/* eslint-disable @typescript-eslint/unbound-method */
import { ExecutionContext, HttpStatus, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AttendanceRegularizationRepository } from '../attendance/repositories/attendance-regularization.repository';
import { AttendanceRepository } from '../attendance/repositories/attendance.repository';
import { AttendanceStatus } from '../attendance/constants/attendance.constant';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { EmploymentStatus } from '../employees/constants/employee.constant';
import { EmployeeRepository } from '../employees/repositories/employee.repository';
import { HolidayRepository } from '../leaves/repositories/holiday.repository';
import { LeaveRequestRepository } from '../leaves/repositories/leave-request.repository';
import { PayrollFrequency } from '../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollSettingsRepository } from '../payroll-configuration/repositories/payroll-settings.repository';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { WeeklyOffConfigRepository } from '../work-schedules/repositories/weekly-off-config.repository';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { PayrollPeriodStatus } from './constants/payroll-period.constant';
import { PayrollAttendanceSummaryQueryDto } from './dto/payroll-attendance-summary-query.dto';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollPeriodRepository } from './repositories/payroll-period.repository';
import { PayrollAttendanceSummaryService } from './services/payroll-attendance-summary.service';
import { PayrollLeaveAttendanceResolverService } from './services/payroll-leave-attendance-resolver.service';
import { PayrollProcessingService } from '../payroll-calculations/services/payroll-processing.service';
import { PayrollPeriodsService } from './services/payroll-periods.service';

describe('Payroll Attendance Summary Integration (Controller + RBAC + Validation + Service)', () => {
  let controller: PayrollPeriodsController;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;
  let objectIdPipe: ParseObjectIdPipe;

  const periodId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const deptId = new Types.ObjectId();
  const empId = new Types.ObjectId();
  const roleId = new Types.ObjectId();

  let activePermissions: string[] = [];

  const mockPeriodRepo = {
    findById: jest.fn(),
  };

  const mockEmployeeRepo = {
    findForPayrollAttendanceSummary: jest.fn(),
  };

  const mockBranchRepo = {
    findByIds: jest.fn(),
  };

  const mockAttendanceRepo = {
    aggregateForPayrollPeriod: jest.fn(),
  };

  const mockRegularizationRepo = {
    findByIds: jest.fn(),
  };

  const mockLeaveRepo = {
    findOverlappingForEmployees: jest.fn(),
  };

  const mockHolidayRepo = {
    findActiveInRange: jest.fn(),
  };

  const mockWeeklyOffRepo = {
    findActiveEffectiveInRange: jest.fn(),
  };

  const mockAuthorizationService = {
    hasPermissions: jest.fn(
      (_roleIds: Types.ObjectId[], requiredPermissions: string[]) =>
        Promise.resolve(
          requiredPermissions.every((p) => activePermissions.includes(p)),
        ),
    ),
  };

  const createExecutionContext = (): ExecutionContext => {
    const req = {
      user: {
        userId: new Types.ObjectId(),
        sessionId: new Types.ObjectId(),
        roleIds: [roleId],
      },
    } as unknown as AuthenticatedRequest;

    return {
      getHandler: () => PayrollPeriodsController.prototype.getAttendanceSummary,
      getClass: () => PayrollPeriodsController,
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollPeriodsController],
      providers: [
        PayrollPeriodsService,
        PayrollAttendanceSummaryService,
        PayrollLeaveAttendanceResolverService,
        { provide: PayrollPeriodRepository, useValue: mockPeriodRepo },
        {
          provide: PayrollSettingsRepository,
          useValue: { findActive: jest.fn() },
        },
        {
          provide: AuditLogsService,
          useValue: { createAuditLog: jest.fn() },
        },
        { provide: EmployeeRepository, useValue: mockEmployeeRepo },
        { provide: BranchRepository, useValue: mockBranchRepo },
        { provide: AttendanceRepository, useValue: mockAttendanceRepo },
        {
          provide: AttendanceRegularizationRepository,
          useValue: mockRegularizationRepo,
        },
        { provide: LeaveRequestRepository, useValue: mockLeaveRepo },
        { provide: HolidayRepository, useValue: mockHolidayRepo },
        { provide: WeeklyOffConfigRepository, useValue: mockWeeklyOffRepo },
        {
          provide: PayrollProcessingService,
          useValue: {
            verifyPeriodCompletionReadiness: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        { provide: AuthorizationService, useValue: mockAuthorizationService },
        Reflector,
        PermissionsGuard,
      ],
    }).compile();

    controller = module.get<PayrollPeriodsController>(PayrollPeriodsController);
    guard = module.get<PermissionsGuard>(PermissionsGuard);
    objectIdPipe = new ParseObjectIdPipe();

    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          HttpStatus.BAD_REQUEST,
          mapValidationErrors(errors),
        ),
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    activePermissions = [PermissionKeys.PAYROLL_PERIODS_VIEW];
  });

  it('enforces PAYROLL_PERIODS_VIEW permission on getAttendanceSummary and rejects PAYROLL_CALCULATIONS_VIEW alone', async () => {
    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(
      true,
    );

    activePermissions = [PermissionKeys.PAYROLL_CALCULATIONS_VIEW];
    await expect(guard.canActivate(createExecutionContext())).rejects.toThrow();
  });

  it('validates periodId via ParseObjectIdPipe and query filters via ValidationPipe', () => {
    expect(() => objectIdPipe.transform('not-an-object-id')).toThrow();
    expect(objectIdPipe.transform(periodId.toHexString())).toBeInstanceOf(
      Types.ObjectId,
    );
  });

  it('rejects unknown or malformed query params cleanly while transforming valid query DTO', async () => {
    await expect(
      validationPipe.transform(
        { branchId: 'bad-id' },
        { type: 'query', metatype: PayrollAttendanceSummaryQueryDto },
      ),
    ).rejects.toThrow(AppError);

    await expect(
      validationPipe.transform(
        { page: 1 },
        { type: 'query', metatype: PayrollAttendanceSummaryQueryDto },
      ),
    ).rejects.toThrow(AppError);

    const validQuery = (await validationPipe.transform(
      { branchId: branchId.toHexString(), anomaliesOnly: 'true' },
      { type: 'query', metatype: PayrollAttendanceSummaryQueryDto },
    )) as PayrollAttendanceSummaryQueryDto;

    expect(validQuery).toEqual({
      branchId: branchId.toHexString(),
      anomaliesOnly: true,
    });
  });

  it('resolves complete period attendance summary end-to-end through controller and service', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-07-02T10:00:00.000Z'));

      mockPeriodRepo.findById.mockResolvedValue({
        _id: periodId,
        periodName: 'June 2026 Monthly',
        periodCode: 'PR-2026-06',
        payrollFrequency: PayrollFrequency.MONTHLY,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-03T00:00:00.000Z'),
        paymentDate: new Date('2026-07-01T00:00:00.000Z'),
        month: 6,
        year: 2026,
        status: PayrollPeriodStatus.FINALIZED,
        notes: null,
        deletedAt: null,
        createdBy: new Types.ObjectId(),
        updatedBy: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 1,
      });

      mockEmployeeRepo.findForPayrollAttendanceSummary.mockResolvedValue([
        {
          _id: empId,
          employeeCode: 'EMP100',
          firstName: 'Neha',
          lastName: 'Verma',
          dateOfJoining: new Date('2025-05-01T00:00:00.000Z'),
          lastWorkingDate: null,
          terminationDate: null,
          employmentStatus: EmploymentStatus.ACTIVE,
          branchId,
          departmentId: deptId,
          designationId: new Types.ObjectId(),
        },
      ]);

      mockBranchRepo.findByIds.mockResolvedValue([
        {
          _id: branchId,
          name: 'Main Branch',
          timezone: 'Asia/Kolkata',
          isActive: true,
        },
      ]);

      mockHolidayRepo.findActiveInRange.mockResolvedValue([]);
      mockWeeklyOffRepo.findActiveEffectiveInRange.mockResolvedValue([]);
      mockRegularizationRepo.findByIds.mockResolvedValue([]);
      mockLeaveRepo.findOverlappingForEmployees.mockResolvedValue([]);

      mockAttendanceRepo.aggregateForPayrollPeriod.mockResolvedValue([
        {
          employeeId: empId,
          attendanceDate: '2026-06-01',
          recordCount: 1,
          status: AttendanceStatus.PRESENT,
          statuses: [AttendanceStatus.PRESENT],
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          totalWorkMinutes: 480,
          totalBreakMinutes: 60,
          overtimeMinutes: 0,
          regularizationId: null,
          leaveRequestId: null,
        },
        {
          employeeId: empId,
          attendanceDate: '2026-06-02',
          recordCount: 1,
          status: AttendanceStatus.LATE,
          statuses: [AttendanceStatus.LATE],
          isLate: true,
          lateMinutes: 15,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          totalWorkMinutes: 465,
          totalBreakMinutes: 60,
          overtimeMinutes: 0,
          regularizationId: null,
          leaveRequestId: null,
        },
        {
          employeeId: empId,
          attendanceDate: '2026-06-03',
          recordCount: 1,
          status: AttendanceStatus.PRESENT,
          statuses: [AttendanceStatus.PRESENT],
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          totalWorkMinutes: 480,
          totalBreakMinutes: 60,
          overtimeMinutes: 0,
          regularizationId: null,
          leaveRequestId: null,
        },
      ]);

      const response = await controller.getAttendanceSummary(periodId, {});

      expect(response.success).toBe(true);
      expect(response.data.period.status).toBe(PayrollPeriodStatus.FINALIZED);
      expect(response.data.finalization.attendanceFinalized).toBe(true);
      expect(response.data.summary.totalEligibleEmployees).toBe(1);
      expect(response.data.summary.totals.totalPresentDays).toBe(3);
      expect(response.data.employees[0].presentDays).toBe(3);
      expect(response.data.employees[0].statusBreakdown.late).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
