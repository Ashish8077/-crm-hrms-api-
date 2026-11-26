import { HttpStatus, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../../salary-structures/constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import {
  CalculationMasterMap,
  SalaryStructureCalculationService,
} from '../../salary-structures/services/salary-structure-calculation.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { Decimal, toDecimal } from '../../../common/utils/financial-math.util';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import {
  PayrollRecordStatus,
  toDecimal128,
} from '../constants/payroll-calculation.constant';
import {
  CalculateEmployeePayrollDto,
  CalculatePayrollPreviewInputDto,
} from '../dto/calculate-employee-payroll.dto';
import {
  PayrollCalculationPreviewResponseDto,
  PayrollRecordResponseDto,
} from '../dto/payroll-calculation-response.dto';
import { PayrollCalculationMapper } from '../mappers/payroll-calculation.mapper';
import { PayrollRecordRepository } from '../repositories/payroll-record.repository';
import { PayrollCalculationSnapshot } from '../schemas/payroll-record.schema';
import {
  PayrollInputResolver,
  ResolvedPayrollInputs,
} from './payroll-input.resolver';
import {
  ResolvedSalaryComponent,
  SalaryComponentResolver,
} from './salary-component.resolver';
import { ComponentDependencyResolver } from './component-dependency.resolver';
import { ComponentCalculationEngine } from './component-calculation.engine';
import { ProrationCalculator } from './proration.calculator';
import {
  PayrollTotalsCalculator,
  PayrollTotalsResult,
} from './payroll-totals.calculator';
import { PayrollSnapshotBuilder } from './payroll-snapshot.builder';

@Injectable()
export class PayrollCalculationService {
  constructor(
    private readonly payrollRecordRepository: PayrollRecordRepository,
    private readonly inputResolver: PayrollInputResolver,
    private readonly componentResolver: SalaryComponentResolver,
    private readonly dependencyResolver: ComponentDependencyResolver,
    private readonly componentEngine: ComponentCalculationEngine,
    private readonly prorationCalculator: ProrationCalculator,
    private readonly totalsCalculator: PayrollTotalsCalculator,
    private readonly snapshotBuilder: PayrollSnapshotBuilder,
    private readonly auditLogsService: AuditLogsService,
    private readonly salaryStructureCalculationService: SalaryStructureCalculationService,
  ) {}

  async preview(
    dto: CalculatePayrollPreviewInputDto,
  ): Promise<PayrollCalculationPreviewResponseDto> {
    const payrollPeriodId = new Types.ObjectId(dto.payrollPeriodId);
    const employeeId = new Types.ObjectId(dto.employeeId);

    const { snapshot } = await this.executeCalculation(
      payrollPeriodId,
      employeeId,
      dto.payableDays,
    );

    return PayrollCalculationMapper.toPreviewResponse(snapshot);
  }

  async calculateAndPersistEmployeePayroll(
    dto: CalculateEmployeePayrollDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<PayrollRecordResponseDto> {
    const payrollPeriodId = new Types.ObjectId(dto.payrollPeriodId);
    const employeeId = new Types.ObjectId(dto.employeeId);

    const { inputs, snapshot, totals, calculatedAt } =
      await this.executeCalculation(
        payrollPeriodId,
        employeeId,
        dto.payableDays,
      );

    const precision = inputs.configuration.roundingPrecision;
    const grossEarnings = toDecimal128(totals.grossEarningsDec, precision);
    const totalDeductions = toDecimal128(totals.totalDeductionsDec, precision);
    const employerContributions = toDecimal128(
      totals.employerContributionsDec,
      precision,
    );
    const netSalary = toDecimal128(totals.netSalaryDec, precision);

    const existingRecord =
      await this.payrollRecordRepository.findByPeriodAndEmployee(
        payrollPeriodId,
        employeeId,
      );

    if (existingRecord) {
      if (!dto.recalculate) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Payroll record already exists for employee '${inputs.employee.employeeCode}' in period '${inputs.period.periodCode}'. Pass recalculate=true to recalculate.`,
          HttpStatus.CONFLICT,
        );
      }

      if (existingRecord.status !== PayrollRecordStatus.CALCULATED) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          `Payroll record for employee '${inputs.employee.employeeCode}' in period '${inputs.period.periodCode}' is in '${String(existingRecord.status)}' status and cannot be recalculated.`,
          HttpStatus.CONFLICT,
        );
      }

      const updated = await this.payrollRecordRepository.recalculateAtomically(
        existingRecord._id,
        existingRecord.__v,
        {
          salaryAssignmentId: inputs.salaryAssignment._id,
          salaryStructureId: inputs.salaryStructure._id,
          calculationSnapshot: snapshot,
          grossEarnings,
          totalDeductions,
          employerContributions,
          netSalary,
          calculatedAt,
          updatedBy: actorId,
        },
      );

      if (!updated) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          `Concurrent payroll recalculation detected for employee '${inputs.employee.employeeCode}' in period '${inputs.period.periodCode}'. Please refresh and try again.`,
          HttpStatus.CONFLICT,
        );
      }

      await this.auditLogsService.createAuditLog({
        actorId,
        action: AuditAction.PAYROLL_CALCULATION_RECALCULATED,
        targetId: updated._id,
        targetModel: AuditTargetModel.PAYROLL_RECORD,
        details: {
          payrollPeriodId: payrollPeriodId.toString(),
          periodCode: inputs.period.periodCode,
          employeeId: employeeId.toString(),
          employeeCode: inputs.employee.employeeCode,
          calculationVersion: updated.calculationVersion,
          payableDays: inputs.payableDays,
          calendarDays: inputs.calendarDays,
          netSalary: updated.netSalary.toString(),
        },
        ipAddress: clientMetadata?.ipAddress ?? null,
        userAgent: clientMetadata?.userAgent ?? null,
      });

      return PayrollCalculationMapper.toRecordResponse(updated);
    }

    let created;
    try {
      created = await this.payrollRecordRepository.create({
        payrollPeriodId,
        employeeId,
        salaryAssignmentId: inputs.salaryAssignment._id,
        salaryStructureId: inputs.salaryStructure._id,
        calculationSnapshot: snapshot,
        grossEarnings,
        totalDeductions,
        employerContributions,
        netSalary,
        status: PayrollRecordStatus.CALCULATED,
        calculatedAt,
        calculationVersion: 1,
        createdBy: actorId,
        updatedBy: actorId,
      });
    } catch (error: unknown) {
      if (this.payrollRecordRepository.isDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Concurrent conflict: payroll record already exists for employee '${inputs.employee.employeeCode}' in period '${inputs.period.periodCode}'.`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PAYROLL_CALCULATION_EXECUTED,
      targetId: created._id,
      targetModel: AuditTargetModel.PAYROLL_RECORD,
      details: {
        payrollPeriodId: payrollPeriodId.toString(),
        periodCode: inputs.period.periodCode,
        employeeId: employeeId.toString(),
        employeeCode: inputs.employee.employeeCode,
        calculationVersion: created.calculationVersion,
        payableDays: inputs.payableDays,
        calendarDays: inputs.calendarDays,
        netSalary: created.netSalary.toString(),
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return PayrollCalculationMapper.toRecordResponse(created);
  }

  private async executeCalculation(
    payrollPeriodId: Types.ObjectId,
    employeeId: Types.ObjectId,
    requestedPayableDays?: number,
  ): Promise<{
    inputs: ResolvedPayrollInputs;
    snapshot: PayrollCalculationSnapshot;
    totals: PayrollTotalsResult;
    calculatedAt: Date;
  }> {
    const inputs = await this.inputResolver.resolve(
      payrollPeriodId,
      employeeId,
      requestedPayableDays,
    );

    const { components: resolvedComponents, masterMap } =
      await this.componentResolver.resolveForStructure(inputs.salaryStructure);

    const targetMonthlyGross = this.resolveTargetMonthlyGross(
      inputs,
      resolvedComponents,
      masterMap,
    );

    const orderedComponents = this.dependencyResolver.resolveExecutionOrder(
      resolvedComponents,
      inputs.configuration.componentExecutionOrder,
      targetMonthlyGross !== null,
    );

    const monthlyCalculated = this.componentEngine.calculateMonthlyAmounts(
      orderedComponents,
      targetMonthlyGross,
    );

    const proration = this.prorationCalculator.applyProration(
      monthlyCalculated,
      inputs.calendarDays,
      inputs.payableDays,
      inputs.configuration,
    );

    const totals = this.totalsCalculator.calculateTotals(
      proration.components,
      inputs.configuration,
    );

    const calculatedAt = new Date();
    const snapshot = this.snapshotBuilder.build({
      inputs,
      executionOrder: orderedComponents.map((c) => c.code),
      proration,
      totals,
      calculatedAt,
    });

    return {
      inputs,
      snapshot,
      totals,
      calculatedAt,
    };
  }

  private resolveTargetMonthlyGross(
    inputs: ResolvedPayrollInputs,
    resolvedComponents: ResolvedSalaryComponent[],
    masterMap: CalculationMasterMap,
  ): Decimal | null {
    const { salaryStructure, salaryAssignment } = inputs;
    const hasBalanceComponent = resolvedComponents.some(
      (c) => c.calculationMethod === StructureComponentCalculationType.BALANCE,
    );

    if (hasBalanceComponent) {
      // Reuse SalaryStructureCalculationService solely to derive target monthly gross
      // (normalized from annual when salaryFrequency === ANNUAL) without double-counting
      // deductions or employer contributions, which are computed per payroll component below.
      const breakup = this.salaryStructureCalculationService.calculate({
        salaryBasis: salaryStructure.salaryBasis,
        salaryFrequency: salaryStructure.salaryFrequency,
        salaryAmount: salaryStructure.salaryAmount,
        components: salaryStructure.components.map((c) => ({
          componentId: c.componentId,
          calculationType: c.calculationType,
          amount: c.amount,
          percentage: c.percentage,
          percentageOf: c.percentageOf,
        })),
        masterMap,
      });

      return toDecimal(breakup.grossSalaryMonthly);
    }

    if (
      salaryStructure.salaryBasis === SalaryStructureBasis.GROSS &&
      salaryStructure.salaryAmount > 0
    ) {
      const amountDec = toDecimal(salaryStructure.salaryAmount);
      return salaryStructure.salaryFrequency === SalaryStructureFrequency.ANNUAL
        ? amountDec.dividedBy(12)
        : amountDec;
    }

    if (
      salaryAssignment.salarySnapshot?.grossSalaryMonthly !== undefined &&
      salaryAssignment.salarySnapshot.grossSalaryMonthly > 0
    ) {
      return toDecimal(salaryAssignment.salarySnapshot.grossSalaryMonthly);
    }

    if (
      salaryStructure.salaryBasis === SalaryStructureBasis.CTC &&
      resolvedComponents.some(
        (c) =>
          c.classification === SalaryComponentType.EARNING &&
          c.percentageOf === 'GROSS_SALARY',
      )
    ) {
      const breakup = this.salaryStructureCalculationService.calculate({
        salaryBasis: salaryStructure.salaryBasis,
        salaryFrequency: salaryStructure.salaryFrequency,
        salaryAmount: salaryStructure.salaryAmount,
        components: salaryStructure.components.map((c) => ({
          componentId: c.componentId,
          calculationType: c.calculationType,
          amount: c.amount,
          percentage: c.percentage,
          percentageOf: c.percentageOf,
        })),
        masterMap,
      });

      return toDecimal(breakup.grossSalaryMonthly);
    }

    return null;
  }
}
