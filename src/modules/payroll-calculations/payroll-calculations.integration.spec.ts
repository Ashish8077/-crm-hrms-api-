/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import {
  ExecutionContext,
  HttpStatus,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PayrollCalculationsController } from './payroll-calculations.controller';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { PayrollInputResolver } from './services/payroll-input.resolver';
import { SalaryComponentResolver } from './services/salary-component.resolver';
import { ComponentDependencyResolver } from './services/component-dependency.resolver';
import { ComponentCalculationEngine } from './services/component-calculation.engine';
import { ProrationCalculator } from './services/proration.calculator';
import { PayrollTotalsCalculator } from './services/payroll-totals.calculator';
import { PayrollSnapshotBuilder } from './services/payroll-snapshot.builder';
import { PayrollRecordRepository } from './repositories/payroll-record.repository';
import { PayrollRecordLean } from './schemas/payroll-record.schema';
import { PayrollPeriodRepository } from '../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../payroll-periods/schemas/payroll-period.schema';
import { PayrollPeriodStatus } from '../payroll-periods/constants/payroll-period.constant';
import { PayrollLeaveAttendanceResolverService } from '../payroll-periods/services/payroll-leave-attendance-resolver.service';
import { BranchRepository } from '../branches/repositories/branch.repository';
import {
  AttendanceRepository,
  PayrollAttendanceBucket,
} from '../attendance/repositories/attendance.repository';
import { AttendanceRegularizationRepository } from '../attendance/repositories/attendance-regularization.repository';
import {
  LeaveRequestLean,
  LeaveRequestRepository,
} from '../leaves/repositories/leave-request.repository';
import { HolidayRepository } from '../leaves/repositories/holiday.repository';
import { WeeklyOffConfigRepository } from '../work-schedules/repositories/weekly-off-config.repository';
import { LeaveRequestStatus } from '../leaves/constants/leaves.constant';
import { Employee } from '../employees/schemas/employee.schema';
import { EmployeeLean } from '../employees/repositories/employee.repository';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import { EmployeeSalaryRepository } from '../employee-salaries/repositories/employee-salary.repository';
import { EmployeeSalaryLean } from '../employee-salaries/schemas/employee-salary.schema';
import { EmployeeSalaryStatus } from '../employee-salaries/constants/employee-salary.constant';
import { SalaryStructureRepository } from '../salary-structures/repositories/salary-structure.repository';
import { SalaryStructureCalculationService } from '../salary-structures/services/salary-structure-calculation.service';
import { SalaryStructureLean } from '../salary-structures/schemas/salary-structure.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../salary-structures/constants/salary-structure.constant';
import {
  SalaryComponent,
  SalaryComponentLean,
} from '../salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import { PayrollSettingsRepository } from '../payroll-configuration/repositories/payroll-settings.repository';
import { PayrollCalculationRuleRepository } from '../payroll-configuration/repositories/payroll-calculation-rule.repository';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../payroll-configuration/constants/payroll-configuration.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  CalculateEmployeePayrollDto,
  CalculatePayrollPreviewInputDto,
} from './dto/calculate-employee-payroll.dto';
import { PayrollRecordStatus } from './constants/payroll-calculation.constant';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

/**
 * In-memory PayrollRecordRepository simulating MongoDB unique index { payrollPeriodId, employeeId }
 * and atomic optimistic concurrency on recalculation.
 */
class InMemoryPayrollRecordRepository {
  store = new Map<string, PayrollRecordLean>();

  clear(): void {
    this.store.clear();
  }

  isDuplicateKeyError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes('E11000 duplicate key error')
    );
  }

  async findByPeriodAndEmployee(
    payrollPeriodId: Types.ObjectId,
    employeeId: Types.ObjectId,
  ): Promise<PayrollRecordLean | null> {
    for (const item of this.store.values()) {
      if (
        item.deletedAt === null &&
        item.payrollPeriodId.equals(payrollPeriodId) &&
        item.employeeId.equals(employeeId)
      ) {
        return { ...item };
      }
    }
    return null;
  }

  async create(input: Record<string, unknown>): Promise<PayrollRecordLean> {
    const periodId = input.payrollPeriodId as Types.ObjectId;
    const empId = input.employeeId as Types.ObjectId;

    for (const item of this.store.values()) {
      if (
        item.deletedAt === null &&
        item.payrollPeriodId.equals(periodId) &&
        item.employeeId.equals(empId)
      ) {
        throw new Error(
          'E11000 duplicate key error: uq_payroll_records_period_employee',
        );
      }
    }

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

describe('Payroll Calculations Module - Full Integration Test Suite', () => {
  let controller: PayrollCalculationsController;
  let recordRepository: InMemoryPayrollRecordRepository;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;

  const actorId = new Types.ObjectId();
  const hrAdminRoleId = new Types.ObjectId();
  const employeeRoleId = new Types.ObjectId();
  let activePermissions: string[] = [];

  const periodsStore = new Map<string, PayrollPeriodLean>();
  const employeesStore = new Map<string, EmployeeLean>();
  const assignmentsStore = new Map<string, EmployeeSalaryLean[]>();
  const structuresStore = new Map<string, SalaryStructureLean>();
  const componentsStore = new Map<string, SalaryComponentLean>();
  const leavesStore: LeaveRequestLean[] = [];
  const attendanceBucketsStore: PayrollAttendanceBucket[] = [];

  let currentSettings: Record<string, unknown> | null = null;
  let currentRules: Record<string, unknown> | null = null;

  const mockAuditLogsService = {
    createAuditLog: jest.fn().mockResolvedValue(undefined),
  };

  const mockAuthorizationService = {
    hasPermissions: jest.fn(
      (_roleIds: Types.ObjectId[], requiredPermissions: string[]) =>
        Promise.resolve(
          requiredPermissions.every((p) => activePermissions.includes(p)),
        ),
    ),
  };

  const createRequest = (
    roleIds: Types.ObjectId[] = [hrAdminRoleId],
  ): AuthenticatedRequest =>
    ({
      user: {
        userId: actorId,
        sessionId: new Types.ObjectId(),
        roleIds,
      },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'Jest-PayrollCalculations/1.0' },
    }) as unknown as AuthenticatedRequest;

  const createExecutionContext = (
    handler: object,
    req: AuthenticatedRequest = createRequest(),
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PayrollCalculationsController,
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    }) as unknown as ExecutionContext;

  const validateBody = async <T>(
    metatype: new () => T,
    body: Record<string, unknown>,
  ): Promise<T> => {
    return (await validationPipe.transform(body, {
      type: 'body',
      metatype,
    })) as T;
  };

  beforeAll(async () => {
    recordRepository = new InMemoryPayrollRecordRepository();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollCalculationsController],
      providers: [
        PayrollCalculationService,
        PayrollInputResolver,
        SalaryComponentResolver,
        ComponentDependencyResolver,
        ComponentCalculationEngine,
        ProrationCalculator,
        PayrollTotalsCalculator,
        PayrollSnapshotBuilder,
        SalaryStructureCalculationService,
        PayrollLeaveAttendanceResolverService,
        {
          provide: BranchRepository,
          useValue: { findByIds: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: HolidayRepository,
          useValue: { findActiveInRange: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: WeeklyOffConfigRepository,
          useValue: {
            findActiveEffectiveInRange: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AttendanceRepository,
          useValue: {
            aggregateForPayrollPeriod: jest.fn(() =>
              Promise.resolve([...attendanceBucketsStore]),
            ),
          },
        },
        {
          provide: AttendanceRegularizationRepository,
          useValue: { findByIds: jest.fn().mockResolvedValue([]) },
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
                  leavesStore.filter(
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
          provide: PayrollRecordRepository,
          useValue: recordRepository,
        },
        {
          provide: PayrollPeriodRepository,
          useValue: {
            findById: jest.fn((id: Types.ObjectId) =>
              Promise.resolve(periodsStore.get(id.toHexString()) ?? null),
            ),
          },
        },
        {
          provide: getModelToken(Employee.name),
          useValue: {
            findById: jest.fn((id: Types.ObjectId) => ({
              lean: () => ({
                exec: () =>
                  Promise.resolve(employeesStore.get(id.toHexString()) ?? null),
              }),
            })),
          },
        },
        {
          provide: EmployeeSalaryRepository,
          useValue: {
            findAllByEmployeeId: jest.fn((empId: Types.ObjectId) =>
              Promise.resolve(assignmentsStore.get(empId.toHexString()) ?? []),
            ),
          },
        },
        {
          provide: SalaryStructureRepository,
          useValue: {
            findById: jest.fn((id: Types.ObjectId) =>
              Promise.resolve(structuresStore.get(id.toHexString()) ?? null),
            ),
          },
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: {
            find: jest.fn((q: { _id?: { $in?: Types.ObjectId[] } }) => ({
              lean: () => ({
                exec: () => {
                  const ids = (q._id?.$in ?? []).map((i) => i.toHexString());
                  return Promise.resolve(
                    ids
                      .map((id) => componentsStore.get(id))
                      .filter(Boolean) as SalaryComponentLean[],
                  );
                },
              }),
            })),
          },
        },
        {
          provide: PayrollSettingsRepository,
          useValue: {
            findActive: jest.fn(() => Promise.resolve(currentSettings)),
          },
        },
        {
          provide: PayrollCalculationRuleRepository,
          useValue: {
            findActive: jest.fn(() => Promise.resolve(currentRules)),
          },
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogsService,
        },
        {
          provide: AuthorizationService,
          useValue: mockAuthorizationService,
        },
        Reflector,
        PermissionsGuard,
      ],
    }).compile();

    controller = module.get(PayrollCalculationsController);
    guard = module.get(PermissionsGuard);

    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          HttpStatus.BAD_REQUEST,
          mapValidationErrors(errors),
        ),
    });
  });

  // Seed fixtures helper
  let periodId: Types.ObjectId;
  let employeeId: Types.ObjectId;
  let structureId: Types.ObjectId;
  let basicId: Types.ObjectId;
  let hraId: Types.ObjectId;
  let pfEeId: Types.ObjectId;
  let pfErId: Types.ObjectId;

  beforeEach(() => {
    recordRepository.clear();
    periodsStore.clear();
    employeesStore.clear();
    assignmentsStore.clear();
    structuresStore.clear();
    componentsStore.clear();
    leavesStore.length = 0;
    attendanceBucketsStore.length = 0;
    jest.clearAllMocks();

    activePermissions = [
      PermissionKeys.PAYROLL_CALCULATIONS_VIEW,
      PermissionKeys.PAYROLL_CALCULATIONS_CREATE,
    ];

    currentSettings = {
      _id: new Types.ObjectId(),
      currency: 'INR',
      __v: 0,
    };
    currentRules = {
      _id: new Types.ObjectId(),
      roundingMode: PayrollRoundingMode.HALF_EVEN,
      roundingPrecision: 2,
      prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
      prorateFixedComponents: true,
      prorateDeductions: false,
      negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
      componentExecutionOrder: [],
      __v: 0,
    };

    periodId = new Types.ObjectId();
    periodsStore.set(periodId.toHexString(), {
      _id: periodId,
      periodName: 'April 2026 Payroll',
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
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });

    employeeId = new Types.ObjectId();
    employeesStore.set(employeeId.toHexString(), {
      _id: employeeId,
      userId: null,
      employeeCode: 'EMP001',
      firstName: 'Aarav',
      lastName: 'Sharma',
      workEmail: 'aarav@example.com',
      dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
      departmentId: new Types.ObjectId(),
      designationId: new Types.ObjectId(),
      branchId: new Types.ObjectId(),
      teamId: null,
      reportingManagerId: null,
      employmentType: EmploymentType.FULL_TIME,
      employmentStatus: EmploymentStatus.ACTIVE,
      bankDetails: null,
      emergencyContact: null,
      skills: [],
      certifications: [],
      deletedAt: null,
      createdBy: actorId,
      updatedBy: actorId,
      deletedBy: null,
    });

    basicId = new Types.ObjectId();
    hraId = new Types.ObjectId();
    pfEeId = new Types.ObjectId();
    pfErId = new Types.ObjectId();

    const makeComp = (
      id: Types.ObjectId,
      code: string,
      name: string,
      type: SalaryComponentType,
    ): SalaryComponentLean => ({
      _id: id,
      name,
      code,
      type,
      calculationType: null,
      percentageOf: null,
      isTaxable: true,
      isStatutory: false,
      defaultValue: null,
      description: null,
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    componentsStore.set(
      basicId.toHexString(),
      makeComp(basicId, 'BASIC', 'Basic Salary', SalaryComponentType.EARNING),
    );
    componentsStore.set(
      hraId.toHexString(),
      makeComp(hraId, 'HRA', 'HRA', SalaryComponentType.EARNING),
    );
    componentsStore.set(
      pfEeId.toHexString(),
      makeComp(
        pfEeId,
        'PF_EE',
        'PF Employee',
        SalaryComponentType.EMPLOYEE_DEDUCTION,
      ),
    );
    componentsStore.set(
      pfErId.toHexString(),
      makeComp(
        pfErId,
        'PF_ER',
        'PF Employer',
        SalaryComponentType.EMPLOYER_CONTRIBUTION,
      ),
    );

    structureId = new Types.ObjectId();
    structuresStore.set(structureId.toHexString(), {
      _id: structureId,
      name: 'Engineering Grade 1',
      code: 'ENG_G1',
      description: null,
      salaryBasis: SalaryStructureBasis.CTC,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 48600,
      components: [
        {
          componentId: basicId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 30000,
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
        {
          componentId: pfEeId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
        {
          componentId: pfErId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
      ],
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 1,
    });

    assignmentsStore.set(employeeId.toHexString(), [
      {
        _id: new Types.ObjectId(),
        employeeId,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 48600,
        salaryStructureVersion: 1,
        salarySnapshot: {} as EmployeeSalaryLean['salarySnapshot'],
        status: EmployeeSalaryStatus.ACTIVE,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0,
      },
    ]);
  });

  const seedUnpaidLeaveRange = (startDate: string, endDate: string) => {
    leavesStore.push({
      _id: new Types.ObjectId(),
      employeeId,
      leaveTypeId: new Types.ObjectId(),
      leaveTypeSnapshot: {
        name: 'Loss of Pay',
        code: 'LWP',
        isPaid: false,
        allowHalfDay: true,
        deductWeekends: true,
        deductHolidays: true,
      },
      startDate,
      endDate,
      totalDays: 1,
      isHalfDay: false,
      halfDaySession: null,
      excludedDates: [],
      status: LeaveRequestStatus.APPROVED,
    } as unknown as LeaveRequestLean);
  };

  it('rejects client-tampered salary amounts, payableDays overrides, and malformed IDs via ValidationPipe', async () => {
    await expect(
      validateBody(CalculateEmployeePayrollDto, {
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
        grossEarnings: 999999,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    await expect(
      validateBody(CalculatePayrollPreviewInputDto, {
        payrollPeriodId: 'not-a-valid-object-id',
        employeeId: employeeId.toString(),
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    await expect(
      validateBody(CalculatePayrollPreviewInputDto, {
        payrollPeriodId: periodId.toString(),
        employeeId: 'bad-emp-id',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    await expect(
      validateBody(CalculateEmployeePayrollDto, {
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
        payableDays: 30,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    await expect(
      validateBody(CalculatePayrollPreviewInputDto, {
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
        totalLopDays: 0,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });

  it('preview computes breakdown without persisting any PayrollRecord', async () => {
    seedUnpaidLeaveRange('2026-04-16', '2026-04-30');
    const dto = await validateBody(CalculatePayrollPreviewInputDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    const res = await controller.preview(dto);

    expect(res.success).toBe(true);
    expect(res.data.persisted).toBe(false);
    expect(res.data.snapshot.totalLopDays).toBe(15);
    expect(res.data.snapshot.payableDays).toBe(15);
    expect(res.data.snapshot.grossEarnings).toBe('22500.00');
    expect(res.data.snapshot.totalDeductions).toBe('3600.00');
    expect(res.data.snapshot.employerContributionsTotal).toBe('3600.00');
    expect(res.data.snapshot.netSalary).toBe('18900.00');
    expect(recordRepository.store.size).toBe(0);
  });

  it('persists PayrollRecord and keeps snapshot immutable even if structure or rules change later', async () => {
    seedUnpaidLeaveRange('2026-04-16', '2026-04-30');
    const dto = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });

    const res = await controller.calculateEmployee(dto, createRequest());
    expect(res.success).toBe(true);
    expect(res.data.persisted).toBe(true);
    expect(res.data.netSalary).toBe('18900.00');
    expect(recordRepository.store.size).toBe(1);

    // Mutate salary structure and rules after calculation (including prorateEmployerContributions)
    const struct = structuresStore.get(structureId.toHexString())!;
    struct.components[0].amount = 90000;
    struct.__v = 2;
    currentRules = {
      ...currentRules,
      roundingPrecision: 0,
      prorateEmployerContributions: true,
    };

    // Stored record snapshot remains immutable
    const stored = await recordRepository.findByPeriodAndEmployee(
      periodId,
      employeeId,
    );
    expect(stored!.netSalary.toString()).toBe('18900.00');
    expect(stored!.employerContributions.toString()).toBe('3600.00');
    expect(stored!.calculationSnapshot.prorateEmployerContributions).toBe(
      false,
    );
    expect(stored!.calculationSnapshot.payrollSettingsId).toBe(
      (currentSettings as { _id: Types.ObjectId })._id.toString(),
    );
    expect(stored!.calculationSnapshot.payrollSettingsVersion).toBe(0);
    expect(stored!.calculationSnapshot.payrollCalculationRuleId).toBe(
      (currentRules as { _id: Types.ObjectId })._id.toString(),
    );
    expect(stored!.calculationSnapshot.payrollCalculationRuleVersion).toBe(0);
    expect(stored!.calculationSnapshot.salaryStructureVersion).toBe(1);
    expect(
      stored!.calculationSnapshot.earnings[0].monthlyBaseAmount.toString(),
    ).toBe('30000.00');
  });

  it('produces identical preview and persisted employer contribution totals when prorateEmployerContributions=true and stores flag in snapshot', async () => {
    seedUnpaidLeaveRange('2026-04-16', '2026-04-30');
    currentRules = {
      ...currentRules,
      prorateEmployerContributions: true,
    };

    const previewDto = await validateBody(CalculatePayrollPreviewInputDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    const previewRes = await controller.preview(previewDto);

    const persistDto = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    const persistRes = await controller.calculateEmployee(
      persistDto,
      createRequest(),
    );

    expect(previewRes.data.snapshot.prorateEmployerContributions).toBe(true);
    expect(previewRes.data.snapshot.employerContributionsTotal).toBe('1800.00');
    expect(persistRes.data.employerContributions).toBe('1800.00');
    expect(
      persistRes.data.calculationSnapshot.prorateEmployerContributions,
    ).toBe(true);
    expect(persistRes.data.calculationSnapshot.employerContributions).toEqual(
      previewRes.data.snapshot.employerContributions,
    );
    expect(persistRes.data.netSalary).toBe(previewRes.data.snapshot.netSalary);
  });

  it('prevents duplicate record creation, updates same record on recalculate=true, and leaves existing valid record intact on failed recalculation', async () => {
    seedUnpaidLeaveRange('2026-04-16', '2026-04-30');
    const dto1 = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    const firstRes = await controller.calculateEmployee(dto1, createRequest());

    // Duplicate without recalculate=true -> 409 Conflict
    await expect(
      controller.calculateEmployee(dto1, createRequest()),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      statusCode: HttpStatus.CONFLICT,
    });

    // Failed recalculation (0 payable days with NegativeNetPayPolicy=REJECT) must NOT overwrite existing valid record
    leavesStore.length = 0;
    seedUnpaidLeaveRange('2026-04-01', '2026-04-30');
    const failedRecalcDto = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
      recalculate: true,
    });
    await expect(
      controller.calculateEmployee(failedRecalcDto, createRequest()),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    const afterFailed = await recordRepository.findByPeriodAndEmployee(
      periodId,
      employeeId,
    );
    expect(afterFailed!.calculationVersion).toBe(1);
    expect(afterFailed!.__v).toBe(0);
    expect(afterFailed!.netSalary.toString()).toBe('18900.00');

    // Recalculate with recalculate=true and cancelled LWP (full 30 days) -> updates same record atomically
    leavesStore.length = 0;
    const dtoRecalc = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
      recalculate: true,
    });
    const recalcRes = await controller.calculateEmployee(
      dtoRecalc,
      createRequest(),
    );

    expect(recalcRes.data.id).toBe(firstRes.data.id);
    expect(recalcRes.data.calculationVersion).toBe(2);
    expect(recalcRes.data.version).toBe(1);
    expect(new Date(recalcRes.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(firstRes.data.updatedAt).getTime(),
    );
    expect(recalcRes.data.netSalary).toBe('41400.00');
    expect(recordRepository.store.size).toBe(1);
  });

  it('rejects recalculation once payroll period is FINALIZED', async () => {
    const dto = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    await controller.calculateEmployee(dto, createRequest());

    // Finalize the period
    const period = periodsStore.get(periodId.toHexString())!;
    period.status = PayrollPeriodStatus.FINALIZED;

    const recalcDto = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
      recalculate: true,
    });

    await expect(
      controller.calculateEmployee(recalcDto, createRequest()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
  });

  it('enforces JWT authentication (401) and dedicated RBAC permissions (403)', async () => {
    // 1. Unauthenticated request -> 401
    const unauthCtx = createExecutionContext(controller.preview, {
      ip: '10.0.0.1',
      headers: {},
    } as unknown as AuthenticatedRequest);
    await expect(guard.canActivate(unauthCtx)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
      statusCode: HttpStatus.UNAUTHORIZED,
    });

    // 2. User lacking PAYROLL_CALCULATIONS_CREATE -> 403 on calculateEmployee
    activePermissions = [PermissionKeys.PAYROLL_CALCULATIONS_VIEW];
    await expect(
      guard.canActivate(
        createExecutionContext(
          controller.preview,
          createRequest([employeeRoleId]),
        ),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        createExecutionContext(
          controller.calculateEmployee,
          createRequest([employeeRoleId]),
        ),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      statusCode: HttpStatus.FORBIDDEN,
    });
  });

  it('supports BALANCE component end-to-end across preview, persistence, and recalculation without persisting on preview', async () => {
    const specialId = new Types.ObjectId();
    componentsStore.set(specialId.toHexString(), {
      _id: specialId,
      name: 'Special Allowance',
      code: 'SPECIAL_ALLOWANCE',
      type: SalaryComponentType.EARNING,
      calculationType: null,
      percentageOf: null,
      isTaxable: true,
      isStatutory: false,
      defaultValue: null,
      description: null,
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ctcBalanceStructId = new Types.ObjectId();
    structuresStore.set(ctcBalanceStructId.toHexString(), {
      _id: ctcBalanceStructId,
      name: 'Annual CTC With Balance',
      code: 'CTC_BAL_ANN',
      salaryBasis: SalaryStructureBasis.CTC,
      salaryFrequency: SalaryStructureFrequency.ANNUAL,
      salaryAmount: 508800, // Monthly CTC 42,400 (PF_ER 2,400 => Gross 40,000/mo)
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 1,
      components: [
        {
          componentId: basicId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 240000, // 20,000/mo
          percentage: null,
          percentageOf: null,
        },
        {
          componentId: hraId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 50,
          percentageOf: StructureComponentPercentageBasis.BASIC, // 10,000/mo
        },
        {
          componentId: specialId,
          calculationType: StructureComponentCalculationType.BALANCE,
          amount: null,
          percentage: null,
          percentageOf: null,
        },
        {
          componentId: pfEeId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC, // 2,400/mo
        },
        {
          componentId: pfErId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC, // 2,400/mo
        },
      ],
    });

    assignmentsStore.set(employeeId.toHexString(), [
      {
        _id: new Types.ObjectId(),
        employeeId,
        salaryStructureId: ctcBalanceStructId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 508800,
        salaryStructureVersion: 1,
        salarySnapshot: {} as EmployeeSalaryLean['salarySnapshot'],
        status: EmployeeSalaryStatus.ACTIVE,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0,
      },
    ]);

    seedUnpaidLeaveRange('2026-04-16', '2026-04-30');
    const previewDto = await validateBody(CalculatePayrollPreviewInputDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    const previewRes = await controller.preview(previewDto);
    expect(previewRes.data.snapshot.grossEarnings).toBe('20000.00');
    expect(previewRes.data.snapshot.netSalary).toBe('17600.00');
    expect(recordRepository.store.size).toBe(0);

    const calcDto = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
    });
    const persistRes = await controller.calculateEmployee(
      calcDto,
      createRequest(),
    );
    expect(persistRes.data.persisted).toBe(true);
    expect(persistRes.data.grossEarnings).toBe('20000.00');
    expect(persistRes.data.netSalary).toBe('17600.00');

    const stored = await recordRepository.findByPeriodAndEmployee(
      periodId,
      employeeId,
    );
    expect(stored).not.toBeNull();
    const specialSnap = stored!.calculationSnapshot.earnings.find(
      (e) => e.componentCode === 'SPECIAL_ALLOWANCE',
    );
    expect(specialSnap?.calculationMethod).toBe(
      StructureComponentCalculationType.BALANCE,
    );
    expect(specialSnap?.monthlyCalculatedAmount.toString()).toBe('10000.00');
    expect(specialSnap?.finalAmount.toString()).toBe('5000.00');

    leavesStore.length = 0;
    const recalcDto = await validateBody(CalculateEmployeePayrollDto, {
      payrollPeriodId: periodId.toString(),
      employeeId: employeeId.toString(),
      recalculate: true,
    });
    const recalcRes = await controller.calculateEmployee(
      recalcDto,
      createRequest(),
    );
    expect(recalcRes.data.grossEarnings).toBe('40000.00');
    expect(recalcRes.data.netSalary).toBe('37600.00');
  });
});
