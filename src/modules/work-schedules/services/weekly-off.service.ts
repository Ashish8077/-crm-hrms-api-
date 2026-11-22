import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { WeeklyOffConfigRepository } from '../repositories/weekly-off-config.repository';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { CreateWeeklyOffConfigDto } from '../dto/create-weekly-off-config.dto';
import { UpdateWeeklyOffConfigDto } from '../dto/update-weekly-off-config.dto';
import { ListWeeklyOffQueryDto } from '../dto/list-weekly-off-query.dto';
import { WeeklyOffDayDto } from '../dto/weekly-off-day.dto';
import {
  WeeklyOffConfigLean,
  WeeklyOffConfigMapper,
  WeeklyOffConfigResponse,
} from '../mappers/weekly-off-config.mapper';
import { WeeklyOffCalculationUtil } from '../utils/weekly-off-calculation.util';
import { WEEKLY_OFF_CONSTANTS } from '../constants/weekly-off.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';

export interface EffectiveWeeklyOffResult {
  isWeeklyOff: boolean;
  date: string;
  source: 'BRANCH_OVERRIDE' | 'COMPANY_DEFAULT' | 'SYSTEM_DEFAULT';
  configuration: WeeklyOffConfigResponse | null;
}

@Injectable()
export class WeeklyOffService {
  private readonly logger = new Logger(WeeklyOffService.name);

  constructor(
    private readonly weeklyOffRepository: WeeklyOffConfigRepository,
    private readonly branchRepository: BranchRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private validateDayRules(days: WeeklyOffDayDto[]): void {
    if (!days || days.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'At least one weekly off day rule must be specified',
        HttpStatus.BAD_REQUEST,
      );
    }

    const seenDays = new Set<number>();
    for (const d of days) {
      if (seenDays.has(d.dayOfWeek)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Duplicate dayOfWeek (${d.dayOfWeek}) specified in weekly off rules. Combine occurrences into a single entry.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      seenDays.add(d.dayOfWeek);

      if (d.occurrences) {
        for (const occ of d.occurrences) {
          if (!Number.isInteger(occ) || occ < 1 || occ > 5) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Invalid occurrence (${occ}) in weekly off rule for day ${d.dayOfWeek}. Must be between 1 and 5.`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }
    }
  }

  private async validateBranch(
    branchId?: string | Types.ObjectId | null,
  ): Promise<Types.ObjectId | null> {
    if (!branchId || branchId === 'null' || branchId === 'company') {
      return null;
    }

    const objectId =
      typeof branchId === 'string' ? new Types.ObjectId(branchId) : branchId;

    const branch = await this.branchRepository.findById(objectId);
    if (!branch || branch.deletedAt) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Specified branch does not exist',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!branch.isActive) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot assign weekly off configuration to an inactive branch',
        HttpStatus.BAD_REQUEST,
      );
    }

    return objectId;
  }

  async create(
    dto: CreateWeeklyOffConfigDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<WeeklyOffConfigResponse> {
    this.validateDayRules(dto.days);

    if (dto.effectiveTo && dto.effectiveTo < dto.effectiveFrom) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'effectiveTo cannot be earlier than effectiveFrom',
        HttpStatus.BAD_REQUEST,
      );
    }

    const branchObjectId = await this.validateBranch(dto.branchId);
    const isActive = dto.isActive ?? true;

    // Check conflict if activating
    if (isActive) {
      const conflict = await this.weeklyOffRepository.findOverlappingConfig({
        branchId: branchObjectId,
        effectiveFrom: dto.effectiveFrom,
        effectiveTo: dto.effectiveTo ?? null,
      });

      if (conflict) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `An active weekly off configuration '${conflict.name}' already overlaps with effective dates [${conflict.effectiveFrom} to ${conflict.effectiveTo ?? 'ongoing'}] for this scope.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const normalizedDays = dto.days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      occurrences:
        d.occurrences && d.occurrences.length > 0
          ? Array.from(new Set(d.occurrences)).sort((a, b) => a - b)
          : [1, 2, 3, 4, 5],
    }));

    let created: WeeklyOffConfigLean;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        if (isActive) {
          const conflict = await this.weeklyOffRepository.findOverlappingConfig(
            {
              branchId: branchObjectId,
              effectiveFrom: dto.effectiveFrom,
              effectiveTo: dto.effectiveTo ?? null,
              session,
            },
          );

          if (conflict) {
            throw new AppError(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              `An active weekly off configuration '${conflict.name}' already overlaps with effective dates [${conflict.effectiveFrom} to ${conflict.effectiveTo ?? 'ongoing'}] for this scope.`,
              HttpStatus.CONFLICT,
            );
          }
        }

        created = await this.weeklyOffRepository.create(
          {
            name: dto.name.trim(),
            description: dto.description?.trim() ?? null,
            branchId: branchObjectId,
            days: normalizedDays,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo ?? null,
            isActive,
            createdBy: actorId,
            updatedBy: actorId,
          },
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.WEEKLY_OFF_CONFIG_CREATED,
            targetId: created._id,
            targetModel: AuditTargetModel.WEEKLY_OFF_CONFIG,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              name: created.name,
              branchId: branchObjectId
                ? branchObjectId.toString()
                : 'company-wide',
              effectiveFrom: created.effectiveFrom,
              effectiveTo: created.effectiveTo,
              isActive: created.isActive,
            },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    return WeeklyOffConfigMapper.toResponse(created!);
  }

  async list(
    query: ListWeeklyOffQueryDto,
  ): Promise<PaginatedResult<WeeklyOffConfigResponse>> {
    let branchFilter: Types.ObjectId | null | 'company' | undefined = undefined;

    if (query.branchId !== undefined) {
      if (
        query.branchId === 'null' ||
        query.branchId === 'company' ||
        query.branchId === ''
      ) {
        branchFilter = 'company';
      } else if (Types.ObjectId.isValid(query.branchId)) {
        branchFilter = new Types.ObjectId(query.branchId);
      } else {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Invalid branchId filter format',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const paginated = await this.weeklyOffRepository.findPaginated({
      branchId: branchFilter,
      isActive: query.isActive,
      page: query.page,
      limit: query.limit,
    });

    return WeeklyOffConfigMapper.toPaginatedResponse(paginated);
  }

  async getById(id: Types.ObjectId | string): Promise<WeeklyOffConfigResponse> {
    const config = await this.weeklyOffRepository.findById(id);
    if (!config) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Weekly off configuration not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return WeeklyOffConfigMapper.toResponse(config);
  }

  async update(
    id: Types.ObjectId | string,
    dto: UpdateWeeklyOffConfigDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<WeeklyOffConfigResponse> {
    const existing = await this.weeklyOffRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Weekly off configuration not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.days) {
      this.validateDayRules(dto.days);
    }

    const effectiveFrom = dto.effectiveFrom ?? existing.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo !== undefined ? dto.effectiveTo : existing.effectiveTo;

    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'effectiveTo cannot be earlier than effectiveFrom',
        HttpStatus.BAD_REQUEST,
      );
    }

    const targetIsActive =
      dto.isActive !== undefined ? dto.isActive : existing.isActive;

    if (targetIsActive) {
      const conflict = await this.weeklyOffRepository.findOverlappingConfig({
        branchId: existing.branchId,
        effectiveFrom,
        effectiveTo: effectiveTo ?? null,
        excludeId: existing._id,
      });

      if (conflict) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `An active weekly off configuration '${conflict.name}' already overlaps with effective dates [${conflict.effectiveFrom} to ${conflict.effectiveTo ?? 'ongoing'}] for this scope.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const updatePayload: Partial<WeeklyOffConfigLean> = {
      updatedBy: actorId,
    };

    if (dto.name !== undefined) {
      updatePayload.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      updatePayload.description = dto.description?.trim() ?? null;
    }
    if (dto.days !== undefined) {
      updatePayload.days = dto.days.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        occurrences:
          d.occurrences && d.occurrences.length > 0
            ? Array.from(new Set(d.occurrences)).sort((a, b) => a - b)
            : [1, 2, 3, 4, 5],
      }));
    }
    if (dto.effectiveFrom !== undefined) {
      updatePayload.effectiveFrom = dto.effectiveFrom;
    }
    if (dto.effectiveTo !== undefined) {
      updatePayload.effectiveTo = dto.effectiveTo;
    }
    if (dto.isActive !== undefined) {
      updatePayload.isActive = dto.isActive;
    }

    let updated: WeeklyOffConfigLean;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        if (targetIsActive) {
          const conflict = await this.weeklyOffRepository.findOverlappingConfig(
            {
              branchId: existing.branchId,
              effectiveFrom,
              effectiveTo: effectiveTo ?? null,
              excludeId: existing._id,
              session,
            },
          );

          if (conflict) {
            throw new AppError(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              `An active weekly off configuration '${conflict.name}' already overlaps with effective dates [${conflict.effectiveFrom} to ${conflict.effectiveTo ?? 'ongoing'}] for this scope.`,
              HttpStatus.CONFLICT,
            );
          }
        }

        updated = (await this.weeklyOffRepository.update(
          existing._id,
          updatePayload,
          session,
        ))!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.WEEKLY_OFF_CONFIG_UPDATED,
            targetId: existing._id,
            targetModel: AuditTargetModel.WEEKLY_OFF_CONFIG,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              previous: {
                name: existing.name,
                effectiveFrom: existing.effectiveFrom,
                effectiveTo: existing.effectiveTo,
                isActive: existing.isActive,
              },
              updated: {
                name: updated.name,
                effectiveFrom: updated.effectiveFrom,
                effectiveTo: updated.effectiveTo,
                isActive: updated.isActive,
              },
            },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    return WeeklyOffConfigMapper.toResponse(updated!);
  }

  async updateStatus(
    id: Types.ObjectId | string,
    isActive: boolean,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<WeeklyOffConfigResponse> {
    const existing = await this.weeklyOffRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Weekly off configuration not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.isActive === isActive) {
      return WeeklyOffConfigMapper.toResponse(existing);
    }

    if (isActive) {
      const conflict = await this.weeklyOffRepository.findOverlappingConfig({
        branchId: existing.branchId,
        effectiveFrom: existing.effectiveFrom,
        effectiveTo: existing.effectiveTo ?? null,
        excludeId: existing._id,
      });

      if (conflict) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Cannot activate configuration: overlaps with active configuration '${conflict.name}' [${conflict.effectiveFrom} to ${conflict.effectiveTo ?? 'ongoing'}].`,
          HttpStatus.CONFLICT,
        );
      }
    }

    let updated: WeeklyOffConfigLean;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        if (isActive) {
          const conflict = await this.weeklyOffRepository.findOverlappingConfig(
            {
              branchId: existing.branchId,
              effectiveFrom: existing.effectiveFrom,
              effectiveTo: existing.effectiveTo ?? null,
              excludeId: existing._id,
              session,
            },
          );

          if (conflict) {
            throw new AppError(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              `Cannot activate configuration: overlaps with active configuration '${conflict.name}' [${conflict.effectiveFrom} to ${conflict.effectiveTo ?? 'ongoing'}].`,
              HttpStatus.CONFLICT,
            );
          }
        }

        updated = (await this.weeklyOffRepository.update(
          existing._id,
          { isActive, updatedBy: actorId },
          session,
        ))!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.WEEKLY_OFF_CONFIG_STATUS_CHANGED,
            targetId: existing._id,
            targetModel: AuditTargetModel.WEEKLY_OFF_CONFIG,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              name: existing.name,
              previousStatus: existing.isActive,
              newStatus: isActive,
            },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    return WeeklyOffConfigMapper.toResponse(updated!);
  }

  async delete(
    id: Types.ObjectId | string,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const existing = await this.weeklyOffRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Weekly off configuration not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.weeklyOffRepository.softDelete(
          existing._id,
          actorId,
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.WEEKLY_OFF_CONFIG_DELETED,
            targetId: existing._id,
            targetModel: AuditTargetModel.WEEKLY_OFF_CONFIG,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              name: existing.name,
              branchId: existing.branchId
                ? existing.branchId.toString()
                : 'company-wide',
            },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  async getEffectiveConfig(
    date: string,
    branchId?: Types.ObjectId | string | null,
  ): Promise<EffectiveWeeklyOffResult> {
    let branchObjectId: Types.ObjectId | null = null;
    if (branchId && Types.ObjectId.isValid(branchId.toString())) {
      branchObjectId =
        typeof branchId === 'string' ? new Types.ObjectId(branchId) : branchId;
    }

    // 1. Check branch-level override
    if (branchObjectId) {
      const branchConfig = await this.weeklyOffRepository.findEffectiveConfig(
        date,
        branchObjectId,
      );
      if (branchConfig) {
        const isOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
          date,
          branchConfig.days,
        );
        return {
          isWeeklyOff: isOff,
          date,
          source: 'BRANCH_OVERRIDE',
          configuration: WeeklyOffConfigMapper.toResponse(branchConfig),
        };
      }
    }

    // 2. Check company-wide default
    const companyConfig = await this.weeklyOffRepository.findEffectiveConfig(
      date,
      null,
    );
    if (companyConfig) {
      const isOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
        date,
        companyConfig.days,
      );
      return {
        isWeeklyOff: isOff,
        date,
        source: 'COMPANY_DEFAULT',
        configuration: WeeklyOffConfigMapper.toResponse(companyConfig),
      };
    }

    // 3. Fallback to system default (Every Sunday)
    const isOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
      date,
      WEEKLY_OFF_CONSTANTS.DEFAULT_WEEKLY_OFF_DAYS,
    );
    return {
      isWeeklyOff: isOff,
      date,
      source: 'SYSTEM_DEFAULT',
      configuration: null,
    };
  }

  async isWeeklyOff(
    date: string,
    branchId?: Types.ObjectId | string | null,
  ): Promise<boolean> {
    const result = await this.getEffectiveConfig(date, branchId);
    return result.isWeeklyOff;
  }

  /**
   * Evaluates all calendar dates in a date range [startDate, endDate] and returns
   * a Set of dates (YYYY-MM-DD) that are configured weekly offs for the specified branch.
   */
  async getWeeklyOffDatesForRange(
    startDate: string,
    endDate: string,
    branchId?: Types.ObjectId | string | null,
  ): Promise<Set<string>> {
    const weeklyOffDates = new Set<string>();
    const dates = this.enumerateDateRange(startDate, endDate);
    if (dates.length === 0) {
      return weeklyOffDates;
    }

    let branchObjectId: Types.ObjectId | null = null;
    if (branchId && Types.ObjectId.isValid(branchId.toString())) {
      branchObjectId =
        typeof branchId === 'string' ? new Types.ObjectId(branchId) : branchId;
    }

    for (const dStr of dates) {
      const isOff = await this.isWeeklyOff(dStr, branchObjectId);
      if (isOff) {
        weeklyOffDates.add(dStr);
      }
    }

    return weeklyOffDates;
  }

  private enumerateDateRange(startDate: string, endDate: string): string[] {
    const [sY, sM, sD] = startDate.split('-').map(Number);
    const [eY, eM, eD] = endDate.split('-').map(Number);
    const cur = new Date(Date.UTC(sY, sM - 1, sD));
    const end = new Date(Date.UTC(eY, eM - 1, eD));
    const result: string[] = [];

    while (cur <= end) {
      result.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return result;
  }
}
