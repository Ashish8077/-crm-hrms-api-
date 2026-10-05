import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { DepartmentRepository } from './repositories/department.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { UpdateDepartmentStatusDto } from './dto/update-department-status.dto';
import { ListDepartmentsQueryDto } from './dto/list-departments-query.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { DepartmentLean } from './repositories/department.repository';
import { getChangedFields } from '../../common/utils/change-detection.util';
import {
  DepartmentMapper,
  DepartmentMapperInput,
  DepartmentResponse,
} from './mappers/department.mapper';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly departmentRepository: DepartmentRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    dto: CreateDepartmentDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<DepartmentResponse> {
    const existing = await this.departmentRepository.findByName(dto.name);
    if (existing) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Department with this name already exists',
        HttpStatus.CONFLICT,
      );
    }

    const session = await this.connection.startSession();
    try {
      let createdDepartment: DepartmentMapperInput;

      await session.withTransaction(async () => {
        const createData = DepartmentMapper.toCreateData(dto);

        createdDepartment = await this.departmentRepository.create(
          {
            ...createData,
            createdBy: actorId,
          },
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEPARTMENT_CREATED,
            targetId: createdDepartment._id,
            targetModel: AuditTargetModel.DEPARTMENT,
            details: { name: createdDepartment.name },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return DepartmentMapper.toResponse(createdDepartment!);
    } finally {
      await session.endSession();
    }
  }

  async list(
    query: ListDepartmentsQueryDto,
  ): Promise<PaginatedResult<DepartmentResponse>> {
    const result = await this.departmentRepository.findList(query);
    return {
      ...result,
      data: result.data.map((dept) => DepartmentMapper.toResponse(dept)),
    };
  }

  async getById(id: Types.ObjectId): Promise<DepartmentResponse> {
    const department = await this.departmentRepository.findById(id);
    if (!department) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Department not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return DepartmentMapper.toResponse(department);
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateDepartmentDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<DepartmentResponse> {
    if (dto.name !== undefined) {
      const existing = await this.departmentRepository.findByName(dto.name, id);
      if (existing) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Department with this name already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    const session = await this.connection.startSession();
    try {
      let updatedDepartment: DepartmentMapperInput | null = null;

      await session.withTransaction(async () => {
        const departmentBefore = await this.departmentRepository.findById(
          id,
          session,
        );
        if (!departmentBefore) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Department not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const updateData = DepartmentMapper.toUpdateData(dto);
        const changedFields = getChangedFields(
          updateData,
          departmentBefore as unknown as Record<string, unknown>,
        );

        if (Object.keys(changedFields).length === 0) {
          updatedDepartment = departmentBefore;
          return;
        }

        updatedDepartment = await this.departmentRepository.updateById(
          id,
          {
            ...changedFields,
            updatedBy: actorId,
          },
          session,
        );

        if (!updatedDepartment) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Department not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEPARTMENT_UPDATED,
            targetId: id,
            targetModel: AuditTargetModel.DEPARTMENT,
            details: DepartmentMapper.toUpdateAuditDetails(
              departmentBefore,
              updatedDepartment,
            ),
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return DepartmentMapper.toResponse(updatedDepartment!);
    } finally {
      await session.endSession();
    }
  }

  async updateStatus(
    id: Types.ObjectId,
    dto: UpdateDepartmentStatusDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<DepartmentResponse> {
    const session = await this.connection.startSession();
    try {
      let updatedDepartment: DepartmentLean | null = null;

      await session.withTransaction(async () => {
        const department = await this.departmentRepository.findById(
          id,
          session,
        );
        if (!department) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Department not found',
            HttpStatus.NOT_FOUND,
          );
        }

        if (department.isActive === dto.isActive) {
          updatedDepartment = department;
          return;
        }

        // NOTE: Business rule around deactivation cascade goes here.
        // For now, we allow it but do not implicitly cascade to Teams.
        // We defer Teams handling to when Teams are actually built,
        // which may involve checking if active teams exist in this department.

        updatedDepartment = await this.departmentRepository.updateStatus(
          id,
          dto.isActive,
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEPARTMENT_STATUS_CHANGED,
            targetId: id,
            targetModel: AuditTargetModel.DEPARTMENT,
            details: {
              oldStatus: department.isActive,
              newStatus: dto.isActive,
            },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return DepartmentMapper.toResponse(updatedDepartment!);
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
        const department = await this.departmentRepository.findById(
          id,
          session,
        );
        if (!department) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Department not found',
            HttpStatus.NOT_FOUND,
          );
        }

        // NOTE: Soft deletion cascade logic is also deferred based on business rules.

        await this.departmentRepository.softDelete(id, actorId, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DEPARTMENT_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.DEPARTMENT,
            details: { name: department.name },
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
