import { HttpStatus, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { PayrollSettingsRepository } from '../repositories/payroll-settings.repository';
import { UpdatePayrollSettingsDto } from '../dto/update-payroll-settings.dto';
import {
  PayrollConfigurationMapper,
  PayrollSettingsResponse,
} from '../mappers/payroll-configuration.mapper';
import {
  PAYROLL_CONFIGURATION_DEFAULTS,
  PAYROLL_CURRENCY_PRECISION_MAP,
  WorkingDaysPolicy,
} from '../constants/payroll-configuration.constant';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';

@Injectable()
export class PayrollSettingsService {
  constructor(
    private readonly settingsRepository: PayrollSettingsRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getSettings(): Promise<PayrollSettingsResponse> {
    const { settings } =
      await this.settingsRepository.findOrCreateDefault(null);
    return PayrollConfigurationMapper.toSettingsResponse(settings);
  }

  async updateSettings(
    dto: UpdatePayrollSettingsDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<PayrollSettingsResponse> {
    const existing = await this.settingsRepository.findActive();

    // Check optimistic concurrency upfront when version is provided
    if (dto.version !== undefined) {
      if (!existing) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Payroll settings version conflict: configuration has not been initialized yet.',
          HttpStatus.CONFLICT,
        );
      }
      if (existing.__v !== dto.version) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Payroll settings were modified by another administrator. Please reload and retry.',
          HttpStatus.CONFLICT,
        );
      }
    }

    // Protect historical processed payroll runs from breaking policy mutations
    if (existing?.hasProcessedPayroll) {
      if (
        (dto.currency !== undefined && dto.currency !== existing.currency) ||
        (dto.payrollFrequency !== undefined &&
          dto.payrollFrequency !== existing.payrollFrequency) ||
        (dto.financialYearStartMonth !== undefined &&
          dto.financialYearStartMonth !== existing.financialYearStartMonth)
      ) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Cannot change currency, payrollFrequency, or financialYearStartMonth after payroll has been processed.',
          HttpStatus.CONFLICT,
        );
      }
    }

    const effectivePolicy =
      dto.workingDaysPolicy ??
      existing?.workingDaysPolicy ??
      PAYROLL_CONFIGURATION_DEFAULTS.WORKING_DAYS_POLICY;

    let effectiveFixedWorkingDays: number | null | undefined =
      dto.fixedWorkingDaysPerMonth;

    if (effectivePolicy === WorkingDaysPolicy.FIXED_WORKING_DAYS) {
      const resolvedDays =
        dto.fixedWorkingDaysPerMonth ?? existing?.fixedWorkingDaysPerMonth;
      if (!resolvedDays || resolvedDays < 1 || resolvedDays > 31) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'fixedWorkingDaysPerMonth (1-31) is required when workingDaysPolicy is FIXED_WORKING_DAYS.',
          HttpStatus.BAD_REQUEST,
        );
      }
      effectiveFixedWorkingDays = resolvedDays;
    } else {
      if (
        dto.fixedWorkingDaysPerMonth !== undefined &&
        dto.fixedWorkingDaysPerMonth !== null
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'fixedWorkingDaysPerMonth is only allowed when workingDaysPolicy is FIXED_WORKING_DAYS.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.workingDaysPolicy !== undefined) {
        effectiveFixedWorkingDays = null;
      }
    }

    const effectiveCurrency =
      dto.currency ??
      existing?.currency ??
      PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY;
    const currencyPrecision =
      PAYROLL_CURRENCY_PRECISION_MAP[effectiveCurrency] ??
      PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY_PRECISION;

    let updated = null;
    try {
      updated = await this.settingsRepository.upsertSettings(
        {
          currency: dto.currency,
          currencyPrecision:
            dto.currency !== undefined ? currencyPrecision : undefined,
          payrollFrequency: dto.payrollFrequency,
          cutoffDay: dto.cutoffDay,
          paymentDay: dto.paymentDay,
          financialYearStartMonth: dto.financialYearStartMonth,
          workingDaysPolicy: dto.workingDaysPolicy,
          fixedWorkingDaysPerMonth: effectiveFixedWorkingDays,
          isPayrollProcessingEnabled: dto.isPayrollProcessingEnabled,
          updatedBy: actorId,
        },
        actorId,
        dto.version,
      );
    } catch (error: unknown) {
      if (this.settingsRepository.isDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Concurrent payroll settings initialization detected. Please retry.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    if (!updated) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Payroll settings were modified concurrently. Please reload and retry.',
        HttpStatus.CONFLICT,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: existing
        ? AuditAction.PAYROLL_SETTINGS_UPDATED
        : AuditAction.PAYROLL_SETTINGS_CREATED,
      targetId: updated._id,
      targetModel: AuditTargetModel.PAYROLL_SETTINGS,
      details: {
        currency: updated.currency,
        payrollFrequency: updated.payrollFrequency,
        cutoffDay: updated.cutoffDay,
        paymentDay: updated.paymentDay,
        financialYearStartMonth: updated.financialYearStartMonth,
        workingDaysPolicy: updated.workingDaysPolicy,
        isPayrollProcessingEnabled: updated.isPayrollProcessingEnabled,
        version: updated.__v,
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return PayrollConfigurationMapper.toSettingsResponse(updated);
  }
}
