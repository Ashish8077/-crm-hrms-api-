/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {
    EVERY_DAY_AT_8AM: '0 8 * * *',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AttendanceFinalizationService } from './attendance-finalization.service';
import { AttendanceFinalizationScheduler } from '../schedulers/attendance-finalization.scheduler';
import {
  AttendanceRepository,
  AttendanceLean,
} from '../repositories/attendance.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../../employees/repositories/employee.repository';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { ShiftService } from './shift.service';
import { ShiftLean } from '../repositories/shift.repository';
import { WeeklyOffService } from '../../work-schedules/services/weekly-off.service';
import {
  HolidayLean,
  HolidayRepository,
} from '../../leaves/repositories/holiday.repository';
import {
  LeaveRequestLean,
  LeaveRequestRepository,
} from '../../leaves/repositories/leave-request.repository';
import {
  AttendanceSource,
  AttendanceStatus,
} from '../constants/attendance.constant';
import {
  HalfDaySession,
  HolidayType,
  LeaveRequestStatus,
} from '../../leaves/constants/leaves.constant';
import { EmploymentStatus } from '../../employees/constants/employee.constant';
import { Branch } from '../../branches/schemas/branch.schema';

describe('Attendance Absence Finalization Workflow (Simplified)', () => {
  let service: AttendanceFinalizationService;
  let scheduler: AttendanceFinalizationScheduler;

  let attendanceRepo: jest.Mocked<AttendanceRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let shiftService: jest.Mocked<ShiftService>;
  let weeklyOffService: jest.Mocked<WeeklyOffService>;
  let holidayRepo: jest.Mocked<HolidayRepository>;
  let leaveRequestRepo: jest.Mocked<LeaveRequestRepository>;

  const branchId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const shiftId = new Types.ObjectId();

  const mockBranch: Branch = {
    _id: branchId,
    name: 'Bangalore Branch',
    code: 'BLR',
    companyId: new Types.ObjectId(),
    timezone: 'Asia/Kolkata',
    isActive: true,
    deletedAt: null,
  } as unknown as Branch;

  const mockEmployee: EmployeeLean = {
    _id: employeeId,
    employeeCode: 'EMP-001',
    firstName: 'John',
    lastName: 'Doe',
    employmentStatus: EmploymentStatus.ACTIVE,
    branchId,
    shiftId,
    dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  } as unknown as EmployeeLean;

  const mockDayShift: ShiftLean = {
    _id: shiftId,
    name: 'Day Shift',
    code: 'DAY',
    startTime: '09:00',
    endTime: '18:00',
    isOvernight: false,
    gracePeriodMinutes: 15,
    minWorkMinutesForFullDay: 480,
    minWorkMinutesForHalfDay: 240,
    overtimeThresholdMinutes: 480,
    isActive: true,
    isDefault: true,
  } as unknown as ShiftLean;

  const mockOvernightShift: ShiftLean = {
    _id: shiftId,
    name: 'Night Shift',
    code: 'NIGHT',
    startTime: '22:00',
    endTime: '06:00',
    isOvernight: true,
    gracePeriodMinutes: 15,
    minWorkMinutesForFullDay: 480,
    minWorkMinutesForHalfDay: 240,
    overtimeThresholdMinutes: 480,
    isActive: true,
    isDefault: false,
  } as unknown as ShiftLean;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceFinalizationService,
        AttendanceFinalizationScheduler,
        {
          provide: AttendanceRepository,
          useValue: {
            findByEmployeeAndDate: jest.fn().mockResolvedValue(null),
            createAbsentRecord: jest.fn().mockResolvedValue({
              created: true,
              attendance: { _id: new Types.ObjectId() } as AttendanceLean,
            }),
            isDuplicateKeyError: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: EmployeeRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(mockEmployee),
            findEligibleForFinalization: jest
              .fn()
              .mockResolvedValue([mockEmployee]),
          },
        },
        {
          provide: BranchRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(mockBranch),
          },
        },
        {
          provide: ShiftService,
          useValue: {
            resolveShift: jest.fn().mockResolvedValue(mockDayShift),
          },
        },
        {
          provide: WeeklyOffService,
          useValue: {
            isWeeklyOff: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: HolidayRepository,
          useValue: {
            findApplicableHolidays: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: LeaveRequestRepository,
          useValue: {
            findOverlappingRequests: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<AttendanceFinalizationService>(
      AttendanceFinalizationService,
    );
    scheduler = module.get<AttendanceFinalizationScheduler>(
      AttendanceFinalizationScheduler,
    );
    attendanceRepo = module.get(AttendanceRepository);
    employeeRepo = module.get(EmployeeRepository);
    branchRepo = module.get(BranchRepository);
    shiftService = module.get(ShiftService);
    weeklyOffService = module.get(WeeklyOffService);
    holidayRepo = module.get(HolidayRepository);
    leaveRequestRepo = module.get(LeaveRequestRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('TC-AF-01A: Rejects/skips finalization before scheduled shift end plus grace period (Standard Daytime Shift)', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-15T12:00:00.000Z')); // 17:30 IST

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.shiftNotEndedCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);
      expect(attendanceRepo.createAbsentRecord).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-01B: Successfully creates ABSENT record after scheduled shift end plus grace period (Standard Daytime Shift)', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-15T13:00:00.000Z')); // 18:30 IST

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.shiftNotEndedCount).toBe(0);
      expect(metrics.absentCreatedCount).toBe(1);
      expect(attendanceRepo.createAbsentRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId,
          attendanceDate: '2026-10-15',
          status: AttendanceStatus.ABSENT,
          checkInSource: AttendanceSource.SYSTEM,
          totalWorkMinutes: 0,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-02A: Skips overnight shift during midnight hours while shift is still active', async () => {
    jest.useFakeTimers();
    try {
      shiftService.resolveShift.mockResolvedValue(mockOvernightShift);
      jest.setSystemTime(new Date('2026-10-15T19:30:00.000Z')); // Oct 16 01:00 IST

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.shiftNotEndedCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);
      expect(attendanceRepo.createAbsentRecord).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-02B: Finalizes overnight shift after morning cutoff (06:15 IST) elapses', async () => {
    jest.useFakeTimers();
    try {
      shiftService.resolveShift.mockResolvedValue(mockOvernightShift);
      jest.setSystemTime(new Date('2026-10-16T01:30:00.000Z')); // Oct 16 07:00 IST

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.shiftNotEndedCount).toBe(0);
      expect(metrics.absentCreatedCount).toBe(1);
      expect(attendanceRepo.createAbsentRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          attendanceDate: '2026-10-15',
          status: AttendanceStatus.ABSENT,
          shiftSnapshot: expect.objectContaining({
            isOvernight: true,
            startTime: '22:00',
            endTime: '06:00',
          }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-03: Respects branch-specific timezone rather than server UTC time', async () => {
    jest.useFakeTimers();
    try {
      const usBranchId = new Types.ObjectId();
      const usBranch = {
        _id: usBranchId,
        name: 'New York Office',
        code: 'NYC',
        timezone: 'America/New_York',
        isActive: true,
        deletedAt: null,
      } as unknown as Branch;

      const usEmployee: EmployeeLean = {
        ...mockEmployee,
        branchId: usBranchId,
      };

      branchRepo.findById.mockResolvedValue(usBranch);
      employeeRepo.findById.mockResolvedValue(usEmployee);

      // At 21:00 UTC (17:00 EDT), New York office shift has NOT ended yet
      jest.setSystemTime(new Date('2026-10-15T21:00:00.000Z'));

      let metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.shiftNotEndedCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);

      // At 23:00 UTC (19:00 EDT), shift cutoff (18:15 EDT) has passed
      jest.setSystemTime(new Date('2026-10-15T23:00:00.000Z'));

      metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.shiftNotEndedCount).toBe(0);
      expect(metrics.absentCreatedCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-04: Never overwrites an existing attendance record (CHECKED_IN, PRESENT, ON_LEAVE, REGULARIZED)', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-15T14:00:00.000Z'));

      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        _id: new Types.ObjectId(),
        employeeId,
        attendanceDate: '2026-10-15',
        status: AttendanceStatus.CHECKED_IN,
      } as AttendanceLean);

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.alreadyRecordedCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);
      expect(attendanceRepo.createAbsentRecord).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-05: Excludes approved full-day leave from absence marking', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-15T14:00:00.000Z'));

      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          employeeId,
          status: LeaveRequestStatus.APPROVED,
          isHalfDay: false,
          startDate: '2026-10-15',
          endDate: '2026-10-15',
        } as unknown as LeaveRequestLean,
      ]);

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.excludedLeaveCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);
      expect(attendanceRepo.createAbsentRecord).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-06: Never marks an approved half-day leave as a full-day absence', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-15T14:00:00.000Z'));

      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          employeeId,
          status: LeaveRequestStatus.APPROVED,
          isHalfDay: true,
          halfDaySession: HalfDaySession.FIRST_HALF,
          startDate: '2026-10-15',
          endDate: '2026-10-15',
        } as unknown as LeaveRequestLean,
      ]);

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.excludedLeaveCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);
      expect(attendanceRepo.createAbsentRecord).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-07: Excludes configured weekly offs from absence marking', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-18T14:00:00.000Z'));

      weeklyOffService.isWeeklyOff.mockResolvedValue(true);

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-18',
        employeeId,
      });

      expect(metrics.excludedWeeklyOffCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);
      expect(attendanceRepo.createAbsentRecord).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-08: Excludes both mandatory and optional holidays when no employee opt-out mechanism exists', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-02T14:00:00.000Z'));

      // Test 1: Mandatory PUBLIC holiday (Gandhi Jayanti) -> excluded from absence marking
      holidayRepo.findApplicableHolidays.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          name: 'Gandhi Jayanti',
          type: HolidayType.PUBLIC,
          isActive: true,
          deletedAt: null,
          startDate: '2026-10-02',
          endDate: '2026-10-02',
        } as unknown as HolidayLean,
      ]);

      let metrics = await service.finalizeAbsences({
        targetDate: '2026-10-02',
        employeeId,
      });

      expect(metrics.excludedHolidayCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);
      expect(attendanceRepo.createAbsentRecord).not.toHaveBeenCalled();

      // Test 2: OPTIONAL holiday -> safely skipped without marking ABSENT because no employee opt-in/opt-out exists
      holidayRepo.findApplicableHolidays.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          name: 'Optional Cultural Festival',
          type: HolidayType.OPTIONAL,
          isActive: true,
          deletedAt: null,
          startDate: '2026-10-05',
          endDate: '2026-10-05',
        } as unknown as HolidayLean,
      ]);

      jest.setSystemTime(new Date('2026-10-05T14:00:00.000Z'));

      metrics = await service.finalizeAbsences({
        targetDate: '2026-10-05',
        employeeId,
      });

      expect(metrics.excludedHolidayCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);
      expect(attendanceRepo.createAbsentRecord).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-09: Excludes dates before dateOfJoining and after authoritative effective end date', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-11-15T14:00:00.000Z'));

      const tenuredEmployee = {
        ...mockEmployee,
        dateOfJoining: new Date('2026-06-01T00:00:00.000Z'),
        lastWorkingDate: new Date('2026-10-31T12:00:00.000Z'),
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      } as unknown as EmployeeLean;

      employeeRepo.findById.mockResolvedValue(tenuredEmployee);

      let metrics = await service.finalizeAbsences({
        targetDate: '2026-05-15',
        employeeId,
      });
      expect(metrics.excludedTenureCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);

      metrics = await service.finalizeAbsences({
        targetDate: '2026-11-05',
        employeeId,
      });
      expect(metrics.excludedTenureCount).toBe(1);
      expect(metrics.absentCreatedCount).toBe(0);

      metrics = await service.finalizeAbsences({
        targetDate: '2026-08-15',
        employeeId,
      });
      expect(metrics.excludedTenureCount).toBe(0);
      expect(metrics.absentCreatedCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-10: Handles duplicate-key races safely via atomic createAbsentRecord without throwing', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-15T14:00:00.000Z'));

      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.createAbsentRecord.mockResolvedValue({ created: false });

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
        employeeId,
      });

      expect(metrics.absentCreatedCount).toBe(0);
      expect(metrics.alreadyRecordedCount).toBe(1);
      expect(metrics.errorCount).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-11: Employee failure does not abort processing of remaining employees in the batch', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-15T14:00:00.000Z'));

      const shift2Id = new Types.ObjectId();
      const emp1: EmployeeLean = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        employeeCode: 'EMP-1',
      };
      const emp2: EmployeeLean = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        shiftId: shift2Id,
        employeeCode: 'EMP-2',
      };
      const emp3: EmployeeLean = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        employeeCode: 'EMP-3',
      };

      employeeRepo.findEligibleForFinalization.mockResolvedValue([
        emp1,
        emp2,
        emp3,
      ]);

      shiftService.resolveShift.mockImplementation((sId) => {
        if (sId?.toString() === shift2Id.toString()) {
          throw new Error('Database timeout resolving shift');
        }
        return Promise.resolve(mockDayShift);
      });

      const metrics = await service.finalizeAbsences({
        targetDate: '2026-10-15',
      });

      expect(metrics.totalEmployeesEvaluated).toBe(3);
      expect(metrics.errorCount).toBe(1);
      expect(metrics.errors[0].employeeId).toBe(emp2._id.toString());
      expect(metrics.absentCreatedCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('TC-AF-12: Daily scheduler triggers finalizeAbsences on schedule', async () => {
    const finalizeSpy = jest
      .spyOn(service, 'finalizeAbsences')
      .mockResolvedValue({
        totalEmployeesEvaluated: 50,
        absentCreatedCount: 5,
        alreadyRecordedCount: 45,
        excludedLeaveCount: 0,
        excludedWeeklyOffCount: 0,
        excludedHolidayCount: 0,
        excludedTenureCount: 0,
        shiftNotEndedCount: 0,
        errorCount: 0,
        errors: [],
        durationMs: 25,
        evaluatedDates: ['2026-10-14', '2026-10-15'],
      });

    await scheduler.handleDailyAbsenceFinalization();

    expect(finalizeSpy).toHaveBeenCalledTimes(1);
  });

  it('TC-AF-13: Scheduler safely catches and logs errors without throwing unhandled exceptions', async () => {
    jest
      .spyOn(service, 'finalizeAbsences')
      .mockRejectedValue(new Error('Unexpected database disconnection'));

    const loggerErrorSpy = jest
      .spyOn(
        (scheduler as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => {});

    await expect(
      scheduler.handleDailyAbsenceFinalization(),
    ).resolves.not.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unexpected database disconnection'),
      expect.anything(),
    );
  });
});
