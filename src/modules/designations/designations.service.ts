import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { DesignationRepository } from './repositories/designation.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { CreateDesignationDto } from './dto/create-designation.dto';
import { UpdateDesignationDto } from './dto/update-designation.dto';
import { UpdateDesignationStatusDto } from './dto/update-designation-status.dto';
import { ListDesignationsQueryDto } from './dto/list-designations-query.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { getChangedFields } from '../../common/utils/change-detection.util';
import {
  DesignationMapper,
  DesignationMapperInput,
  DesignationResponse,
} from './mappers/designation.mapper';

@Injectable()
export class DesignationsService {
  constructor(
    private readonly designationRepository: DesignationRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    dto: CreateDesignationDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<DesignationResponse> {
    const existing = await this.designationRepository.findByName(dto.name);
    if (existing) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Designation with this name already exists',
        HttpStatus.CONFLICT,
      );
    }

    const session = await this.connection.startSession();
    try {
      let createdDesignation: DesignationMapperInput;

      await session.withTransaction(async () => {
        const createData = DesignationMapper.toCreateData(dto);

        createdDesignation = await this.designationRepository.create(
          {
            ...createData,
            createdBy: actorId,
          },
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DESIGNATION_CREATED,
            targetId: createdDesignation._id,
            targetModel: AuditTargetModel.DESIGNATION,
            details: { name: createdDesignation.name },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return DesignationMapper.toResponse(createdDesignation!);
    } finally {
      await session.endSession();
    }
  }

  async list(
    query: ListDesignationsQueryDto,
  ): Promise<PaginatedResult<DesignationResponse>> {
    const result = await this.designationRepository.findList(query);
    return {
      ...result,
      data: result.data.map((d) =>
        DesignationMapper.toResponse(d as DesignationMapperInput),
      ),
    };
  }

  async getById(id: Types.ObjectId): Promise<DesignationResponse> {
    const designation = await this.designationRepository.findById(id);
    if (!designation) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Designation not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return DesignationMapper.toResponse(designation as DesignationMapperInput);
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateDesignationDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<DesignationResponse> {
    if (dto.name !== undefined) {
      const existing = await this.designationRepository.findByName(
        dto.name,
        id,
      );
      if (existing) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Designation with this name already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    const session = await this.connection.startSession();
    try {
      let updatedDesignation: DesignationMapperInput | null;

      await session.withTransaction(async () => {
        const designationBefore = await this.designationRepository.findById(
          id,
          session,
        );
        if (!designationBefore) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Designation not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const updateData = DesignationMapper.toUpdateData(dto);
        const changedFields = getChangedFields(
          updateData,
          designationBefore as unknown as Record<string, unknown>,
        );

        if (Object.keys(changedFields).length === 0) {
          updatedDesignation = designationBefore as DesignationMapperInput;
          return;
        }

        updatedDesignation = (await this.designationRepository.updateById(
          id,
          {
            ...changedFields,
            updatedBy: actorId,
          },
          session,
        )) as DesignationMapperInput | null;

        if (!updatedDesignation) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Designation not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DESIGNATION_UPDATED,
            targetId: id,
            targetModel: AuditTargetModel.DESIGNATION,
            details: DesignationMapper.toUpdateAuditDetails(
              designationBefore as DesignationMapperInput,
              updatedDesignation,
            ),
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return DesignationMapper.toResponse(updatedDesignation!);
    } finally {
      await session.endSession();
    }
  }

  async updateStatus(
    id: Types.ObjectId,
    dto: UpdateDesignationStatusDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<DesignationResponse> {
    const session = await this.connection.startSession();
    try {
      let updatedDesignation: DesignationMapperInput | null;

      await session.withTransaction(async () => {
        const designation = await this.designationRepository.findById(
          id,
          session,
        );
        if (!designation) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Designation not found',
            HttpStatus.NOT_FOUND,
          );
        }

        if (designation.isActive === dto.isActive) {
          updatedDesignation = designation as DesignationMapperInput;
          return;
        }

        updatedDesignation = (await this.designationRepository.updateStatus(
          id,
          dto.isActive,
          session,
        )) as DesignationMapperInput | null;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DESIGNATION_STATUS_CHANGED,
            targetId: id,
            targetModel: AuditTargetModel.DESIGNATION,
            details: {
              oldStatus: designation.isActive,
              newStatus: dto.isActive,
            },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return DesignationMapper.toResponse(updatedDesignation!);
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
        const designation = await this.designationRepository.findById(
          id,
          session,
        );
        if (!designation) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Designation not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.designationRepository.softDelete(id, actorId, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DESIGNATION_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.DESIGNATION,
            details: { name: designation.name },
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
