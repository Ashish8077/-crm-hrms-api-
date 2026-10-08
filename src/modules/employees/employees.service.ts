import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, Connection, ClientSession } from 'mongoose';
import { EmployeeRepository } from './repositories/employee.repository';
import { EmployeeStatusHistoryRepository } from './repositories/employee-status-history.repository';
import { DepartmentRepository } from '../departments/repositories/department.repository';
import { DesignationRepository } from '../designations/repositories/designation.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { TeamRepository } from '../teams/repositories/team.repository';
import {
  AuditLogsService,
  CreateAuditLogParams,
} from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { ActiveEmploymentStatuses } from './constants/employee.constant';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmploymentStatusDto } from './dto/update-employment-status.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { GetEmployeeStatusHistoryQueryDto } from './dto/get-employee-status-history-query.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { EmployeeMapper, EmployeeResponse } from './mappers/employee.mapper';
import { getChangedFields } from '../../common/utils/change-detection.util';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly employeeRepository: EmployeeRepository,
    private readonly employeeStatusHistoryRepository: EmployeeStatusHistoryRepository,
    private readonly departmentRepository: DepartmentRepository,
    private readonly designationRepository: DesignationRepository,
    private readonly branchRepository: BranchRepository,
    private readonly teamRepository: TeamRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private async validateRelationships(
    departmentId: Types.ObjectId,
    designationId: Types.ObjectId,
    branchId: Types.ObjectId,
    teamId?: Types.ObjectId | null,
    reportingManagerId?: Types.ObjectId | null,
    employeeId?: Types.ObjectId,
  ): Promise<void> {
    const [department, designation, branch] = await Promise.all([
      this.departmentRepository.findById(departmentId),
      this.designationRepository.findById(designationId),
      this.branchRepository.findById(branchId),
    ]);

    if (!department || !department.isActive) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Department not found or inactive',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!designation || !designation.isActive) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Designation not found or inactive',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!branch || !branch.isActive) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Branch not found or inactive',
        HttpStatus.NOT_FOUND,
      );
    }

    if (teamId) {
      const team = await this.teamRepository.findById(teamId);
      if (!team || !team.isActive) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Team not found or inactive',
          HttpStatus.NOT_FOUND,
        );
      }
      if (!team.departmentId.equals(departmentId)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Team does not belong to the selected department',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (reportingManagerId) {
      await this.validateReportingManager(reportingManagerId, employeeId);
    }
  }

  private async validateReportingManager(
    managerId: Types.ObjectId,
    employeeId?: Types.ObjectId,
  ): Promise<void> {
    if (employeeId && managerId.equals(employeeId)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Employee cannot report to themselves',
        HttpStatus.BAD_REQUEST,
      );
    }

    const manager = await this.employeeRepository.findById(managerId);
    if (
      !manager ||
      !ActiveEmploymentStatuses.includes(manager.employmentStatus)
    ) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Reporting manager not found or inactive',
        HttpStatus.NOT_FOUND,
      );
    }

    if (employeeId) {
      let currentManagerId = manager.reportingManagerId;
      const visited = new Set<string>([
        employeeId.toString(),
        managerId.toString(),
      ]);

      while (currentManagerId) {
        if (currentManagerId.equals(employeeId)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Circular reporting hierarchy detected',
            HttpStatus.BAD_REQUEST,
          );
        }

        const currentManager =
          await this.employeeRepository.findById(currentManagerId);
        if (!currentManager) break;

        if (visited.has(currentManager._id.toString())) break;
        visited.add(currentManager._id.toString());

        currentManagerId = currentManager.reportingManagerId;
      }
    }
  }

  async create(
    dto: CreateEmployeeDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<EmployeeResponse> {
    const existingEmail = await this.employeeRepository.findByWorkEmail(
      dto.workEmail,
    );
    if (existingEmail) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Work email already exists',
        HttpStatus.CONFLICT,
      );
    }

    await this.validateRelationships(
      new Types.ObjectId(dto.departmentId),
      new Types.ObjectId(dto.designationId),
      new Types.ObjectId(dto.branchId),
      dto.teamId ? new Types.ObjectId(dto.teamId) : null,
      dto.reportingManagerId
        ? new Types.ObjectId(dto.reportingManagerId)
        : null,
    );

    const session = await this.connection.startSession();
    let result: EmployeeResponse;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const createData = EmployeeMapper.toCreateData(dto);
        createData.employeeCode =
          await this.employeeRepository.getNextEmployeeCode();
        createData.createdBy = actorId;
        createData.updatedBy = actorId;

        const employee = await this.employeeRepository.create(
          createData,
          session,
        );

        const auditLogData = {
          action: AuditAction.EMPLOYEE_CREATED,
          targetModel: AuditTargetModel.EMPLOYEE,
          targetId: employee._id,
          actorId,
          details: { after: EmployeeMapper.toResponse(employee) },
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        }; // Force IDE re-lint

        await this.auditLogsService.createAuditLog(auditLogData, session);

        result = EmployeeMapper.toResponse(employee);
      });
    } finally {
      await session.endSession();
    }

    return result!;
  }

  async getById(id: Types.ObjectId): Promise<EmployeeResponse> {
    const employee = await this.employeeRepository.findById(id);
    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return EmployeeMapper.toResponse(employee);
  }

  async getBankDetails(id: Types.ObjectId) {
    const employee = await this.employeeRepository.findById(id);
    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return employee.bankDetails || null;
  }

  async list(
    query: ListEmployeesQueryDto,
  ): Promise<PaginatedResult<EmployeeResponse>> {
    const result = await this.employeeRepository.findList(query);
    return {
      data: result.data.map((e) => EmployeeMapper.toResponse(e)),
      meta: result.meta,
    };
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateEmployeeDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<EmployeeResponse> {
    const employeeBefore = await this.employeeRepository.findById(id);
    if (!employeeBefore) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.workEmail && dto.workEmail !== employeeBefore.workEmail) {
      const existingEmail = await this.employeeRepository.findByWorkEmail(
        dto.workEmail,
        id,
      );
      if (existingEmail) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Work email already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    const updateData = EmployeeMapper.toUpdateData(dto);
    const changedFields = getChangedFields(
      updateData,
      employeeBefore as unknown as Record<string, unknown>,
    );

    if (Object.keys(changedFields).length === 0) {
      return EmployeeMapper.toResponse(employeeBefore);
    }

    // Validate relationships if any relational fields changed
    if (
      changedFields.departmentId !== undefined ||
      changedFields.designationId !== undefined ||
      changedFields.branchId !== undefined ||
      changedFields.teamId !== undefined ||
      changedFields.reportingManagerId !== undefined
    ) {
      const targetDepartmentId =
        (changedFields.departmentId as Types.ObjectId) ||
        employeeBefore.departmentId;
      const targetDesignationId =
        (changedFields.designationId as Types.ObjectId) ||
        employeeBefore.designationId;
      const targetBranchId =
        (changedFields.branchId as Types.ObjectId) || employeeBefore.branchId;
      const targetTeamId =
        changedFields.teamId !== undefined
          ? (changedFields.teamId as Types.ObjectId | null)
          : employeeBefore.teamId;
      const targetManagerId =
        changedFields.reportingManagerId !== undefined
          ? (changedFields.reportingManagerId as Types.ObjectId | null)
          : employeeBefore.reportingManagerId;

      await this.validateRelationships(
        targetDepartmentId,
        targetDesignationId,
        targetBranchId,
        targetTeamId,
        targetManagerId,
        employeeBefore._id,
      );
    }

    const session = await this.connection.startSession();
    let result: EmployeeResponse;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updatePayload = {
          ...changedFields,
          updatedBy: actorId,
          updatedAt: new Date(),
        };

        const employeeAfter = await this.employeeRepository.updateById(
          id,
          updatePayload,
          session,
        );

        if (!employeeAfter) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Employee not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const auditDetails = EmployeeMapper.toUpdateAuditDetails(
          employeeBefore,
          employeeAfter,
        );

        const auditLogData: CreateAuditLogParams = {
          action: AuditAction.EMPLOYEE_UPDATED,
          targetModel: AuditTargetModel.EMPLOYEE,
          targetId: employeeAfter._id,
          actorId,
          details: {
            ...auditDetails,
            changedFields: Object.keys(changedFields),
          },
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        };

        await this.auditLogsService.createAuditLog(auditLogData, session);

        result = EmployeeMapper.toResponse(employeeAfter);
      });
    } finally {
      await session.endSession();
    }

    return result!;
  }

  async updateStatus(
    id: Types.ObjectId,
    dto: UpdateEmploymentStatusDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<EmployeeResponse> {
    const employeeBefore = await this.employeeRepository.findById(id);
    if (!employeeBefore) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (employeeBefore.employmentStatus === dto.employmentStatus) {
      return EmployeeMapper.toResponse(employeeBefore);
    }

    const session = await this.connection.startSession();
    let result: EmployeeResponse;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const employeeAfter = await this.employeeRepository.updateById(
          id,
          {
            employmentStatus: dto.employmentStatus,
            updatedBy: actorId,
            updatedAt: new Date(),
          },
          session,
        );

        if (!employeeAfter) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Employee not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.employeeStatusHistoryRepository.create(
          {
            employeeId: employeeAfter._id,
            previousStatus: employeeBefore.employmentStatus,
            newStatus: employeeAfter.employmentStatus,
            reason: dto.reason || null,
            changedBy: actorId,
            changedAt: new Date(),
          },
          session,
        );

        const auditLogData: CreateAuditLogParams = {
          action: AuditAction.EMPLOYEE_STATUS_CHANGED,
          targetModel: AuditTargetModel.EMPLOYEE,
          targetId: employeeAfter._id,
          actorId,
          details: {
            from: employeeBefore.employmentStatus,
            to: employeeAfter.employmentStatus,
            reason: dto.reason || null,
          },
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        };

        await this.auditLogsService.createAuditLog(auditLogData, session);

        result = EmployeeMapper.toResponse(employeeAfter);
      });
    } finally {
      await session.endSession();
    }

    return result!;
  }

  async delete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const employeeBefore = await this.employeeRepository.findById(id);
    if (!employeeBefore) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const deletedEmployee = await this.employeeRepository.softDelete(
          id,
          actorId,
          session,
        );

        if (!deletedEmployee) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Employee not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const auditLogData: CreateAuditLogParams = {
          action: AuditAction.EMPLOYEE_DELETED,
          targetModel: AuditTargetModel.EMPLOYEE,
          targetId: id,
          actorId,
          details: {
            employeeCode: deletedEmployee.employeeCode,
            workEmail: deletedEmployee.workEmail,
          },
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        };

        await this.auditLogsService.createAuditLog(auditLogData, session);
      });
    } finally {
      await session.endSession();
    }
  }

  async getStatusHistory(
    employeeId: Types.ObjectId,
    query: GetEmployeeStatusHistoryQueryDto,
  ) {
    console.log(employeeId);

    const employee = await this.employeeRepository.findById(employeeId);
    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.employeeStatusHistoryRepository.findByEmployeeId(
      employeeId,
      query,
    );
  }
}
