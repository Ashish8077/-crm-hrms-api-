import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PayrollCalculationRuleRepository } from '../repositories/payroll-calculation-rule.repository';
import { UpdateCalculationRulesDto } from '../dto/update-calculation-rules.dto';
import {
  PayrollCalculationRuleResponse,
  PayrollConfigurationMapper,
} from '../mappers/payroll-configuration.mapper';
import { PAYROLL_CONFIGURATION_DEFAULTS } from '../constants/payroll-configuration.constant';
import {
  SalaryComponent,
  SalaryComponentDocument,
  SalaryComponentLean,
} from '../../salary-components/schemas/salary-component.schema';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';

@Injectable()
export class PayrollCalculationRuleService {
  constructor(
    private readonly ruleRepository: PayrollCalculationRuleRepository,
    @InjectModel(SalaryComponent.name)
    private readonly salaryComponentModel: Model<SalaryComponentDocument>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getCalculationRules(): Promise<PayrollCalculationRuleResponse> {
    const { rule } = await this.ruleRepository.findOrCreateDefault(null);
    return PayrollConfigurationMapper.toCalculationRuleResponse(rule);
  }

  async updateCalculationRules(
    dto: UpdateCalculationRulesDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<PayrollCalculationRuleResponse> {
    const existing = await this.ruleRepository.findActive();

    if (dto.version !== undefined) {
      if (!existing) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Payroll calculation rules have not been initialized yet.',
          HttpStatus.CONFLICT,
        );
      }
      if (existing.__v !== dto.version) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Payroll calculation rules were modified by another administrator. Please reload and retry.',
          HttpStatus.CONFLICT,
        );
      }
    }

    if (dto.componentExecutionOrder && dto.componentExecutionOrder.length > 0) {
      const normalizedCodes = dto.componentExecutionOrder.map((c) =>
        c.trim().toUpperCase(),
      );
      const uniqueCodes = new Set(normalizedCodes);
      if (uniqueCodes.size !== normalizedCodes.length) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Duplicate component codes are not allowed in componentExecutionOrder.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const foundComponents = await this.salaryComponentModel
        .find({ code: { $in: normalizedCodes } })
        .select('code')
        .lean<Array<Pick<SalaryComponentLean, 'code'>>>()
        .exec();

      const foundCodeSet = new Set(
        foundComponents.map((c) => c.code.toUpperCase()),
      );
      const unknownCodes = normalizedCodes.filter((c) => !foundCodeSet.has(c));
      if (unknownCodes.length > 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unknown salary component codes in componentExecutionOrder: ${unknownCodes.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const existingStatutory =
      existing?.statutoryConfig ??
      PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG;
    const mergedStatutory = dto.statutoryConfig
      ? {
          pfEnabled:
            dto.statutoryConfig.pfEnabled ?? existingStatutory.pfEnabled,
          esiEnabled:
            dto.statutoryConfig.esiEnabled ?? existingStatutory.esiEnabled,
          ptEnabled:
            dto.statutoryConfig.ptEnabled ?? existingStatutory.ptEnabled,
          tdsEnabled:
            dto.statutoryConfig.tdsEnabled ?? existingStatutory.tdsEnabled,
        }
      : undefined;

    let updated = null;
    try {
      updated = await this.ruleRepository.upsertRule(
        {
          roundingMode: dto.roundingMode,
          roundingPrecision: dto.roundingPrecision,
          prorationPolicy: dto.prorationPolicy,
          prorateFixedComponents: dto.prorateFixedComponents,
          prorateDeductions: dto.prorateDeductions,
          negativeNetPayPolicy: dto.negativeNetPayPolicy,
          statutoryConfig: mergedStatutory,
          componentExecutionOrder: dto.componentExecutionOrder,
          updatedBy: actorId,
        },
        actorId,
        dto.version,
      );
    } catch (error: unknown) {
      if (this.ruleRepository.isDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Concurrent calculation rules initialization detected. Please retry.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    if (!updated) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Payroll calculation rules were modified concurrently. Please reload and retry.',
        HttpStatus.CONFLICT,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PAYROLL_CALCULATION_RULES_UPDATED,
      targetId: updated._id,
      targetModel: AuditTargetModel.PAYROLL_CALCULATION_RULE,
      details: {
        roundingMode: updated.roundingMode,
        roundingPrecision: updated.roundingPrecision,
        prorationPolicy: updated.prorationPolicy,
        negativeNetPayPolicy: updated.negativeNetPayPolicy,
        version: updated.__v,
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return PayrollConfigurationMapper.toCalculationRuleResponse(updated);
  }
}
