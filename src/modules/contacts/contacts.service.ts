import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Types, ClientSession, Model } from 'mongoose';
import { ContactRepository } from './repositories/contact.repository';
import { ContactLean, ContactMapper, ContactResponse } from './mappers/contact.mapper';
import { CompanyRepository } from '../companies/repositories/company.repository';
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
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts-query.dto';
import { LinkCompanyDto } from './dto/link-company.dto';
import { AssignContactDto } from './dto/assign-contact.dto';
import { AddContactNoteDto } from './dto/add-contact-note.dto';
import { LogContactActivityDto } from './dto/log-contact-activity.dto';
import { UpdateContactActivityDto } from './dto/update-contact-activity.dto';
import { UploadContactDocumentDto } from './dto/upload-contact-document.dto';
import { CheckDuplicateContactDto } from './dto/check-duplicate-contact.dto';
import {
  CONTACT_MAX_DOCUMENTS,
  CONTACT_MAX_NOTES,
  CONTACT_CACHE_KEYS,
} from './constants/contact.constant';
import {
  CrmActivityRepository,
  CrmActivityLean,
} from '../../common/repositories/crm-activity.repository';
import {
  ActivityEntityType,
  CrmActivity,
} from '../../common/schemas/crm-activity.schema';
import { normalizeEmail } from '../../common/utils/string-normalization.util';
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
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly contactRepository: ContactRepository,
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

  private async validateCompany(
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const company = await this.companyRepository.findById(companyId, session);
    if (!company) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot link contact to a non-existent or deleted company',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async checkDuplicate(
    dto: CheckDuplicateContactDto,
  ): Promise<{ exists: boolean; duplicateId?: string }> {
    const duplicate = await this.contactRepository.checkDuplicate(
      dto.email,
      dto.phone,
    );
    if (duplicate) {
      return { exists: true, duplicateId: duplicate._id.toString() };
    }
    return { exists: false };
  }

  async create(
    dto: CreateContactDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ContactResponse> {
    const normalizedEmail = normalizeEmail(dto.email)!;
    const allEmails = [normalizedEmail];
    if (dto.alternateEmail) allEmails.push(dto.alternateEmail);
    if (dto.additionalEmails) {
      allEmails.push(...dto.additionalEmails.map((e) => e.value));
    }

    const collision = await this.contactRepository.checkEmailCollision(allEmails);
    if (collision) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Contact with this email address already exists',
        HttpStatus.CONFLICT,
      );
    }

    if (dto.phone) {
      const phoneDup = await this.contactRepository.checkDuplicate(null, dto.phone);
      if (phoneDup) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Contact with this phone number already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    if (dto.ownerId) {
      await this.validateOwnerUser(new Types.ObjectId(dto.ownerId));
    }
    if (dto.companyId) {
      await this.validateCompany(new Types.ObjectId(dto.companyId));
    }

    const session = await this.connection.startSession();
    let result: ContactLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        // If designated as primary for the company, unset existing primary contact
        if (dto.companyId && dto.isPrimaryContact) {
          await this.contactRepository.transferCompanyAndPrimary(
            new Types.ObjectId(),
            new Types.ObjectId(dto.companyId),
            true,
            undefined,
            undefined,
            actorId,
            session,
          );
        }

        const createData = ContactMapper.toCreateData(dto, actorId);
        result = await this.contactRepository.create(createData, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_CREATED,
            targetId: result._id,
            targetModel: AuditTargetModel.CONTACT,
            details: {
              name: `${result.firstName} ${result.lastName}`,
              email: result.email,
              companyId: result.companyId?.toString() ?? null,
              isPrimaryContact: result.isPrimaryContact,
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

    if (dto.companyId) {
      await this.redisService.del(`crm:companies:${dto.companyId}:contacts`);
    }

    return ContactMapper.toResponse(result!);
  }

  async list(queryDto: ListContactsQueryDto): Promise<PaginatedResult<ContactResponse>> {
    const paginated = await this.contactRepository.findList(queryDto);

    return {
      data: paginated.data.map((contact) => ContactMapper.toResponse(contact)),
      meta: paginated.meta,
    };
  }

  async getById(id: Types.ObjectId): Promise<ContactResponse> {
    const cached = await this.redisService.get(CONTACT_CACHE_KEYS.DETAIL(id.toString()));
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Fall through
      }
    }

    const contact = await this.contactRepository.findById(id);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    let company = null;
    if (contact.companyId) {
      company = await this.companyRepository.findById(contact.companyId);
    }

    let owner = null;
    if (contact.ownerId) {
      owner = await this.userRepository.findById(contact.ownerId);
    }

    const response = ContactMapper.toResponse(contact, company, owner);

    await this.redisService.set(
      CONTACT_CACHE_KEYS.DETAIL(id.toString()),
      JSON.stringify(response),
      3600,
    );

    return response;
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateContactDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ContactResponse> {
    const existing = await this.contactRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.email || dto.alternateEmail || dto.additionalEmails) {
      const allEmails: string[] = [];
      if (dto.email) allEmails.push(dto.email);
      if (dto.alternateEmail) allEmails.push(dto.alternateEmail);
      if (dto.additionalEmails) allEmails.push(...dto.additionalEmails.map((e) => e.value));

      const collision = await this.contactRepository.checkEmailCollision(allEmails, id);
      if (collision) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Another contact with this email address already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    if (dto.phone) {
      const phoneDup = await this.contactRepository.checkDuplicate(null, dto.phone, id);
      if (phoneDup) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Another contact with this phone number already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    if (dto.ownerId) {
      await this.validateOwnerUser(new Types.ObjectId(dto.ownerId));
    }
    if (dto.companyId) {
      await this.validateCompany(new Types.ObjectId(dto.companyId));
    }

    const session = await this.connection.startSession();
    let result: ContactLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updateData = ContactMapper.toUpdateData(dto, actorId);
        const updated = await this.contactRepository.updateById(id, updateData, session);
        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Contact not found',
            HttpStatus.NOT_FOUND,
          );
        }
        result = updated;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_UPDATED,
            targetId: id,
            targetModel: AuditTargetModel.CONTACT,
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

    await this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(id.toString()));
    if (existing.companyId) {
      await this.redisService.del(`crm:companies:${existing.companyId}:contacts`);
    }

    return ContactMapper.toResponse(result!);
  }

  async softDelete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const existing = await this.contactRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async (session: ClientSession) => {
        await this.contactRepository.softDelete(id, actorId, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.CONTACT,
            details: {
              name: `${existing.firstName} ${existing.lastName}`,
              email: existing.email,
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

    await this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(id.toString()));
    if (existing.companyId) {
      await this.redisService.del(`crm:companies:${existing.companyId}:contacts`);
    }
  }

  async linkCompany(
    contactId: Types.ObjectId,
    dto: LinkCompanyDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ContactResponse> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const targetCompanyId = new Types.ObjectId(dto.companyId);
    await this.validateCompany(targetCompanyId);

    const oldCompanyId = contact.companyId;
    const isPrimary = dto.isPrimaryContact ?? false;

    const session = await this.connection.startSession();
    let result: ContactLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updated = await this.contactRepository.transferCompanyAndPrimary(
          contactId,
          targetCompanyId,
          isPrimary,
          dto.jobTitle,
          dto.department,
          actorId,
          session,
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Contact transfer failed',
            HttpStatus.NOT_FOUND,
          );
        }
        result = updated;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_COMPANY_LINKED,
            targetId: contactId,
            targetModel: AuditTargetModel.CONTACT,
            details: {
              previousCompanyId: oldCompanyId?.toString() ?? null,
              newCompanyId: targetCompanyId.toString(),
              isPrimaryContact: isPrimary,
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

    await Promise.all([
      this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(contactId.toString())),
      oldCompanyId ? this.redisService.del(`crm:companies:${oldCompanyId}:contacts`) : Promise.resolve(),
      this.redisService.del(`crm:companies:${targetCompanyId}:contacts`),
    ]);

    return ContactMapper.toResponse(result!);
  }

  async unlinkCompany(
    contactId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ContactResponse> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const oldCompanyId = contact.companyId;

    const session = await this.connection.startSession();
    let result: ContactLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updated = await this.contactRepository.unlinkCompany(contactId, actorId, session);
        result = updated!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_COMPANY_UNLINKED,
            targetId: contactId,
            targetModel: AuditTargetModel.CONTACT,
            details: { previousCompanyId: oldCompanyId?.toString() ?? null },
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
      this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(contactId.toString())),
      oldCompanyId ? this.redisService.del(`crm:companies:${oldCompanyId}:contacts`) : Promise.resolve(),
    ]);

    return ContactMapper.toResponse(result!);
  }

  async assignOwner(
    id: Types.ObjectId,
    dto: AssignContactDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ContactResponse> {
    const contact = await this.contactRepository.findById(id);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const newOwnerId = new Types.ObjectId(dto.ownerId);
    await this.validateOwnerUser(newOwnerId);

    const session = await this.connection.startSession();
    let result: ContactLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updated = await this.contactRepository.updateOwner(id, newOwnerId, actorId, session);
        result = updated!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_ASSIGNED,
            targetId: id,
            targetModel: AuditTargetModel.CONTACT,
            details: {
              previousOwnerId: contact.ownerId?.toString() ?? null,
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

    await this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(id.toString()));

    return ContactMapper.toResponse(result!);
  }

  async addNote(
    contactId: Types.ObjectId,
    dto: AddContactNoteDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ContactResponse> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if ((contact.notes || []).length >= CONTACT_MAX_NOTES) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Maximum limit of ${CONTACT_MAX_NOTES} notes reached for this contact.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await this.connection.startSession();
    let result: ContactLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        result = (await this.contactRepository.addNote(
          contactId,
          { content: dto.content, createdBy: actorId },
          session,
        ))!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_NOTE_ADDED,
            targetId: contactId,
            targetModel: AuditTargetModel.CONTACT,
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

    await this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(contactId.toString()));
    return ContactMapper.toResponse(result!);
  }

  async deleteNote(
    contactId: Types.ObjectId,
    noteId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const note = (contact.notes || []).find(
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
        await this.contactRepository.softDeleteNote(contactId, noteId, actorId, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_NOTE_DELETED,
            targetId: contactId,
            targetModel: AuditTargetModel.CONTACT,
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

    await this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(contactId.toString()));
  }

  async uploadDocument(
    contactId: Types.ObjectId,
    file: Express.Multer.File,
    dto: UploadContactDocumentDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ContactResponse> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if ((contact.documents || []).length >= CONTACT_MAX_DOCUMENTS) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Maximum limit of ${CONTACT_MAX_DOCUMENTS} documents reached for this contact.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const { key: fileKey } = await this.storageService.uploadFile(
      file,
      `crm/contacts/${contactId.toString()}`,
      ALLOWED_DOCUMENT_MIME_TYPES,
      MAX_DOCUMENT_FILE_SIZE,
    );

    const session = await this.connection.startSession();
    let result: ContactLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        result = (await this.contactRepository.addDocument(
          contactId,
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
            action: AuditAction.CONTACT_DOCUMENT_UPLOADED,
            targetId: contactId,
            targetModel: AuditTargetModel.CONTACT,
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
      try {
        await this.storageService.deleteFile(fileKey);
      } catch (s3Error) {
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

    await this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(contactId.toString()));
    return ContactMapper.toResponse(result!);
  }

  async getDocumentDownloadUrl(
    contactId: Types.ObjectId,
    docId: Types.ObjectId,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const doc = await this.contactRepository.findDocumentById(contactId, docId);
    if (!doc) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Document not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const downloadUrl = await this.storageService.getSignedDownloadUrl(doc.fileKey, 3600);
    return { downloadUrl, expiresIn: 3600 };
  }

  async deleteDocument(
    contactId: Types.ObjectId,
    docId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const doc = await this.contactRepository.findDocumentById(contactId, docId);
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
        await this.contactRepository.softDeleteDocument(contactId, docId, actorId, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.CONTACT_DOCUMENT_DELETED,
            targetId: contactId,
            targetModel: AuditTargetModel.CONTACT,
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
      this.logger.warn(`S3 physical deletion failed for ${doc.fileKey}, queued to outbox.`);
    }

    await this.redisService.del(CONTACT_CACHE_KEYS.DETAIL(contactId.toString()));
  }

  async logActivity(
    contactId: Types.ObjectId,
    dto: LogContactActivityDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<CrmActivityLean> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    let activity: CrmActivityLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        activity = await this.crmActivityRepository.create(
          {
            entityType: ActivityEntityType.CONTACT,
            entityId: contactId,
            type: dto.type,
            subject: dto.subject.trim(),
            description: dto.description ? dto.description.trim() : null,
            activityDate: dto.activityDate || dto.performedAt
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
            action: AuditAction.CONTACT_ACTIVITY_LOGGED,
            targetId: contactId,
            targetModel: AuditTargetModel.CONTACT,
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
    contactId: Types.ObjectId,
    queryDto: PaginationQueryDto,
  ): Promise<PaginatedResult<CrmActivityLean>> {
    const contact = await this.contactRepository.findById(contactId);
    if (!contact) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Contact not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.crmActivityRepository.findTimeline(
      ActivityEntityType.CONTACT,
      contactId,
      queryDto,
    );
  }

  async updateActivity(
    contactId: Types.ObjectId,
    activityId: Types.ObjectId,
    dto: UpdateContactActivityDto,
    actorId: Types.ObjectId,
  ): Promise<CrmActivityLean> {
    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity || !activity.entityId.equals(contactId)) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found for this contact',
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
    if (dto.description !== undefined) updateData.description = dto.description ? dto.description.trim() : null;
    if (dto.durationMinutes !== undefined) updateData.durationMinutes = dto.durationMinutes;
    if (dto.outcome !== undefined) updateData.outcome = dto.outcome;
    const dateToUpdate = dto.activityDate || dto.performedAt;
    if (dateToUpdate !== undefined) updateData.activityDate = new Date(dateToUpdate);

    const updated = await this.crmActivityRepository.updateById(activityId, updateData);
    return updated!;
  }

  async deleteActivity(
    contactId: Types.ObjectId,
    activityId: Types.ObjectId,
    actorId: Types.ObjectId,
  ): Promise<void> {
    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity || !activity.entityId.equals(contactId)) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found for this contact',
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
