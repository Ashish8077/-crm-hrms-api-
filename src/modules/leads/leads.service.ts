import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types, ClientSession } from 'mongoose';
import { LeadRepository, LeadLean } from './repositories/lead.repository';
import { UserRepository } from '../users/repositories/user.repository';
import { UserStatus } from '../users/constants/user-status.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { BulkAssignLeadsDto } from './dto/bulk-assign-leads.dto';
import { CheckDuplicateDto } from './dto/check-duplicate.dto';
import { AddLeadNoteDto } from './dto/add-lead-note.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import { AddLeadDocumentDto } from './dto/add-lead-document.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';
import { LeadStatus } from './constants/lead-status.constant';
import { LeadMapper, LeadResponse } from './mappers/lead.mapper';

export interface ImportLeadsResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ row: number; reason: string }>;
  created: LeadResponse[];
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly leadRepository: LeadRepository,
    private readonly userRepository: UserRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

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

  async create(
    dto: CreateLeadDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    // Duplicate detection check
    const duplicate = await this.leadRepository.checkDuplicate(
      dto.email,
      dto.phone,
    );
    if (duplicate) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Lead with this email or phone number already exists',
        HttpStatus.CONFLICT,
        {
          duplicateId: duplicate._id.toString(),
          email: duplicate.email,
          phone: duplicate.phone,
        },
      );
    }

    // Owner validation
    if (dto.ownerId) {
      await this.validateOwnerUser(new Types.ObjectId(dto.ownerId));
    }

    const session = await this.connection.startSession();
    let result: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const createData = LeadMapper.toCreateData(dto, actorId);
        result = await this.leadRepository.create(createData, session);

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_CREATED,
            targetModel: AuditTargetModel.LEAD,
            targetId: result._id,
            actorId,
            details: {
              email: result.email,
              phone: result.phone,
              status: result.status,
              source: result.source,
              ownerId: result.ownerId?.toString() ?? null,
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

    return LeadMapper.toResponse(result!);
  }

  async findById(id: Types.ObjectId): Promise<LeadResponse> {
    const lead = await this.leadRepository.findById(id);
    if (!lead) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return LeadMapper.toResponse(lead);
  }

  async list(query: ListLeadsQueryDto): Promise<PaginatedResult<LeadResponse>> {
    const paginated = await this.leadRepository.findList(query);
    return {
      data: paginated.data.map((lead) => LeadMapper.toResponse(lead)),
      meta: paginated.meta,
    };
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateLeadDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Check duplicate if email or phone is updated
    if (
      (dto.email && dto.email.trim().toLowerCase() !== existing.email) ||
      (dto.phone && dto.phone.trim() !== existing.phone)
    ) {
      const duplicate = await this.leadRepository.checkDuplicate(
        dto.email ?? existing.email,
        dto.phone ?? existing.phone,
        id,
      );
      if (duplicate) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Lead with this email or phone number already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    // Validate new owner if updated
    if (dto.ownerId) {
      await this.validateOwnerUser(new Types.ObjectId(dto.ownerId));
    }

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updateData = LeadMapper.toUpdateData(dto, actorId);
        const res = await this.leadRepository.updateById(
          id,
          updateData,
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        const auditDetails = LeadMapper.toUpdateAuditDetails(existing, updated);

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_UPDATED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: auditDetails,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );

        // Status change audit if status changed
        if (dto.status && dto.status !== existing.status) {
          await this.auditLogsService.createAuditLog(
            {
              action: AuditAction.LEAD_STATUS_CHANGED,
              targetModel: AuditTargetModel.LEAD,
              targetId: id,
              actorId,
              details: {
                from: existing.status,
                to: dto.status,
              },
              ipAddress: metadata.ipAddress,
              userAgent: metadata.userAgent,
            },
            session,
          );
        }

        // Score change audit if score changed
        if (dto.score !== undefined && dto.score !== existing.score) {
          await this.auditLogsService.createAuditLog(
            {
              action: AuditAction.LEAD_SCORE_CHANGED,
              targetModel: AuditTargetModel.LEAD,
              targetId: id,
              actorId,
              details: {
                from: existing.score,
                to: dto.score,
              },
              ipAddress: metadata.ipAddress,
              userAgent: metadata.userAgent,
            },
            session,
          );
        }
      });
    } finally {
      await session.endSession();
    }

    return LeadMapper.toResponse(updated!);
  }

  async updateStatus(
    id: Types.ObjectId,
    status: LeadStatus,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.status === status) {
      return LeadMapper.toResponse(existing);
    }

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.updateById(
          id,
          { status, updatedBy: actorId },
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_STATUS_CHANGED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: {
              from: existing.status,
              to: status,
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

    return LeadMapper.toResponse(updated!);
  }

  async updateScore(
    id: Types.ObjectId,
    score: number,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.score === score) {
      return LeadMapper.toResponse(existing);
    }

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.updateById(
          id,
          { score, updatedBy: actorId },
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_SCORE_CHANGED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: {
              from: existing.score,
              to: score,
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

    return LeadMapper.toResponse(updated!);
  }

  async assignOwner(
    id: Types.ObjectId,
    ownerId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.validateOwnerUser(ownerId);

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.updateById(
          id,
          { ownerId, updatedBy: actorId },
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_ASSIGNED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: {
              previousOwnerId: existing.ownerId?.toString() ?? null,
              newOwnerId: ownerId.toString(),
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

    return LeadMapper.toResponse(updated!);
  }

  async transferOwner(
    id: Types.ObjectId,
    newOwnerId: Types.ObjectId,
    reason: string | undefined,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.validateOwnerUser(newOwnerId);

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.updateById(
          id,
          { ownerId: newOwnerId, updatedBy: actorId },
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_TRANSFERRED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: {
              previousOwnerId: existing.ownerId?.toString() ?? null,
              newOwnerId: newOwnerId.toString(),
              reason: reason ?? null,
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

    return LeadMapper.toResponse(updated!);
  }

  async bulkAssign(
    dto: BulkAssignLeadsDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<{ assignedCount: number; leadIds: string[] }> {
    const targetOwnerId = new Types.ObjectId(dto.ownerId);
    await this.validateOwnerUser(targetOwnerId);

    const leadObjectIds = dto.leadIds.map((id) => new Types.ObjectId(id));

    const session = await this.connection.startSession();
    let count = 0;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        count = await this.leadRepository.bulkAssign(
          leadObjectIds,
          targetOwnerId,
          actorId,
          session,
        );

        // Record audit logs
        for (const leadId of leadObjectIds) {
          await this.auditLogsService.createAuditLog(
            {
              action: AuditAction.LEAD_BULK_ASSIGNED,
              targetModel: AuditTargetModel.LEAD,
              targetId: leadId,
              actorId,
              details: {
                newOwnerId: targetOwnerId.toString(),
                totalInBatch: leadObjectIds.length,
              },
              ipAddress: metadata.ipAddress,
              userAgent: metadata.userAgent,
            },
            session,
          );
        }
      });
    } finally {
      await session.endSession();
    }

    return {
      assignedCount: count,
      leadIds: dto.leadIds,
    };
  }

  async softDelete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const deleted = await this.leadRepository.softDelete(
          id,
          actorId,
          session,
        );
        if (!deleted) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_DELETED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: {
              email: existing.email,
              phone: existing.phone,
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
  }

  async checkDuplicate(
    dto: CheckDuplicateDto,
  ): Promise<{ isDuplicate: boolean; duplicate?: LeadResponse | null }> {
    const duplicate = await this.leadRepository.checkDuplicate(
      dto.email,
      dto.phone,
    );
    if (duplicate) {
      return {
        isDuplicate: true,
        duplicate: LeadMapper.toResponse(duplicate),
      };
    }
    return {
      isDuplicate: false,
      duplicate: null,
    };
  }

  async addNote(
    id: Types.ObjectId,
    dto: AddLeadNoteDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.addNote(
          id,
          {
            content: dto.content,
            createdBy: actorId,
          },
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_NOTE_ADDED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: {
              contentSnippet: dto.content.slice(0, 100),
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

    return LeadMapper.toResponse(updated!);
  }

  async deleteNote(
    leadId: Types.ObjectId,
    noteId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(leadId);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const targetNote = (existing.notes || []).find(
      (n) => n._id.toString() === noteId.toString() && !n.deletedAt,
    );
    if (!targetNote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Note not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.deleteNote(
          leadId,
          noteId,
          actorId,
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Note not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_NOTE_DELETED,
            targetModel: AuditTargetModel.LEAD,
            targetId: leadId,
            actorId,
            details: {
              noteId: noteId.toString(),
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

    return LeadMapper.toResponse(updated!);
  }

  async addFollowUp(
    id: Types.ObjectId,
    dto: CreateFollowUpDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const assignedToUser = new Types.ObjectId(dto.assignedTo);
    await this.validateOwnerUser(assignedToUser);

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.addFollowUp(
          id,
          {
            scheduledAt: dto.scheduledAt,
            assignedTo: assignedToUser,
            status: dto.status,
            notes: dto.notes,
            createdBy: actorId,
          },
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_FOLLOW_UP_ADDED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: {
              scheduledAt: dto.scheduledAt,
              assignedTo: dto.assignedTo,
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

    return LeadMapper.toResponse(updated!);
  }

  async updateFollowUp(
    leadId: Types.ObjectId,
    followUpId: Types.ObjectId,
    dto: UpdateFollowUpDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(leadId);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const targetFollowUp = (existing.followUps || []).find(
      (fu) => fu._id.toString() === followUpId.toString(),
    );
    if (!targetFollowUp) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Follow-up not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.assignedTo) {
      await this.validateOwnerUser(new Types.ObjectId(dto.assignedTo));
    }

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.updateFollowUp(
          leadId,
          followUpId,
          {
            ...(dto.scheduledAt && { scheduledAt: dto.scheduledAt }),
            ...(dto.assignedTo && {
              assignedTo: new Types.ObjectId(dto.assignedTo),
            }),
            ...(dto.status && { status: dto.status }),
            ...(dto.notes !== undefined && { notes: dto.notes }),
          },
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Follow-up not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_FOLLOW_UP_UPDATED,
            targetModel: AuditTargetModel.LEAD,
            targetId: leadId,
            actorId,
            details: {
              followUpId: followUpId.toString(),
              status: dto.status,
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

    return LeadMapper.toResponse(updated!);
  }

  async addDocument(
    id: Types.ObjectId,
    dto: AddLeadDocumentDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.addDocument(
          id,
          {
            fileName: dto.fileName,
            fileUrl: dto.fileUrl,
            fileType: dto.fileType,
            fileSize: dto.fileSize,
            uploadedBy: actorId,
          },
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Lead not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_DOCUMENT_ADDED,
            targetModel: AuditTargetModel.LEAD,
            targetId: id,
            actorId,
            details: {
              fileName: dto.fileName,
              fileUrl: dto.fileUrl,
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

    return LeadMapper.toResponse(updated!);
  }

  async deleteDocument(
    leadId: Types.ObjectId,
    documentId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<LeadResponse> {
    const existing = await this.leadRepository.findById(leadId);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const targetDoc = (existing.documents || []).find(
      (d) => d._id.toString() === documentId.toString() && !d.deletedAt,
    );
    if (!targetDoc) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Document not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    let updated: LeadLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const res = await this.leadRepository.deleteDocument(
          leadId,
          documentId,
          actorId,
          session,
        );
        if (!res) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Document not found',
            HttpStatus.NOT_FOUND,
          );
        }
        updated = res;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.LEAD_DOCUMENT_DELETED,
            targetModel: AuditTargetModel.LEAD,
            targetId: leadId,
            actorId,
            details: {
              documentId: documentId.toString(),
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

    return LeadMapper.toResponse(updated!);
  }

  async importLeads(
    dto: ImportLeadsDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ImportLeadsResult> {
    const result: ImportLeadsResult = {
      total: dto.leads.length,
      successful: 0,
      failed: 0,
      errors: [],
      created: [],
    };

    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();

    for (let i = 0; i < dto.leads.length; i++) {
      const rowNum = i + 1;
      const leadDto = dto.leads[i];

      try {
        const normEmail = leadDto.email?.trim().toLowerCase();
        const normPhone = leadDto.phone?.trim();

        // Check within batch duplicates
        if (seenEmails.has(normEmail)) {
          throw new Error(`Duplicate email in import batch: ${normEmail}`);
        }
        if (seenPhones.has(normPhone)) {
          throw new Error(`Duplicate phone in import batch: ${normPhone}`);
        }

        // Check database duplicates
        const existingDup = await this.leadRepository.checkDuplicate(
          normEmail,
          normPhone,
        );
        if (existingDup) {
          throw new Error(`Lead already exists in database with email/phone`);
        }

        // Validate owner if present
        if (leadDto.ownerId) {
          await this.validateOwnerUser(new Types.ObjectId(leadDto.ownerId));
        }

        const createData = LeadMapper.toCreateData(leadDto, actorId);
        const created = await this.leadRepository.create(createData);

        seenEmails.add(normEmail);
        seenPhones.add(normPhone);

        await this.auditLogsService.createAuditLog({
          action: AuditAction.LEAD_IMPORTED,
          targetModel: AuditTargetModel.LEAD,
          targetId: created._id,
          actorId,
          details: {
            batchRow: rowNum,
            email: created.email,
          },
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });

        result.successful++;
        result.created.push(LeadMapper.toResponse(created));
      } catch (err: unknown) {
        result.failed++;
        const errorMessage =
          err instanceof Error ? err.message : 'Validation or duplicate error';
        result.errors.push({
          row: rowNum,
          reason: errorMessage,
        });
      }
    }

    return result;
  }

  async exportLeads(query: ListLeadsQueryDto): Promise<LeadResponse[]> {
    const leads = await this.leadRepository.findForExport(query);
    return leads.map((lead) => LeadMapper.toResponse(lead));
  }

  async getTimeline(
    id: Types.ObjectId,
  ): Promise<Array<Record<string, unknown>>> {
    const lead = await this.leadRepository.findById(id);
    if (!lead) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lead not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const logs = await this.auditLogsService.findByTarget(
      AuditTargetModel.LEAD,
      id,
    );

    return logs.map((log) => {
      const record = log as unknown as {
        _id: Types.ObjectId;
        action: string;
        targetId?: Types.ObjectId | null;
        targetModel?: string | null;
        actorId?: Types.ObjectId | null;
        details?: Record<string, unknown>;
        createdAt?: Date;
      };
      return {
        id: record._id.toString(),
        action: record.action,
        targetId: record.targetId ? record.targetId.toString() : null,
        targetModel: record.targetModel,
        actorId: record.actorId ? record.actorId.toString() : null,
        details: record.details || {},
        createdAt: record.createdAt,
      };
    });
  }
}
