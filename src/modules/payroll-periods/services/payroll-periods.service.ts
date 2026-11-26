import { HttpStatus, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { PayrollPeriodRepository } from '../repositories/payroll-period.repository';
import { PayrollSettingsRepository } from '../../payroll-configuration/repositories/payroll-settings.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuthorizationService } from '../../authorization/authorization.service';
import { CreatePayrollPeriodDto } from '../dto/create-payroll-period.dto';
import { UpdatePayrollPeriodDto } from '../dto/update-payroll-period.dto';
import { UpdatePayrollPeriodStatusDto } from '../dto/update-payroll-period-status.dto';
import { ListPayrollPeriodsQueryDto } from '../dto/list-payroll-periods-query.dto';
import {
  PayrollPeriodMapper,
  PayrollPeriodResponse,
} from '../mappers/payroll-period.mapper';
import {
  ALLOWED_STATUS_TRANSITIONS,
  PayrollPeriodSortableField,
  PayrollPeriodStatus,
} from '../constants/payroll-period.constant';
import {
  PAYROLL_CONFIGURATION_DEFAULTS,
  PayrollFrequency,
} from '../../payroll-configuration/constants/payroll-configuration.constant';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { PayrollPeriod } from '../schemas/payroll-period.schema';

@Injectable()
export class PayrollPeriodsService {
  constructor(
    private readonly payrollPeriodRepository: PayrollPeriodRepository,
    private readonly payrollSettingsRepository: PayrollSettingsRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(
    dto: CreatePayrollPeriodDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<PayrollPeriodResponse> {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const payment = new Date(dto.paymentDate);

    if (
      isNaN(start.getTime()) ||
      isNaN(end.getTime()) ||
      isNaN(payment.getTime())
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid date format provided for period dates.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (start > end) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `startDate (${dto.startDate}) cannot be after endDate (${dto.endDate}).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (payment < end) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `paymentDate (${dto.paymentDate}) cannot be before endDate (${dto.endDate}). Payment date must be on or after the period closing date.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Inherit or validate configured payroll frequency
    const settings = await this.payrollSettingsRepository.findActive();
    const configuredFrequency =
      settings?.payrollFrequency ??
      PAYROLL_CONFIGURATION_DEFAULTS.PAYROLL_FREQUENCY;

    if (
      dto.payrollFrequency !== undefined &&
      dto.payrollFrequency !== configuredFrequency
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Company payroll settings are configured for ${String(configuredFrequency)} frequency. Period frequency must match.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const effectiveFrequency: PayrollFrequency = configuredFrequency;

    // 2. Validate calendar month and year consistency with period dates
    const startMonth = start.getUTCMonth() + 1;
    const startYear = start.getUTCFullYear();
    const endMonth = end.getUTCMonth() + 1;
    const endYear = end.getUTCFullYear();

    if (
      (startMonth !== dto.month && endMonth !== dto.month) ||
      (startYear !== dto.year && endYear !== dto.year)
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `The specified month (${dto.month}) and year (${dto.year}) do not align with startDate (${dto.startDate}) or endDate (${dto.endDate}).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Application-level date-range overlap check
    const overlapping = await this.payrollPeriodRepository.findOverlapping(
      start,
      end,
    );
    if (overlapping) {
      const existingStart = overlapping.startDate.toISOString().split('T')[0];
      const existingEnd = overlapping.endDate.toISOString().split('T')[0];
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Payroll period dates overlap with existing period '${overlapping.periodCode}' (${overlapping.periodName}: ${existingStart} to ${existingEnd}).`,
        HttpStatus.CONFLICT,
      );
    }

    // 4. Duplicate cycle check (year + month + frequency)
    const duplicateCycle =
      await this.payrollPeriodRepository.findDuplicateCycle(
        dto.year,
        dto.month,
        effectiveFrequency,
      );
    if (duplicateCycle) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `A payroll period for ${dto.year}-${String(dto.month).padStart(2, '0')} (${effectiveFrequency}) already exists: '${duplicateCycle.periodCode}'.`,
        HttpStatus.CONFLICT,
      );
    }

    // 5. Code resolution & uniqueness check
    const code = dto.periodCode
      ? dto.periodCode.trim().toUpperCase()
      : `PR-${dto.year}-${String(dto.month).padStart(2, '0')}`;

    const existingByCode = await this.payrollPeriodRepository.findByCode(code);
    if (existingByCode) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Payroll period with code '${code}' already exists.`,
        HttpStatus.CONFLICT,
      );
    }

    const periodData: Partial<PayrollPeriod> = {
      periodName: dto.periodName.trim(),
      periodCode: code,
      payrollFrequency: effectiveFrequency,
      startDate: start,
      endDate: end,
      paymentDate: payment,
      month: dto.month,
      year: dto.year,
      status: PayrollPeriodStatus.DRAFT,
      notes: dto.notes ? dto.notes.trim() : null,
      deletedAt: null,
      createdBy: actorId,
      updatedBy: actorId,
    };

    let created = null;
    try {
      created = await this.payrollPeriodRepository.create(periodData);
    } catch (error: unknown) {
      if (this.payrollPeriodRepository.isDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Concurrent conflict: a payroll period for cycle ${dto.year}-${dto.month} or code '${code}' already exists.`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PAYROLL_PERIOD_CREATED,
      targetId: created._id,
      targetModel: AuditTargetModel.PAYROLL_PERIOD,
      details: {
        periodCode: created.periodCode,
        periodName: created.periodName,
        month: created.month,
        year: created.year,
        frequency: created.payrollFrequency,
        status: created.status,
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return PayrollPeriodMapper.toResponse(created);
  }

  async list(
    query: ListPayrollPeriodsQueryDto,
  ): Promise<PaginatedResult<PayrollPeriodResponse>> {
    const filter = {
      year: query.year,
      month: query.month,
      status: query.status,
      payrollFrequency: query.payrollFrequency,
      search: query.search,
    };

    const pagination = {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      sortBy: (query.sortBy as PayrollPeriodSortableField) ?? 'startDate',
      sortOrder: query.sortOrder ?? 'desc',
    };

    const result = await this.payrollPeriodRepository.findList(
      filter,
      pagination,
    );

    return {
      data: result.data.map((item) => PayrollPeriodMapper.toResponse(item)),
      meta: result.meta,
    };
  }

  async getById(id: Types.ObjectId): Promise<PayrollPeriodResponse> {
    const doc = await this.payrollPeriodRepository.findById(id);
    if (!doc) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return PayrollPeriodMapper.toResponse(doc);
  }

  async update(
    id: Types.ObjectId,
    dto: UpdatePayrollPeriodDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<PayrollPeriodResponse> {
    const hasAtLeastOneField =
      dto.periodName !== undefined ||
      dto.startDate !== undefined ||
      dto.endDate !== undefined ||
      dto.paymentDate !== undefined ||
      dto.notes !== undefined;

    if (!hasAtLeastOneField) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'At least one field must be provided for update.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.payrollPeriodRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.status !== PayrollPeriodStatus.DRAFT) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Cannot update payroll period '${existing.periodCode}' because it is in '${existing.status}' status. Only DRAFT periods can be updated.`,
        HttpStatus.CONFLICT,
      );
    }

    if (dto.version !== undefined && dto.version !== existing.__v) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period was modified concurrently. Expected version ${existing.__v}, but received ${dto.version}. Please refresh and try again.`,
        HttpStatus.CONFLICT,
      );
    }

    const newStart = dto.startDate
      ? new Date(dto.startDate)
      : existing.startDate;
    const newEnd = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    const newPayment = dto.paymentDate
      ? new Date(dto.paymentDate)
      : existing.paymentDate;

    if (
      isNaN(newStart.getTime()) ||
      isNaN(newEnd.getTime()) ||
      isNaN(newPayment.getTime())
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid date format provided for period dates.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (newStart > newEnd) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `startDate cannot be after endDate.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (newPayment < newEnd) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `paymentDate cannot be before endDate. Payment date must be on or after the period closing date.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.startDate || dto.endDate) {
      const overlapping = await this.payrollPeriodRepository.findOverlapping(
        newStart,
        newEnd,
        id,
      );
      if (overlapping) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Updated dates overlap with existing period '${overlapping.periodCode}'.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const updateData: Partial<PayrollPeriod> = {
      updatedBy: actorId,
    };
    if (dto.periodName !== undefined) {
      updateData.periodName = dto.periodName.trim();
    }
    if (dto.startDate !== undefined) {
      updateData.startDate = newStart;
    }
    if (dto.endDate !== undefined) {
      updateData.endDate = newEnd;
    }
    if (dto.paymentDate !== undefined) {
      updateData.paymentDate = newPayment;
    }
    if (dto.notes !== undefined) {
      updateData.notes = dto.notes ? dto.notes.trim() : null;
    }

    const expectedVersion = dto.version ?? existing.__v;
    const updated = await this.payrollPeriodRepository.updateById(
      id,
      updateData,
      expectedVersion,
    );
    if (!updated) {
      const stillExists = await this.payrollPeriodRepository.findById(id);
      if (stillExists) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          `Payroll period '${existing.periodCode}' was modified concurrently by another process. Please refresh and try again.`,
          HttpStatus.CONFLICT,
        );
      }
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PAYROLL_PERIOD_UPDATED,
      targetId: updated._id,
      targetModel: AuditTargetModel.PAYROLL_PERIOD,
      details: {
        periodCode: updated.periodCode,
        periodName: updated.periodName,
        startDate: updated.startDate,
        endDate: updated.endDate,
        paymentDate: updated.paymentDate,
        version: updated.__v,
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return PayrollPeriodMapper.toResponse(updated);
  }

  async updateStatus(
    id: Types.ObjectId,
    dto: UpdatePayrollPeriodStatusDto,
    actorId: Types.ObjectId,
    roleIds: Types.ObjectId[],
    clientMetadata?: ClientMetadata,
  ): Promise<PayrollPeriodResponse> {
    const existing = await this.payrollPeriodRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const fromStatus = existing.status;
    const toStatus = dto.status;

    if (fromStatus === toStatus) {
      return PayrollPeriodMapper.toResponse(existing);
    }

    if (fromStatus === PayrollPeriodStatus.FINALIZED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${existing.periodCode}' is FINALIZED and locked. Status cannot be modified.`,
        HttpStatus.CONFLICT,
      );
    }

    if (dto.version !== undefined && dto.version !== existing.__v) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period status was modified concurrently. Expected version ${existing.__v}, but received ${dto.version}. Please refresh and try again.`,
        HttpStatus.CONFLICT,
      );
    }

    const allowed = ALLOWED_STATUS_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid status transition from '${fromStatus}' to '${toStatus}'. Allowed transitions: ${allowed.join(', ') || 'None'}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Special authorization check for finalization
    if (toStatus === PayrollPeriodStatus.FINALIZED) {
      const isAuthorized = await this.authorizationService.hasPermissions(
        roleIds,
        [PermissionKeys.PAYROLL_PERIODS_APPROVE],
      );
      if (!isAuthorized) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permissions to finalize payroll period. Requires '${PermissionKeys.PAYROLL_PERIODS_APPROVE}'.`,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const expectedVersion = dto.version ?? existing.__v;
    const updated = await this.payrollPeriodRepository.updateStatus(
      id,
      toStatus,
      actorId,
      expectedVersion,
    );
    if (!updated) {
      const stillExists = await this.payrollPeriodRepository.findById(id);
      if (stillExists) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          `Payroll period '${existing.periodCode}' was modified concurrently by another process. Please refresh and try again.`,
          HttpStatus.CONFLICT,
        );
      }
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PAYROLL_PERIOD_STATUS_CHANGED,
      targetId: updated._id,
      targetModel: AuditTargetModel.PAYROLL_PERIOD,
      details: {
        periodCode: updated.periodCode,
        fromStatus,
        toStatus,
        reason: dto.reason ?? null,
        version: updated.__v,
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return PayrollPeriodMapper.toResponse(updated);
  }
}
