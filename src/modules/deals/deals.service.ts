import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { DealRepository, DealLean } from './repositories/deal.repository';
import { DealMapper, DealResponse } from './mappers/deal.mapper';
import { CompanyRepository } from '../companies/repositories/company.repository';
import { ContactRepository } from '../contacts/repositories/contact.repository';
import { UserRepository } from '../users/repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { SystemRole } from '../roles/constants/role.constant';
import { UserStatus } from '../users/constants/user-status.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { RedisService } from '../../common/redis/redis.service';
import {
  CrmActivityRepository,
  CrmActivityLean,
} from '../../common/repositories/crm-activity.repository';
import {
  ActivityEntityType,
  CrmActivity,
} from '../../common/schemas/crm-activity.schema';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { getChangedFields } from '../../common/utils/change-detection.util';
import {
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE,
  DEAL_CACHE_KEYS,
  fromMinorUnits,
  toMinorUnits,
} from './constants/deal.constant';
import {
  DEFAULT_STAGE_PROBABILITIES,
  DealStage,
  OPEN_STAGES,
  STAGE_STATUS_MAP,
} from './constants/deal-stage.constant';
import { DealStatus } from './constants/deal-status.constant';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { AssignDealDto } from './dto/assign-deal.dto';
import { ChangeDealStageDto } from './dto/change-deal-stage.dto';
import { CloseDealDto } from './dto/close-deal.dto';
import { ReopenDealDto } from './dto/reopen-deal.dto';
import { BulkAssignDealsDto } from './dto/bulk-assign-deals.dto';
import { AddDealNoteDto } from './dto/add-deal-note.dto';
import { LogDealActivityDto } from './dto/log-deal-activity.dto';
import { UpdateDealActivityDto } from './dto/update-deal-activity.dto';
import { ForecastQueryDto } from './dto/forecast-query.dto';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly dealRepository: DealRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly contactRepository: ContactRepository,
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly redisService: RedisService,
    private readonly crmActivityRepository: CrmActivityRepository,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private async isUserAdmin(userId: Types.ObjectId): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.roleIds?.length) return false;
    const activeRoles = await this.roleRepository.findActiveByIds(user.roleIds);
    return activeRoles.some(
      (r) =>
        r.key === (SystemRole.SUPER_ADMIN as string) ||
        r.key === (SystemRole.ADMIN as string),
    );
  }

  private async validateOwnerUser(
    ownerId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const user = await this.userRepository.findById(ownerId, session);
    if (!user) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Assigned owner user not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Assigned owner user is not active',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async validateCompany(
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const company = await this.companyRepository.findById(companyId, session);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Associated company not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async validateContact(
    contactId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const contact = await this.contactRepository.findById(contactId, session);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Associated contact not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async verifyDealAccess(
    dealId: Types.ObjectId,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean> {
    const deal = await this.dealRepository.findById(dealId, session);
    if (!deal) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Deal not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const isAdmin = await this.isUserAdmin(actorId);
    if (!isAdmin && deal.ownerId && !deal.ownerId.equals(actorId)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You do not have access to this deal',
        HttpStatus.FORBIDDEN,
      );
    }
    return deal;
  }

  async create(
    dto: CreateDealDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse> {
    const ownerId = dto.ownerId ? new Types.ObjectId(dto.ownerId) : actorId;
    const companyId = dto.companyId ? new Types.ObjectId(dto.companyId) : null;
    const contactId = dto.contactId ? new Types.ObjectId(dto.contactId) : null;
    const leadId = dto.leadId ? new Types.ObjectId(dto.leadId) : null;

    await this.validateOwnerUser(ownerId);
    if (companyId) await this.validateCompany(companyId);
    if (contactId) await this.validateContact(contactId);

    const currency = (dto.currency || DEFAULT_CURRENCY).toUpperCase();
    const stage = dto.stage || DealStage.NEW;
    const status = STAGE_STATUS_MAP[stage] || DealStatus.OPEN;
    const probability =
      dto.probability !== undefined
        ? dto.probability
        : (DEFAULT_STAGE_PROBABILITIES[stage] ?? 10);

    const products = dto.products
      ? DealMapper.calculateProductTotals(dto.products, currency)
      : [];

    const amount = dto.amount;
    if (products.length > 0) {
      const productsTotalMinor = products.reduce(
        (sum, p) => sum + toMinorUnits(p.total, currency),
        0,
      );
      const expectedAmount = fromMinorUnits(productsTotalMinor, currency);
      if (toMinorUnits(amount, currency) !== productsTotalMinor) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Deal amount (${amount}) does not match the sum of line items (${expectedAmount})`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const session = await this.connection.startSession();
    let createdDeal: DealLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        createdDeal = await this.dealRepository.create(
          {
            title: dto.title.trim(),
            description: dto.description ? dto.description.trim() : null,
            pipeline: dto.pipeline || DEFAULT_PIPELINE,
            stage,
            status,
            amount,
            currency,
            probability,
            expectedCloseDate: dto.expectedCloseDate
              ? new Date(dto.expectedCloseDate)
              : null,
            companyId,
            contactId,
            ownerId,
            leadId,
            products,
            notes: [],
            closureHistory: [],
            tags: dto.tags ? dto.tags.map((t) => t.trim().toLowerCase()) : [],
            priority: dto.priority,
            deletedAt: null,
            createdBy: actorId,
            updatedBy: actorId,
          },
          s,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEAL_CREATED,
            targetId: createdDeal._id,
            targetModel: AuditTargetModel.DEAL,
            details: {
              title: createdDeal.title,
              amount: createdDeal.amount,
              currency: createdDeal.currency,
              stage: createdDeal.stage,
              ownerId: createdDeal.ownerId?.toString() ?? null,
              companyId: createdDeal.companyId?.toString() ?? null,
              contactId: createdDeal.contactId?.toString() ?? null,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(
      DEAL_CACHE_KEYS.DETAIL(createdDeal!._id.toString()),
    );

    const populated = await this.dealRepository.findByIdPopulated(
      createdDeal!._id,
    );
    return DealMapper.toResponse(populated || createdDeal!);
  }

  async findAll(
    queryDto: ListDealsQueryDto,
    actorId: Types.ObjectId,
  ): Promise<PaginatedResult<DealResponse>> {
    const isAdmin = await this.isUserAdmin(actorId);
    const scopedOwnerId = isAdmin ? undefined : actorId;

    const result = await this.dealRepository.findList(queryDto, scopedOwnerId);
    return {
      data: DealMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  async findById(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
  ): Promise<DealResponse> {
    await this.verifyDealAccess(id, actorId);
    const deal = await this.dealRepository.findByIdPopulated(id);
    if (!deal) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Deal not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return DealMapper.toResponse(deal, { includeNotes: true });
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateDealDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse> {
    const existing = await this.verifyDealAccess(id, actorId);

    // Terminal Lock: Updates on closed deals are rejected
    if (
      existing.status === DealStatus.WON ||
      existing.status === DealStatus.LOST
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot update a closed deal. Reopen the deal first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const currency = (
      dto.currency ||
      existing.currency ||
      DEFAULT_CURRENCY
    ).toUpperCase();

    if (dto.companyId !== undefined) {
      if (dto.companyId) {
        await this.validateCompany(new Types.ObjectId(dto.companyId));
      }
    }

    if (dto.contactId !== undefined) {
      if (dto.contactId) {
        await this.validateContact(new Types.ObjectId(dto.contactId));
      }
    }

    const updateData: Record<string, any> = { updatedBy: actorId };

    if (dto.title !== undefined) updateData.title = dto.title.trim();
    if (dto.description !== undefined) {
      updateData.description = dto.description ? dto.description.trim() : null;
    }
    if (dto.pipeline !== undefined) updateData.pipeline = dto.pipeline;
    if (dto.priority !== undefined) updateData.priority = dto.priority;
    if (dto.currency !== undefined) updateData.currency = currency;

    if (dto.probability !== undefined) {
      if (dto.probability < 0 || dto.probability > 99) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Open deal probability must be between 0 and 99',
          HttpStatus.BAD_REQUEST,
        );
      }
      updateData.probability = dto.probability;
    }

    if (dto.expectedCloseDate !== undefined) {
      updateData.expectedCloseDate = dto.expectedCloseDate
        ? new Date(dto.expectedCloseDate)
        : null;
    }

    if (dto.companyId !== undefined) {
      updateData.companyId = dto.companyId
        ? new Types.ObjectId(dto.companyId)
        : null;
    }
    if (dto.contactId !== undefined) {
      updateData.contactId = dto.contactId
        ? new Types.ObjectId(dto.contactId)
        : null;
    }
    if (dto.leadId !== undefined) {
      updateData.leadId = dto.leadId ? new Types.ObjectId(dto.leadId) : null;
    }

    if (dto.tags !== undefined) {
      updateData.tags = dto.tags.map((t) => t.trim().toLowerCase());
    }

    // Handle line items and amount reconciliation
    if (dto.products !== undefined) {
      const products = DealMapper.calculateProductTotals(
        dto.products,
        currency,
      );
      updateData.products = products;
      const productsTotalMinor = products.reduce(
        (sum, p) => sum + toMinorUnits(p.total, currency),
        0,
      );
      const expectedAmount = fromMinorUnits(productsTotalMinor, currency);

      if (dto.amount !== undefined) {
        if (toMinorUnits(dto.amount, currency) !== productsTotalMinor) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Deal amount (${dto.amount}) does not match the sum of line items (${expectedAmount})`,
            HttpStatus.BAD_REQUEST,
          );
        }
        updateData.amount = dto.amount;
      } else {
        updateData.amount = expectedAmount;
      }
    } else if (dto.amount !== undefined) {
      // If products exist and amount is updated without updating products, check matching
      if (existing.products && existing.products.length > 0) {
        const productsTotalMinor = existing.products.reduce(
          (sum, p) => sum + toMinorUnits(p.total, currency),
          0,
        );
        if (toMinorUnits(dto.amount, currency) !== productsTotalMinor) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Deal amount (${dto.amount}) does not match existing line items total (${fromMinorUnits(productsTotalMinor, currency)})`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      updateData.amount = dto.amount;
    }

    const changedFields = getChangedFields(
      updateData,
      existing as unknown as Record<string, unknown>,
    );

    const session = await this.connection.startSession();
    let updatedDeal: DealLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const res = await this.dealRepository.updateById(id, updateData, s);
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Deal not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updatedDeal = res;

        if (Object.keys(changedFields).length > 0) {
          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.DEAL_UPDATED,
              targetId: id,
              targetModel: AuditTargetModel.DEAL,
              details: {
                changes: changedFields,
              },
              ipAddress: metadata.ipAddress,
              userAgent: metadata.userAgent,
            },
            s,
          );
        }
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(id.toString()));

    const populated = await this.dealRepository.findByIdPopulated(id);
    return DealMapper.toResponse(populated || updatedDeal!);
  }

  async changeStage(
    id: Types.ObjectId,
    dto: ChangeDealStageDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse> {
    const existing = await this.verifyDealAccess(id, actorId);

    // Terminal Lock: Cannot change stage of already closed deal directly
    if (
      existing.status === DealStatus.WON ||
      existing.status === DealStatus.LOST
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot change stage of a closed deal. Reopen the deal first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Direct transition to terminal stage must use close endpoint or follow close rules
    if (
      dto.stage === DealStage.CLOSED_WON ||
      dto.stage === DealStage.CLOSED_LOST
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `To close a deal as ${dto.stage}, use the dedicated PATCH /deals/:id/close endpoint.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const targetProbability =
      dto.probability !== undefined
        ? dto.probability
        : (DEFAULT_STAGE_PROBABILITIES[dto.stage] ?? 10);

    const session = await this.connection.startSession();
    let updatedDeal: DealLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const res = await this.dealRepository.updateStage(
          id,
          dto.stage,
          targetProbability,
          actorId,
          s,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Deal not found or already closed',
            HttpStatus.NOT_FOUND,
          );
        }
        updatedDeal = res;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEAL_STAGE_CHANGED,
            targetId: id,
            targetModel: AuditTargetModel.DEAL,
            details: {
              previousStage: existing.stage,
              newStage: dto.stage,
              previousProbability: existing.probability,
              newProbability: targetProbability,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(id.toString()));

    const populated = await this.dealRepository.findByIdPopulated(id);
    return DealMapper.toResponse(populated || updatedDeal!);
  }

  async closeDeal(
    id: Types.ObjectId,
    dto: CloseDealDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse> {
    await this.verifyDealAccess(id, actorId);

    if (
      dto.stage === DealStage.CLOSED_LOST &&
      (!dto.lostReason || dto.lostReason.trim().length < 3)
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'A valid lostReason (minimum 3 characters) is required when closing a deal as LOST',
        HttpStatus.BAD_REQUEST,
      );
    }

    const status =
      dto.stage === DealStage.CLOSED_WON ? DealStatus.WON : DealStatus.LOST;
    const session = await this.connection.startSession();
    let closedDeal: DealLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const res = await this.dealRepository.closeDeal(
          id,
          dto.stage,
          status,
          dto.lostReason ? dto.lostReason.trim() : null,
          dto.lostCompetitor ? dto.lostCompetitor.trim() : null,
          actorId,
          s,
        );

        if (!res) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Deal closure failed: deal does not exist, is deleted, or is already closed.',
            HttpStatus.BAD_REQUEST,
          );
        }
        closedDeal = res;

        const auditAction =
          status === DealStatus.WON
            ? AuditAction.DEAL_CLOSED_WON
            : AuditAction.DEAL_CLOSED_LOST;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: auditAction,
            targetId: id,
            targetModel: AuditTargetModel.DEAL,
            details: {
              stage: dto.stage,
              status,
              amount: closedDeal.amount,
              currency: closedDeal.currency,
              lostReason: dto.lostReason ?? null,
              lostCompetitor: dto.lostCompetitor ?? null,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(id.toString()));

    const populated = await this.dealRepository.findByIdPopulated(id);
    return DealMapper.toResponse(populated || closedDeal!);
  }

  async reopenDeal(
    id: Types.ObjectId,
    dto: ReopenDealDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse> {
    const existing = await this.verifyDealAccess(id, actorId);

    if (existing.status === DealStatus.OPEN) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Only closed deals (WON or LOST) can be reopened',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!dto.reopenReason || dto.reopenReason.trim().length < 5) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'A valid reopenReason (minimum 5 characters) is required to reopen a closed deal',
        HttpStatus.BAD_REQUEST,
      );
    }

    const targetStage = dto.targetStage || DealStage.NEGOTIATION;
    if (!OPEN_STAGES.includes(targetStage)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Target stage upon reopen must be an active open pipeline stage',
        HttpStatus.BAD_REQUEST,
      );
    }

    const targetProbability =
      dto.probability !== undefined
        ? dto.probability
        : (DEFAULT_STAGE_PROBABILITIES[targetStage] ?? 80);

    const session = await this.connection.startSession();
    let reopenedDeal: DealLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const res = await this.dealRepository.reopenDeal(
          id,
          targetStage,
          targetProbability,
          dto.reopenReason.trim(),
          actorId,
          s,
        );

        if (!res) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Deal reopening failed: deal must currently be closed (WON or LOST).',
            HttpStatus.BAD_REQUEST,
          );
        }
        reopenedDeal = res;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEAL_REOPENED,
            targetId: id,
            targetModel: AuditTargetModel.DEAL,
            details: {
              targetStage,
              probability: targetProbability,
              reopenReason: dto.reopenReason.trim(),
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(id.toString()));

    const populated = await this.dealRepository.findByIdPopulated(id);
    return DealMapper.toResponse(populated || reopenedDeal!);
  }

  async assignOwner(
    id: Types.ObjectId,
    dto: AssignDealDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse> {
    const existing = await this.verifyDealAccess(id, actorId);
    const newOwnerId = new Types.ObjectId(dto.ownerId);
    await this.validateOwnerUser(newOwnerId);

    const session = await this.connection.startSession();
    let updatedDeal: DealLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const res = await this.dealRepository.updateOwner(
          id,
          newOwnerId,
          actorId,
          s,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Deal not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updatedDeal = res;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEAL_ASSIGNED,
            targetId: id,
            targetModel: AuditTargetModel.DEAL,
            details: {
              previousOwnerId: existing.ownerId?.toString() ?? null,
              newOwnerId: newOwnerId.toString(),
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(id.toString()));

    const populated = await this.dealRepository.findByIdPopulated(id);
    return DealMapper.toResponse(populated || updatedDeal!);
  }

  async bulkAssign(
    dto: BulkAssignDealsDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<{ assignedCount: number }> {
    const newOwnerId = new Types.ObjectId(dto.ownerId);
    await this.validateOwnerUser(newOwnerId);

    const dealObjectIds = dto.dealIds.map((idStr) => new Types.ObjectId(idStr));

    // Verify caller has access to every single deal in the batch
    for (const dId of dealObjectIds) {
      await this.verifyDealAccess(dId, actorId);
    }

    const session = await this.connection.startSession();
    let assignedCount = 0;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        assignedCount = await this.dealRepository.bulkUpdateOwner(
          dealObjectIds,
          newOwnerId,
          actorId,
          s,
        );

        for (const dId of dealObjectIds) {
          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.DEAL_ASSIGNED,
              targetId: dId,
              targetModel: AuditTargetModel.DEAL,
              details: {
                bulkAssigned: true,
                newOwnerId: newOwnerId.toString(),
              },
              ipAddress: metadata.ipAddress,
              userAgent: metadata.userAgent,
            },
            s,
          );
        }
      });
    } finally {
      await session.endSession();
    }

    for (const dId of dealObjectIds) {
      await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(dId.toString()));
    }

    return { assignedCount };
  }

  async getPipeline(
    pipeline = DEFAULT_PIPELINE,
    actorId: Types.ObjectId,
  ): Promise<
    Array<{
      stage: DealStage;
      count: number;
      totalAmount: number;
      deals: DealResponse[];
    }>
  > {
    const isAdmin = await this.isUserAdmin(actorId);
    const scopedOwnerId = isAdmin ? undefined : actorId;

    const kanban = await this.dealRepository.getPipelineKanban(
      pipeline,
      scopedOwnerId,
    );
    return kanban.map((column) => ({
      stage: column.stage,
      count: column.count,
      totalAmount: column.totalAmount,
      deals: DealMapper.toResponseList(column.deals),
    }));
  }

  async getForecast(
    queryDto: ForecastQueryDto,
    actorId: Types.ObjectId,
  ): Promise<{
    currency: string;
    totalPipeline: number;
    weightedPipeline: number;
    count: number;
    byStage: Array<{
      stage: DealStage;
      count: number;
      totalAmount: number;
      weightedAmount: number;
    }>;
  }> {
    if (queryDto.startDate && queryDto.endDate) {
      const start = new Date(queryDto.startDate);
      const end = new Date(queryDto.endDate);
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 3600 * 24);
      if (diffDays > 365) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Forecast date range cannot exceed 365 days',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const isAdmin = await this.isUserAdmin(actorId);
    const scopedOwnerId = isAdmin ? undefined : actorId;

    return this.dealRepository.getForecast(queryDto, scopedOwnerId);
  }

  async exportDeals(
    queryDto: ListDealsQueryDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse[]> {
    const isAdmin = await this.isUserAdmin(actorId);
    const scopedOwnerId = isAdmin ? undefined : actorId;

    const deals = await this.dealRepository.findForExport(
      queryDto,
      scopedOwnerId,
      1000,
    );

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.DOCUMENT_DOWNLOADED,
      targetId: actorId,
      targetModel: AuditTargetModel.USER,
      details: {
        exportModule: 'DEALS',
        count: deals.length,
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });

    return DealMapper.toResponseList(deals);
  }

  async softDelete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const existing = await this.verifyDealAccess(id, actorId);

    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const deleted = await this.dealRepository.softDelete(id, actorId, s);
        if (!deleted) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Deal not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEAL_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.DEAL,
            details: {
              title: existing.title,
              amount: existing.amount,
              stage: existing.stage,
              status: existing.status,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(id.toString()));
  }

  async addNote(
    dealId: Types.ObjectId,
    dto: AddDealNoteDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse> {
    await this.verifyDealAccess(dealId, actorId);

    const note = {
      _id: new Types.ObjectId(),
      content: dto.content.trim(),
      createdBy: actorId,
      deletedAt: null,
      deletedBy: null,
    };

    const session = await this.connection.startSession();
    let updatedDeal: DealLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const res = await this.dealRepository.addNote(dealId, note, s);
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Deal not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updatedDeal = res;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEAL_NOTE_ADDED,
            targetId: dealId,
            targetModel: AuditTargetModel.DEAL,
            details: { noteId: note._id.toString() },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(dealId.toString()));

    const populated = await this.dealRepository.findByIdPopulated(dealId);
    return DealMapper.toResponse(populated || updatedDeal!, {
      includeNotes: true,
    });
  }

  async deleteNote(
    dealId: Types.ObjectId,
    noteId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<DealResponse> {
    const deal = await this.verifyDealAccess(dealId, actorId);

    const note = deal.notes?.find((n) => n._id.equals(noteId) && !n.deletedAt);
    if (!note) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Note not found on this deal',
        HttpStatus.NOT_FOUND,
      );
    }

    const isAdmin = await this.isUserAdmin(actorId);
    if (!isAdmin && !note.createdBy.equals(actorId)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the author or an admin can delete this note',
        HttpStatus.FORBIDDEN,
      );
    }

    const session = await this.connection.startSession();
    let updatedDeal: DealLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const res = await this.dealRepository.deleteNote(
          dealId,
          noteId,
          actorId,
          s,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Deal or note not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updatedDeal = res;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEAL_NOTE_DELETED,
            targetId: dealId,
            targetModel: AuditTargetModel.DEAL,
            details: { noteId: noteId.toString() },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(DEAL_CACHE_KEYS.DETAIL(dealId.toString()));

    const populated = await this.dealRepository.findByIdPopulated(dealId);
    return DealMapper.toResponse(populated || updatedDeal!, {
      includeNotes: true,
    });
  }

  async logActivity(
    dealId: Types.ObjectId,
    dto: LogDealActivityDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<CrmActivityLean> {
    await this.verifyDealAccess(dealId, actorId);

    const activityDate = dto.activityDate
      ? new Date(dto.activityDate)
      : dto.performedAt
        ? new Date(dto.performedAt)
        : new Date();

    const activity = await this.crmActivityRepository.create({
      entityType: ActivityEntityType.DEAL,
      entityId: dealId,
      type: dto.type,
      subject: dto.subject.trim(),
      description: dto.description ? dto.description.trim() : null,
      activityDate,
      durationMinutes: dto.durationMinutes,
      outcome: dto.outcome,
      performedBy: actorId,
    });

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.DEAL_ACTIVITY_LOGGED,
      targetId: dealId,
      targetModel: AuditTargetModel.DEAL,
      details: {
        activityId: activity._id.toString(),
        type: activity.type,
        subject: activity.subject,
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });

    return activity;
  }

  async listActivities(
    dealId: Types.ObjectId,
    queryDto: PaginationQueryDto,
    actorId: Types.ObjectId,
  ): Promise<PaginatedResult<CrmActivityLean>> {
    await this.verifyDealAccess(dealId, actorId);
    return this.crmActivityRepository.findTimeline(
      ActivityEntityType.DEAL,
      dealId,
      queryDto,
    );
  }

  async updateActivity(
    dealId: Types.ObjectId,
    activityId: Types.ObjectId,
    dto: UpdateDealActivityDto,
    actorId: Types.ObjectId,
  ): Promise<CrmActivityLean> {
    await this.verifyDealAccess(dealId, actorId);

    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Cross-resource safety validation
    if (
      activity.entityType !== ActivityEntityType.DEAL ||
      !activity.entityId.equals(dealId)
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Activity does not belong to the specified deal',
        HttpStatus.FORBIDDEN,
      );
    }

    const isAdmin = await this.isUserAdmin(actorId);
    if (!isAdmin && !activity.performedBy.equals(actorId)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the author or an admin can update this activity',
        HttpStatus.FORBIDDEN,
      );
    }

    const updateData: Partial<CrmActivity> = {};
    if (dto.subject !== undefined) updateData.subject = dto.subject.trim();
    if (dto.description !== undefined) {
      updateData.description = dto.description ? dto.description.trim() : null;
    }
    const dateToUpdate = dto.activityDate || dto.performedAt;
    if (dateToUpdate !== undefined) {
      updateData.activityDate = new Date(dateToUpdate);
    }
    if (dto.durationMinutes !== undefined) {
      updateData.durationMinutes = dto.durationMinutes;
    }
    if (dto.outcome !== undefined) updateData.outcome = dto.outcome;

    const updated = await this.crmActivityRepository.updateById(
      activityId,
      updateData,
    );
    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return updated;
  }

  async deleteActivity(
    dealId: Types.ObjectId,
    activityId: Types.ObjectId,
    actorId: Types.ObjectId,
  ): Promise<void> {
    await this.verifyDealAccess(dealId, actorId);

    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Cross-resource safety validation
    if (
      activity.entityType !== ActivityEntityType.DEAL ||
      !activity.entityId.equals(dealId)
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Activity does not belong to the specified deal',
        HttpStatus.FORBIDDEN,
      );
    }

    const isAdmin = await this.isUserAdmin(actorId);
    if (!isAdmin && !activity.performedBy.equals(actorId)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the author or an admin can delete this activity',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.crmActivityRepository.softDelete(activityId, actorId);
  }
}
