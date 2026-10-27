import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Types, ClientSession, Model } from 'mongoose';
import { CompanyRepository } from './repositories/company.repository';
import {
  CompanyLean,
  CompanyMapper,
  CompanyResponse,
} from './mappers/company.mapper';
import { UserRepository } from '../users/repositories/user.repository';
import { UserStatus } from '../users/constants/user-status.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { StorageService } from '../storage/storage.service';
import {
  FailedStorageOperation,
  FailedStorageOperationDocument,
  FailedStorageStatus,
  StorageOperationType,
} from '../storage/schemas/failed-storage-operation.schema';
import { RedisService } from '../../common/redis/redis.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import { AssignCompanyDto } from './dto/assign-company.dto';
import { AddCompanyNoteDto } from './dto/add-company-note.dto';
import { LogCompanyActivityDto } from './dto/log-company-activity.dto';
import { UpdateCompanyActivityDto } from './dto/update-company-activity.dto';
import { UploadCompanyDocumentDto } from './dto/upload-company-document.dto';
import { CheckDuplicateCompanyDto } from './dto/check-duplicate-company.dto';
import {
  COMPANY_MAX_DOCUMENTS,
  COMPANY_MAX_NOTES,
  COMPANY_CACHE_KEYS,
} from './constants/company.constant';
import {
  CrmActivityRepository,
  CrmActivityLean,
} from '../../common/repositories/crm-activity.repository';
import {
  ActivityEntityType,
  CrmActivity,
} from '../../common/schemas/crm-activity.schema';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { RoleRepository } from '../roles/repositories/role.repository';
import { SystemRole } from '../roles/constants/role.constant';

const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024; // 10MB

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly companyRepository: CompanyRepository,
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly storageService: StorageService,
    private readonly redisService: RedisService,
    private readonly crmActivityRepository: CrmActivityRepository,
    @InjectModel(FailedStorageOperation.name)
    private readonly failedStorageModel: Model<FailedStorageOperationDocument>,
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

  async validateCompanyHierarchy(
    companyId: Types.ObjectId,
    proposedParentId?: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<void> {
    if (!proposedParentId) return;

    if (companyId.equals(proposedParentId)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'A company cannot be its own parent',
        HttpStatus.BAD_REQUEST,
      );
    }

    const parent = await this.companyRepository.findById(
      proposedParentId,
      session,
    );
    if (!parent) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Parent company not found or is deleted',
        HttpStatus.NOT_FOUND,
      );
    }

    let currentAncestorId: Types.ObjectId | null | undefined =
      parent.parentCompanyId;
    let depth = 0;
    while (currentAncestorId && depth < 5) {
      if (currentAncestorId.equals(companyId)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Circular hierarchy detected: Company is an ancestor of the proposed parent',
          HttpStatus.BAD_REQUEST,
        );
      }
      const ancestor = await this.companyRepository.findById(
        currentAncestorId,
        session,
      );
      currentAncestorId = ancestor?.parentCompanyId;
      depth++;
    }
  }

  async checkDuplicate(
    dto: CheckDuplicateCompanyDto,
  ): Promise<{ exists: boolean; duplicateId?: string }> {
    const reg = dto.registrationNumber || dto.taxId;
    const duplicate = await this.companyRepository.checkDuplicate(
      reg,
      dto.domain,
      dto.email,
    );
    if (duplicate) {
      return { exists: true, duplicateId: duplicate._id.toString() };
    }
    return { exists: false };
  }

  async create(
    dto: CreateCompanyDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<CompanyResponse> {
    const regNumberToCheck = dto.registrationNumber || dto.taxId;
    if (regNumberToCheck) {
      const duplicate = await this.companyRepository.checkDuplicate(
        regNumberToCheck,
        null,
        null,
      );
      if (duplicate) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Company with this registration number or tax ID already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    if (dto.ownerId) {
      await this.validateOwnerUser(new Types.ObjectId(dto.ownerId));
    }
    if (dto.parentCompanyId) {
      const parent = await this.companyRepository.findById(
        new Types.ObjectId(dto.parentCompanyId),
      );
      if (!parent) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Parent company not found',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const session = await this.connection.startSession();
    let result: CompanyLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const createData = CompanyMapper.toCreateData(dto, actorId);
        result = await this.companyRepository.create(createData, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_CREATED,
            targetId: result._id,
            targetModel: AuditTargetModel.COMPANY,
            details: {
              name: result.name,
              registrationNumber: result.registrationNumber,
              industry: result.industry,
              type: result.type,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    return CompanyMapper.toResponse(result!);
  }

  async list(
    queryDto: ListCompaniesQueryDto,
  ): Promise<PaginatedResult<CompanyResponse>> {
    const paginated = await this.companyRepository.findList(queryDto);

    return {
      data: paginated.data.map((company) => CompanyMapper.toResponse(company)),
      meta: paginated.meta,
    };
  }

  async getById(id: Types.ObjectId): Promise<CompanyResponse> {
    const cached = await this.redisService.get(
      COMPANY_CACHE_KEYS.DETAIL(id.toString()),
    );
    if (cached) {
      try {
        return JSON.parse(cached) as CompanyResponse;
      } catch {
        // Fall through to DB
      }
    }

    const company = await this.companyRepository.findById(id);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    let owner = null;
    if (company.ownerId) {
      owner = await this.userRepository.findById(company.ownerId);
    }

    let parentCompany = null;
    if (company.parentCompanyId) {
      parentCompany = await this.companyRepository.findById(
        company.parentCompanyId,
      );
    }

    const response = CompanyMapper.toResponse(
      company,
      null,
      owner,
      parentCompany,
    );

    await this.redisService.set(
      COMPANY_CACHE_KEYS.DETAIL(id.toString()),
      JSON.stringify(response),
      3600,
    );

    return response;
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateCompanyDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<CompanyResponse> {
    const existing = await this.companyRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.registrationNumber) {
      const duplicate = await this.companyRepository.checkDuplicate(
        dto.registrationNumber,
        null,
        null,
        id,
      );
      if (duplicate) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Company with this registration number already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    if (dto.ownerId) {
      await this.validateOwnerUser(new Types.ObjectId(dto.ownerId));
    }
    if (dto.parentCompanyId) {
      await this.validateCompanyHierarchy(
        id,
        new Types.ObjectId(dto.parentCompanyId),
      );
    }

    const session = await this.connection.startSession();
    let result: CompanyLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updateData = CompanyMapper.toUpdateData(dto, actorId);
        const updated = await this.companyRepository.updateById(
          id,
          updateData,
          session,
        );
        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Company not found',
            HttpStatus.NOT_FOUND,
          );
        }
        result = updated;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_UPDATED,
            targetId: id,
            targetModel: AuditTargetModel.COMPANY,
            details: { updatedFields: Object.keys(dto) },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(COMPANY_CACHE_KEYS.DETAIL(id.toString()));

    return CompanyMapper.toResponse(result!);
  }

  async softDelete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const existing = await this.companyRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async (session: ClientSession) => {
        await this.companyRepository.softDelete(id, actorId, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.COMPANY,
            details: { name: existing.name },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    await Promise.all([
      this.redisService.del(COMPANY_CACHE_KEYS.DETAIL(id.toString())),
      this.redisService.del(COMPANY_CACHE_KEYS.CONTACTS(id.toString())),
    ]);
  }

  async assignOwner(
    id: Types.ObjectId,
    dto: AssignCompanyDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<CompanyResponse> {
    const existing = await this.companyRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const newOwnerId = new Types.ObjectId(dto.ownerId);
    await this.validateOwnerUser(newOwnerId);

    const session = await this.connection.startSession();
    let result: CompanyLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updated = await this.companyRepository.updateOwner(
          id,
          newOwnerId,
          actorId,
          session,
        );
        result = updated!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_ASSIGNED,
            targetId: id,
            targetModel: AuditTargetModel.COMPANY,
            details: {
              previousOwnerId: existing.ownerId?.toString() ?? null,
              newOwnerId: newOwnerId.toString(),
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(COMPANY_CACHE_KEYS.DETAIL(id.toString()));

    return CompanyMapper.toResponse(result!);
  }

  async addNote(
    companyId: Types.ObjectId,
    dto: AddCompanyNoteDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<CompanyResponse> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if ((company.notes || []).length >= COMPANY_MAX_NOTES) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Maximum limit of ${COMPANY_MAX_NOTES} notes reached for this company.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await this.connection.startSession();
    let result: CompanyLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        result = (await this.companyRepository.addNote(
          companyId,
          { content: dto.content, createdBy: actorId },
          session,
        ))!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_NOTE_ADDED,
            targetId: companyId,
            targetModel: AuditTargetModel.COMPANY,
            details: { contentPreview: dto.content.slice(0, 50) },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(
      COMPANY_CACHE_KEYS.DETAIL(companyId.toString()),
    );
    return CompanyMapper.toResponse(result!);
  }

  async deleteNote(
    companyId: Types.ObjectId,
    noteId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const note = (company.notes || []).find(
      (n) => n._id.equals(noteId) && !n.deletedAt,
    );
    if (!note) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Note not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async (session: ClientSession) => {
        await this.companyRepository.softDeleteNote(
          companyId,
          noteId,
          actorId,
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_NOTE_DELETED,
            targetId: companyId,
            targetModel: AuditTargetModel.COMPANY,
            details: { noteId: noteId.toString() },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.redisService.del(
      COMPANY_CACHE_KEYS.DETAIL(companyId.toString()),
    );
  }

  async uploadDocument(
    companyId: Types.ObjectId,
    file: Express.Multer.File,
    dto: UploadCompanyDocumentDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<CompanyResponse> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if ((company.documents || []).length >= COMPANY_MAX_DOCUMENTS) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Maximum limit of ${COMPANY_MAX_DOCUMENTS} documents reached for this company.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const { key: fileKey } = await this.storageService.uploadFile(
      file,
      `crm/companies/${companyId.toString()}`,
      ALLOWED_DOCUMENT_MIME_TYPES,
      MAX_DOCUMENT_FILE_SIZE,
    );

    const session = await this.connection.startSession();
    let result: CompanyLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        result = (await this.companyRepository.addDocument(
          companyId,
          {
            fileName: dto.fileName || file.originalname,
            fileKey,
            fileType: file.mimetype,
            fileSize: file.size,
            uploadedBy: actorId,
          },
          session,
        ))!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_DOCUMENT_UPLOADED,
            targetId: companyId,
            targetModel: AuditTargetModel.COMPANY,
            details: {
              fileName: dto.fileName || file.originalname,
              fileKey,
              fileSize: file.size,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } catch (error) {
      // DB Save failed -> Trigger immediate orphan S3 cleanup
      try {
        await this.storageService.deleteFile(fileKey);
      } catch (s3Error) {
        // Direct cleanup failed -> Persist to durable outbox
        await this.failedStorageModel.create({
          fileKey,
          operation: StorageOperationType.DELETE,
          status: FailedStorageStatus.PENDING,
          lastError: (s3Error as Error).message,
          nextRetryAt: new Date(Date.now() + 60000),
        });
        this.logger.error(`S3 orphan queued to outbox for ${fileKey}`);
      }
      throw error;
    } finally {
      await session.endSession();
    }

    await this.redisService.del(
      COMPANY_CACHE_KEYS.DETAIL(companyId.toString()),
    );
    return CompanyMapper.toResponse(result!);
  }

  async getDocumentDownloadUrl(
    companyId: Types.ObjectId,
    docId: Types.ObjectId,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const doc = await this.companyRepository.findDocumentById(companyId, docId);
    if (!doc) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Document not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const downloadUrl = await this.storageService.getSignedDownloadUrl(
      doc.fileKey,
      3600,
    );
    return { downloadUrl, expiresIn: 3600 };
  }

  async deleteDocument(
    companyId: Types.ObjectId,
    docId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const doc = await this.companyRepository.findDocumentById(companyId, docId);
    if (!doc) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Document not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async (session: ClientSession) => {
        await this.companyRepository.softDeleteDocument(
          companyId,
          docId,
          actorId,
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_DOCUMENT_DELETED,
            targetId: companyId,
            targetModel: AuditTargetModel.COMPANY,
            details: { docId: docId.toString(), fileKey: doc.fileKey },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    // Attempt physical S3 delete
    try {
      await this.storageService.deleteFile(doc.fileKey);
    } catch (s3Error) {
      await this.failedStorageModel.create({
        fileKey: doc.fileKey,
        operation: StorageOperationType.DELETE,
        status: FailedStorageStatus.PENDING,
        lastError: (s3Error as Error).message,
        nextRetryAt: new Date(Date.now() + 60000),
      });
      this.logger.warn(
        `S3 physical deletion failed for ${doc.fileKey}, queued to outbox.`,
      );
    }

    await this.redisService.del(
      COMPANY_CACHE_KEYS.DETAIL(companyId.toString()),
    );
  }

  async logActivity(
    companyId: Types.ObjectId,
    dto: LogCompanyActivityDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<CrmActivityLean> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    let activity: CrmActivityLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        activity = await this.crmActivityRepository.create(
          {
            entityType: ActivityEntityType.COMPANY,
            entityId: companyId,
            type: dto.type,
            subject: dto.subject.trim(),
            description: dto.description ? dto.description.trim() : null,
            activityDate:
              dto.activityDate || dto.performedAt
                ? new Date(dto.activityDate || dto.performedAt!)
                : new Date(),
            durationMinutes: dto.durationMinutes ?? 0,
            outcome: dto.outcome ?? null,
            performedBy: actorId,
            deletedAt: null,
          },
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.COMPANY_ACTIVITY_LOGGED,
            targetId: companyId,
            targetModel: AuditTargetModel.COMPANY,
            details: {
              activityId: activity._id.toString(),
              type: activity.type,
              subject: activity.subject,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    return activity!;
  }

  async getActivities(
    companyId: Types.ObjectId,
    queryDto: PaginationQueryDto,
  ): Promise<PaginatedResult<CrmActivityLean>> {
    const company = await this.companyRepository.findById(companyId);
    if (!company) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Company not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.crmActivityRepository.findTimeline(
      ActivityEntityType.COMPANY,
      companyId,
      queryDto,
    );
  }

  async updateActivity(
    companyId: Types.ObjectId,
    activityId: Types.ObjectId,
    dto: UpdateCompanyActivityDto,
    actorId: Types.ObjectId,
  ): Promise<CrmActivityLean> {
    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity || !activity.entityId.equals(companyId)) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found for this company',
        HttpStatus.NOT_FOUND,
      );
    }

    const isAdmin = await this.isUserAdmin(actorId);
    if (!isAdmin && !activity.performedBy.equals(actorId)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You can only edit activities logged by yourself',
        HttpStatus.FORBIDDEN,
      );
    }

    const updateData: Partial<CrmActivity> = {};
    if (dto.subject !== undefined) updateData.subject = dto.subject.trim();
    if (dto.description !== undefined)
      updateData.description = dto.description ? dto.description.trim() : null;
    if (dto.durationMinutes !== undefined)
      updateData.durationMinutes = dto.durationMinutes;
    if (dto.outcome !== undefined) updateData.outcome = dto.outcome;
    const dateToUpdate = dto.activityDate || dto.performedAt;
    if (dateToUpdate !== undefined)
      updateData.activityDate = new Date(dateToUpdate);

    const updated = await this.crmActivityRepository.updateById(
      activityId,
      updateData,
    );
    return updated!;
  }

  async deleteActivity(
    companyId: Types.ObjectId,
    activityId: Types.ObjectId,
    actorId: Types.ObjectId,
  ): Promise<void> {
    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity || !activity.entityId.equals(companyId)) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found for this company',
        HttpStatus.NOT_FOUND,
      );
    }

    const isAdmin = await this.isUserAdmin(actorId);
    if (!isAdmin && !activity.performedBy.equals(actorId)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You can only delete activities logged by yourself',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.crmActivityRepository.softDelete(activityId, actorId);
  }
}
