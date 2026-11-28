import { HttpStatus, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  ATTENDANCE_CONSTANTS,
  AttendanceStatus,
  RegularizationStatus,
} from '../../attendance/constants/attendance.constant';
import { AttendanceRegularizationRepository } from '../../attendance/repositories/attendance-regularization.repository';
import { AttendanceRepository } from '../../attendance/repositories/attendance.repository';
import { AttendanceCalculationUtil } from '../../attendance/utils/attendance-calculation.util';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import {
  EmployeeRepository,
  PayrollAttendanceEmployeeProjection,
} from '../../employees/repositories/employee.repository';
import { evaluateEmployeePayrollPeriodEligibility } from '../../employees/utils/payroll-eligibility.util';
import { LeaveRequestStatus } from '../../leaves/constants/leaves.constant';
import { HolidayRepository } from '../../leaves/repositories/holiday.repository';
import {
  LeaveRequestLean,
  LeaveRequestRepository,
} from '../../leaves/repositories/leave-request.repository';
import { LeaveCalculationUtil } from '../../leaves/utils/leave-calculation.util';
import { WEEKLY_OFF_CONSTANTS } from '../../work-schedules/constants/weekly-off.constant';
import { WeeklyOffConfigRepository } from '../../work-schedules/repositories/weekly-off-config.repository';
import { WeeklyOffConfigLean } from '../../work-schedules/mappers/weekly-off-config.mapper';
import { WeeklyOffCalculationUtil } from '../../work-schedules/utils/weekly-off-calculation.util';
import { PayrollAttendanceSummaryQueryDto } from '../dto/payroll-attendance-summary-query.dto';
import {
  EmployeePayrollAttendanceSummaryDto,
  PayrollAttendanceFinalizationStateDto,
  PayrollAttendancePeriodInfoDto,
  PayrollAttendanceStatusBreakdownDto,
  PayrollAttendanceWarningCode,
  PayrollLeaveTypeBreakdownItemDto,
  PayrollPeriodAttendanceSummaryResponseDto,
} from '../dto/payroll-attendance-summary-response.dto';
import { PayrollPeriodRepository } from '../repositories/payroll-period.repository';

interface AggregatedAttendanceDay {
  employeeId: Types.ObjectId;
  attendanceDate: string;
  recordCount: number;
  status: AttendanceStatus;
  statuses: AttendanceStatus[];
  isLate: boolean;
  lateMinutes: number;
  isEarlyDeparture: boolean;
  earlyDepartureMinutes: number;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  overtimeMinutes: number;
  regularizationId: Types.ObjectId | null;
  leaveRequestId: Types.ObjectId | null;
}

interface VerifiedRegularizationInfo {
  employeeId: Types.ObjectId;
  attendanceDate: string;
  status: RegularizationStatus;
}

interface EligibleEmployeeTenure {
  employee: PayrollAttendanceEmployeeProjection;
  branchIdStr: string;
  branchTimezone: string;
  dateOfJoiningStr: string;
  effectiveExitDateStr: string | null;
  effectiveStartDate: string;
  effectiveEndDate: string;
}

interface BranchCalendarLookup {
  weeklyOffConfigsByBranch: Map<string, WeeklyOffConfigLean[]>;
  companyWeeklyOffConfigs: WeeklyOffConfigLean[];
  holidaysByBranch: Map<string, Set<string>>;
  globalHolidays: Set<string>;
}

const INCLUDED_LEAVE_STATUSES: LeaveRequestStatus[] = [
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.CANCELLATION_REQUESTED,
];

const MS_PER_DAY = 86_400_000;

@Injectable()
export class PayrollAttendanceSummaryService {
  constructor(
    private readonly payrollPeriodRepository: PayrollPeriodRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly branchRepository: BranchRepository,
    private readonly attendanceRepository: AttendanceRepository,
    private readonly attendanceRegularizationRepository: AttendanceRegularizationRepository,
    private readonly leaveRequestRepository: LeaveRequestRepository,
    private readonly holidayRepository: HolidayRepository,
    private readonly weeklyOffConfigRepository: WeeklyOffConfigRepository,
  ) {}

  async getPeriodAttendanceSummary(
    periodId: Types.ObjectId,
    query: PayrollAttendanceSummaryQueryDto = {},
  ): Promise<PayrollPeriodAttendanceSummaryResponseDto> {
    const now = new Date();
    const period = await this.payrollPeriodRepository.findById(periodId);

    if (!period || period.deletedAt !== null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Payroll period with ID '${periodId.toHexString()}' not found.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const periodStartStr = period.startDate.toISOString().slice(0, 10);
    const periodEndStr = period.endDate.toISOString().slice(0, 10);
    const periodDates = LeaveCalculationUtil.enumerateDateStrings(
      periodStartStr,
      periodEndStr,
    );

    if (periodDates.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Payroll period '${period.periodCode}' has an invalid date range (${periodStartStr} to ${periodEndStr}).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const periodInfo: PayrollAttendancePeriodInfoDto = {
      id: period._id.toHexString(),
      periodCode: period.periodCode,
      periodName: period.periodName,
      status: period.status,
      payrollFrequency: period.payrollFrequency,
      startDate: periodStartStr,
      endDate: periodEndStr,
      month: period.month,
      year: period.year,
      calendarDays: periodDates.length,
    };

    // Pad MongoDB date filters by +/-1 day so branch timezone boundary evaluations are never missed.
    const paddedMinExitDate = new Date(
      Date.parse(`${periodStartStr}T00:00:00.000Z`) - MS_PER_DAY,
    );
    const paddedMaxJoiningDate = new Date(
      Date.parse(`${periodEndStr}T23:59:59.999Z`) + MS_PER_DAY,
    );

    const candidateEmployees =
      await this.employeeRepository.findForPayrollAttendanceSummary({
        branchId: query.branchId
          ? new Types.ObjectId(query.branchId)
          : undefined,
        departmentId: query.departmentId
          ? new Types.ObjectId(query.departmentId)
          : undefined,
        employeeId: query.employeeId
          ? new Types.ObjectId(query.employeeId)
          : undefined,
        minExitDate: paddedMinExitDate,
        maxJoiningDate: paddedMaxJoiningDate,
      });

    if (candidateEmployees.length === 0) {
      return this.buildEmptyResponse(periodInfo, periodEndStr, now);
    }

    const uniqueBranchIds = this.extractUniqueBranchIds(candidateEmployees);

    const [branches, activeHolidays, activeWeeklyOffConfigs] =
      await Promise.all([
        this.branchRepository.findByIds(uniqueBranchIds),
        this.holidayRepository.findActiveInRange(periodStartStr, periodEndStr),
        this.weeklyOffConfigRepository.findActiveEffectiveInRange(
          periodStartStr,
          periodEndStr,
        ),
      ]);

    const branchTimezoneMap = new Map<string, string>();
    for (const branch of branches) {
      branchTimezoneMap.set(
        branch._id.toHexString(),
        branch.timezone?.trim() || ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
      );
    }

    const eligibleEmployees = this.resolveEligibleEmployees(
      candidateEmployees,
      branchTimezoneMap,
      periodStartStr,
      periodEndStr,
    );

    if (eligibleEmployees.length === 0) {
      return this.buildEmptyResponse(periodInfo, periodEndStr, now);
    }

    const eligibleEmployeeIds = eligibleEmployees.map((e) => e.employee._id);

    const [attendanceBuckets, leaveRequests] = await Promise.all([
      this.attendanceRepository.aggregateForPayrollPeriod(
        eligibleEmployeeIds,
        periodStartStr,
        periodEndStr,
      ),
      this.leaveRequestRepository.findOverlappingForEmployees(
        eligibleEmployeeIds,
        periodStartStr,
        periodEndStr,
        INCLUDED_LEAVE_STATUSES,
      ),
    ]);

    const regIdsToVerify = this.extractRegularizationIds(attendanceBuckets);
    const regularizationMap = await this.loadRegularizationMap(regIdsToVerify);

    const attendanceByEmployee =
      this.groupAttendanceByEmployee(attendanceBuckets);
    const leavesByEmployee = this.groupLeavesByEmployee(leaveRequests);

    const calendarLookup = this.buildCalendarLookup(
      activeHolidays,
      activeWeeklyOffConfigs,
    );
    const branchDayCache = new Map<
      string,
      { isWeeklyOff: boolean; isHoliday: boolean }
    >();

    const allSummaries: EmployeePayrollAttendanceSummaryDto[] = [];
    let periodEndedAcrossBranches = true;

    for (const tenure of eligibleEmployees) {
      const branchTodayStr = AttendanceCalculationUtil.getAttendanceDateString(
        now,
        tenure.branchTimezone,
      );
      if (branchTodayStr <= periodEndStr) {
        periodEndedAcrossBranches = false;
      }

      const empIdStr = tenure.employee._id.toHexString();
      const empAttendance = attendanceByEmployee.get(empIdStr) ?? [];
      const empLeaves = leavesByEmployee.get(empIdStr) ?? [];

      const summary = this.buildEmployeeSummary(
        tenure,
        periodStartStr,
        periodEndStr,
        periodDates,
        branchTodayStr,
        empAttendance,
        empLeaves,
        regularizationMap,
        calendarLookup,
        branchDayCache,
      );
      allSummaries.push(summary);
    }

    return this.assemblePeriodResponse(
      periodInfo,
      periodEndedAcrossBranches,
      allSummaries,
      Boolean(query.anomaliesOnly),
    );
  }

  private buildEmptyResponse(
    periodInfo: PayrollAttendancePeriodInfoDto,
    periodEndStr: string,
    now: Date,
  ): PayrollPeriodAttendanceSummaryResponseDto {
    const defaultTodayStr = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );
    const periodEnded = defaultTodayStr > periodEndStr;

    return {
      period: periodInfo,
      finalization: {
        attendanceFinalized: periodEnded,
        finalizationBasis: 'DERIVED_FROM_PERIOD_ATTENDANCE_COMPLETENESS',
        periodEnded,
        hasUnresolvedGaps: false,
        unresolvedEmployeeCount: 0,
        totalMissingDays: 0,
        totalIncompleteDays: 0,
        totalDuplicateAttendanceDays: 0,
        totalUnapprovedRegularizedDays: 0,
      },
      summary: {
        totalEligibleEmployees: 0,
        returnedEmployeesCount: 0,
        employeesWithAnomalies: 0,
        totals: {
          totalTenureCalendarDays: 0,
          totalScheduledWorkingDays: 0,
          totalPresentDays: 0,
          totalHalfDays: 0,
          totalAbsentDays: 0,
          totalIncompleteDays: 0,
          totalMissingDays: 0,
          totalPaidLeaveDays: 0,
          totalUnpaidLeaveDays: 0,
          totalPendingCancellationLeaveDays: 0,
          totalHolidayDays: 0,
          totalWeeklyOffDays: 0,
        },
      },
      employees: [],
    };
  }

  private extractUniqueBranchIds(
    employees: PayrollAttendanceEmployeeProjection[],
  ): Types.ObjectId[] {
    const seen = new Map<string, Types.ObjectId>();
    for (const emp of employees) {
      if (emp.branchId) {
        const key = emp.branchId.toHexString();
        if (!seen.has(key)) {
          seen.set(key, emp.branchId);
        }
      }
    }
    return Array.from(seen.values());
  }

  private resolveEligibleEmployees(
    candidates: PayrollAttendanceEmployeeProjection[],
    branchTimezoneMap: Map<string, string>,
    periodStartStr: string,
    periodEndStr: string,
  ): EligibleEmployeeTenure[] {
    const eligible: EligibleEmployeeTenure[] = [];

    for (const employee of candidates) {
      const branchIdStr = employee.branchId
        ? employee.branchId.toHexString()
        : '';
      const branchTimezone =
        branchTimezoneMap.get(branchIdStr) ??
        ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE;

      const decision = evaluateEmployeePayrollPeriodEligibility(
        {
          deletedAt: null,
          employmentStatus: employee.employmentStatus,
          dateOfJoining: employee.dateOfJoining,
          lastWorkingDate: employee.lastWorkingDate ?? null,
          terminationDate: employee.terminationDate ?? null,
        },
        periodStartStr,
        periodEndStr,
        branchTimezone,
      );

      if (!decision.eligible) {
        continue;
      }

      eligible.push({
        employee,
        branchIdStr,
        branchTimezone,
        dateOfJoiningStr: decision.dateOfJoiningStr,
        effectiveExitDateStr: decision.effectiveExitDateStr,
        effectiveStartDate: decision.effectiveStartStr,
        effectiveEndDate: decision.effectiveEndStr,
      });
    }

    return eligible;
  }

  private extractRegularizationIds(
    buckets: AggregatedAttendanceDay[],
  ): Types.ObjectId[] {
    const seen = new Map<string, Types.ObjectId>();
    for (const bucket of buckets) {
      if (bucket.regularizationId) {
        const key = bucket.regularizationId.toHexString();
        if (!seen.has(key)) {
          seen.set(key, bucket.regularizationId);
        }
      }
    }
    return Array.from(seen.values());
  }

  private async loadRegularizationMap(
    regIds: Types.ObjectId[],
  ): Promise<Map<string, VerifiedRegularizationInfo>> {
    const docs =
      await this.attendanceRegularizationRepository.findByIds(regIds);
    const map = new Map<string, VerifiedRegularizationInfo>();
    for (const doc of docs) {
      map.set(doc._id.toHexString(), {
        employeeId: doc.employeeId,
        attendanceDate: doc.attendanceDate,
        status: doc.status,
      });
    }
    return map;
  }

  private groupAttendanceByEmployee(
    buckets: AggregatedAttendanceDay[],
  ): Map<string, AggregatedAttendanceDay[]> {
    const map = new Map<string, AggregatedAttendanceDay[]>();
    for (const bucket of buckets) {
      const key = bucket.employeeId.toHexString();
      const list = map.get(key);
      if (list) {
        list.push(bucket);
      } else {
        map.set(key, [bucket]);
      }
    }
    return map;
  }

  private groupLeavesByEmployee(
    leaves: LeaveRequestLean[],
  ): Map<string, LeaveRequestLean[]> {
    const map = new Map<string, LeaveRequestLean[]>();
    for (const leave of leaves) {
      const key = leave.employeeId.toHexString();
      const list = map.get(key);
      if (list) {
        list.push(leave);
      } else {
        map.set(key, [leave]);
      }
    }
    return map;
  }

  private buildCalendarLookup(
    holidays: Array<{ date: string; branchId: Types.ObjectId | null }>,
    weeklyOffConfigs: WeeklyOffConfigLean[],
  ): BranchCalendarLookup {
    const globalHolidays = new Set<string>();
    const holidaysByBranch = new Map<string, Set<string>>();

    for (const holiday of holidays) {
      if (!holiday.branchId) {
        globalHolidays.add(holiday.date);
      } else {
        const bKey = holiday.branchId.toHexString();
        let set = holidaysByBranch.get(bKey);
        if (!set) {
          set = new Set<string>();
          holidaysByBranch.set(bKey, set);
        }
        set.add(holiday.date);
      }
    }

    const companyWeeklyOffConfigs: WeeklyOffConfigLean[] = [];
    const weeklyOffConfigsByBranch = new Map<string, WeeklyOffConfigLean[]>();

    for (const cfg of weeklyOffConfigs) {
      if (!cfg.branchId) {
        companyWeeklyOffConfigs.push(cfg);
      } else {
        const bKey = cfg.branchId.toHexString();
        const list = weeklyOffConfigsByBranch.get(bKey);
        if (list) {
          list.push(cfg);
        } else {
          weeklyOffConfigsByBranch.set(bKey, [cfg]);
        }
      }
    }

    return {
      weeklyOffConfigsByBranch,
      companyWeeklyOffConfigs,
      holidaysByBranch,
      globalHolidays,
    };
  }

  private resolveBranchDayStatus(
    branchIdStr: string,
    dateStr: string,
    lookup: BranchCalendarLookup,
    cache: Map<string, { isWeeklyOff: boolean; isHoliday: boolean }>,
  ): { isWeeklyOff: boolean; isHoliday: boolean } {
    const cacheKey = `${branchIdStr}:${dateStr}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const isHoliday =
      lookup.globalHolidays.has(dateStr) ||
      Boolean(lookup.holidaysByBranch.get(branchIdStr)?.has(dateStr));

    const branchCfgs = lookup.weeklyOffConfigsByBranch.get(branchIdStr) ?? [];
    const matchedBranchCfg = branchCfgs.find(
      (cfg) =>
        cfg.effectiveFrom <= dateStr &&
        (cfg.effectiveTo === null || cfg.effectiveTo >= dateStr),
    );

    let isWeeklyOff: boolean;
    if (matchedBranchCfg) {
      isWeeklyOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
        dateStr,
        matchedBranchCfg.days,
      );
    } else {
      const matchedCompanyCfg = lookup.companyWeeklyOffConfigs.find(
        (cfg) =>
          cfg.effectiveFrom <= dateStr &&
          (cfg.effectiveTo === null || cfg.effectiveTo >= dateStr),
      );
      if (matchedCompanyCfg) {
        isWeeklyOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
          dateStr,
          matchedCompanyCfg.days,
        );
      } else {
        isWeeklyOff = WeeklyOffCalculationUtil.isDateWeeklyOff(
          dateStr,
          WEEKLY_OFF_CONSTANTS.DEFAULT_WEEKLY_OFF_DAYS,
        );
      }
    }

    const result = { isWeeklyOff, isHoliday };
    cache.set(cacheKey, result);
    return result;
  }

  private buildEmployeeSummary(
    tenure: EligibleEmployeeTenure,
    periodStartStr: string,
    periodEndStr: string,
    periodDates: string[],
    branchTodayStr: string,
    attendanceBuckets: AggregatedAttendanceDay[],
    leaves: LeaveRequestLean[],
    regularizationMap: Map<string, VerifiedRegularizationInfo>,
    calendarLookup: BranchCalendarLookup,
    branchDayCache: Map<string, { isWeeklyOff: boolean; isHoliday: boolean }>,
  ): EmployeePayrollAttendanceSummaryDto {
    const {
      employee,
      branchIdStr,
      branchTimezone,
      dateOfJoiningStr,
      effectiveExitDateStr,
      effectiveStartDate,
      effectiveEndDate,
    } = tenure;

    const tenureDates = periodDates.filter(
      (d) => d >= effectiveStartDate && d <= effectiveEndDate,
    );

    let weeklyOffDays = 0;
    let holidayDays = 0;
    let evaluatableCalendarDays = 0;
    const scheduledWorkingDates: string[] = [];
    const evaluatableWorkingDates: string[] = [];

    for (const dateStr of tenureDates) {
      if (dateStr <= branchTodayStr) {
        evaluatableCalendarDays++;
      }
      const { isWeeklyOff, isHoliday } = this.resolveBranchDayStatus(
        branchIdStr,
        dateStr,
        calendarLookup,
        branchDayCache,
      );

      if (isWeeklyOff) {
        weeklyOffDays++;
      } else if (isHoliday) {
        holidayDays++;
      } else {
        scheduledWorkingDates.push(dateStr);
        if (dateStr <= branchTodayStr) {
          evaluatableWorkingDates.push(dateStr);
        }
      }
    }

    const statusBreakdown: PayrollAttendanceStatusBreakdownDto = {
      present: 0,
      late: 0,
      regularized: 0,
      halfDay: 0,
      absent: 0,
      onLeave: 0,
      incomplete: 0,
      checkedIn: 0,
      onBreak: 0,
      weekOffRecordCount: 0,
      holidayRecordCount: 0,
    };

    let presentDays = 0;
    let halfDays = 0;
    let absentDays = 0;
    let incompleteDays = 0;
    let totalWorkMinutes = 0;
    let totalBreakMinutes = 0;
    let totalOvertimeMinutes = 0;
    let totalLateMinutes = 0;
    let totalEarlyDepartureMinutes = 0;
    let lateInstanceCount = 0;
    let earlyDepartureCount = 0;

    const duplicateAttendanceDates = new Set<string>();
    const unapprovedRegularizedDates = new Set<string>();
    const openSessionDates = new Set<string>();
    const incompleteDates = new Set<string>();
    const missingDates = new Set<string>();
    const leaveAttendanceMismatchDates = new Set<string>();
    const outsideTenureAttendanceDates = new Set<string>();

    const validAttendanceByDate = new Map<string, AggregatedAttendanceDay>();

    for (const bucket of attendanceBuckets) {
      if (
        bucket.attendanceDate < effectiveStartDate ||
        bucket.attendanceDate > effectiveEndDate
      ) {
        outsideTenureAttendanceDates.add(bucket.attendanceDate);
        continue;
      }

      if (bucket.recordCount > 1) {
        duplicateAttendanceDates.add(bucket.attendanceDate);
      }

      validAttendanceByDate.set(bucket.attendanceDate, bucket);

      const hasVerifiedApprovedRegularization =
        bucket.regularizationId !== null &&
        this.isVerifiedApprovedRegularization(
          regularizationMap.get(bucket.regularizationId.toHexString()),
          employee._id,
          bucket.attendanceDate,
        );

      if (
        bucket.status === AttendanceStatus.REGULARIZED &&
        !hasVerifiedApprovedRegularization
      ) {
        unapprovedRegularizedDates.add(bucket.attendanceDate);
        continue;
      }

      if (
        bucket.regularizationId !== null &&
        !hasVerifiedApprovedRegularization
      ) {
        unapprovedRegularizedDates.add(bucket.attendanceDate);
        continue;
      }

      switch (bucket.status) {
        case AttendanceStatus.PRESENT:
          presentDays++;
          statusBreakdown.present++;
          break;
        case AttendanceStatus.LATE:
          presentDays++;
          statusBreakdown.late++;
          break;
        case AttendanceStatus.REGULARIZED:
          presentDays++;
          statusBreakdown.regularized++;
          break;
        case AttendanceStatus.HALF_DAY:
          halfDays++;
          statusBreakdown.halfDay++;
          break;
        case AttendanceStatus.ABSENT:
          absentDays++;
          statusBreakdown.absent++;
          break;
        case AttendanceStatus.ON_LEAVE:
          statusBreakdown.onLeave++;
          break;
        case AttendanceStatus.INCOMPLETE:
          incompleteDays++;
          statusBreakdown.incomplete++;
          incompleteDates.add(bucket.attendanceDate);
          break;
        case AttendanceStatus.CHECKED_IN:
          incompleteDays++;
          statusBreakdown.checkedIn++;
          openSessionDates.add(bucket.attendanceDate);
          break;
        case AttendanceStatus.ON_BREAK:
          incompleteDays++;
          statusBreakdown.onBreak++;
          openSessionDates.add(bucket.attendanceDate);
          break;
        case AttendanceStatus.WEEK_OFF:
          statusBreakdown.weekOffRecordCount++;
          break;
        case AttendanceStatus.HOLIDAY:
          statusBreakdown.holidayRecordCount++;
          break;
      }

      totalWorkMinutes += bucket.totalWorkMinutes;
      totalBreakMinutes += bucket.totalBreakMinutes;
      totalOvertimeMinutes += bucket.overtimeMinutes;
      totalLateMinutes += bucket.lateMinutes;
      totalEarlyDepartureMinutes += bucket.earlyDepartureMinutes;

      if (bucket.isLate || bucket.status === AttendanceStatus.LATE) {
        lateInstanceCount++;
      }
      if (bucket.isEarlyDeparture) {
        earlyDepartureCount++;
      }
    }

    // Resolve approved & cancellation-requested leaves clipped strictly to tenure within period
    const fullDayLeaveDates = new Set<string>();
    const halfDayLeaveDates = new Set<string>();
    const leaveWeightByDate = new Map<string, number>();
    const leaveTypeMap = new Map<string, PayrollLeaveTypeBreakdownItemDto>();

    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let halfDayLeaveCount = 0;
    let pendingCancellationLeaveDays = 0;

    for (const leave of leaves) {
      const clipStart =
        leave.startDate > effectiveStartDate
          ? leave.startDate
          : effectiveStartDate;
      const clipEnd =
        leave.endDate < effectiveEndDate ? leave.endDate : effectiveEndDate;

      if (clipStart > clipEnd) {
        continue;
      }

      const candidateDates = LeaveCalculationUtil.enumerateDateStrings(
        clipStart,
        clipEnd,
      );
      const hasExplicitExcludedDates =
        Array.isArray(leave.excludedDates) && leave.excludedDates.length > 0;
      const excludedSet = hasExplicitExcludedDates
        ? new Set(leave.excludedDates)
        : null;

      let applicableLeaveDaysForRequest = 0;

      for (const dStr of candidateDates) {
        if (excludedSet) {
          if (excludedSet.has(dStr)) {
            continue;
          }
        } else {
          const { isWeeklyOff, isHoliday } = this.resolveBranchDayStatus(
            branchIdStr,
            dStr,
            calendarLookup,
            branchDayCache,
          );
          if (
            (isWeeklyOff && !leave.leaveTypeSnapshot.deductWeekends) ||
            (isHoliday && !leave.leaveTypeSnapshot.deductHolidays)
          ) {
            continue;
          }
        }

        const weight = leave.isHalfDay ? 0.5 : 1;
        applicableLeaveDaysForRequest += weight;

        const prevWeight = leaveWeightByDate.get(dStr) ?? 0;
        const nextWeight = prevWeight + weight;
        leaveWeightByDate.set(dStr, nextWeight);
        if (nextWeight > 1) {
          leaveAttendanceMismatchDates.add(dStr);
        }

        if (leave.isHalfDay) {
          halfDayLeaveDates.add(dStr);
          halfDayLeaveCount++;
        } else {
          fullDayLeaveDates.add(dStr);
        }
      }

      if (applicableLeaveDaysForRequest <= 0) {
        continue;
      }

      if (leave.leaveTypeSnapshot.isPaid) {
        paidLeaveDays += applicableLeaveDaysForRequest;
      } else {
        unpaidLeaveDays += applicableLeaveDaysForRequest;
      }

      if (leave.status === LeaveRequestStatus.CANCELLATION_REQUESTED) {
        pendingCancellationLeaveDays += applicableLeaveDaysForRequest;
      }

      const ltId = leave.leaveTypeId.toHexString();
      const existingType = leaveTypeMap.get(ltId);
      if (existingType) {
        existingType.days += applicableLeaveDaysForRequest;
      } else {
        leaveTypeMap.set(ltId, {
          leaveTypeId: ltId,
          leaveTypeCode: leave.leaveTypeSnapshot.code,
          leaveTypeName: leave.leaveTypeSnapshot.name,
          isPaid: leave.leaveTypeSnapshot.isPaid,
          days: applicableLeaveDaysForRequest,
        });
      }
    }

    // Identify missing evaluatable working days (not recorded in attendances & not covered by full-day approved leave)
    for (const dStr of evaluatableWorkingDates) {
      const att = validAttendanceByDate.get(dStr);
      const hasFullDayLeave = fullDayLeaveDates.has(dStr);
      const hasHalfDayLeave = halfDayLeaveDates.has(dStr);

      if (!att && !hasFullDayLeave) {
        missingDates.add(dStr);
        if (hasHalfDayLeave) {
          leaveAttendanceMismatchDates.add(dStr);
        }
      }
    }

    // Reconcile leave vs attendance consistency across tenure dates
    for (const dStr of tenureDates) {
      const att = validAttendanceByDate.get(dStr);
      const hasFullDayLeave = fullDayLeaveDates.has(dStr);
      const hasAnyApprovedLeave =
        hasFullDayLeave || halfDayLeaveDates.has(dStr);

      if (hasFullDayLeave && !att && dStr <= branchTodayStr) {
        leaveAttendanceMismatchDates.add(dStr);
      } else if (
        hasFullDayLeave &&
        att &&
        att.status !== AttendanceStatus.ON_LEAVE
      ) {
        leaveAttendanceMismatchDates.add(dStr);
      } else if (
        att?.status === AttendanceStatus.ON_LEAVE &&
        !hasAnyApprovedLeave
      ) {
        leaveAttendanceMismatchDates.add(dStr);
      }
    }

    const sortedDuplicateDates = Array.from(duplicateAttendanceDates).sort();
    const sortedUnapprovedRegDates = Array.from(
      unapprovedRegularizedDates,
    ).sort();
    const sortedOpenSessionDates = Array.from(openSessionDates).sort();
    const sortedIncompleteDates = Array.from(incompleteDates).sort();
    const sortedMissingDates = Array.from(missingDates).sort();
    const sortedLeaveMismatchDates = Array.from(
      leaveAttendanceMismatchDates,
    ).sort();
    const sortedOutsideTenureDates = Array.from(
      outsideTenureAttendanceDates,
    ).sort();

    const warnings: PayrollAttendanceWarningCode[] = [];
    if (sortedMissingDates.length > 0) {
      warnings.push('UNFINALIZED_MISSING_DAYS');
    }
    if (sortedOpenSessionDates.length > 0) {
      warnings.push('OPEN_ATTENDANCE_SESSION');
    }
    if (sortedIncompleteDates.length > 0) {
      warnings.push('INCOMPLETE_ATTENDANCE_RECORD');
    }
    if (sortedDuplicateDates.length > 0) {
      warnings.push('DUPLICATE_ATTENDANCE_RECORD');
    }
    if (sortedUnapprovedRegDates.length > 0) {
      warnings.push('UNAPPROVED_REGULARIZED_ATTENDANCE');
    }
    if (sortedLeaveMismatchDates.length > 0) {
      warnings.push('LEAVE_ATTENDANCE_MISMATCH');
    }
    if (sortedOutsideTenureDates.length > 0) {
      warnings.push('OUTSIDE_TENURE_ATTENDANCE');
    }
    if (pendingCancellationLeaveDays > 0) {
      warnings.push('PENDING_LEAVE_CANCELLATION_RECONCILIATION');
    }

    const hasAnomalies = warnings.length > 0;

    return {
      employeeId: employee._id.toHexString(),
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      employmentStatus: employee.employmentStatus,
      branchId: branchIdStr,
      branchTimezone,
      departmentId: employee.departmentId.toHexString(),
      designationId: employee.designationId.toHexString(),
      dateOfJoining: dateOfJoiningStr,
      effectiveExitDate: effectiveExitDateStr,
      effectiveStartDate,
      effectiveEndDate,
      isMidPeriodJoiner: dateOfJoiningStr > periodStartStr,
      isMidPeriodLeaver:
        effectiveExitDateStr !== null && effectiveExitDateStr < periodEndStr,
      tenureCalendarDays: tenureDates.length,
      evaluatableCalendarDays,
      weeklyOffDays,
      holidayDays,
      scheduledWorkingDays: scheduledWorkingDates.length,
      evaluatableWorkingDays: evaluatableWorkingDates.length,
      futureScheduledWorkingDays:
        scheduledWorkingDates.length - evaluatableWorkingDates.length,
      presentDays,
      halfDays,
      absentDays,
      incompleteDays,
      missingDays: sortedMissingDates.length,
      statusBreakdown,
      totalWorkMinutes,
      totalBreakMinutes,
      totalOvertimeMinutes,
      totalLateMinutes,
      totalEarlyDepartureMinutes,
      lateInstanceCount,
      earlyDepartureCount,
      leaveSummary: {
        paidLeaveDays,
        unpaidLeaveDays,
        totalLeaveDays: paidLeaveDays + unpaidLeaveDays,
        halfDayLeaveCount,
        pendingCancellationLeaveDays,
        leaveTypeBreakdown: Array.from(leaveTypeMap.values()).sort((a, b) =>
          a.leaveTypeCode.localeCompare(b.leaveTypeCode),
        ),
      },
      anomalies: {
        hasAnomalies,
        duplicateAttendanceDates: sortedDuplicateDates,
        unapprovedRegularizedDates: sortedUnapprovedRegDates,
        openSessionDates: sortedOpenSessionDates,
        incompleteDates: sortedIncompleteDates,
        missingDates: sortedMissingDates,
        leaveAttendanceMismatchDates: sortedLeaveMismatchDates,
        outsideTenureAttendanceDates: sortedOutsideTenureDates,
        warnings,
      },
    };
  }

  private isVerifiedApprovedRegularization(
    reg: VerifiedRegularizationInfo | undefined,
    employeeId: Types.ObjectId,
    attendanceDate: string,
  ): boolean {
    if (!reg) return false;
    return (
      reg.status === RegularizationStatus.APPROVED &&
      reg.employeeId.equals(employeeId) &&
      reg.attendanceDate === attendanceDate
    );
  }

  private assemblePeriodResponse(
    periodInfo: PayrollAttendancePeriodInfoDto,
    periodEnded: boolean,
    allSummaries: EmployeePayrollAttendanceSummaryDto[],
    anomaliesOnly: boolean,
  ): PayrollPeriodAttendanceSummaryResponseDto {
    let totalTenureCalendarDays = 0;
    let totalScheduledWorkingDays = 0;
    let totalPresentDays = 0;
    let totalHalfDays = 0;
    let totalAbsentDays = 0;
    let totalIncompleteDays = 0;
    let totalMissingDays = 0;
    let totalPaidLeaveDays = 0;
    let totalUnpaidLeaveDays = 0;
    let totalPendingCancellationLeaveDays = 0;
    let totalHolidayDays = 0;
    let totalWeeklyOffDays = 0;

    let employeesWithAnomalies = 0;
    let unresolvedEmployeeCount = 0;
    let totalDuplicateAttendanceDays = 0;
    let totalUnapprovedRegularizedDays = 0;

    for (const emp of allSummaries) {
      totalTenureCalendarDays += emp.tenureCalendarDays;
      totalScheduledWorkingDays += emp.scheduledWorkingDays;
      totalPresentDays += emp.presentDays;
      totalHalfDays += emp.halfDays;
      totalAbsentDays += emp.absentDays;
      totalIncompleteDays += emp.incompleteDays;
      totalMissingDays += emp.missingDays;
      totalPaidLeaveDays += emp.leaveSummary.paidLeaveDays;
      totalUnpaidLeaveDays += emp.leaveSummary.unpaidLeaveDays;
      totalPendingCancellationLeaveDays +=
        emp.leaveSummary.pendingCancellationLeaveDays;
      totalHolidayDays += emp.holidayDays;
      totalWeeklyOffDays += emp.weeklyOffDays;

      if (emp.anomalies.hasAnomalies) {
        employeesWithAnomalies++;
      }

      const empDupCount = emp.anomalies.duplicateAttendanceDates.length;
      const empUnapprovedRegCount =
        emp.anomalies.unapprovedRegularizedDates.length;
      totalDuplicateAttendanceDays += empDupCount;
      totalUnapprovedRegularizedDays += empUnapprovedRegCount;

      if (
        emp.missingDays > 0 ||
        emp.incompleteDays > 0 ||
        empDupCount > 0 ||
        empUnapprovedRegCount > 0
      ) {
        unresolvedEmployeeCount++;
      }
    }

    const hasUnresolvedGaps =
      totalMissingDays > 0 ||
      totalIncompleteDays > 0 ||
      totalDuplicateAttendanceDays > 0 ||
      totalUnapprovedRegularizedDays > 0;

    const finalization: PayrollAttendanceFinalizationStateDto = {
      attendanceFinalized: periodEnded && !hasUnresolvedGaps,
      finalizationBasis: 'DERIVED_FROM_PERIOD_ATTENDANCE_COMPLETENESS',
      periodEnded,
      hasUnresolvedGaps,
      unresolvedEmployeeCount,
      totalMissingDays,
      totalIncompleteDays,
      totalDuplicateAttendanceDays,
      totalUnapprovedRegularizedDays,
    };

    const returnedEmployees = anomaliesOnly
      ? allSummaries.filter((emp) => emp.anomalies.hasAnomalies)
      : allSummaries;

    return {
      period: periodInfo,
      finalization,
      summary: {
        totalEligibleEmployees: allSummaries.length,
        returnedEmployeesCount: returnedEmployees.length,
        employeesWithAnomalies,
        totals: {
          totalTenureCalendarDays,
          totalScheduledWorkingDays,
          totalPresentDays,
          totalHalfDays,
          totalAbsentDays,
          totalIncompleteDays,
          totalMissingDays,
          totalPaidLeaveDays,
          totalUnpaidLeaveDays,
          totalPendingCancellationLeaveDays,
          totalHolidayDays,
          totalWeeklyOffDays,
        },
      },
      employees: returnedEmployees,
    };
  }
}
