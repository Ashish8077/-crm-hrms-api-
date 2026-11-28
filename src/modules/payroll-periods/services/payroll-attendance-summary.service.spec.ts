/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { PayrollAttendanceSummaryService } from './payroll-attendance-summary.service';
import { PayrollPeriodRepository } from '../repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../schemas/payroll-period.schema';
import { PayrollPeriodStatus } from '../constants/payroll-period.constant';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import {
  EmployeeRepository,
  PayrollAttendanceEmployeeProjection,
} from '../../employees/repositories/employee.repository';
import { EmploymentStatus } from '../../employees/constants/employee.constant';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { AttendanceRepository } from '../../attendance/repositories/attendance.repository';
import { AttendanceRegularizationRepository } from '../../attendance/repositories/attendance-regularization.repository';
import {
  AttendanceStatus,
  RegularizationStatus,
} from '../../attendance/constants/attendance.constant';
import {
  LeaveRequestLean,
  LeaveRequestRepository,
} from '../../leaves/repositories/leave-request.repository';
import {
  HolidayType,
  LeaveRequestStatus,
} from '../../leaves/constants/leaves.constant';
import {
  HolidayLean,
  HolidayRepository,
} from '../../leaves/repositories/holiday.repository';
import { WeeklyOffConfigRepository } from '../../work-schedules/repositories/weekly-off-config.repository';
import { WeeklyOffConfigLean } from '../../work-schedules/mappers/weekly-off-config.mapper';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('PayrollAttendanceSummaryService', () => {
  let service: PayrollAttendanceSummaryService;
  let payrollPeriodRepository: jest.Mocked<PayrollPeriodRepository>;
  let employeeRepository: jest.Mocked<EmployeeRepository>;
  let branchRepository: jest.Mocked<BranchRepository>;
  let attendanceRepository: jest.Mocked<AttendanceRepository>;
  let attendanceRegularizationRepository: jest.Mocked<AttendanceRegularizationRepository>;
  let leaveRequestRepository: jest.Mocked<LeaveRequestRepository>;
  let holidayRepository: jest.Mocked<HolidayRepository>;
  let weeklyOffConfigRepository: jest.Mocked<WeeklyOffConfigRepository>;

  const periodId = new Types.ObjectId();
  const branchKolkataId = new Types.ObjectId();
  const branchNyId = new Types.ObjectId();
  const deptId = new Types.ObjectId();
  const desigId = new Types.ObjectId();
  const paidLeaveTypeId = new Types.ObjectId();
  const unpaidLeaveTypeId = new Types.ObjectId();

  // April 2026: 2026-04-01 (Wed) to 2026-04-10 (Fri) — compact 10-day window for crisp assertions
  // Wait: let's also test full 30-day June 2026 periods where helpful.
  const makePeriod = (
    overrides: Partial<PayrollPeriodLean> = {},
  ): PayrollPeriodLean => ({
    _id: periodId,
    periodName: 'June 2026 Payroll',
    periodCode: 'PR-2026-06',
    payrollFrequency: PayrollFrequency.MONTHLY,
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-30T00:00:00.000Z'),
    paymentDate: new Date('2026-07-01T00:00:00.000Z'),
    month: 6,
    year: 2026,
    status: PayrollPeriodStatus.PROCESSING,
    notes: null,
    deletedAt: null,
    createdBy: new Types.ObjectId(),
    updatedBy: new Types.ObjectId(),
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    __v: 0,
    ...overrides,
  });

  const makeEmployee = (
    overrides: Partial<PayrollAttendanceEmployeeProjection> = {},
  ): PayrollAttendanceEmployeeProjection => ({
    _id: new Types.ObjectId(),
    employeeCode: 'EMP001',
    firstName: 'Aarav',
    lastName: 'Sharma',
    dateOfJoining: new Date('2025-01-15T00:00:00.000Z'),
    lastWorkingDate: null,
    terminationDate: null,
    employmentStatus: EmploymentStatus.ACTIVE,
    branchId: branchKolkataId,
    departmentId: deptId,
    designationId: desigId,
    ...overrides,
  });

  const makeAttDay = (
    employeeId: Types.ObjectId,
    attendanceDate: string,
    status: AttendanceStatus,
    overrides: Partial<{
      recordCount: number;
      isLate: boolean;
      lateMinutes: number;
      isEarlyDeparture: boolean;
      earlyDepartureMinutes: number;
      totalWorkMinutes: number;
      totalBreakMinutes: number;
      overtimeMinutes: number;
      regularizationId: Types.ObjectId | null;
      leaveRequestId: Types.ObjectId | null;
    }> = {},
  ) => ({
    employeeId,
    attendanceDate,
    recordCount: overrides.recordCount ?? 1,
    status,
    statuses: [status],
    isLate: overrides.isLate ?? status === AttendanceStatus.LATE,
    lateMinutes:
      overrides.lateMinutes ?? (status === AttendanceStatus.LATE ? 20 : 0),
    isEarlyDeparture: overrides.isEarlyDeparture ?? false,
    earlyDepartureMinutes: overrides.earlyDepartureMinutes ?? 0,
    totalWorkMinutes:
      overrides.totalWorkMinutes ??
      (status === AttendanceStatus.PRESENT ||
      status === AttendanceStatus.LATE ||
      status === AttendanceStatus.REGULARIZED
        ? 480
        : status === AttendanceStatus.HALF_DAY
          ? 240
          : 0),
    totalBreakMinutes: overrides.totalBreakMinutes ?? 60,
    overtimeMinutes: overrides.overtimeMinutes ?? 0,
    regularizationId: overrides.regularizationId ?? null,
    leaveRequestId: overrides.leaveRequestId ?? null,
  });

  const makeLeave = (
    employeeId: Types.ObjectId,
    startDate: string,
    endDate: string,
    overrides: Partial<LeaveRequestLean> = {},
  ): LeaveRequestLean =>
    ({
      _id: new Types.ObjectId(),
      employeeId,
      leaveTypeId:
        overrides.leaveTypeSnapshot?.isPaid === false
          ? unpaidLeaveTypeId
          : paidLeaveTypeId,
      leaveTypeSnapshot: {
        name: 'Casual Leave',
        code: 'CL',
        isPaid: true,
        allowHalfDay: true,
        deductWeekends: false,
        deductHolidays: false,
        ...(overrides.leaveTypeSnapshot ?? {}),
      },
      startDate,
      endDate,
      totalDays: overrides.totalDays ?? 1,
      isHalfDay: overrides.isHalfDay ?? false,
      halfDaySession: overrides.halfDaySession ?? null,
      excludedDates: overrides.excludedDates ?? [],
      status: overrides.status ?? LeaveRequestStatus.APPROVED,
      ...overrides,
    }) as LeaveRequestLean;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-05T10:00:00.000Z'));

    payrollPeriodRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<PayrollPeriodRepository>;

    employeeRepository = {
      findForPayrollAttendanceSummary: jest.fn(),
    } as unknown as jest.Mocked<EmployeeRepository>;

    branchRepository = {
      findByIds: jest.fn().mockResolvedValue([
        {
          _id: branchKolkataId,
          name: 'Mumbai HQ',
          timezone: 'Asia/Kolkata',
          isActive: true,
        },
        {
          _id: branchNyId,
          name: 'New York Office',
          timezone: 'America/New_York',
          isActive: true,
        },
      ]),
    } as unknown as jest.Mocked<BranchRepository>;

    attendanceRepository = {
      aggregateForPayrollPeriod: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<AttendanceRepository>;

    attendanceRegularizationRepository = {
      findByIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<AttendanceRegularizationRepository>;

    leaveRequestRepository = {
      findOverlappingForEmployees: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<LeaveRequestRepository>;

    holidayRepository = {
      findActiveInRange: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<HolidayRepository>;

    weeklyOffConfigRepository = {
      findActiveEffectiveInRange: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<WeeklyOffConfigRepository>;

    service = new PayrollAttendanceSummaryService(
      payrollPeriodRepository,
      employeeRepository,
      branchRepository,
      attendanceRepository,
      attendanceRegularizationRepository,
      leaveRequestRepository,
      holidayRepository,
      weeklyOffConfigRepository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('throws 404 when payroll period does not exist or is soft-deleted', async () => {
    payrollPeriodRepository.findById.mockResolvedValue(null);

    await expect(
      service.getPeriodAttendanceSummary(periodId),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      statusCode: HttpStatus.NOT_FOUND,
    });
  });

  it('throws 400 when payroll period has an inverted date range', async () => {
    payrollPeriodRepository.findById.mockResolvedValue(
      makePeriod({
        startDate: new Date('2026-06-30T00:00:00.000Z'),
        endDate: new Date('2026-06-01T00:00:00.000Z'),
      }),
    );

    await expect(service.getPeriodAttendanceSummary(periodId)).rejects.toThrow(
      AppError,
    );
  });

  it('returns empty response cleanly when no employees overlap the period', async () => {
    payrollPeriodRepository.findById.mockResolvedValue(makePeriod());
    employeeRepository.findForPayrollAttendanceSummary.mockResolvedValue([]);

    const res = await service.getPeriodAttendanceSummary(periodId);

    expect(res.period.periodCode).toBe('PR-2026-06');
    expect(res.period.calendarDays).toBe(30);
    expect(res.summary.totalEligibleEmployees).toBe(0);
    expect(res.employees).toEqual([]);
    expect(res.finalization.attendanceFinalized).toBe(true);
    expect(
      attendanceRepository.aggregateForPayrollPeriod,
    ).not.toHaveBeenCalled();
  });

  it('classifies PRESENT, LATE, approved REGULARIZED, HALF_DAY, ABSENT, INCOMPLETE, CHECKED_IN, ON_BREAK, and ON_LEAVE strictly per locked rules', async () => {
    // Use 14-day period: 2026-06-01 (Mon) to 2026-06-14 (Sun)
    // Sundays: 2026-06-07, 2026-06-14 (2 weekly offs via system default)
    // Working days: Jun 1,2,3,4,5,6, 8,9,10,11,12,13 (12 scheduled working days)
    payrollPeriodRepository.findById.mockResolvedValue(
      makePeriod({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-14T00:00:00.000Z'),
      }),
    );

    const emp = makeEmployee();
    employeeRepository.findForPayrollAttendanceSummary.mockResolvedValue([emp]);

    const approvedRegId = new Types.ObjectId();
    const pendingRegId = new Types.ObjectId();

    attendanceRegularizationRepository.findByIds.mockResolvedValue([
      {
        _id: approvedRegId,
        employeeId: emp._id,
        attendanceDate: '2026-06-03',
        status: RegularizationStatus.APPROVED,
      },
      {
        _id: pendingRegId,
        employeeId: emp._id,
        attendanceDate: '2026-06-12',
        status: RegularizationStatus.PENDING,
      },
    ]);

    attendanceRepository.aggregateForPayrollPeriod.mockResolvedValue([
      makeAttDay(emp._id, '2026-06-01', AttendanceStatus.PRESENT),
      makeAttDay(emp._id, '2026-06-02', AttendanceStatus.LATE, {
        lateMinutes: 25,
      }),
      makeAttDay(emp._id, '2026-06-03', AttendanceStatus.REGULARIZED, {
        regularizationId: approvedRegId,
      }),
      makeAttDay(emp._id, '2026-06-04', AttendanceStatus.HALF_DAY),
      makeAttDay(emp._id, '2026-06-05', AttendanceStatus.ABSENT),
      makeAttDay(emp._id, '2026-06-06', AttendanceStatus.ON_LEAVE),
      makeAttDay(emp._id, '2026-06-08', AttendanceStatus.CHECKED_IN, {
        totalWorkMinutes: 0,
      }),
      makeAttDay(emp._id, '2026-06-09', AttendanceStatus.ON_BREAK, {
        totalWorkMinutes: 0,
      }),
      makeAttDay(emp._id, '2026-06-10', AttendanceStatus.INCOMPLETE, {
        totalWorkMinutes: 90,
      }),
      // 2026-06-11 intentionally unrecorded -> missingDays = 1
      // 2026-06-12 REGULARIZED with PENDING regularization -> must NOT count as present!
      makeAttDay(emp._id, '2026-06-12', AttendanceStatus.REGULARIZED, {
        regularizationId: pendingRegId,
      }),
      // 2026-06-13 REGULARIZED with null regularizationId -> must NOT count as present!
      makeAttDay(emp._id, '2026-06-13', AttendanceStatus.REGULARIZED, {
        regularizationId: null,
      }),
    ]);

    leaveRequestRepository.findOverlappingForEmployees.mockResolvedValue([
      makeLeave(emp._id, '2026-06-06', '2026-06-06'),
    ]);

    const res = await service.getPeriodAttendanceSummary(periodId);
    expect(res.employees).toHaveLength(1);
    const e = res.employees[0];

    expect(e.weeklyOffDays).toBe(2);
    expect(e.holidayDays).toBe(0);
    expect(e.scheduledWorkingDays).toBe(12);

    // PRESENT (1) + LATE (1) + verified-approved REGULARIZED (1) = 3
    expect(e.presentDays).toBe(3);
    expect(e.halfDays).toBe(1);
    expect(e.absentDays).toBe(1);
    // CHECKED_IN (1) + ON_BREAK (1) + INCOMPLETE (1) = 3
    expect(e.incompleteDays).toBe(3);
    // Only 2026-06-11 has no record & no full-day leave
    expect(e.missingDays).toBe(1);

    expect(e.statusBreakdown).toEqual({
      present: 1,
      late: 1,
      regularized: 1,
      halfDay: 1,
      absent: 1,
      onLeave: 1,
      incomplete: 1,
      checkedIn: 1,
      onBreak: 1,
      weekOffRecordCount: 0,
      holidayRecordCount: 0,
    });

    expect(e.leaveSummary.paidLeaveDays).toBe(1);
    expect(e.leaveSummary.unpaidLeaveDays).toBe(0);
    expect(e.anomalies.missingDates).toEqual(['2026-06-11']);
    expect(e.anomalies.openSessionDates).toEqual(['2026-06-08', '2026-06-09']);
    expect(e.anomalies.incompleteDates).toEqual(['2026-06-10']);
    expect(e.anomalies.unapprovedRegularizedDates).toEqual([
      '2026-06-12',
      '2026-06-13',
    ]);
    expect(e.anomalies.warnings).toEqual(
      expect.arrayContaining([
        'UNFINALIZED_MISSING_DAYS',
        'OPEN_ATTENDANCE_SESSION',
        'INCOMPLETE_ATTENDANCE_RECORD',
        'UNAPPROVED_REGULARIZED_ATTENDANCE',
      ]),
    );
    expect(res.finalization.attendanceFinalized).toBe(false);
    expect(res.finalization.hasUnresolvedGaps).toBe(true);
    expect(res.finalization.totalMissingDays).toBe(1);
    expect(res.finalization.totalIncompleteDays).toBe(3);
    expect(res.finalization.totalUnapprovedRegularizedDays).toBe(2);
  });

  it('includes separated employees overlapping the period using lastWorkingDate/terminationDate, never guesses missing exit dates, and ignores resignationDate', async () => {
    payrollPeriodRepository.findById.mockResolvedValue(makePeriod());

    const activeEmp = makeEmployee({
      employeeCode: 'EMP001',
      employmentStatus: EmploymentStatus.ACTIVE,
    });
    const resignedWithLwd = makeEmployee({
      employeeCode: 'EMP002',
      employmentStatus: EmploymentStatus.RESIGNED,
      lastWorkingDate: new Date('2026-06-15T00:00:00.000Z'),
    });
    const terminatedEarlierDate = makeEmployee({
      employeeCode: 'EMP003',
      employmentStatus: EmploymentStatus.TERMINATED,
      terminationDate: new Date('2026-06-10T00:00:00.000Z'),
      lastWorkingDate: new Date('2026-06-12T00:00:00.000Z'),
    });
    const resignedBeforePeriod = makeEmployee({
      employeeCode: 'EMP004',
      employmentStatus: EmploymentStatus.RESIGNED,
      lastWorkingDate: new Date('2026-05-31T00:00:00.000Z'),
    });
    const resignedWithoutExitDate = makeEmployee({
      employeeCode: 'EMP005',
      employmentStatus: EmploymentStatus.RESIGNED,
      lastWorkingDate: null,
      terminationDate: null,
      // Even if a dynamic resignationDate field existed in DB, it must NOT be used as exit date
      ...({ resignationDate: new Date('2026-06-20T00:00:00.000Z') } as object),
    });
    const postPeriodJoiner = makeEmployee({
      employeeCode: 'EMP006',
      dateOfJoining: new Date('2026-07-01T00:00:00.000Z'),
    });

    employeeRepository.findForPayrollAttendanceSummary.mockResolvedValue([
      activeEmp,
      resignedWithLwd,
      terminatedEarlierDate,
      resignedBeforePeriod,
      resignedWithoutExitDate,
      postPeriodJoiner,
    ]);

    const res = await service.getPeriodAttendanceSummary(periodId);

    const codes = res.employees.map((e) => e.employeeCode);
    expect(codes).toEqual(['EMP001', 'EMP002', 'EMP003']);

    const emp2 = res.employees[1];
    expect(emp2.effectiveStartDate).toBe('2026-06-01');
    expect(emp2.effectiveEndDate).toBe('2026-06-15');
    expect(emp2.effectiveExitDate).toBe('2026-06-15');
    expect(emp2.isMidPeriodLeaver).toBe(true);
    expect(emp2.tenureCalendarDays).toBe(15);

    const emp3 = res.employees[2];
    expect(emp3.effectiveExitDate).toBe('2026-06-10');
    expect(emp3.tenureCalendarDays).toBe(10);
  });

  it('derives holidays and weekly offs per branch config without needing attendance records and counts cross-period leaves accurately', async () => {
    // Period: 2026-06-01 (Mon) to 2026-06-07 (Sun)
    payrollPeriodRepository.findById.mockResolvedValue(
      makePeriod({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-07T00:00:00.000Z'),
      }),
    );

    const empKolkata = makeEmployee({
      employeeCode: 'EMP_KOL',
      branchId: branchKolkataId,
      dateOfJoining: new Date('2026-06-02T00:00:00.000Z'), // Mid-period joiner (Tue)
    });
    const empNy = makeEmployee({
      employeeCode: 'EMP_NY',
      branchId: branchNyId,
      dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
    });

    employeeRepository.findForPayrollAttendanceSummary.mockResolvedValue([
      empKolkata,
      empNy,
    ]);

    // Global holiday on 2026-06-03 (Wed)
    // Branch NY holiday on 2026-06-05 (Fri)
    holidayRepository.findActiveInRange.mockResolvedValue([
      {
        _id: new Types.ObjectId(),
        name: 'Global Holiday',
        date: '2026-06-03',
        year: 2026,
        type: HolidayType.PUBLIC,
        branchId: null,
        isActive: true,
        deletedAt: null,
      } as HolidayLean,
      {
        _id: new Types.ObjectId(),
        name: 'NY Holiday',
        date: '2026-06-05',
        year: 2026,
        type: HolidayType.REGIONAL,
        branchId: branchNyId,
        isActive: true,
        deletedAt: null,
      } as HolidayLean,
    ]);

    // Company default: Sun (0) + Sat (6); NY override: Sun (0) only
    weeklyOffConfigRepository.findActiveEffectiveInRange.mockResolvedValue([
      {
        _id: new Types.ObjectId(),
        name: 'NY Sun Only',
        branchId: branchNyId,
        days: [{ dayOfWeek: 0 }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      } as WeeklyOffConfigLean,
      {
        _id: new Types.ObjectId(),
        name: 'Company Sat-Sun',
        branchId: null,
        days: [{ dayOfWeek: 0 }, { dayOfWeek: 6 }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      } as WeeklyOffConfigLean,
    ]);

    // Cross-period leave for NY employee: 2026-05-29 to 2026-06-04 (Fri May 29..Thu Jun 4), unpaid, CANCELLATION_REQUESTED
    // Within Jun 1..7: Jun 1 (Mon), Jun 2 (Tue), Jun 3 (Holiday, excluded), Jun 4 (Thu) => 3 unpaid days!
    // Plus half-day paid leave on Jun 2 for Kolkata employee (0.5 days).
    leaveRequestRepository.findOverlappingForEmployees.mockResolvedValue([
      makeLeave(empNy._id, '2026-05-29', '2026-06-04', {
        status: LeaveRequestStatus.CANCELLATION_REQUESTED,
        excludedDates: ['2026-05-31', '2026-06-03'],
        leaveTypeSnapshot: {
          name: 'Loss Of Pay',
          code: 'LWP',
          isPaid: false,
          allowHalfDay: true,
          deductWeekends: false,
          deductHolidays: false,
        },
      }),
      makeLeave(empKolkata._id, '2026-06-02', '2026-06-02', {
        isHalfDay: true,
        totalDays: 0.5,
      }),
    ]);

    // Attendance for Kolkata (joined Jun 2): Jun 2 HALF_DAY, Jun 3 Holiday (no doc!), Jun 4 PRESENT, Jun 5 PRESENT, Jun 6-7 WeekOff (no docs!)
    // Attendance for NY: Jun 1,2,4 ON_LEAVE, Jun 3 Holiday, Jun 5 NY Holiday, Jun 6 PRESENT, Jun 7 WeekOff
    attendanceRepository.aggregateForPayrollPeriod.mockResolvedValue([
      makeAttDay(empKolkata._id, '2026-06-02', AttendanceStatus.HALF_DAY),
      makeAttDay(empKolkata._id, '2026-06-04', AttendanceStatus.PRESENT),
      makeAttDay(empKolkata._id, '2026-06-05', AttendanceStatus.PRESENT),
      makeAttDay(empNy._id, '2026-06-01', AttendanceStatus.ON_LEAVE),
      makeAttDay(empNy._id, '2026-06-02', AttendanceStatus.ON_LEAVE),
      makeAttDay(empNy._id, '2026-06-04', AttendanceStatus.ON_LEAVE),
      makeAttDay(empNy._id, '2026-06-06', AttendanceStatus.PRESENT),
    ]);

    const res = await service.getPeriodAttendanceSummary(periodId);

    const kol = res.employees.find((e) => e.employeeCode === 'EMP_KOL')!;
    expect(kol.isMidPeriodJoiner).toBe(true);
    expect(kol.tenureCalendarDays).toBe(6); // Jun 2..7
    expect(kol.weeklyOffDays).toBe(2); // Jun 6 Sat, Jun 7 Sun
    expect(kol.holidayDays).toBe(1); // Jun 3 Global Holiday
    expect(kol.scheduledWorkingDays).toBe(3); // Jun 2, 4, 5
    expect(kol.presentDays).toBe(2);
    expect(kol.halfDays).toBe(1);
    expect(kol.missingDays).toBe(0);
    expect(kol.leaveSummary.paidLeaveDays).toBe(0.5);
    expect(kol.anomalies.hasAnomalies).toBe(false);

    const ny = res.employees.find((e) => e.employeeCode === 'EMP_NY')!;
    expect(ny.branchTimezone).toBe('America/New_York');
    expect(ny.tenureCalendarDays).toBe(7); // Jun 1..7
    expect(ny.weeklyOffDays).toBe(1); // Sun Jun 7 only
    expect(ny.holidayDays).toBe(2); // Jun 3 Global + Jun 5 NY
    expect(ny.scheduledWorkingDays).toBe(4); // Jun 1, 2, 4, 6
    expect(ny.presentDays).toBe(1);
    expect(ny.missingDays).toBe(0);
    expect(ny.leaveSummary.unpaidLeaveDays).toBe(3);
    expect(ny.leaveSummary.pendingCancellationLeaveDays).toBe(3);
    expect(ny.anomalies.warnings).toEqual([
      'PENDING_LEAVE_CANCELLATION_RECONCILIATION',
    ]);

    // CANCELLATION_REQUESTED is an informational warning, not an attendance gap!
    expect(res.finalization.attendanceFinalized).toBe(true);
    expect(res.finalization.hasUnresolvedGaps).toBe(false);
  });

  it('does not mark future days in an ongoing period as missingDays and exposes unfinalized state accurately', async () => {
    // Current system time set to 2026-06-03 10:00 UTC (15:30 IST -> branchTodayStr = 2026-06-03)
    jest.setSystemTime(new Date('2026-06-03T10:00:00.000Z'));

    // Period: 2026-06-01 (Mon) to 2026-06-05 (Fri)
    payrollPeriodRepository.findById.mockResolvedValue(
      makePeriod({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-05T00:00:00.000Z'),
      }),
    );

    const emp = makeEmployee();
    employeeRepository.findForPayrollAttendanceSummary.mockResolvedValue([emp]);
    // Recorded ONLY Jun 1 PRESENT; Jun 2 and Jun 3 have no record; Jun 4 & Jun 5 are future!
    attendanceRepository.aggregateForPayrollPeriod.mockResolvedValue([
      makeAttDay(emp._id, '2026-06-01', AttendanceStatus.PRESENT),
    ]);

    const res = await service.getPeriodAttendanceSummary(periodId);
    const e = res.employees[0];

    expect(e.scheduledWorkingDays).toBe(5);
    expect(e.evaluatableWorkingDays).toBe(3); // Jun 1, 2, 3
    expect(e.futureScheduledWorkingDays).toBe(2); // Jun 4, 5
    expect(e.missingDays).toBe(2); // Jun 2, 3 only — NEVER Jun 4, 5!
    expect(e.absentDays).toBe(0);
    expect(e.anomalies.missingDates).toEqual(['2026-06-02', '2026-06-03']);
    expect(res.finalization.periodEnded).toBe(false);
    expect(res.finalization.attendanceFinalized).toBe(false);
  });

  it('detects duplicate records, outside-tenure attendance, leave/attendance mismatches, and supports anomaliesOnly filter', async () => {
    payrollPeriodRepository.findById.mockResolvedValue(
      makePeriod({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-05T00:00:00.000Z'),
      }),
    );

    const cleanEmp = makeEmployee({ employeeCode: 'EMP_CLEAN' });
    const noisyEmp = makeEmployee({
      employeeCode: 'EMP_NOISY',
      dateOfJoining: new Date('2026-06-02T00:00:00.000Z'),
    });

    employeeRepository.findForPayrollAttendanceSummary.mockResolvedValue([
      cleanEmp,
      noisyEmp,
    ]);

    attendanceRepository.aggregateForPayrollPeriod.mockResolvedValue([
      // cleanEmp: all 5 working days present
      makeAttDay(cleanEmp._id, '2026-06-01', AttendanceStatus.PRESENT),
      makeAttDay(cleanEmp._id, '2026-06-02', AttendanceStatus.PRESENT),
      makeAttDay(cleanEmp._id, '2026-06-03', AttendanceStatus.PRESENT),
      makeAttDay(cleanEmp._id, '2026-06-04', AttendanceStatus.PRESENT),
      makeAttDay(cleanEmp._id, '2026-06-05', AttendanceStatus.PRESENT),
      // noisyEmp (joined Jun 2):
      // Jun 1: outside tenure! Must be excluded from presentDays and flagged
      makeAttDay(noisyEmp._id, '2026-06-01', AttendanceStatus.PRESENT),
      // Jun 2: duplicate recordCount = 2
      makeAttDay(noisyEmp._id, '2026-06-02', AttendanceStatus.PRESENT, {
        recordCount: 2,
      }),
      // Jun 3: ABSENT while approved full-day leave exists -> leave mismatch
      makeAttDay(noisyEmp._id, '2026-06-03', AttendanceStatus.ABSENT),
      // Jun 4: ON_LEAVE attendance doc with NO approved leave -> leave mismatch
      makeAttDay(noisyEmp._id, '2026-06-04', AttendanceStatus.ON_LEAVE),
      // Jun 5: PRESENT
      makeAttDay(noisyEmp._id, '2026-06-05', AttendanceStatus.PRESENT),
    ]);

    leaveRequestRepository.findOverlappingForEmployees.mockResolvedValue([
      makeLeave(noisyEmp._id, '2026-06-03', '2026-06-03'),
    ]);

    const res = await service.getPeriodAttendanceSummary(periodId, {
      anomaliesOnly: true,
    });

    // Summary reflects BOTH eligible employees, while employees array is filtered to anomaliesOnly
    expect(res.summary.totalEligibleEmployees).toBe(2);
    expect(res.summary.returnedEmployeesCount).toBe(1);
    expect(res.summary.employeesWithAnomalies).toBe(1);
    expect(res.employees).toHaveLength(1);

    const n = res.employees[0];
    expect(n.employeeCode).toBe('EMP_NOISY');
    expect(n.presentDays).toBe(2); // Jun 2 + Jun 5 (Jun 1 outside-tenure excluded)
    expect(n.anomalies.outsideTenureAttendanceDates).toEqual(['2026-06-01']);
    expect(n.anomalies.duplicateAttendanceDates).toEqual(['2026-06-02']);
    expect(n.anomalies.leaveAttendanceMismatchDates).toEqual([
      '2026-06-03',
      '2026-06-04',
    ]);
    expect(n.anomalies.warnings).toEqual(
      expect.arrayContaining([
        'DUPLICATE_ATTENDANCE_RECORD',
        'LEAVE_ATTENDANCE_MISMATCH',
        'OUTSIDE_TENURE_ATTENDANCE',
      ]),
    );
  });

  it('falls back to deductWeekends and deductHolidays when Mongoose hydrates excludedDates as empty array []', async () => {
    payrollPeriodRepository.findById.mockResolvedValue(
      makePeriod({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-08T00:00:00.000Z'),
      }),
    );

    const emp = makeEmployee({ employeeCode: 'EMP_EMPTY_EXCL' });
    employeeRepository.findForPayrollAttendanceSummary.mockResolvedValue([emp]);

    // 2026-06-06 (Sat), 2026-06-07 (Sun weekly off), 2026-06-08 (Mon global holiday)
    holidayRepository.findActiveInRange.mockResolvedValue([
      {
        _id: new Types.ObjectId(),
        name: 'June Holiday',
        date: '2026-06-08',
        year: 2026,
        type: HolidayType.PUBLIC,
        branchId: null,
        isActive: true,
        deletedAt: null,
      } as HolidayLean,
    ]);

    leaveRequestRepository.findOverlappingForEmployees.mockResolvedValue([
      makeLeave(emp._id, '2026-06-06', '2026-06-08', {
        excludedDates: [], // Mongoose schema default [] on legacy/unpopulated leave doc
        totalDays: 1,
        leaveTypeSnapshot: {
          name: 'Loss Of Pay',
          code: 'LWP',
          isPaid: false,
          allowHalfDay: true,
          deductWeekends: false,
          deductHolidays: false,
        },
      }),
    ]);

    attendanceRepository.aggregateForPayrollPeriod.mockResolvedValue([
      makeAttDay(emp._id, '2026-06-01', AttendanceStatus.PRESENT),
      makeAttDay(emp._id, '2026-06-02', AttendanceStatus.PRESENT),
      makeAttDay(emp._id, '2026-06-03', AttendanceStatus.PRESENT),
      makeAttDay(emp._id, '2026-06-04', AttendanceStatus.PRESENT),
      makeAttDay(emp._id, '2026-06-05', AttendanceStatus.PRESENT),
      makeAttDay(emp._id, '2026-06-06', AttendanceStatus.ON_LEAVE),
    ]);

    const res = await service.getPeriodAttendanceSummary(periodId);
    const e = res.employees[0];

    // Only Jun 06 (Sat) counts; Jun 07 (Sun weekly off) & Jun 08 (Holiday) are skipped via fallback
    expect(e.leaveSummary.unpaidLeaveDays).toBe(1);
    expect(e.missingDays).toBe(0);
    expect(e.anomalies.hasAnomalies).toBe(false);
  });
});
