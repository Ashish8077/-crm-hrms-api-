import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { BranchRepository } from './repositories/branch.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { UpdateBranchStatusDto } from './dto/update-branch-status.dto';
import { ListBranchesQueryDto } from './dto/list-branches-query.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { getChangedFields } from '../../common/utils/change-detection.util';
import {
  BranchMapper,
  BranchResponse,
  BranchDocument,
} from './mappers/branch.mapper';

@Injectable()
export class BranchesService {
  constructor(
    private readonly branchRepository: BranchRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    dto: CreateBranchDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<BranchResponse> {
    const existing = await this.branchRepository.findByName(dto.name);
    if (existing) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Branch with this name already exists',
        HttpStatus.CONFLICT,
      );
    }

    const session = await this.connection.startSession();
    try {
      let createdBranch: BranchDocument;

      await session.withTransaction(async () => {
        const branchData = BranchMapper.toCreateData(dto);

        createdBranch = (await this.branchRepository.create(
          {
            ...branchData,
            createdBy: actorId,
          },
          session,
        )) as BranchDocument;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.BRANCH_CREATED,
            targetId: createdBranch._id,
            targetModel: AuditTargetModel.BRANCH,
            details: { name: createdBranch.name },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return BranchMapper.toResponse(createdBranch!);
    } finally {
      await session.endSession();
    }
  }

  async list(
    query: ListBranchesQueryDto,
  ): Promise<PaginatedResult<BranchResponse>> {
    const result = await this.branchRepository.findList(query);
    return {
      ...result,
      data: result.data.map((b) =>
        BranchMapper.toResponse(b as BranchDocument),
      ),
    };
  }

  async getById(id: Types.ObjectId): Promise<BranchResponse> {
    const branch = await this.branchRepository.findById(id);
    if (!branch) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Branch not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return BranchMapper.toResponse(branch as BranchDocument);
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateBranchDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<BranchResponse> {
    if (dto.name !== undefined) {
      const existing = await this.branchRepository.findByName(dto.name, id);
      if (existing) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Branch with this name already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    const session = await this.connection.startSession();
    try {
      let updatedBranch: BranchDocument | null = null;

      await session.withTransaction(async () => {
        const branchBefore = await this.branchRepository.findById(id, session);
        if (!branchBefore) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Branch not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const updateData = BranchMapper.toUpdateData(dto);
        const changedFields = getChangedFields(
          updateData,
          branchBefore as unknown as Record<string, unknown>,
        );

        if (Object.keys(changedFields).length === 0) {
          updatedBranch = branchBefore as BranchDocument;
          return;
        }

        updatedBranch = (await this.branchRepository.updateById(
          id,
          {
            ...changedFields,
            updatedBy: actorId,
          },
          session,
        )) as BranchDocument;

        if (!updatedBranch) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Branch not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.BRANCH_UPDATED,
            targetId: id,
            targetModel: AuditTargetModel.BRANCH,
            details: BranchMapper.toUpdateAuditDetails(
              branchBefore as BranchDocument,
              updatedBranch,
            ),
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return BranchMapper.toResponse(updatedBranch!);
    } finally {
      await session.endSession();
    }
  }

  async updateStatus(
    id: Types.ObjectId,
    dto: UpdateBranchStatusDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<BranchResponse> {
    const session = await this.connection.startSession();
    try {
      let updatedBranch: BranchDocument | null;

      await session.withTransaction(async () => {
        const branch = await this.branchRepository.findById(id, session);
        if (!branch) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Branch not found',
            HttpStatus.NOT_FOUND,
          );
        }

        if (branch.isActive === dto.isActive) {
          updatedBranch = branch as BranchDocument;
          return;
        }

        updatedBranch = (await this.branchRepository.updateStatus(
          id,
          dto.isActive,
          session,
        )) as BranchDocument;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.BRANCH_STATUS_CHANGED,
            targetId: id,
            targetModel: AuditTargetModel.BRANCH,
            details: { oldStatus: branch.isActive, newStatus: dto.isActive },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return BranchMapper.toResponse(updatedBranch!);
    } finally {
      await session.endSession();
    }
  }

  async delete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<void> {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const branch = await this.branchRepository.findById(id, session);
        if (!branch) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Branch not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.branchRepository.softDelete(id, actorId, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.BRANCH_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.BRANCH,
            details: { name: branch.name },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }
}
