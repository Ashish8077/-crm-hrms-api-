import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PayrollPeriodRepository } from '../../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../../payroll-periods/schemas/payroll-period.schema';
import { PayrollPeriodStatus } from '../../payroll-periods/constants/payroll-period.constant';
import {
  PayrollLeaveAttendanceResolution,
  PayrollLeaveAttendanceResolverService,
} from '../../payroll-periods/services/payroll-leave-attendance-resolver.service';
import { roundPayrollDays } from '../../payroll-periods/utils/payroll-calendar.util';
import {
  Employee,
  EmployeeDocument,
} from '../../employees/schemas/employee.schema';
import { EmployeeLean } from '../../employees/repositories/employee.repository';
import {
  PayrollPeriodEligibilityResult,
  evaluateEmployeePayrollPeriodEligibility,
} from '../../employees/utils/payroll-eligibility.util';
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
  leaveAndAttendance: PayrollLeaveAttendanceResolution;
  calendarDays: number;
  payableDays: number;
}

export interface BatchPayrollInputFailure {
  employeeId: string;
  employeeCode: string;
  errorCode: string;
  message: string;
}

export interface BatchPayrollInputResolutionResult {
  period: PayrollPeriodLean;
  calendarDays: number;
  configuration: ResolvedPayrollConfiguration;
  resolved: ResolvedPayrollInputs[];
  failures: BatchPayrollInputFailure[];
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
    private readonly payrollLeaveAttendanceResolver: PayrollLeaveAttendanceResolverService,
  ) {}

  async resolve(
    payrollPeriodId: Types.ObjectId,
    employeeId: Types.ObjectId,
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

    const {
      period: validPeriod,
      calendarDays,
      periodStartStr,
      periodEndStr,
    } = this.validatePeriod(payrollPeriodId, period);

    if (!employeeRaw) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Employee '${employeeId.toString()}' not found.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const decision = this.resolveEligibleTenureDecision(
      employeeRaw,
      validPeriod,
      periodStartStr,
      periodEndStr,
    );

    const salaryAssignment = this.resolveEligibleSalaryAssignment(
      employeeRaw.employeeCode,
      validPeriod,
      decision.effectiveTenureStart,
      decision.effectiveTenureEnd,
      allAssignments,
    );

    const [salaryStructure, leaveAndAttendance] = await Promise.all([
      this.salaryStructureRepository.findById(
        salaryAssignment.salaryStructureId,
      ),
      this.payrollLeaveAttendanceResolver.resolveForEmployee({
        periodStartStr,
        periodEndStr,
        target: {
          employee: employeeRaw,
          tenure: decision,
        },
      }),
    ]);

    this.validateSalaryStructure(salaryStructure, salaryAssignment);

    const configuration = this.buildConfigurationSnapshot(settingsDoc, ruleDoc);
    const payableDays = this.computeAuthoritativePayableDays({
      calendarDays,
      tenureCalendarDays: decision.eligibleDays,
      leaveAndAttendance,
      configuration,
    });

    return {
      period: validPeriod,
      employee: employeeRaw,
      salaryAssignment,
      salaryStructure: salaryStructure!,
      configuration,
      leaveAndAttendance,
      calendarDays,
      payableDays,
    };
  }

  /**
   * Batch-resolves authoritative payroll calculation inputs (including leave & attendance LOP)
   * for up to 1,000+ employees in a constant number of bulk database queries (zero N+1).
   */
  async resolveBatchForPeriod(
    payrollPeriodId: Types.ObjectId,
    employeeIds?: Types.ObjectId[],
  ): Promise<BatchPayrollInputResolutionResult> {
    const employeeFilter: Record<string, unknown> = { deletedAt: null };
    if (employeeIds && employeeIds.length > 0) {
      employeeFilter._id = { $in: employeeIds };
    }

    const [period, employees, settingsDoc, ruleDoc] = await Promise.all([
      this.payrollPeriodRepository.findById(payrollPeriodId),
      this.employeeModel
        .find(employeeFilter)
        .sort({ employeeCode: 1, _id: 1 })
        .lean<EmployeeLean[]>()
        .exec(),
      this.payrollSettingsRepository.findActive(),
      this.payrollCalculationRuleRepository.findActive(),
    ]);

    const {
      period: validPeriod,
      calendarDays,
      periodStartStr,
      periodEndStr,
    } = this.validatePeriod(payrollPeriodId, period);
    const configuration = this.buildConfigurationSnapshot(settingsDoc, ruleDoc);

    if (employees.length === 0) {
      return {
        period: validPeriod,
        calendarDays,
        configuration,
        resolved: [],
        failures: [],
      };
    }

    const failures: BatchPayrollInputFailure[] = [];
    const eligibleTargets: Array<{
      employee: EmployeeLean;
      tenure: Extract<PayrollPeriodEligibilityResult, { eligible: true }>;
    }> = [];

    for (const emp of employees) {
      try {
        const decision = this.resolveEligibleTenureDecision(
          emp,
          validPeriod,
          periodStartStr,
          periodEndStr,
        );
        eligibleTargets.push({ employee: emp, tenure: decision });
      } catch (error) {
        failures.push({
          employeeId: emp._id.toHexString(),
          employeeCode: emp.employeeCode,
          errorCode:
            error instanceof AppError ? error.code : ErrorCode.VALIDATION_ERROR,
          message:
            error instanceof Error ? error.message : 'Employee is ineligible',
        });
      }
    }

    if (eligibleTargets.length === 0) {
      return {
        period: validPeriod,
        calendarDays,
        configuration,
        resolved: [],
        failures,
      };
    }

    const eligibleIds = eligibleTargets.map((t) => t.employee._id);
    const [allAssignments, leaveAttendanceByEmp] = await Promise.all([
      this.employeeSalaryRepository.findAllByEmployeeIds(eligibleIds),
      this.payrollLeaveAttendanceResolver.resolveBatch({
        periodStartStr,
        periodEndStr,
        targets: eligibleTargets,
      }),
    ]);

    const assignmentsByEmp = new Map<string, EmployeeSalaryLean[]>();
    for (const assignment of allAssignments) {
      const empKey = assignment.employeeId.toHexString();
      const list = assignmentsByEmp.get(empKey);
      if (list) {
        list.push(assignment);
      } else {
        assignmentsByEmp.set(empKey, [assignment]);
      }
    }

    const matchedAssignments: Array<{
      employee: EmployeeLean;
      tenure: Extract<PayrollPeriodEligibilityResult, { eligible: true }>;
      assignment: EmployeeSalaryLean;
      leaveAndAttendance: PayrollLeaveAttendanceResolution;
    }> = [];
    const structureIdMap = new Map<string, Types.ObjectId>();

    for (const target of eligibleTargets) {
      const empKey = target.employee._id.toHexString();
      try {
        const assignment = this.resolveEligibleSalaryAssignment(
          target.employee.employeeCode,
          validPeriod,
          target.tenure.effectiveTenureStart,
          target.tenure.effectiveTenureEnd,
          assignmentsByEmp.get(empKey) ?? [],
        );
        const leaveAndAttendance = leaveAttendanceByEmp.get(empKey);
        if (!leaveAndAttendance) {
          throw new AppError(
            ErrorCode.INTERNAL_SERVER_ERROR,
            `Missing leave & attendance reconciliation for employee '${target.employee.employeeCode}'.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
        structureIdMap.set(
          assignment.salaryStructureId.toHexString(),
          assignment.salaryStructureId,
        );
        matchedAssignments.push({
          employee: target.employee,
          tenure: target.tenure,
          assignment,
          leaveAndAttendance,
        });
      } catch (error) {
        failures.push({
          employeeId: empKey,
          employeeCode: target.employee.employeeCode,
          errorCode:
            error instanceof AppError ? error.code : ErrorCode.VALIDATION_ERROR,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to resolve salary assignment',
        });
      }
    }

    const uniqueStructureIds = Array.from(structureIdMap.values());
    const structures =
      await this.salaryStructureRepository.findByIds(uniqueStructureIds);
    const structureMap = new Map<string, SalaryStructureLean>(
      structures.map((s) => [s._id.toHexString(), s]),
    );

    const resolved: ResolvedPayrollInputs[] = [];
    for (const item of matchedAssignments) {
      const structure =
        structureMap.get(item.assignment.salaryStructureId.toHexString()) ??
        null;
      try {
        this.validateSalaryStructure(structure, item.assignment);
        const payableDays = this.computeAuthoritativePayableDays({
          calendarDays,
          tenureCalendarDays: item.tenure.eligibleDays,
          leaveAndAttendance: item.leaveAndAttendance,
          configuration,
        });
        resolved.push({
          period: validPeriod,
          employee: item.employee,
          salaryAssignment: item.assignment,
          salaryStructure: structure!,
          configuration,
          leaveAndAttendance: item.leaveAndAttendance,
          calendarDays,
          payableDays,
        });
      } catch (error) {
        failures.push({
          employeeId: item.employee._id.toHexString(),
          employeeCode: item.employee.employeeCode,
          errorCode:
            error instanceof AppError ? error.code : ErrorCode.VALIDATION_ERROR,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to validate salary structure',
        });
      }
    }

    return {
      period: validPeriod,
      calendarDays,
      configuration,
      resolved,
      failures,
    };
  }

  private validatePeriod(
    payrollPeriodId: Types.ObjectId,
    period: PayrollPeriodLean | null,
  ): {
    period: PayrollPeriodLean;
    calendarDays: number;
    periodStartStr: string;
    periodEndStr: string;
  } {
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

    const periodStartStr = normalizeEffectiveDate(period.startDate)
      .toISOString()
      .slice(0, 10);
    const periodEndStr = normalizeEffectiveDate(period.endDate)
      .toISOString()
      .slice(0, 10);

    return { period, calendarDays, periodStartStr, periodEndStr };
  }

  private validateSalaryStructure(
    salaryStructure: SalaryStructureLean | null,
    salaryAssignment: EmployeeSalaryLean,
  ): void {
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
  }

  private buildConfigurationSnapshot(
    settingsDoc: {
      _id?: Types.ObjectId;
      __v?: number;
      currency?: string;
      fixedWorkingDaysPerMonth?: number | null;
    } | null,
    ruleDoc: {
      _id?: Types.ObjectId;
      __v?: number;
      roundingMode?: PayrollRoundingMode;
      roundingPrecision?: number;
      prorationPolicy?: PayrollProrationPolicy;
      prorateFixedComponents?: boolean;
      prorateDeductions?: boolean;
      prorateEmployerContributions?: boolean;
      negativeNetPayPolicy?: NegativeNetPayPolicy;
      componentExecutionOrder?: string[];
    } | null,
  ): ResolvedPayrollConfiguration {
    return {
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
  }

  private computeAuthoritativePayableDays(params: {
    calendarDays: number;
    tenureCalendarDays: number;
    leaveAndAttendance: PayrollLeaveAttendanceResolution;
    configuration: ResolvedPayrollConfiguration;
  }): number {
    const {
      calendarDays,
      tenureCalendarDays,
      leaveAndAttendance,
      configuration,
    } = params;
    const {
      eligibleWorkingDays,
      presentDays,
      halfDays,
      paidLeaveDays,
      totalLopDays,
    } = leaveAndAttendance;

    // Full-month LOP: zero worked days, zero paid leave, and every scheduled working day is LOP
    const isFullPeriodLop =
      eligibleWorkingDays > 0 &&
      presentDays === 0 &&
      halfDays === 0 &&
      paidLeaveDays === 0 &&
      totalLopDays >= eligibleWorkingDays;

    if (isFullPeriodLop) {
      return 0;
    }

    if (
      configuration.prorationPolicy === PayrollProrationPolicy.WORKING_DAYS &&
      configuration.fixedWorkingDaysPerMonth &&
      configuration.fixedWorkingDaysPerMonth > 0
    ) {
      const fixedMonthlyWorkingDays = configuration.fixedWorkingDaysPerMonth;
      const workingBase =
        tenureCalendarDays === calendarDays
          ? fixedMonthlyWorkingDays
          : Math.min(eligibleWorkingDays, fixedMonthlyWorkingDays);
      return roundPayrollDays(Math.max(0, workingBase - totalLopDays));
    }

    if (
      configuration.prorationPolicy === PayrollProrationPolicy.FIXED_30_DAYS
    ) {
      if (tenureCalendarDays === calendarDays) {
        return roundPayrollDays(Math.max(0, 30 - totalLopDays));
      }
      const fixedBase = Math.min(30, tenureCalendarDays);
      return roundPayrollDays(Math.max(0, fixedBase - totalLopDays));
    }

    return roundPayrollDays(Math.max(0, tenureCalendarDays - totalLopDays));
  }

  private resolveEligibleTenureDecision(
    employee: EmployeeLean,
    period: PayrollPeriodLean,
    periodStartStr: string,
    periodEndStr: string,
  ): Extract<PayrollPeriodEligibilityResult, { eligible: true }> {
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

    return decision;
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

      const coversStart = assignStartMs <= tenureStartMs;
      const coversEnd = assignEndMs > tenureEndMs;

      if (coversStart && coversEnd) {
        coveringFullTenure.push(assignment);
      } else if (assignStartMs <= tenureEndMs && assignEndMs > tenureStartMs) {
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
