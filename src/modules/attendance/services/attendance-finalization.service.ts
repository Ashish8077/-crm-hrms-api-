import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  AttendanceRepository,
  AttendanceLean,
  CreateAbsentRecordResult,
} from '../repositories/attendance.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../../employees/repositories/employee.repository';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { ShiftService } from './shift.service';
import { WeeklyOffService } from '../../work-schedules/services/weekly-off.service';
import { HolidayRepository } from '../../leaves/repositories/holiday.repository';
import { LeaveRequestRepository } from '../../leaves/repositories/leave-request.repository';
import {
  ATTENDANCE_CONSTANTS,
  AttendanceSource,
  AttendanceStatus,
  WorkMode,
} from '../constants/attendance.constant';
import { LeaveRequestStatus } from '../../leaves/constants/leaves.constant';
import { EmploymentStatus } from '../../employees/constants/employee.constant';
import { AttendanceCalculationUtil } from '../utils/attendance-calculation.util';
import { Branch } from '../../branches/schemas/branch.schema';

export interface FinalizationMetrics {
  totalEmployeesEvaluated: number;
  absentCreatedCount: number;
  alreadyRecordedCount: number;
  excludedLeaveCount: number;
  excludedWeeklyOffCount: number;
  excludedHolidayCount: number;
  excludedTenureCount: number;
  shiftNotEndedCount: number;
  errorCount: number;
  errors: Array<{ employeeId: string; date: string; error: string }>;
  durationMs: number;
  evaluatedDates: string[];
}

export interface FinalizationOptions {
  targetDate?: string; // YYYY-MM-DD
  lookbackDays?: number; // default 2 (evaluates recent days up to today)
  branchId?: Types.ObjectId | string;
  employeeId?: Types.ObjectId | string;
}

@Injectable()
export class AttendanceFinalizationService {
  private readonly logger = new Logger(AttendanceFinalizationService.name);

  constructor(
    private readonly attendanceRepo: AttendanceRepository,
    private readonly employeeRepo: EmployeeRepository,
    private readonly branchRepo: BranchRepository,
    private readonly shiftService: ShiftService,
    @Optional() private readonly weeklyOffService?: WeeklyOffService,
    @Optional()
    @Inject(forwardRef(() => HolidayRepository))
    private readonly holidayRepo?: HolidayRepository,
    @Optional()
    @Inject(forwardRef(() => LeaveRequestRepository))
    private readonly leaveRequestRepo?: LeaveRequestRepository,
  ) {}

  /**
   * Resolves the authoritative effective employment end date taking into account
   * status-specific lifecycle fields without assuming a fixed precedence.
   */
  private getAuthoritativeEffectiveEndDate(
    employee: EmployeeLean,
  ): Date | undefined {
    const emp = employee as {
      employmentStatus?: EmploymentStatus;
      lastWorkingDate?: Date;
      resignationDate?: Date;
      terminationDate?: Date;
    };

    if (emp.employmentStatus === EmploymentStatus.TERMINATED) {
      if (emp.lastWorkingDate && emp.terminationDate) {
        return emp.lastWorkingDate < emp.terminationDate
          ? emp.lastWorkingDate
          : emp.terminationDate;
      }
      return emp.terminationDate ?? emp.lastWorkingDate ?? emp.resignationDate;
    }

    if (
      emp.employmentStatus === EmploymentStatus.RESIGNED ||
      emp.employmentStatus === EmploymentStatus.NOTICE_PERIOD
    ) {
      return emp.lastWorkingDate ?? emp.resignationDate ?? emp.terminationDate;
    }

    return emp.lastWorkingDate ?? emp.terminationDate ?? emp.resignationDate;
  }

  /**
   * Main production entry point for absence finalization.
   * Runs daily via AttendanceFinalizationScheduler (or programmatically for testing).
   */
  async finalizeAbsences(
    options: FinalizationOptions = {},
  ): Promise<FinalizationMetrics> {
    const startTime = Date.now();
    const now = new Date();

    const metrics: FinalizationMetrics = {
      totalEmployeesEvaluated: 0,
      absentCreatedCount: 0,
      alreadyRecordedCount: 0,
      excludedLeaveCount: 0,
      excludedWeeklyOffCount: 0,
      excludedHolidayCount: 0,
      excludedTenureCount: 0,
      shiftNotEndedCount: 0,
      errorCount: 0,
      errors: [],
      durationMs: 0,
      evaluatedDates: [],
    };

    const targetBranchId = options.branchId
      ? typeof options.branchId === 'string'
        ? new Types.ObjectId(options.branchId)
        : options.branchId
      : undefined;

    let employees: EmployeeLean[] = [];
    if (options.employeeId) {
      const emp = await this.employeeRepo.findById(options.employeeId);
      if (emp) employees = [emp];
    } else {
      employees =
        await this.employeeRepo.findEligibleForFinalization(targetBranchId);
    }

    if (employees.length === 0) {
      metrics.durationMs = Date.now() - startTime;
      return metrics;
    }

    // Cache branch lookups to minimize DB queries across employees
    const branchCache = new Map<
      string,
      { branch: Branch | null; timezone: string }
    >();
    const getBranchInfo = async (
      bId?: Types.ObjectId | null,
    ): Promise<{ branch: Branch | null; timezone: string }> => {
      const bKey = bId ? bId.toString() : 'default';
      if (branchCache.has(bKey)) {
        return branchCache.get(bKey)!;
      }
      const branch = bId ? await this.branchRepo.findById(bId) : null;
      const timezone =
        branch?.timezone || ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE;
      const res = { branch, timezone };
      branchCache.set(bKey, res);
      return res;
    };

    const evaluatedDatesSet = new Set<string>();

    // Process each employee independently (isolated error handling)
    for (const employee of employees) {
      metrics.totalEmployeesEvaluated++;

      try {
        const { timezone } = await getBranchInfo(employee.branchId);

        let targetDates: string[] = [];
        if (options.targetDate) {
          targetDates = [options.targetDate];
        } else {
          const todayStr = AttendanceCalculationUtil.getAttendanceDateString(
            now,
            timezone,
          );
          const lookback = options.lookbackDays ?? 2;
          let candidate = todayStr;
          for (let i = 0; i < lookback; i++) {
            candidate =
              AttendanceCalculationUtil.getPreviousDateString(candidate);
            targetDates.push(candidate);
          }
          targetDates.push(todayStr);
        }

        for (const dateStr of targetDates) {
          evaluatedDatesSet.add(dateStr);
          await this.evaluateEmployeeDate(
            employee,
            dateStr,
            timezone,
            now,
            metrics,
          );
        }
      } catch (err: unknown) {
        metrics.errorCount++;
        metrics.errors.push({
          employeeId: employee._id.toString(),
          date: options.targetDate ?? 'DAILY_RUN',
          error: (err as Error).message,
        });
        this.logger.warn(
          `Error finalizing attendance for employee ${employee._id.toString()}: ${(err as Error).message}`,
        );
      }
    }

    metrics.evaluatedDates = Array.from(evaluatedDatesSet).sort();
    metrics.durationMs = Date.now() - startTime;

    this.logger.log(
      `Absence finalization completed: Evaluated ${metrics.totalEmployeesEvaluated} employees, ` +
        `created ${metrics.absentCreatedCount} ABSENT records, ` +
        `already recorded ${metrics.alreadyRecordedCount}, ` +
        `errors: ${metrics.errorCount} in ${metrics.durationMs}ms`,
    );

    return metrics;
  }

  /**
   * Evaluates a single employee on a single attendance date.
   */
  private async evaluateEmployeeDate(
    employee: EmployeeLean,
    attendanceDate: string,
    timezone: string,
    now: Date,
    metrics: FinalizationMetrics,
  ): Promise<void> {
    // ─── Guard 1: Employment Tenure Bounds ───
    if (employee.dateOfJoining) {
      const joiningDateStr = AttendanceCalculationUtil.getAttendanceDateString(
        employee.dateOfJoining,
        timezone,
      );
      if (attendanceDate < joiningDateStr) {
        metrics.excludedTenureCount++;
        return;
      }
    }

    const effectiveEndDate = this.getAuthoritativeEffectiveEndDate(employee);
    if (effectiveEndDate) {
      const endDateStr = AttendanceCalculationUtil.getAttendanceDateString(
        effectiveEndDate,
        timezone,
      );
      if (attendanceDate > endDateStr) {
        metrics.excludedTenureCount++;
        return;
      }
    }

    // ─── Guard 2: Shift Window & Grace Period Cutoff (Supports Overnight Shifts) ───
    let shift;
    try {
      shift = await this.shiftService.resolveShift(employee.shiftId);
    } catch {
      metrics.errorCount++;
      metrics.errors.push({
        employeeId: employee._id.toString(),
        date: attendanceDate,
        error: `Could not resolve shift for employee ${employee._id.toString()}`,
      });
      return;
    }

    const shiftWindow = AttendanceCalculationUtil.getShiftWindow(
      attendanceDate,
      shift,
      timezone,
    );

    // Scheduled shift end + configured grace period
    const cutoffTime = new Date(
      shiftWindow.shiftEnd.getTime() +
        (shift.gracePeriodMinutes || 0) * 60 * 1000,
    );

    if (now.getTime() < cutoffTime.getTime()) {
      // Shift or grace period is still in progress; skip
      metrics.shiftNotEndedCount++;
      return;
    }

    // ─── Guard 3: Existing Attendance Record (Never Overwrite) ───
    const existing = await this.attendanceRepo.findByEmployeeAndDate(
      employee._id,
      attendanceDate,
    );

    if (existing) {
      metrics.alreadyRecordedCount++;
      return;
    }

    // ─── Guard 4: Approved Leave Checks (Full-Day and Half-Day Protection) ───
    if (this.leaveRequestRepo) {
      const overlappingLeaves =
        await this.leaveRequestRepo.findOverlappingRequests(
          employee._id,
          attendanceDate,
          attendanceDate,
        );

      const approvedLeave = overlappingLeaves.find(
        (l) => l.status === LeaveRequestStatus.APPROVED,
      );

      if (approvedLeave) {
        // Both full-day and half-day approved leaves are excluded from full-day absence
        metrics.excludedLeaveCount++;
        return;
      }
    }

    // ─── Guard 5: Weekly Off Check ───
    const isWeeklyOff = this.weeklyOffService
      ? await this.weeklyOffService.isWeeklyOff(
          attendanceDate,
          employee.branchId,
        )
      : AttendanceCalculationUtil.isWeeklyOff(attendanceDate);

    if (isWeeklyOff) {
      metrics.excludedWeeklyOffCount++;
      return;
    }

    // ─── Guard 6: Holiday Check (Mandatory & Optional Holidays) ───
    // Production Safety Adjustment:
    // In addition to mandatory holidays (PUBLIC, COMPANY, REGIONAL), OPTIONAL holidays
    // must NOT mark employees ABSENT unless an authoritative employee-level holiday
    // selection/opt-out mechanism exists and confirms the employee was expected to work.
    // Since no employee-level opt-in/opt-out model exists, OPTIONAL holidays are safely skipped.
    if (this.holidayRepo) {
      const holidays = await this.holidayRepo.findApplicableHolidays(
        attendanceDate,
        attendanceDate,
        employee.branchId,
      );

      const applicableHoliday = holidays.find(
        (h) => h.isActive && !h.deletedAt,
      );

      if (applicableHoliday) {
        metrics.excludedHolidayCount++;
        return;
      }
    }

    // ─── Layer 3: Atomic Creation of ABSENT Record ───
    const absentRecord: Partial<AttendanceLean> = {
      employeeId: employee._id,
      attendanceDate,
      date: new Date(`${attendanceDate}T00:00:00.000Z`),
      shiftId: shift._id,
      shiftSnapshot: {
        name: shift.name,
        code: shift.code,
        startTime: shift.startTime,
        endTime: shift.endTime,
        isOvernight: shift.isOvernight,
        gracePeriodMinutes: shift.gracePeriodMinutes,
        minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
        minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
        overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
      },
      status: AttendanceStatus.ABSENT,
      workMode: WorkMode.OFFICE,
      checkInSource: AttendanceSource.SYSTEM,
      checkInTime: null,
      checkOutTime: null,
      breaks: [],
      totalBreakMinutes: 0,
      totalWorkMinutes: 0,
      isLate: false,
      lateMinutes: 0,
      isEarlyDeparture: false,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      regularizationId: null,
      leaveRequestId: null,
      deletedAt: null,
      deletedBy: null,
    };

    const result: CreateAbsentRecordResult =
      await this.attendanceRepo.createAbsentRecord(absentRecord);
    if (result.created) {
      metrics.absentCreatedCount++;
    } else {
      // Caught duplicate-key race: another punch or worker recorded attendance simultaneously
      metrics.alreadyRecordedCount++;
    }
  }
}
