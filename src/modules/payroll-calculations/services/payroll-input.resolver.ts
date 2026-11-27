import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PayrollPeriodRepository } from '../../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../../payroll-periods/schemas/payroll-period.schema';
import { PayrollPeriodStatus } from '../../payroll-periods/constants/payroll-period.constant';
import {
  Employee,
  EmployeeDocument,
} from '../../employees/schemas/employee.schema';
import { EmployeeLean } from '../../employees/repositories/employee.repository';
import { evaluateEmployeePayrollPeriodEligibility } from '../../employees/utils/payroll-eligibility.util';
import { EmployeeSalaryRepository } from '../../employee-salaries/repositories/employee-salary.repository';
import { EmployeeSalaryLean } from '../../employee-salaries/schemas/employee-salary.schema';
import { normalizeEffectiveDate } from '../../employee-salaries/constants/employee-salary.constant';
import { SalaryStructureRepository } from '../../salary-structures/repositories/salary-structure.repository';
import { SalaryStructureLean } from '../../salary-structures/schemas/salary-structure.schema';
import { PayrollSettingsRepository } from '../../payroll-configuration/repositories/payroll-settings.repository';
import { PayrollCalculationRuleRepository } from '../../payroll-configuration/repositories/payroll-calculation-rule.repository';
import {
  NegativeNetPayPolicy,
  PAYROLL_CONFIGURATION_DEFAULTS,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../../payroll-configuration/constants/payroll-configuration.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  ALLOWED_CALCULATION_PERIOD_STATUSES,
  calculateCalendarDaysInclusive,
} from '../constants/payroll-calculation.constant';

export interface ResolvedPayrollConfiguration {
  payrollSettingsId: string | null;
  payrollSettingsVersion: number | null;
  payrollCalculationRuleId: string | null;
  payrollCalculationRuleVersion: number | null;
  currency: string;
  roundingMode: PayrollRoundingMode;
  roundingPrecision: number;
  prorationPolicy: PayrollProrationPolicy;
  prorateFixedComponents: boolean;
  prorateDeductions: boolean;
  prorateEmployerContributions: boolean;
  negativeNetPayPolicy: NegativeNetPayPolicy;
  fixedWorkingDaysPerMonth: number | null;
  componentExecutionOrder: string[];
}

export interface ResolvedPayrollInputs {
  period: PayrollPeriodLean;
  employee: EmployeeLean;
  salaryAssignment: EmployeeSalaryLean;
  salaryStructure: SalaryStructureLean;
  configuration: ResolvedPayrollConfiguration;
  calendarDays: number;
  payableDays: number;
}

@Injectable()
export class PayrollInputResolver {
  constructor(
    private readonly payrollPeriodRepository: PayrollPeriodRepository,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    private readonly employeeSalaryRepository: EmployeeSalaryRepository,
    private readonly salaryStructureRepository: SalaryStructureRepository,
    private readonly payrollSettingsRepository: PayrollSettingsRepository,
    private readonly payrollCalculationRuleRepository: PayrollCalculationRuleRepository,
  ) {}

  async resolve(
    payrollPeriodId: Types.ObjectId,
    employeeId: Types.ObjectId,
    requestedPayableDays?: number,
  ): Promise<ResolvedPayrollInputs> {
    const [period, employeeRaw, allAssignments, settingsDoc, ruleDoc] =
      await Promise.all([
        this.payrollPeriodRepository.findById(payrollPeriodId),
        this.employeeModel
          .findById(employeeId)
          .lean<EmployeeLean | null>()
          .exec(),
        this.employeeSalaryRepository.findAllByEmployeeId(employeeId),
        this.payrollSettingsRepository.findActive(),
        this.payrollCalculationRuleRepository.findActive(),
      ]);

    // 1. Validate Payroll Period
    if (!period || period.deletedAt !== null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Payroll period '${payrollPeriodId.toString()}' not found.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (period.status === PayrollPeriodStatus.FINALIZED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${period.periodCode}' is FINALIZED and locked. Calculations are not permitted.`,
        HttpStatus.CONFLICT,
      );
    }

    if (!ALLOWED_CALCULATION_PERIOD_STATUSES.includes(period.status)) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${period.periodCode}' is in '${period.status}' status. Allowed statuses for calculation: ${ALLOWED_CALCULATION_PERIOD_STATUSES.join(', ')}.`,
        HttpStatus.CONFLICT,
      );
    }

    const calendarDays = calculateCalendarDaysInclusive(
      period.startDate,
      period.endDate,
    );
    if (calendarDays <= 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Payroll period '${period.periodCode}' has invalid calendar days (${calendarDays}).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2 & 3. Validate Employee eligibility & active employment tenure using shared payroll eligibility policy
    if (!employeeRaw) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Employee '${employeeId.toString()}' not found.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const tenure = this.resolveEligibleTenure(employeeRaw, period);

    const payableDays = requestedPayableDays ?? tenure.eligibleDays;
    if (
      !Number.isFinite(payableDays) ||
      payableDays < 0 ||
      payableDays > tenure.eligibleDays
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `payableDays (${payableDays}) must be between 0 and eligible tenure days (${tenure.eligibleDays}) for employee '${employeeRaw.employeeCode}' in period '${period.periodCode}' (calendar days: ${calendarDays}).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. Resolve exact salary assignment covering employee's active tenure in this period
    const salaryAssignment = this.resolveEligibleSalaryAssignment(
      employeeRaw.employeeCode,
      period,
      tenure.effectiveTenureStart,
      tenure.effectiveTenureEnd,
      allAssignments,
    );

    // 5. Fetch & Validate Salary Structure
    const salaryStructure = await this.salaryStructureRepository.findById(
      salaryAssignment.salaryStructureId,
    );
    if (!salaryStructure) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Salary structure '${salaryAssignment.salaryStructureId.toString()}' referenced by assignment '${salaryAssignment._id.toString()}' not found.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (
      !salaryStructure.components ||
      salaryStructure.components.length === 0
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Salary structure '${salaryStructure.code}' contains no salary components.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 5. Build authoritative Payroll Configuration snapshot
    const configuration: ResolvedPayrollConfiguration = {
      payrollSettingsId: settingsDoc?._id?.toString() ?? null,
      payrollSettingsVersion: settingsDoc?.__v ?? null,
      payrollCalculationRuleId: ruleDoc?._id?.toString() ?? null,
      payrollCalculationRuleVersion: ruleDoc?.__v ?? null,
      currency:
        settingsDoc?.currency ?? PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY,
      roundingMode:
        ruleDoc?.roundingMode ?? PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_MODE,
      roundingPrecision:
        ruleDoc?.roundingPrecision ??
        PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION,
      prorationPolicy:
        ruleDoc?.prorationPolicy ??
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATION_POLICY,
      prorateFixedComponents:
        ruleDoc?.prorateFixedComponents ??
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_FIXED_COMPONENTS,
      prorateDeductions:
        ruleDoc?.prorateDeductions ??
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_DEDUCTIONS,
      prorateEmployerContributions:
        ruleDoc?.prorateEmployerContributions ??
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_EMPLOYER_CONTRIBUTIONS,
      negativeNetPayPolicy:
        ruleDoc?.negativeNetPayPolicy ??
        PAYROLL_CONFIGURATION_DEFAULTS.NEGATIVE_NET_PAY_POLICY,
      fixedWorkingDaysPerMonth: settingsDoc?.fixedWorkingDaysPerMonth ?? null,
      componentExecutionOrder: ruleDoc?.componentExecutionOrder ?? [],
    };

    return {
      period,
      employee: employeeRaw,
      salaryAssignment,
      salaryStructure,
      configuration,
      calendarDays,
      payableDays,
    };
  }

  private resolveEligibleTenure(
    employee: EmployeeLean,
    period: PayrollPeriodLean,
  ): {
    effectiveTenureStart: Date;
    effectiveTenureEnd: Date;
    eligibleDays: number;
  } {
    const periodStart = normalizeEffectiveDate(period.startDate);
    const periodEnd = normalizeEffectiveDate(period.endDate);
    const periodStartStr = periodStart.toISOString().slice(0, 10);
    const periodEndStr = periodEnd.toISOString().slice(0, 10);

    const decision = evaluateEmployeePayrollPeriodEligibility(
      employee,
      periodStartStr,
      periodEndStr,
    );

    if (!decision.eligible) {
      switch (decision.reason) {
        case 'SOFT_DELETED':
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            `Employee '${employee.employeeCode}' is soft-deleted and ineligible for payroll calculation.`,
            HttpStatus.NOT_FOUND,
          );
        case 'MISSING_RELIABLE_EXIT_DATE':
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Employee '${employee.employeeCode}' has status '${employee.employmentStatus}' without a reliable effective exit date (lastWorkingDate or terminationDate) and is ineligible for payroll.`,
            HttpStatus.BAD_REQUEST,
          );
        case 'UNSUPPORTED_EMPLOYMENT_STATUS':
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Employee '${employee.employeeCode}' has unsupported employment status '${employee.employmentStatus}' for payroll.`,
            HttpStatus.BAD_REQUEST,
          );
        case 'JOINED_AFTER_PERIOD':
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Employee '${employee.employeeCode}' joined on ${decision.dateOfJoiningStr ?? 'unknown'}, after payroll period '${period.periodCode}' ended (${periodEndStr}). Ineligible for this payroll period.`,
            HttpStatus.BAD_REQUEST,
          );
        case 'EXITED_BEFORE_PERIOD':
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Employee '${employee.employeeCode}' left on ${decision.effectiveExitDateStr ?? 'unknown'}, before payroll period '${period.periodCode}' started (${periodStartStr}). Ineligible for this payroll period.`,
            HttpStatus.BAD_REQUEST,
          );
        default:
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Employee '${employee.employeeCode}' has invalid employment tenure window in period '${period.periodCode}'.`,
            HttpStatus.BAD_REQUEST,
          );
      }
    }

    return {
      effectiveTenureStart: decision.effectiveTenureStart,
      effectiveTenureEnd: decision.effectiveTenureEnd,
      eligibleDays: decision.eligibleDays,
    };
  }

  private resolveEligibleSalaryAssignment(
    employeeCode: string,
    period: PayrollPeriodLean,
    effectiveTenureStart: Date,
    effectiveTenureEnd: Date,
    assignments: EmployeeSalaryLean[],
  ): EmployeeSalaryLean {
    if (!assignments || assignments.length === 0) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `No salary assignment found for employee '${employeeCode}'.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const tenureStartMs = effectiveTenureStart.getTime();
    const tenureEndMs = effectiveTenureEnd.getTime();

    const coveringFullTenure: EmployeeSalaryLean[] = [];
    const overlappingPartial: EmployeeSalaryLean[] = [];

    for (const assignment of assignments) {
      const assignStartMs = normalizeEffectiveDate(
        assignment.effectiveFrom,
      ).getTime();
      const assignEndMs = assignment.effectiveTo
        ? normalizeEffectiveDate(assignment.effectiveTo).getTime()
        : Infinity;

      // Half-open interval [effectiveFrom, effectiveTo):
      // Must start on or before the employee's active tenure start in the period
      // AND must extend past the employee's active tenure end in the period.
      const coversStart = assignStartMs <= tenureStartMs;
      const coversEnd = assignEndMs > tenureEndMs;

      if (coversStart && coversEnd) {
        coveringFullTenure.push(assignment);
      } else if (assignStartMs <= tenureEndMs && assignEndMs > tenureStartMs) {
        // Overlaps at least one calendar day inside the employee's active tenure window
        overlappingPartial.push(assignment);
      }
    }

    if (coveringFullTenure.length > 1) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Multiple ambiguous salary assignments (${coveringFullTenure.length}) cover tenure for employee '${employeeCode}' in payroll period '${period.periodCode}'.`,
        HttpStatus.CONFLICT,
      );
    }

    if (coveringFullTenure.length === 0) {
      if (overlappingPartial.length > 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Salary assignment does not cover the employee's active tenure (${effectiveTenureStart.toISOString().slice(0, 10)} to ${effectiveTenureEnd.toISOString().slice(0, 10)}) in payroll period '${period.periodCode}'. Mid-period salary revisions or partial coverage are not supported.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `No active salary assignment covers payroll period '${period.periodCode}' (${effectiveTenureStart.toISOString().slice(0, 10)} to ${effectiveTenureEnd.toISOString().slice(0, 10)}) for employee '${employeeCode}'.`,
        HttpStatus.NOT_FOUND,
      );
    }

    return coveringFullTenure[0];
  }
}
