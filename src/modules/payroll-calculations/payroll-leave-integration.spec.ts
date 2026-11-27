/* eslint-disable @typescript-eslint/require-await */
import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import {
  AttendanceStatus,
  RegularizationStatus,
} from '../attendance/constants/attendance.constant';
import { AttendanceRegularizationRepository } from '../attendance/repositories/attendance-regularization.repository';
import {
  AttendanceRepository,
  PayrollAttendanceBucket,
} from '../attendance/repositories/attendance.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { EmployeeSalaryStatus } from '../employee-salaries/constants/employee-salary.constant';
import { EmployeeSalaryRepository } from '../employee-salaries/repositories/employee-salary.repository';
import { EmployeeSalaryLean } from '../employee-salaries/schemas/employee-salary.schema';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import { EmployeeLean } from '../employees/repositories/employee.repository';
import { Employee } from '../employees/schemas/employee.schema';
import {
  HalfDaySession,
  LeaveRequestStatus,
} from '../leaves/constants/leaves.constant';
import { HolidayRepository } from '../leaves/repositories/holiday.repository';
import {
  LeaveRequestLean,
  LeaveRequestRepository,
} from '../leaves/repositories/leave-request.repository';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollCalculationRuleRepository } from '../payroll-configuration/repositories/payroll-calculation-rule.repository';
import { PayrollSettingsRepository } from '../payroll-configuration/repositories/payroll-settings.repository';
import { PayrollPeriodStatus } from '../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodRepository } from '../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../payroll-periods/schemas/payroll-period.schema';
import { PayrollLeaveAttendanceResolverService } from '../payroll-periods/services/payroll-leave-attendance-resolver.service';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  SalaryComponent,
  SalaryComponentLean,
} from '../salary-components/schemas/salary-component.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../salary-structures/constants/salary-structure.constant';
import { SalaryStructureRepository } from '../salary-structures/repositories/salary-structure.repository';
import { SalaryStructureLean } from '../salary-structures/schemas/salary-structure.schema';
import { SalaryStructureCalculationService } from '../salary-structures/services/salary-structure-calculation.service';
import { WeeklyOffConfigRepository } from '../work-schedules/repositories/weekly-off-config.repository';
import { PayrollRecordStatus } from './constants/payroll-calculation.constant';
import {
  CalculateEmployeePayrollDto,
  CalculatePayrollPreviewInputDto,
} from './dto/calculate-employee-payroll.dto';
import { PayrollCalculationsController } from './payroll-calculations.controller';
import { PayrollRecordRepository } from './repositories/payroll-record.repository';
import { PayrollRecordLean } from './schemas/payroll-record.schema';
import { ComponentCalculationEngine } from './services/component-calculation.engine';
import { ComponentDependencyResolver } from './services/component-dependency.resolver';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { PayrollInputResolver } from './services/payroll-input.resolver';
import { PayrollSnapshotBuilder } from './services/payroll-snapshot.builder';
import { PayrollTotalsCalculator } from './services/payroll-totals.calculator';
import { ProrationCalculator } from './services/proration.calculator';
import { SalaryComponentResolver } from './services/salary-component.resolver';

class InMemoryPayrollRecordRepo {
  store = new Map<string, PayrollRecordLean>();

  clear() {
    this.store.clear();
  }

  isDuplicateKeyError(err: unknown) {
    return err instanceof Error && err.message.includes('E11000');
  }

  async findByPeriodAndEmployee(
    payrollPeriodId: Types.ObjectId,
    employeeId: Types.ObjectId,
  ): Promise<PayrollRecordLean | null> {
    for (const rec of this.store.values()) {
      if (
        rec.deletedAt === null &&
        rec.payrollPeriodId.equals(payrollPeriodId) &&
        rec.employeeId.equals(employeeId)
      ) {
        return { ...rec };
      }
    }
    return null;
  }

  async create(input: Record<string, unknown>): Promise<PayrollRecordLean> {
    const _id = new Types.ObjectId();
    const doc = {
      _id,
      ...input,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    } as unknown as PayrollRecordLean;
    this.store.set(_id.toHexString(), doc);
    return { ...doc };
  }

  async recalculateAtomically(
    id: Types.ObjectId,
    expectedVersion: number,
    input: Record<string, unknown>,
  ): Promise<PayrollRecordLean | null> {
    const existing = this.store.get(id.toHexString());
    if (
      !existing ||
      existing.deletedAt !== null ||
      existing.status !== PayrollRecordStatus.CALCULATED ||
      existing.__v !== expectedVersion
    ) {
      return null;
    }
    const updated = {
      ...existing,
      ...input,
      calculationVersion: existing.calculationVersion + 1,
      updatedAt: new Date(),
      __v: existing.__v + 1,
    } as unknown as PayrollRecordLean;
    this.store.set(id.toHexString(), updated);
    return { ...updated };
  }
}

describe('Payroll Leave & Attendance LOP Integration (Step 4.2 Comprehensive Suite)', () => {
  let controller: PayrollCalculationsController;
  let calculationService: PayrollCalculationService;
  let inputResolver: PayrollInputResolver;
  let recordRepo: InMemoryPayrollRecordRepo;
  let validationPipe: ValidationPipe;

  const actorId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const paidLeaveTypeId = new Types.ObjectId();
  const unpaidLeaveTypeId = new Types.ObjectId();
  const sandwichUnpaidLeaveTypeId = new Types.ObjectId();

  let periods: Map<string, PayrollPeriodLean>;
  let employees: Map<string, EmployeeLean>;
  let assignments: EmployeeSalaryLean[];
  let structures: Map<string, SalaryStructureLean>;
  let components: Map<string, SalaryComponentLean>;
  let branches: Array<{ _id: Types.ObjectId; timezone: string }>;
  let holidays: Array<{ date: string; branchId: Types.ObjectId | null }>;
  let weeklyOffConfigs: Array<{
    branchId: Types.ObjectId | null;
    days: Array<{ dayOfWeek: number; occurrences: number[] }>;
    effectiveFrom: string;
    effectiveTo: string | null;
    isActive: boolean;
  }>;
  let attendanceBuckets: PayrollAttendanceBucket[];
  let leaves: LeaveRequestLean[];
  let regularizations: Array<{
    _id: Types.ObjectId;
    employeeId: Types.ObjectId;
    attendanceDate: string;
    status: RegularizationStatus;
  }>;
  let settingsDoc: Record<string, unknown>;
  let rulesDoc: Record<string, unknown>;

  let periodId: Types.ObjectId;
  let employeeId: Types.ObjectId;
  let structureId: Types.ObjectId;
  let basicId: Types.ObjectId;
  let hraId: Types.ObjectId;

  const makeReq = (): AuthenticatedRequest =>
    ({
      user: {
        userId: actorId,
        sessionId: new Types.ObjectId(),
        roleIds: [new Types.ObjectId()],
      },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Step4.2-Spec' },
    }) as unknown as AuthenticatedRequest;

  const validateBody = async <T>(
    metatype: new () => T,
    body: Record<string, unknown>,
  ): Promise<T> =>
    (await validationPipe.transform(body, {
      type: 'body',
      metatype,
    })) as T;

  const addLeave = (
    opts: Partial<LeaveRequestLean> & {
      startDate: string;
      endDate: string;
      isPaid?: boolean;
      status?: LeaveRequestStatus;
      isHalfDay?: boolean;
      halfDaySession?: HalfDaySession | null;
      deductWeekends?: boolean;
      deductHolidays?: boolean;
      excludedDates?: string[];
      empId?: Types.ObjectId;
    },
  ): LeaveRequestLean => {
    const isPaid = opts.isPaid ?? false;
    const deductWeekends = opts.deductWeekends ?? false;
    const doc = {
      _id: new Types.ObjectId(),
      employeeId: opts.empId ?? employeeId,
      leaveTypeId: isPaid
        ? paidLeaveTypeId
        : deductWeekends
          ? sandwichUnpaidLeaveTypeId
          : unpaidLeaveTypeId,
      leaveTypeSnapshot: {
        name: isPaid ? 'Casual Leave' : 'Loss of Pay',
        code: isPaid ? 'CL' : 'LWP',
        isPaid,
        allowHalfDay: true,
        deductWeekends,
        deductHolidays: opts.deductHolidays ?? false,
      },
      startDate: opts.startDate,
      endDate: opts.endDate,
      totalDays: opts.totalDays ?? (opts.isHalfDay ? 0.5 : 1),
      isHalfDay: opts.isHalfDay ?? false,
      halfDaySession: opts.halfDaySession ?? null,
      excludedDates: opts.excludedDates ?? [],
      status: opts.status ?? LeaveRequestStatus.APPROVED,
    } as unknown as LeaveRequestLean;
    leaves.push(doc);
    return doc;
  };

  const addAttendance = (
    attendanceDate: string,
    status: AttendanceStatus,
    opts: {
      empId?: Types.ObjectId;
      regularizationId?: Types.ObjectId | null;
      recordCount?: number;
    } = {},
  ) => {
    attendanceBuckets.push({
      employeeId: opts.empId ?? employeeId,
      attendanceDate,
      recordCount: opts.recordCount ?? 1,
      status,
      statuses: [status],
      isLate: status === AttendanceStatus.LATE,
      lateMinutes: 0,
      isEarlyDeparture: false,
      earlyDepartureMinutes: 0,
      totalWorkMinutes: status === AttendanceStatus.ABSENT ? 0 : 480,
      totalBreakMinutes: 0,
      overtimeMinutes: 0,
      regularizationId: opts.regularizationId ?? null,
      leaveRequestId: null,
    });
  };

  beforeAll(async () => {
    recordRepo = new InMemoryPayrollRecordRepo();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollCalculationsController],
      providers: [
        PayrollCalculationService,
        PayrollInputResolver,
        PayrollLeaveAttendanceResolverService,
        SalaryComponentResolver,
        ComponentDependencyResolver,
        ComponentCalculationEngine,
        ProrationCalculator,
        PayrollTotalsCalculator,
        PayrollSnapshotBuilder,
        SalaryStructureCalculationService,
        { provide: PayrollRecordRepository, useValue: recordRepo },
        {
          provide: PayrollPeriodRepository,
          useValue: {
            findById: jest.fn((id: Types.ObjectId) =>
              Promise.resolve(periods.get(id.toHexString()) ?? null),
            ),
            verifyPeriodMutableAndBumpVersion: jest.fn(
              (
                id: Types.ObjectId,
                allowed: ReadonlyArray<PayrollPeriodStatus>,
              ) => {
                const p = periods.get(id.toHexString());
                if (!p || p.deletedAt !== null || !allowed.includes(p.status)) {
                  return Promise.resolve(false);
                }
                p.__v = (p.__v ?? 0) + 1;
                return Promise.resolve(true);
              },
            ),
          },
        },
        {
          provide: getModelToken(Employee.name),
          useValue: {
            findById: jest.fn((id: Types.ObjectId) => ({
              lean: () => ({
                exec: () =>
                  Promise.resolve(employees.get(id.toHexString()) ?? null),
              }),
            })),
            find: jest.fn(() => {
              const queryChain = {
                select: () => queryChain,
                sort: () => ({
                  lean: () => ({
                    exec: () => Promise.resolve(Array.from(employees.values())),
                  }),
                }),
              };
              return queryChain;
            }),
          },
        },
        {
          provide: EmployeeSalaryRepository,
          useValue: {
            findAllByEmployeeId: jest.fn((empId: Types.ObjectId) =>
              Promise.resolve(
                assignments.filter((a) => a.employeeId.equals(empId)),
              ),
            ),
            findAllByEmployeeIds: jest.fn((empIds: Types.ObjectId[]) =>
              Promise.resolve(
                assignments.filter((a) =>
                  empIds.some((id) => id.equals(a.employeeId)),
                ),
              ),
            ),
          },
        },
        {
          provide: SalaryStructureRepository,
          useValue: {
            findById: jest.fn((id: Types.ObjectId) =>
              Promise.resolve(structures.get(id.toHexString()) ?? null),
            ),
            findByIds: jest.fn((ids: Types.ObjectId[]) =>
              Promise.resolve(
                ids
                  .map((id) => structures.get(id.toHexString()))
                  .filter(Boolean),
              ),
            ),
          },
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: {
            find: jest.fn((q: { _id?: { $in?: Types.ObjectId[] } }) => ({
              lean: () => ({
                exec: () =>
                  Promise.resolve(
                    (q._id?.$in ?? [])
                      .map((id) => components.get(id.toHexString()))
                      .filter(Boolean),
                  ),
              }),
            })),
          },
        },
        {
          provide: PayrollSettingsRepository,
          useValue: { findActive: jest.fn(() => Promise.resolve(settingsDoc)) },
        },
        {
          provide: PayrollCalculationRuleRepository,
          useValue: { findActive: jest.fn(() => Promise.resolve(rulesDoc)) },
        },
        {
          provide: BranchRepository,
          useValue: { findByIds: jest.fn(() => Promise.resolve(branches)) },
        },
        {
          provide: HolidayRepository,
          useValue: {
            findActiveInRange: jest.fn(() => Promise.resolve(holidays)),
          },
        },
        {
          provide: WeeklyOffConfigRepository,
          useValue: {
            findActiveEffectiveInRange: jest.fn(() =>
              Promise.resolve(weeklyOffConfigs),
            ),
          },
        },
        {
          provide: AttendanceRepository,
          useValue: {
            aggregateForPayrollPeriod: jest.fn(
              (empIds: Types.ObjectId[], startDate: string, endDate: string) =>
                Promise.resolve(
                  attendanceBuckets.filter(
                    (b) =>
                      empIds.some((id) => id.equals(b.employeeId)) &&
                      b.attendanceDate >= startDate &&
                      b.attendanceDate <= endDate,
                  ),
                ),
            ),
          },
        },
        {
          provide: AttendanceRegularizationRepository,
          useValue: {
            findByIds: jest.fn((ids: Types.ObjectId[]) =>
              Promise.resolve(
                regularizations.filter((r) =>
                  ids.some((id) => id.equals(r._id)),
                ),
              ),
            ),
          },
        },
        {
          provide: LeaveRequestRepository,
          useValue: {
            findOverlappingForEmployees: jest.fn(
              (
                empIds: Types.ObjectId[],
                startDate: string,
                endDate: string,
                statuses: LeaveRequestStatus[],
              ) =>
                Promise.resolve(
                  leaves.filter(
                    (l) =>
                      empIds.some((id) => id.equals(l.employeeId)) &&
                      statuses.includes(l.status) &&
                      l.startDate <= endDate &&
                      l.endDate >= startDate,
                  ),
                ),
            ),
          },
        },
        {
          provide: AuditLogsService,
          useValue: { createAuditLog: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: getConnectionToken(),
          useValue: {
            startSession: jest.fn().mockResolvedValue({
              withTransaction: jest.fn(async (cb: (s: unknown) => unknown) =>
                cb({}),
              ),
              endSession: jest.fn().mockResolvedValue(undefined),
            }),
          },
        },
        {
          provide: AuthorizationService,
          useValue: { hasPermissions: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
        PermissionsGuard,
      ],
    }).compile();

    controller = module.get(PayrollCalculationsController);
    calculationService = module.get(PayrollCalculationService);
    inputResolver = module.get(PayrollInputResolver);
    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Validation failed',
          HttpStatus.BAD_REQUEST,
          mapValidationErrors(errors),
        ),
    });
  });

  beforeEach(() => {
    recordRepo.clear();
    periods = new Map();
    employees = new Map();
    assignments = [];
    structures = new Map();
    components = new Map();
    branches = [{ _id: branchId, timezone: 'Asia/Kolkata' }];
    holidays = [];
    // Standard Mon-Fri working week (Sat = 6, Sun = 0 weekly off) -> April 2026 has 22 working days & 8 weekly offs
    weeklyOffConfigs = [
      {
        branchId,
        days: [
          { dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] },
          { dayOfWeek: 6, occurrences: [1, 2, 3, 4, 5] },
        ],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      },
    ];
    attendanceBuckets = [];
    leaves = [];
    regularizations = [];

    settingsDoc = {
      _id: new Types.ObjectId(),
      currency: 'INR',
      fixedWorkingDaysPerMonth: 22,
      __v: 0,
    };
    rulesDoc = {
      _id: new Types.ObjectId(),
      roundingMode: PayrollRoundingMode.HALF_EVEN,
      roundingPrecision: 2,
      prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
      prorateFixedComponents: true,
      prorateDeductions: false,
      prorateEmployerContributions: false,
      negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
      componentExecutionOrder: [],
      __v: 0,
    };

    periodId = new Types.ObjectId();
    periods.set(periodId.toHexString(), {
      _id: periodId,
      periodName: 'April 2026',
      periodCode: 'PR-2026-04',
      payrollFrequency: PayrollFrequency.MONTHLY,
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-04-30T00:00:00.000Z'),
      paymentDate: new Date('2026-05-01T00:00:00.000Z'),
      month: 4,
      year: 2026,
      status: PayrollPeriodStatus.PROCESSING,
      notes: null,
      deletedAt: null,
      __v: 0,
    } as unknown as PayrollPeriodLean);

    employeeId = new Types.ObjectId();
    employees.set(employeeId.toHexString(), {
      _id: employeeId,
      employeeCode: 'EMP-100',
      firstName: 'Anita',
      lastName: 'Rao',
      branchId,
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
      deletedAt: null,
    } as unknown as EmployeeLean);

    basicId = new Types.ObjectId();
    hraId = new Types.ObjectId();
    components.set(basicId.toHexString(), {
      _id: basicId,
      code: 'BASIC',
      name: 'Basic Pay',
      type: SalaryComponentType.EARNING,
      isActive: true,
    } as unknown as SalaryComponentLean);
    components.set(hraId.toHexString(), {
      _id: hraId,
      code: 'HRA',
      name: 'HRA',
      type: SalaryComponentType.EARNING,
      isActive: true,
    } as unknown as SalaryComponentLean);

    // 30,000 monthly gross (Basic 20,000 + HRA 10,000) -> Rs 1,000/day in 30-day April
    structureId = new Types.ObjectId();
    structures.set(structureId.toHexString(), {
      _id: structureId,
      code: 'STD_30K',
      name: 'Standard 30K',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 30000,
      isActive: true,
      __v: 1,
      components: [
        {
          componentId: basicId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 20000,
          percentage: null,
          percentageOf: null,
        },
        {
          componentId: hraId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 50,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
      ],
    } as unknown as SalaryStructureLean);

    assignments.push({
      _id: new Types.ObjectId(),
      employeeId,
      salaryStructureId: structureId,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 30000,
      salaryStructureVersion: 1,
      salarySnapshot: {} as EmployeeSalaryLean['salarySnapshot'],
      status: EmployeeSalaryStatus.ACTIVE,
      __v: 0,
    } as unknown as EmployeeSalaryLean);
  });

  it('full attendance with zero leaves yields 30 payable days and 100% salary', async () => {
    addAttendance('2026-04-01', AttendanceStatus.PRESENT);
    addAttendance('2026-04-02', AttendanceStatus.LATE);

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.calendarDays).toBe(30);
    expect(res.snapshot.eligibleWorkingDays).toBe(22);
    expect(res.snapshot.weeklyOffDays).toBe(8);
    expect(res.snapshot.totalLopDays).toBe(0);
    expect(res.snapshot.payableDays).toBe(30);
    expect(res.snapshot.grossEarnings).toBe('30000.00');
  });

  it('approved paid leaves produce zero LOP and preserve full pay', async () => {
    addLeave({ startDate: '2026-04-06', endDate: '2026-04-08', isPaid: true });
    addAttendance('2026-04-06', AttendanceStatus.ON_LEAVE);
    addAttendance('2026-04-07', AttendanceStatus.ON_LEAVE);
    addAttendance('2026-04-08', AttendanceStatus.ON_LEAVE);

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.paidLeaveDays).toBe(3);
    expect(res.snapshot.unpaidLeaveDays).toBe(0);
    expect(res.snapshot.totalLopDays).toBe(0);
    expect(res.snapshot.payableDays).toBe(30);
    expect(res.snapshot.grossEarnings).toBe('30000.00');
  });

  it('approved unpaid leaves reduce payable days cleanly without altering leave balance/status', async () => {
    addLeave({ startDate: '2026-04-06', endDate: '2026-04-08', isPaid: false });
    addAttendance('2026-04-06', AttendanceStatus.ON_LEAVE);
    addAttendance('2026-04-07', AttendanceStatus.ON_LEAVE);
    addAttendance('2026-04-08', AttendanceStatus.ON_LEAVE);

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.unpaidLeaveDays).toBe(3);
    expect(res.snapshot.unpaidLeaveLopDays).toBe(3);
    expect(res.snapshot.totalLopDays).toBe(3);
    expect(res.snapshot.payableDays).toBe(27);
    expect(res.snapshot.grossEarnings).toBe('27000.00');
  });

  it('handles half-day unpaid leave, half-day paid leave, and half-day unexcused attendance accurately', async () => {
    // 1) Half-day paid CL paired with HALF_DAY attendance -> 0 LOP
    addLeave({
      startDate: '2026-04-01',
      endDate: '2026-04-01',
      isPaid: true,
      isHalfDay: true,
    });
    addAttendance('2026-04-01', AttendanceStatus.HALF_DAY);

    // 2) Half-day unpaid LWP paired with HALF_DAY worked -> 0.5 LOP
    addLeave({
      startDate: '2026-04-02',
      endDate: '2026-04-02',
      isPaid: false,
      isHalfDay: true,
    });
    addAttendance('2026-04-02', AttendanceStatus.HALF_DAY);

    // 3) Unexcused HALF_DAY attendance (no leave) -> 0.5 LOP
    addAttendance('2026-04-03', AttendanceStatus.HALF_DAY);

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.paidLeaveDays).toBe(0.5);
    expect(res.snapshot.unpaidLeaveDays).toBe(0.5);
    expect(res.snapshot.halfDayDeductions).toBe(0.5);
    expect(res.snapshot.totalLopDays).toBe(1);
    expect(res.snapshot.payableDays).toBe(29);
    expect(res.snapshot.grossEarnings).toBe('29000.00');
  });

  it('never double-deducts when ABSENT attendance coincides with approved Unpaid Leave or Paid Leave on the same date', async () => {
    // Apr 06: Approved Unpaid Leave + ABSENT attendance -> LOP must be 1 (NEVER 2)
    addLeave({ startDate: '2026-04-06', endDate: '2026-04-06', isPaid: false });
    addAttendance('2026-04-06', AttendanceStatus.ABSENT);

    // Apr 07: Approved Paid Leave + ABSENT attendance -> Paid leave wins (0 LOP), anomaly flagged
    addLeave({ startDate: '2026-04-07', endDate: '2026-04-07', isPaid: true });
    addAttendance('2026-04-07', AttendanceStatus.ABSENT);

    // Apr 08: Half-day Paid Leave + ABSENT attendance -> 0.5 LOP (paid half protected, absent half deducted)
    addLeave({
      startDate: '2026-04-08',
      endDate: '2026-04-08',
      isPaid: true,
      isHalfDay: true,
    });
    addAttendance('2026-04-08', AttendanceStatus.ABSENT);

    // Apr 09: Half-day Unpaid Leave + ABSENT attendance -> 0.5 + 0.5 = 1.0 LOP (NEVER 1.5)
    addLeave({
      startDate: '2026-04-09',
      endDate: '2026-04-09',
      isPaid: false,
      isHalfDay: true,
    });
    addAttendance('2026-04-09', AttendanceStatus.ABSENT);

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.paidLeaveDays).toBe(1.5);
    expect(res.snapshot.unpaidLeaveLopDays).toBe(1.5);
    expect(res.snapshot.attendanceAbsenceLopDays).toBe(1); // 0.5 on Apr 08 + 0.5 on Apr 09
    expect(res.snapshot.totalLopDays).toBe(2.5);
    expect(res.snapshot.payableDays).toBe(27.5);
    expect(res.snapshot.grossEarnings).toBe('27500.00');
    expect(res.snapshot.attendanceLeaveWarnings).toContain(
      'LEAVE_ATTENDANCE_MISMATCH',
    );
    expect(res.snapshot.leaveAttendanceMismatchDates).toEqual(
      expect.arrayContaining([
        '2026-04-06',
        '2026-04-07',
        '2026-04-08',
        '2026-04-09',
      ]),
    );
  });

  it('excludes PENDING, REJECTED, and CANCELLED leaves while keeping CANCELLATION_REQUESTED active with warning', async () => {
    addLeave({
      startDate: '2026-04-01',
      endDate: '2026-04-02',
      isPaid: false,
      status: LeaveRequestStatus.PENDING,
    });
    addLeave({
      startDate: '2026-04-03',
      endDate: '2026-04-03',
      isPaid: false,
      status: LeaveRequestStatus.REJECTED,
    });
    addLeave({
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      isPaid: false,
      status: LeaveRequestStatus.CANCELLED,
    });
    addLeave({
      startDate: '2026-04-07',
      endDate: '2026-04-08',
      isPaid: false,
      status: LeaveRequestStatus.CANCELLATION_REQUESTED,
    });

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.unpaidLeaveDays).toBe(2);
    expect(res.snapshot.pendingCancellationLeaveDays).toBe(2);
    expect(res.snapshot.totalLopDays).toBe(2);
    expect(res.snapshot.payableDays).toBe(28);
    expect(res.snapshot.attendanceLeaveWarnings).toContain(
      'PENDING_LEAVE_CANCELLATION_RECONCILIATION',
    );
  });

  it('clips multi-month leaves to period boundary and excludes holidays/weekly offs unless sandwich enabled', async () => {
    // Public holiday on Wed 2026-04-01
    holidays.push({ date: '2026-04-01', branchId: null });

    // Multi-month unpaid leave Mar 30 - Apr 06:
    // Mar 30, 31 = outside period (ignored)
    // Apr 01 = holiday (excluded because deductHolidays=false)
    // Apr 02, 03 = Mon-Fri working days (2 days LOP)
    // Apr 04, 05 = Sat/Sun weekly off (excluded because deductWeekends=false)
    // Apr 06 = Monday working day (1 day LOP)
    // Total inside April = 3 LOP days
    addLeave({
      startDate: '2026-03-30',
      endDate: '2026-04-06',
      isPaid: false,
      deductWeekends: false,
      deductHolidays: false,
    });

    // Separate sandwich unpaid leave Apr 10 (Fri) - Apr 12 (Sun) with deductWeekends=true -> 3 LOP days
    addLeave({
      startDate: '2026-04-10',
      endDate: '2026-04-12',
      isPaid: false,
      deductWeekends: true,
    });

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.holidayDays).toBe(1);
    expect(res.snapshot.eligibleWorkingDays).toBe(21);
    expect(res.snapshot.unpaidLeaveDays).toBe(6);
    expect(res.snapshot.totalLopDays).toBe(6);
    expect(res.snapshot.payableDays).toBe(24);
    expect(res.snapshot.grossEarnings).toBe('24000.00');
  });

  it('protects incomplete/open sessions from silent LOP, accepts approved REGULARIZED, and flags unapproved REGULARIZED', async () => {
    const approvedRegId = new Types.ObjectId();
    const pendingRegId = new Types.ObjectId();
    regularizations.push(
      {
        _id: approvedRegId,
        employeeId,
        attendanceDate: '2026-04-01',
        status: RegularizationStatus.APPROVED,
      },
      {
        _id: pendingRegId,
        employeeId,
        attendanceDate: '2026-04-02',
        status: RegularizationStatus.PENDING,
      },
    );

    addAttendance('2026-04-01', AttendanceStatus.REGULARIZED, {
      regularizationId: approvedRegId,
    });
    addAttendance('2026-04-02', AttendanceStatus.REGULARIZED, {
      regularizationId: pendingRegId,
    });
    addAttendance('2026-04-03', AttendanceStatus.CHECKED_IN);
    addAttendance('2026-04-06', AttendanceStatus.INCOMPLETE);

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.presentDays).toBe(1);
    expect(res.snapshot.totalLopDays).toBe(0);
    expect(res.snapshot.payableDays).toBe(30);
    expect(res.snapshot.attendanceLeaveWarnings).toEqual(
      expect.arrayContaining([
        'UNAPPROVED_REGULARIZED_ATTENDANCE',
        'OPEN_ATTENDANCE_SESSION',
        'INCOMPLETE_ATTENDANCE_RECORD',
      ]),
    );
  });

  it('reconciles WORKING_DAYS (fixedWorkingDaysPerMonth=22) and FIXED_30_DAYS policies accurately', async () => {
    // Switch to WORKING_DAYS (22 working days per month)
    rulesDoc = {
      ...rulesDoc,
      prorationPolicy: PayrollProrationPolicy.WORKING_DAYS,
    };

    // 2 LOP days => 22 - 2 = 20 / 22 * 30,000 = 27,272.73
    addLeave({ startDate: '2026-04-01', endDate: '2026-04-02', isPaid: false });
    const workingDaysLop = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    expect(workingDaysLop.snapshot.prorationDenominatorDays).toBe(22);
    expect(workingDaysLop.snapshot.payableDays).toBe(20);
    expect(workingDaysLop.snapshot.grossEarnings).toBe('27272.73');

    // 0 LOP => 22 / 22 = 1.0 (100% salary)
    leaves = [];
    const workingDaysFull = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    expect(workingDaysFull.snapshot.payableDays).toBe(22);
    expect(workingDaysFull.snapshot.grossEarnings).toBe('30000.00');

    // Switch to FIXED_30_DAYS on 31-day May with 2 LOP days => (30 - 2) / 30 * 30,000 = 28,000.00
    const mayId = new Types.ObjectId();
    periods.set(mayId.toHexString(), {
      _id: mayId,
      periodName: 'May 2026',
      periodCode: 'PR-2026-05',
      payrollFrequency: PayrollFrequency.MONTHLY,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: new Date('2026-05-31T00:00:00.000Z'),
      paymentDate: new Date('2026-06-01T00:00:00.000Z'),
      month: 5,
      year: 2026,
      status: PayrollPeriodStatus.PROCESSING,
      deletedAt: null,
      __v: 0,
    } as unknown as PayrollPeriodLean);
    rulesDoc = {
      ...rulesDoc,
      prorationPolicy: PayrollProrationPolicy.FIXED_30_DAYS,
    };
    addLeave({ startDate: '2026-05-04', endDate: '2026-05-05', isPaid: false });

    const fixedMay = await calculationService.preview({
      payrollPeriodId: mayId.toString(),
      employeeId: employeeId.toString(),
    });
    expect(fixedMay.snapshot.prorationDenominatorDays).toBe(30);
    expect(fixedMay.snapshot.payableDays).toBe(28);
    expect(fixedMay.snapshot.grossEarnings).toBe('28000.00');
  });

  it('handles separated employee overlapping tenure and clips post-exit leave', async () => {
    employees.set(employeeId.toHexString(), {
      _id: employeeId,
      employeeCode: 'EMP-RES-1',
      firstName: 'Anita',
      lastName: 'Rao',
      branchId,
      employmentStatus: EmploymentStatus.RESIGNED,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
      lastWorkingDate: new Date('2026-04-15T00:00:00.000Z'),
      deletedAt: null,
    } as unknown as EmployeeLean);

    // Leave Apr 14–17: Apr 14, 15 in tenure; Apr 16, 17 after lastWorkingDate -> 2 LOP days
    addLeave({ startDate: '2026-04-14', endDate: '2026-04-17', isPaid: false });

    const res = await calculationService.preview({
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    expect(res.snapshot.tenureCalendarDays).toBe(15);
    expect(res.snapshot.unpaidLeaveDays).toBe(2);
    expect(res.snapshot.totalLopDays).toBe(2);
    expect(res.snapshot.payableDays).toBe(13);
    expect(res.snapshot.grossEarnings).toBe('13000.00');
  });

  it('rejects client-tampered LOP/payableDays inputs via ValidationPipe and supports recalculate after leave approval/cancellation', async () => {
    await expect(
      validateBody(CalculatePayrollPreviewInputDto, {
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
        payableDays: 30,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    await expect(
      validateBody(CalculateEmployeePayrollDto, {
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
        totalLopDays: 0,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    // Step A: Initial calculation with 1 pending leave (ignored) -> 30 payableDays
    const leaveDoc = addLeave({
      startDate: '2026-04-06',
      endDate: '2026-04-08',
      isPaid: false,
      status: LeaveRequestStatus.PENDING,
    });
    const calcDto1 = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    const first = await controller.calculateEmployee(calcDto1, makeReq());
    expect(first.data.calculationVersion).toBe(1);
    expect(first.data.calculationSnapshot.payableDays).toBe(30);
    expect(first.data.netSalary).toBe('30000.00');

    // Step B: Leave gets APPROVED -> recalculate=true updates totalLopDays=3, netSalary=27,000
    leaveDoc.status = LeaveRequestStatus.APPROVED;
    const recalcDto = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
      recalculate: true,
    });
    const second = await controller.calculateEmployee(recalcDto, makeReq());
    expect(second.data.calculationVersion).toBe(2);
    expect(second.data.calculationSnapshot.totalLopDays).toBe(3);
    expect(second.data.netSalary).toBe('27000.00');

    // Step C: Leave gets CANCELLED -> recalculate=true restores 30 payableDays
    leaveDoc.status = LeaveRequestStatus.CANCELLED;
    const third = await controller.calculateEmployee(recalcDto, makeReq());
    expect(third.data.calculationVersion).toBe(3);
    expect(third.data.calculationSnapshot.totalLopDays).toBe(0);
    expect(third.data.netSalary).toBe('30000.00');
  });

  it('caps overlapping leave requests on same day at 1.0 LOP day with OVERLAPPING_LEAVE_REQUESTS warning and resolves batches cleanly', async () => {
    addLeave({ startDate: '2026-04-06', endDate: '2026-04-06', isPaid: false });
    addLeave({ startDate: '2026-04-06', endDate: '2026-04-06', isPaid: false });

    const batch = await inputResolver.resolveBatchForPeriod(periodId);
    expect(batch.resolved).toHaveLength(1);
    expect(batch.resolved[0].leaveAndAttendance.totalLopDays).toBe(1);
    expect(batch.resolved[0].leaveAndAttendance.warnings).toContain(
      'OVERLAPPING_LEAVE_REQUESTS',
    );
    expect(batch.resolved[0].payableDays).toBe(29);
  });

  describe('Audit #1 — Overlapping Leave Conflicts (Order-Independent & Surfaced)', () => {
    it('detects paid overlapping unpaid deterministically regardless of leave _id/insertion order and flags CONFLICTING_LEAVE_CLASSIFICATION', async () => {
      // Order A: Paid inserted first, Unpaid second
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: true,
      });
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: false,
      });
      const resA = await calculationService.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      // Order B: Unpaid inserted first, Paid second
      leaves = [];
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: false,
      });
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: true,
      });
      const resB = await calculationService.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(resA.snapshot.totalLopDays).toBe(resB.snapshot.totalLopDays);
      expect(resA.snapshot.paidLeaveDays).toBe(resB.snapshot.paidLeaveDays);
      expect(resA.snapshot.unpaidLeaveDays).toBe(resB.snapshot.unpaidLeaveDays);
      expect(resA.snapshot.totalLopDays).toBe(1);
      expect(resA.snapshot.attendanceLeaveWarnings).toEqual(
        expect.arrayContaining([
          'OVERLAPPING_LEAVE_REQUESTS',
          'CONFLICTING_LEAVE_CLASSIFICATION',
          'LEAVE_ATTENDANCE_MISMATCH',
        ]),
      );
    });

    it('detects two paid leaves, full overlapping half-day leave, same-session half-day collision, and allows clean FIRST_HALF + SECOND_HALF split', async () => {
      // 1. Two full paid leaves on Apr 06 -> capped at 1.0, OVERLAPPING_LEAVE_REQUESTS
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: true,
      });
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: true,
      });
      // 2. Full-day unpaid + half-day unpaid on Apr 07 -> capped at 1.0, OVERLAPPING_LEAVE_REQUESTS
      addLeave({
        startDate: '2026-04-07',
        endDate: '2026-04-07',
        isPaid: false,
      });
      addLeave({
        startDate: '2026-04-07',
        endDate: '2026-04-07',
        isPaid: false,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      });
      // 3. Same-session half-day collision on Apr 08 (FIRST_HALF Paid + FIRST_HALF Unpaid) -> conflict detected
      addLeave({
        startDate: '2026-04-08',
        endDate: '2026-04-08',
        isPaid: true,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      });
      addLeave({
        startDate: '2026-04-08',
        endDate: '2026-04-08',
        isPaid: false,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      });
      // 4. Clean distinct split on Apr 09 (FIRST_HALF Paid + SECOND_HALF Unpaid) -> 0.5 + 0.5, NOT flagged as overlapping
      addLeave({
        startDate: '2026-04-09',
        endDate: '2026-04-09',
        isPaid: true,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      });
      addLeave({
        startDate: '2026-04-09',
        endDate: '2026-04-09',
        isPaid: false,
        isHalfDay: true,
        halfDaySession: HalfDaySession.SECOND_HALF,
      });

      const resolved = (await inputResolver.resolve(periodId, employeeId))
        .leaveAndAttendance;

      expect(resolved.overlappingLeaveDates).toEqual([
        '2026-04-06',
        '2026-04-07',
        '2026-04-08',
      ]);
      expect(resolved.conflictingLeaveDates).toEqual(['2026-04-08']);
      expect(resolved.totalLopDays).toBe(2); // 0 on Apr 06 + 1 on Apr 07 + 0.5 on Apr 08 (FIRST_HALF only) + 0.5 on Apr 09
      expect(resolved.paidLeaveDays).toBe(1.5); // 1 on Apr 06 + 0.5 on Apr 09 (Apr 08 FIRST_HALF does not leak into SECOND_HALF)
    });

    it('detects CANCELLATION_REQUESTED leave overlapping APPROVED leave without double-counting and prioritizes active APPROVED leave', async () => {
      // Cancellation-requested Unpaid overlaps Approved Paid on Apr 06 -> Approved Paid governs, both flagged!
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: false,
        status: LeaveRequestStatus.CANCELLATION_REQUESTED,
      });
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: true,
        status: LeaveRequestStatus.APPROVED,
      });

      const res = await calculationService.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.paidLeaveDays).toBe(1);
      expect(res.snapshot.totalLopDays).toBe(0);
      expect(res.snapshot.attendanceLeaveWarnings).toEqual(
        expect.arrayContaining([
          'OVERLAPPING_LEAVE_REQUESTS',
          'CONFLICTING_LEAVE_CLASSIFICATION',
          'PENDING_LEAVE_CANCELLATION_RECONCILIATION',
        ]),
      );
    });
  });

  describe('Audit #2 & #3 — Full Attendance/Leave Matrix & All 3 Proration Policies Across Feb/Apr/May', () => {
    it('never exceeds 1.0 LOP/day across Leave + missing, incomplete, ABSENT, and unapproved REGULARIZED attendance', async () => {
      const pendingRegId = new Types.ObjectId();
      regularizations.push({
        _id: pendingRegId,
        employeeId,
        attendanceDate: '2026-04-09',
        status: RegularizationStatus.PENDING,
      });

      // Apr 06: Full paid leave + missing attendance -> 0 LOP, mismatch
      addLeave({
        startDate: '2026-04-06',
        endDate: '2026-04-06',
        isPaid: true,
      });
      // Apr 07: Full unpaid leave + INCOMPLETE attendance -> 1 LOP, incomplete + mismatch
      addLeave({
        startDate: '2026-04-07',
        endDate: '2026-04-07',
        isPaid: false,
      });
      addAttendance('2026-04-07', AttendanceStatus.INCOMPLETE);
      // Apr 08: Half unpaid leave + INCOMPLETE attendance -> 0.5 LOP (no extra silent LOP for incomplete)
      addLeave({
        startDate: '2026-04-08',
        endDate: '2026-04-08',
        isPaid: false,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      });
      addAttendance('2026-04-08', AttendanceStatus.INCOMPLETE);
      // Apr 09: Half paid leave + unapproved REGULARIZED attendance -> 0 LOP, UNAPPROVED_REGULARIZED_ATTENDANCE
      addLeave({
        startDate: '2026-04-09',
        endDate: '2026-04-09',
        isPaid: true,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      });
      addAttendance('2026-04-09', AttendanceStatus.REGULARIZED, {
        regularizationId: pendingRegId,
      });

      const res = await calculationService.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.totalLopDays).toBe(1.5);
      expect(res.snapshot.attendanceAbsenceLopDays).toBe(0);
      expect(res.snapshot.attendanceLeaveWarnings).toEqual(
        expect.arrayContaining([
          'INCOMPLETE_ATTENDANCE_RECORD',
          'UNAPPROVED_REGULARIZED_ATTENDANCE',
          'LEAVE_ATTENDANCE_MISMATCH',
        ]),
      );
    });

    it('matches independent expected salary math across CALENDAR_DAYS, FIXED_30_DAYS, and WORKING_DAYS in Feb (28d/20wd), Apr (30d/22wd), and May (31d/23wd)', async () => {
      const febId = new Types.ObjectId();
      periods.set(febId.toHexString(), {
        _id: febId,
        periodName: 'Feb 2026',
        periodCode: 'PR-2026-02',
        payrollFrequency: PayrollFrequency.MONTHLY,
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: new Date('2026-02-28T00:00:00.000Z'),
        paymentDate: new Date('2026-03-01T00:00:00.000Z'),
        month: 2,
        year: 2026,
        status: PayrollPeriodStatus.PROCESSING,
        deletedAt: null,
        __v: 0,
      } as unknown as PayrollPeriodLean);

      const mayId = new Types.ObjectId();
      periods.set(mayId.toHexString(), {
        _id: mayId,
        periodName: 'May 2026',
        periodCode: 'PR-2026-05',
        payrollFrequency: PayrollFrequency.MONTHLY,
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        endDate: new Date('2026-05-31T00:00:00.000Z'),
        paymentDate: new Date('2026-06-01T00:00:00.000Z'),
        month: 5,
        year: 2026,
        status: PayrollPeriodStatus.PROCESSING,
        deletedAt: null,
        __v: 0,
      } as unknown as PayrollPeriodLean);

      // Helper: Basic=20,000 + HRA(50%)=10,000 -> total 30,000/month
      // Policy 1: WORKING_DAYS (22 working days/month norm)
      rulesDoc = {
        ...rulesDoc,
        prorationPolicy: PayrollProrationPolicy.WORKING_DAYS,
      };

      // Feb (20 working days): 0 LOP => MUST still pay full 30,000.00 (22/22)!
      leaves = [];
      const wdFebZeroLop = await calculationService.preview({
        payrollPeriodId: febId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(wdFebZeroLop.snapshot.eligibleWorkingDays).toBe(20);
      expect(wdFebZeroLop.snapshot.payableDays).toBe(22);
      expect(wdFebZeroLop.snapshot.prorationApplied).toBe(false);
      expect(wdFebZeroLop.snapshot.grossEarnings).toBe('30000.00');

      // Feb (20 working days): 1.5 LOP => (22 - 1.5) / 22 = 20.5/22
      // Basic: 20000 * 20.5/22 = 18636.3636 -> 18636.36; HRA: 10000 * 20.5/22 = 9318.1818 -> 9318.18 => 27954.54
      addLeave({
        startDate: '2026-02-02',
        endDate: '2026-02-02',
        isPaid: false,
      });
      addLeave({
        startDate: '2026-02-03',
        endDate: '2026-02-03',
        isPaid: false,
        isHalfDay: true,
      });
      const wdFebPartial = await calculationService.preview({
        payrollPeriodId: febId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(wdFebPartial.snapshot.payableDays).toBe(20.5);
      expect(wdFebPartial.snapshot.grossEarnings).toBe('27954.54');

      // Policy 2: FIXED_30_DAYS
      rulesDoc = {
        ...rulesDoc,
        prorationPolicy: PayrollProrationPolicy.FIXED_30_DAYS,
      };
      // Feb with 1.5 LOP => (30 - 1.5) / 30 = 28.5 / 30 => 28,500.00!
      const f30FebPartial = await calculationService.preview({
        payrollPeriodId: febId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(f30FebPartial.snapshot.prorationDenominatorDays).toBe(30);
      expect(f30FebPartial.snapshot.payableDays).toBe(28.5);
      expect(f30FebPartial.snapshot.prorationApplied).toBe(true);
      expect(f30FebPartial.snapshot.grossEarnings).toBe('28500.00');

      // Feb with 0 LOP => 30/30 = 30,000.00
      leaves = [];
      const f30FebFull = await calculationService.preview({
        payrollPeriodId: febId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(f30FebFull.snapshot.payableDays).toBe(30);
      expect(f30FebFull.snapshot.grossEarnings).toBe('30000.00');

      // Full-month LOP in Feb under FIXED_30_DAYS (all 20 working days unpaid) => 0.00!
      addLeave({
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        isPaid: false,
      });
      const f30FebFullLop = await calculationService.preview({
        payrollPeriodId: febId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(f30FebFullLop.snapshot.payableDays).toBe(0);
      expect(f30FebFullLop.snapshot.grossEarnings).toBe('0.00');

      // Policy 3: CALENDAR_DAYS on 31-day May (23 working days) with 2.5 LOP => (31 - 2.5)/31 = 28.5/31
      // Basic: 20000 * 28.5/31 = 18387.0967 -> 18387.10; HRA: 10000 * 28.5/31 = 9193.5483 -> 9193.55 => 27580.65
      leaves = [];
      rulesDoc = {
        ...rulesDoc,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
      };
      addLeave({
        startDate: '2026-05-04',
        endDate: '2026-05-05',
        isPaid: false,
      });
      addLeave({
        startDate: '2026-05-06',
        endDate: '2026-05-06',
        isPaid: false,
        isHalfDay: true,
      });
      const calMayPartial = await calculationService.preview({
        payrollPeriodId: mayId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(calMayPartial.snapshot.eligibleWorkingDays).toBe(21);
      expect(calMayPartial.snapshot.payableDays).toBe(28.5);
      expect(calMayPartial.snapshot.grossEarnings).toBe('27580.65');

      // Mid-month joiner in Feb (Feb 15..28 = 14 tenure days, 0 LOP) under CALENDAR_DAYS => 14/28 = 0.5 => 15,000.00
      leaves = [];
      employees.set(employeeId.toHexString(), {
        _id: employeeId,
        employeeCode: 'EMP-FEB-JOIN',
        firstName: 'Anita',
        lastName: 'Rao',
        branchId,
        employmentStatus: EmploymentStatus.ACTIVE,
        employmentType: EmploymentType.FULL_TIME,
        dateOfJoining: new Date('2026-02-15T00:00:00.000Z'),
        deletedAt: null,
      } as unknown as EmployeeLean);
      const febJoiner = await calculationService.preview({
        payrollPeriodId: febId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(febJoiner.snapshot.tenureCalendarDays).toBe(14);
      expect(febJoiner.snapshot.payableDays).toBe(14);
      expect(febJoiner.snapshot.grossEarnings).toBe('15000.00');
    });
  });
});
