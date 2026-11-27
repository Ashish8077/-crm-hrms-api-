import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  ATTENDANCE_CONSTANTS,
  AttendanceStatus,
} from '../../attendance/constants/attendance.constant';
import { AttendanceRegularizationRepository } from '../../attendance/repositories/attendance-regularization.repository';
import {
  AttendanceRepository,
  PayrollAttendanceBucket,
} from '../../attendance/repositories/attendance.repository';
import { AttendanceCalculationUtil } from '../../attendance/utils/attendance-calculation.util';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { EmployeeLean } from '../../employees/repositories/employee.repository';
import { PayrollPeriodEligibilityResult } from '../../employees/utils/payroll-eligibility.util';
import { LeaveRequestStatus } from '../../leaves/constants/leaves.constant';
import { HolidayRepository } from '../../leaves/repositories/holiday.repository';
import {
  LeaveRequestLean,
  LeaveRequestRepository,
} from '../../leaves/repositories/leave-request.repository';
import { LeaveCalculationUtil } from '../../leaves/utils/leave-calculation.util';
import { WeeklyOffConfigRepository } from '../../work-schedules/repositories/weekly-off-config.repository';
import { PayrollLeaveTypeBreakdownItemDto } from '../dto/payroll-attendance-summary-response.dto';
import {
  BranchCalendarLookup,
  PAYROLL_INCLUDED_LEAVE_STATUSES,
  VerifiedRegularizationRecord,
  buildBranchCalendarLookup,
  isVerifiedApprovedRegularization,
  resolveBranchDayStatus,
  roundPayrollDays,
} from '../utils/payroll-calendar.util';

export interface PayrollEmployeeReconciliationTarget {
  employee: Pick<EmployeeLean, '_id' | 'branchId' | 'employeeCode'>;
  tenure: Extract<PayrollPeriodEligibilityResult, { eligible: true }>;
}

export type PayrollLeaveAttendanceWarningCode =
  | 'UNFINALIZED_MISSING_DAYS'
  | 'OPEN_ATTENDANCE_SESSION'
  | 'INCOMPLETE_ATTENDANCE_RECORD'
  | 'DUPLICATE_ATTENDANCE_RECORD'
  | 'UNAPPROVED_REGULARIZED_ATTENDANCE'
  | 'LEAVE_ATTENDANCE_MISMATCH'
  | 'OUTSIDE_TENURE_ATTENDANCE'
  | 'PENDING_LEAVE_CANCELLATION_RECONCILIATION'
  | 'OVERLAPPING_LEAVE_REQUESTS'
  | 'CONFLICTING_LEAVE_CLASSIFICATION';

export interface PayrollLeaveAttendanceResolution {
  employeeId: string;
  branchId: string;
  branchTimezone: string;
  tenureCalendarDays: number;
  eligibleWorkingDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  unpaidLeaveLopDays: number;
  attendanceAbsenceDays: number;
  attendanceAbsenceLopDays: number;
  halfDayDeductions: number;
  totalLopDays: number;
  incompleteDays: number;
  pendingCancellationLeaveDays: number;
  leaveTypeBreakdown: PayrollLeaveTypeBreakdownItemDto[];
  warnings: PayrollLeaveAttendanceWarningCode[];
  missingDates: string[];
  openSessionDates: string[];
  incompleteDates: string[];
  duplicateAttendanceDates: string[];
  unapprovedRegularizedDates: string[];
  leaveAttendanceMismatchDates: string[];
  overlappingLeaveDates: string[];
  conflictingLeaveDates: string[];
  outsideTenureAttendanceDates: string[];
}

interface DailyLeaveCoverage {
  paidWeight: number;
  unpaidWeight: number;
  hasFullDayLeave: boolean;
  hasHalfDayLeave: boolean;
}

/**
 * Shared read-only batch resolver reconciling branch schedules, holidays, weekly offs,
 * approved/cancellation-requested leaves, and verified attendance for payroll calculations.
 * Reconciles at individual date granularity so overlapping leave + ABSENT records never double-deduct.
 */
@Injectable()
export class PayrollLeaveAttendanceResolverService {
  constructor(
    private readonly branchRepository: BranchRepository,
    private readonly attendanceRepository: AttendanceRepository,
    private readonly attendanceRegularizationRepository: AttendanceRegularizationRepository,
    private readonly leaveRequestRepository: LeaveRequestRepository,
    private readonly holidayRepository: HolidayRepository,
    private readonly weeklyOffConfigRepository: WeeklyOffConfigRepository,
  ) {}

  async resolveForEmployee(params: {
    periodStartStr: string;
    periodEndStr: string;
    target: PayrollEmployeeReconciliationTarget;
    now?: Date;
  }): Promise<PayrollLeaveAttendanceResolution> {
    const map = await this.resolveBatch({
      periodStartStr: params.periodStartStr,
      periodEndStr: params.periodEndStr,
      targets: [params.target],
      now: params.now,
    });

    const resolved = map.get(params.target.employee._id.toHexString());
    if (!resolved) {
      throw new Error(
        `Failed to resolve leave & attendance summary for employee '${params.target.employee._id.toHexString()}'.`,
      );
    }
    return resolved;
  }

  /**
   * Batch resolves leave & attendance LOP metrics for 1 to 1,000+ eligible employees
   * using a constant number of bulk MongoDB queries (zero N+1 queries, zero writes).
   */
  async resolveBatch(params: {
    periodStartStr: string;
    periodEndStr: string;
    targets: PayrollEmployeeReconciliationTarget[];
    now?: Date;
  }): Promise<Map<string, PayrollLeaveAttendanceResolution>> {
    const resultMap = new Map<string, PayrollLeaveAttendanceResolution>();
    if (params.targets.length === 0) {
      return resultMap;
    }

    const now = params.now ?? new Date();
    const { periodStartStr, periodEndStr, targets } = params;
    const periodDates = LeaveCalculationUtil.enumerateDateStrings(
      periodStartStr,
      periodEndStr,
    );

    const employeeIds = targets.map((t) => t.employee._id);
    const branchIdMap = new Map<string, Types.ObjectId>();
    for (const target of targets) {
      if (target.employee.branchId) {
        branchIdMap.set(
          target.employee.branchId.toHexString(),
          target.employee.branchId,
        );
      }
    }
    const uniqueBranchIds = Array.from(branchIdMap.values());

    // Execute all independent collection lookups concurrently (5 bulk queries total)
    const [
      branches,
      activeHolidays,
      activeWeeklyOffConfigs,
      attendanceBuckets,
      leaveRequests,
    ] = await Promise.all([
      this.branchRepository.findByIds(uniqueBranchIds),
      this.holidayRepository.findActiveInRange(periodStartStr, periodEndStr),
      this.weeklyOffConfigRepository.findActiveEffectiveInRange(
        periodStartStr,
        periodEndStr,
      ),
      this.attendanceRepository.aggregateForPayrollPeriod(
        employeeIds,
        periodStartStr,
        periodEndStr,
      ),
      this.leaveRequestRepository.findOverlappingForEmployees(
        employeeIds,
        periodStartStr,
        periodEndStr,
        PAYROLL_INCLUDED_LEAVE_STATUSES,
      ),
    ]);

    const regIds = this.extractRegularizationIds(attendanceBuckets);
    const regularizationMap = await this.loadRegularizationMap(regIds);

    const branchTimezoneMap = new Map<string, string>();
    for (const branch of branches) {
      branchTimezoneMap.set(
        branch._id.toHexString(),
        branch.timezone?.trim() || ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
      );
    }

    const attendanceByEmployee =
      this.groupAttendanceByEmployee(attendanceBuckets);
    const leavesByEmployee = this.groupLeavesByEmployee(leaveRequests);
    const calendarLookup = buildBranchCalendarLookup(
      activeHolidays,
      activeWeeklyOffConfigs,
    );
    const branchDayCache = new Map<
      string,
      { isWeeklyOff: boolean; isHoliday: boolean }
    >();

    for (const target of targets) {
      const empIdStr = target.employee._id.toHexString();
      const branchIdStr =
        target.employee.branchId?.toHexString() ?? 'UNASSIGNED';
      const branchTimezone =
        branchTimezoneMap.get(branchIdStr) ??
        ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE;
      const branchTodayStr = AttendanceCalculationUtil.getAttendanceDateString(
        now,
        branchTimezone,
      );

      const resolution = this.reconcileEmployee({
        employeeId: target.employee._id,
        branchIdStr,
        branchTimezone,
        effectiveStartDate: target.tenure.effectiveStartStr,
        effectiveEndDate: target.tenure.effectiveEndStr,
        tenureCalendarDays: target.tenure.eligibleDays,
        periodDates,
        branchTodayStr,
        attendanceBuckets: attendanceByEmployee.get(empIdStr) ?? [],
        leaves: leavesByEmployee.get(empIdStr) ?? [],
        regularizationMap,
        calendarLookup,
        branchDayCache,
      });

      resultMap.set(empIdStr, resolution);
    }

    return resultMap;
  }

  private reconcileEmployee(params: {
    employeeId: Types.ObjectId;
    branchIdStr: string;
    branchTimezone: string;
    effectiveStartDate: string;
    effectiveEndDate: string;
    tenureCalendarDays: number;
    periodDates: string[];
    branchTodayStr: string;
    attendanceBuckets: PayrollAttendanceBucket[];
    leaves: LeaveRequestLean[];
    regularizationMap: Map<string, VerifiedRegularizationRecord>;
    calendarLookup: BranchCalendarLookup;
    branchDayCache: Map<string, { isWeeklyOff: boolean; isHoliday: boolean }>;
  }): PayrollLeaveAttendanceResolution {
    const {
      employeeId,
      branchIdStr,
      branchTimezone,
      effectiveStartDate,
      effectiveEndDate,
      tenureCalendarDays,
      periodDates,
      branchTodayStr,
      attendanceBuckets,
      leaves,
      regularizationMap,
      calendarLookup,
      branchDayCache,
    } = params;

    const tenureDates = periodDates.filter(
      (d) => d >= effectiveStartDate && d <= effectiveEndDate,
    );

    let weeklyOffDays = 0;
    let holidayDays = 0;
    const scheduledWorkingDateSet = new Set<string>();
    const evaluatableWorkingDates: string[] = [];

    for (const dStr of tenureDates) {
      const { isWeeklyOff, isHoliday } = resolveBranchDayStatus(
        branchIdStr,
        dStr,
        calendarLookup,
        branchDayCache,
      );

      if (isWeeklyOff) {
        weeklyOffDays++;
      } else if (isHoliday) {
        holidayDays++;
      } else {
        scheduledWorkingDateSet.add(dStr);
        if (dStr <= branchTodayStr) {
          evaluatableWorkingDates.push(dStr);
        }
      }
    }

    const eligibleWorkingDays = scheduledWorkingDateSet.size;

    const duplicateAttendanceDates = new Set<string>();
    const unapprovedRegularizedDates = new Set<string>();
    const openSessionDates = new Set<string>();
    const incompleteDates = new Set<string>();
    const missingDates = new Set<string>();
    const leaveAttendanceMismatchDates = new Set<string>();
    const overlappingLeaveDates = new Set<string>();
    const conflictingLeaveDates = new Set<string>();
    const outsideTenureAttendanceDates = new Set<string>();

    // Index verified attendance buckets inside active tenure
    const validAttendanceByDate = new Map<string, PayrollAttendanceBucket>();
    const verifiedStatusByDate = new Map<string, AttendanceStatus>();

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

      const hasVerifiedApprovedReg =
        bucket.regularizationId !== null &&
        isVerifiedApprovedRegularization(
          regularizationMap.get(bucket.regularizationId.toHexString()),
          employeeId,
          bucket.attendanceDate,
        );

      if (
        (bucket.status === AttendanceStatus.REGULARIZED ||
          bucket.regularizationId !== null) &&
        !hasVerifiedApprovedReg
      ) {
        unapprovedRegularizedDates.add(bucket.attendanceDate);
        continue;
      }

      verifiedStatusByDate.set(bucket.attendanceDate, bucket.status);
    }

    // Step 1: Gather all candidate leave entries per date within active tenure
    interface DailyLeaveCandidate {
      leave: LeaveRequestLean;
      weight: number;
      isPaid: boolean;
      isHalfDay: boolean;
      halfDaySession: string | null;
      isCancellationRequested: boolean;
    }

    const candidatesByDate = new Map<string, DailyLeaveCandidate[]>();
    let hasPendingCancellationOverlapInTenure = false;

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

      for (const dStr of candidateDates) {
        if (excludedSet) {
          if (excludedSet.has(dStr)) continue;
        } else {
          const { isWeeklyOff, isHoliday } = resolveBranchDayStatus(
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

        if (leave.status === LeaveRequestStatus.CANCELLATION_REQUESTED) {
          hasPendingCancellationOverlapInTenure = true;
        }

        const list = candidatesByDate.get(dStr) ?? [];
        list.push({
          leave,
          weight: leave.isHalfDay ? 0.5 : 1,
          isPaid: leave.leaveTypeSnapshot.isPaid,
          isHalfDay: Boolean(leave.isHalfDay),
          halfDaySession: leave.halfDaySession ?? null,
          isCancellationRequested:
            leave.status === LeaveRequestStatus.CANCELLATION_REQUESTED,
        });
        candidatesByDate.set(dStr, list);
      }
    }

    // Step 2: Reconcile each date deterministically (order-independent) & detect any overlapping/conflicting leaves
    const leaveCoverageByDate = new Map<string, DailyLeaveCoverage>();
    const leaveTypeMap = new Map<string, PayrollLeaveTypeBreakdownItemDto>();
    let pendingCancellationLeaveDays = 0;

    for (const [dStr, entries] of candidatesByDate.entries()) {
      if (entries.length > 1) {
        const rawWeightSum = roundPayrollDays(
          entries.reduce((acc, item) => acc + item.weight, 0),
        );
        const isCleanSplitHalfDay =
          entries.length === 2 &&
          rawWeightSum === 1 &&
          entries.every((e) => e.isHalfDay && !e.isCancellationRequested) &&
          entries[0].halfDaySession !== null &&
          entries[1].halfDaySession !== null &&
          entries[0].halfDaySession !== entries[1].halfDaySession;

        if (!isCleanSplitHalfDay) {
          overlappingLeaveDates.add(dStr);
          leaveAttendanceMismatchDates.add(dStr);

          const hasPaid = entries.some((e) => e.isPaid);
          const hasUnpaid = entries.some((e) => !e.isPaid);
          const hasCancellationOverlap = entries.some(
            (e) => e.isCancellationRequested,
          );
          if ((hasPaid && hasUnpaid) || hasCancellationOverlap) {
            conflictingLeaveDates.add(dStr);
          }
        }
      }

      // Deterministic sort independent of MongoDB _id / insertion order:
      // 1) Active APPROVED beats CANCELLATION_REQUESTED
      // 2) Within conflicting same-status requests, conservative Unpaid precedes Paid so free paid leave is never granted silently
      // 3) Full-day precedes half-day
      // 4) Leave type code + _id as stable deterministic tie-breaker
      const sorted = [...entries].sort((a, b) => {
        if (a.isCancellationRequested !== b.isCancellationRequested) {
          return a.isCancellationRequested ? 1 : -1;
        }
        if (a.isPaid !== b.isPaid) {
          return a.isPaid ? 1 : -1;
        }
        if (a.weight !== b.weight) {
          return b.weight - a.weight;
        }
        const codeCmp = a.leave.leaveTypeSnapshot.code.localeCompare(
          b.leave.leaveTypeSnapshot.code,
        );
        if (codeCmp !== 0) return codeCmp;
        return a.leave._id
          .toHexString()
          .localeCompare(b.leave._id.toHexString());
      });

      const current: DailyLeaveCoverage = {
        paidWeight: 0,
        unpaidWeight: 0,
        hasFullDayLeave: false,
        hasHalfDayLeave: false,
      };
      let usedFirstHalf = false;
      let usedSecondHalf = false;

      for (const entry of sorted) {
        const alreadyCovered = roundPayrollDays(
          current.paidWeight + current.unpaidWeight,
        );
        const remainingCapacity = Math.max(
          0,
          roundPayrollDays(1 - alreadyCovered),
        );
        if (remainingCapacity <= 0) {
          break;
        }

        if (entry.isHalfDay) {
          if (entry.halfDaySession === 'FIRST_HALF') {
            if (usedFirstHalf) continue;
            usedFirstHalf = true;
          } else if (entry.halfDaySession === 'SECOND_HALF') {
            if (usedSecondHalf) continue;
            usedSecondHalf = true;
          } else {
            if (!usedFirstHalf) {
              usedFirstHalf = true;
            } else if (!usedSecondHalf) {
              usedSecondHalf = true;
            } else {
              continue;
            }
          }
        } else {
          usedFirstHalf = true;
          usedSecondHalf = true;
        }

        const effectiveWeight = Math.min(entry.weight, remainingCapacity);
        if (entry.isPaid) {
          current.paidWeight = roundPayrollDays(
            current.paidWeight + effectiveWeight,
          );
        } else {
          current.unpaidWeight = roundPayrollDays(
            current.unpaidWeight + effectiveWeight,
          );
        }

        if (entry.isHalfDay) {
          current.hasHalfDayLeave = true;
        } else {
          current.hasFullDayLeave = true;
        }

        if (entry.isCancellationRequested) {
          pendingCancellationLeaveDays = roundPayrollDays(
            pendingCancellationLeaveDays + effectiveWeight,
          );
        }

        const ltId = entry.leave.leaveTypeId.toHexString();
        const existingType = leaveTypeMap.get(ltId);
        if (existingType) {
          existingType.days = roundPayrollDays(
            existingType.days + effectiveWeight,
          );
        } else {
          leaveTypeMap.set(ltId, {
            leaveTypeId: ltId,
            leaveTypeCode: entry.leave.leaveTypeSnapshot.code,
            leaveTypeName: entry.leave.leaveTypeSnapshot.name,
            isPaid: entry.leave.leaveTypeSnapshot.isPaid,
            days: effectiveWeight,
          });
        }
      }

      leaveCoverageByDate.set(dStr, current);
    }

    // Reconcile day-by-day across tenure dates: Paid Leave, Unpaid Leave LOP, Attendance LOP (no double deduction)
    let presentDays = 0;
    let halfDays = 0;
    let incompleteDays = 0;
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let unpaidLeaveLopDays = 0;
    let attendanceAbsenceDays = 0;
    let attendanceAbsenceLopDays = 0;
    let halfDayDeductions = 0;

    for (const dStr of tenureDates) {
      const leaveCov = leaveCoverageByDate.get(dStr);
      const paidOnDay = leaveCov?.paidWeight ?? 0;
      const unpaidOnDay = leaveCov?.unpaidWeight ?? 0;
      const totalLeaveOnDay = roundPayrollDays(
        Math.min(1, paidOnDay + unpaidOnDay),
      );

      paidLeaveDays = roundPayrollDays(paidLeaveDays + paidOnDay);
      unpaidLeaveDays = roundPayrollDays(unpaidLeaveDays + unpaidOnDay);
      unpaidLeaveLopDays = roundPayrollDays(unpaidLeaveLopDays + unpaidOnDay);

      const attBucket = validAttendanceByDate.get(dStr);
      const verifiedStatus = verifiedStatusByDate.get(dStr);

      if (
        verifiedStatus === AttendanceStatus.PRESENT ||
        verifiedStatus === AttendanceStatus.LATE ||
        verifiedStatus === AttendanceStatus.REGULARIZED
      ) {
        presentDays++;
      } else if (verifiedStatus === AttendanceStatus.HALF_DAY) {
        halfDays++;
      } else if (verifiedStatus === AttendanceStatus.INCOMPLETE) {
        incompleteDays++;
        incompleteDates.add(dStr);
      } else if (
        verifiedStatus === AttendanceStatus.CHECKED_IN ||
        verifiedStatus === AttendanceStatus.ON_BREAK
      ) {
        incompleteDays++;
        openSessionDates.add(dStr);
      }

      // Consistency anomalies between leave & attendance
      const hasFullLeave = Boolean(leaveCov?.hasFullDayLeave);
      const hasAnyLeave = Boolean(leaveCov);
      if (hasFullLeave && !attBucket && dStr <= branchTodayStr) {
        leaveAttendanceMismatchDates.add(dStr);
      } else if (
        hasFullLeave &&
        attBucket &&
        attBucket.status !== AttendanceStatus.ON_LEAVE
      ) {
        leaveAttendanceMismatchDates.add(dStr);
      } else if (
        attBucket?.status === AttendanceStatus.ON_LEAVE &&
        !hasAnyLeave
      ) {
        leaveAttendanceMismatchDates.add(dStr);
      }

      // Weekly offs & holidays never incur attendance absence LOP
      if (!scheduledWorkingDateSet.has(dStr)) {
        continue;
      }

      // Uncovered working fraction on this scheduled working day (0, 0.5, or 1)
      const uncoveredWorkingSlot = Math.max(
        0,
        roundPayrollDays(1 - totalLeaveOnDay),
      );

      if (uncoveredWorkingSlot <= 0) {
        // Full day is already covered by approved leave (paid or unpaid) -> 0 additional attendance LOP
        continue;
      }

      if (verifiedStatus === AttendanceStatus.ABSENT) {
        // Full ABSENT (1.0) on working day -> deduct only up to uncoveredWorkingSlot (never > 1.0 total/day)
        const lopAdd = uncoveredWorkingSlot;
        attendanceAbsenceDays = roundPayrollDays(
          attendanceAbsenceDays + lopAdd,
        );
        attendanceAbsenceLopDays = roundPayrollDays(
          attendanceAbsenceLopDays + lopAdd,
        );
        if (hasAnyLeave) {
          // Half-day leave + ABSENT on the other half
          leaveAttendanceMismatchDates.add(dStr);
        }
      } else if (verifiedStatus === AttendanceStatus.HALF_DAY) {
        // HALF_DAY attendance covers 0.5 worked day:
        // - If paired with 0.5 approved leave (uncoveredWorkingSlot = 0.5), 0.5 worked + 0.5 leave = 0 extra LOP!
        // - If no leave covers the other half (uncoveredWorkingSlot = 1.0), 0.5 half-day deduction!
        if (uncoveredWorkingSlot > 0.5) {
          const halfLop = roundPayrollDays(uncoveredWorkingSlot - 0.5);
          attendanceAbsenceDays = roundPayrollDays(
            attendanceAbsenceDays + halfLop,
          );
          attendanceAbsenceLopDays = roundPayrollDays(
            attendanceAbsenceLopDays + halfLop,
          );
          halfDayDeductions = roundPayrollDays(halfDayDeductions + halfLop);
        }
      }
    }

    // Track missing attendance on evaluatable working days not covered by full-day approved leave
    for (const dStr of evaluatableWorkingDates) {
      const att = validAttendanceByDate.get(dStr);
      const leaveCov = leaveCoverageByDate.get(dStr);
      if (!att && !leaveCov?.hasFullDayLeave) {
        missingDates.add(dStr);
        if (leaveCov?.hasHalfDayLeave) {
          leaveAttendanceMismatchDates.add(dStr);
        }
      }
    }

    const totalLopDays = Math.min(
      tenureCalendarDays,
      roundPayrollDays(unpaidLeaveLopDays + attendanceAbsenceLopDays),
    );

    const sortedMissing = Array.from(missingDates).sort();
    const sortedOpen = Array.from(openSessionDates).sort();
    const sortedIncomplete = Array.from(incompleteDates).sort();
    const sortedDuplicate = Array.from(duplicateAttendanceDates).sort();
    const sortedUnapprovedReg = Array.from(unapprovedRegularizedDates).sort();
    const sortedLeaveMismatch = Array.from(leaveAttendanceMismatchDates).sort();
    const sortedOverlappingLeave = Array.from(overlappingLeaveDates).sort();
    const sortedConflictingLeave = Array.from(conflictingLeaveDates).sort();
    const sortedOutsideTenure = Array.from(outsideTenureAttendanceDates).sort();

    const warnings: PayrollLeaveAttendanceWarningCode[] = [];
    if (sortedMissing.length > 0) warnings.push('UNFINALIZED_MISSING_DAYS');
    if (sortedOpen.length > 0) warnings.push('OPEN_ATTENDANCE_SESSION');
    if (sortedIncomplete.length > 0)
      warnings.push('INCOMPLETE_ATTENDANCE_RECORD');
    if (sortedDuplicate.length > 0)
      warnings.push('DUPLICATE_ATTENDANCE_RECORD');
    if (sortedUnapprovedReg.length > 0) {
      warnings.push('UNAPPROVED_REGULARIZED_ATTENDANCE');
    }
    if (sortedLeaveMismatch.length > 0) {
      warnings.push('LEAVE_ATTENDANCE_MISMATCH');
    }
    if (sortedOverlappingLeave.length > 0) {
      warnings.push('OVERLAPPING_LEAVE_REQUESTS');
    }
    if (sortedConflictingLeave.length > 0) {
      warnings.push('CONFLICTING_LEAVE_CLASSIFICATION');
    }
    if (sortedOutsideTenure.length > 0) {
      warnings.push('OUTSIDE_TENURE_ATTENDANCE');
    }
    if (
      pendingCancellationLeaveDays > 0 ||
      hasPendingCancellationOverlapInTenure
    ) {
      warnings.push('PENDING_LEAVE_CANCELLATION_RECONCILIATION');
    }

    const leaveTypeBreakdown = Array.from(leaveTypeMap.values()).sort((a, b) =>
      a.leaveTypeCode.localeCompare(b.leaveTypeCode),
    );

    return {
      employeeId: employeeId.toHexString(),
      branchId: branchIdStr,
      branchTimezone,
      tenureCalendarDays,
      eligibleWorkingDays,
      weeklyOffDays,
      holidayDays,
      presentDays,
      halfDays,
      paidLeaveDays,
      unpaidLeaveDays,
      unpaidLeaveLopDays,
      attendanceAbsenceDays,
      attendanceAbsenceLopDays,
      halfDayDeductions,
      totalLopDays,
      incompleteDays,
      pendingCancellationLeaveDays,
      leaveTypeBreakdown,
      warnings,
      missingDates: sortedMissing,
      openSessionDates: sortedOpen,
      incompleteDates: sortedIncomplete,
      duplicateAttendanceDates: sortedDuplicate,
      unapprovedRegularizedDates: sortedUnapprovedReg,
      leaveAttendanceMismatchDates: sortedLeaveMismatch,
      overlappingLeaveDates: sortedOverlappingLeave,
      conflictingLeaveDates: sortedConflictingLeave,
      outsideTenureAttendanceDates: sortedOutsideTenure,
    };
  }

  private extractRegularizationIds(
    buckets: PayrollAttendanceBucket[],
  ): Types.ObjectId[] {
    const idMap = new Map<string, Types.ObjectId>();
    for (const bucket of buckets) {
      if (bucket.regularizationId) {
        idMap.set(
          bucket.regularizationId.toHexString(),
          bucket.regularizationId,
        );
      }
    }
    return Array.from(idMap.values());
  }

  private async loadRegularizationMap(
    regIds: Types.ObjectId[],
  ): Promise<Map<string, VerifiedRegularizationRecord>> {
    const map = new Map<string, VerifiedRegularizationRecord>();
    if (regIds.length === 0) return map;

    const regs =
      await this.attendanceRegularizationRepository.findByIds(regIds);
    for (const reg of regs) {
      map.set(reg._id.toHexString(), {
        employeeId: reg.employeeId,
        attendanceDate: reg.attendanceDate,
        status: reg.status,
      });
    }
    return map;
  }

  private groupAttendanceByEmployee(
    buckets: PayrollAttendanceBucket[],
  ): Map<string, PayrollAttendanceBucket[]> {
    const map = new Map<string, PayrollAttendanceBucket[]>();
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
}
