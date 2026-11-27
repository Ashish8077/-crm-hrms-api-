import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollInputResolver } from './payroll-input.resolver';
import { SalaryComponentResolver } from './salary-component.resolver';
import { ComponentDependencyResolver } from './component-dependency.resolver';
import { ComponentCalculationEngine } from './component-calculation.engine';
import { ProrationCalculator } from './proration.calculator';
import { PayrollTotalsCalculator } from './payroll-totals.calculator';
import { PayrollSnapshotBuilder } from './payroll-snapshot.builder';
import { PayrollRecordRepository } from '../repositories/payroll-record.repository';
import { PayrollProcessingFailureRepository } from '../repositories/payroll-processing-failure.repository';
import { PayrollPeriodRepository } from '../../payroll-periods/repositories/payroll-period.repository';
import { EmployeeSalaryRepository } from '../../employee-salaries/repositories/employee-salary.repository';
import { SalaryStructureRepository } from '../../salary-structures/repositories/salary-structure.repository';
import { SalaryStructureCalculationService } from '../../salary-structures/services/salary-structure-calculation.service';
import { PayrollSettingsRepository } from '../../payroll-configuration/repositories/payroll-settings.repository';
import { PayrollCalculationRuleRepository } from '../../payroll-configuration/repositories/payroll-calculation-rule.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { Employee } from '../../employees/schemas/employee.schema';
import { SalaryComponent } from '../../salary-components/schemas/salary-component.schema';
import { PayrollPeriodStatus } from '../../payroll-periods/constants/payroll-period.constant';
import {
  PayrollLeaveAttendanceResolution,
  PayrollLeaveAttendanceResolverService,
} from '../../payroll-periods/services/payroll-leave-attendance-resolver.service';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../../payroll-configuration/constants/payroll-configuration.constant';
import {
  EmploymentStatus,
  EmploymentType,
} from '../../employees/constants/employee.constant';
import { EmployeeSalaryStatus } from '../../employee-salaries/constants/employee-salary.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../../salary-structures/constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { PayrollRecordStatus } from '../constants/payroll-calculation.constant';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('PayrollCalculationService (Employee Payroll Calculation Engine)', () => {
  let service: PayrollCalculationService;
  let periodRepo: {
    findById: jest.Mock;
    verifyPeriodMutableAndBumpVersion: jest.Mock;
  };
  let employeeModel: { findById: jest.Mock };
  let employeeSalaryRepo: { findAllByEmployeeId: jest.Mock };
  let structureRepo: { findById: jest.Mock };
  let componentModel: { find: jest.Mock };
  let settingsRepo: { findActive: jest.Mock };
  let ruleRepo: { findActive: jest.Mock };
  let payrollRecordRepo: {
    findByPeriodAndEmployee: jest.Mock;
    create: jest.Mock;
    recalculateAtomically: jest.Mock;
    isDuplicateKeyError: jest.Mock;
  };
  let payrollProcessingFailureRepo: {
    deleteByPeriodAndEmployees: jest.Mock;
  };
  let auditLogsService: { createAuditLog: jest.Mock };
  let connectionMock: { startSession: jest.Mock };
  let sessionMock: {
    withTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let leaveAttendanceResolver: { resolveForEmployee: jest.Mock };

  const actorId = new Types.ObjectId();
  const periodId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const assignmentId = new Types.ObjectId();
  const structureId = new Types.ObjectId();
  const basicId = new Types.ObjectId();
  const hraId = new Types.ObjectId();
  const pfEeId = new Types.ObjectId();
  const pfErId = new Types.ObjectId();

  const makePeriod = (overrides: Record<string, unknown> = {}) => ({
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
    deletedAt: null,
    __v: 0,
    ...overrides,
  });

  const makeEmployee = (overrides: Record<string, unknown> = {}) => ({
    _id: employeeId,
    employeeCode: 'EMP-001',
    firstName: 'John',
    lastName: 'Smith',
    employmentStatus: EmploymentStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  });

  const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
    _id: assignmentId,
    employeeId,
    salaryStructureId: structureId,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 48600,
    salaryStructureVersion: 1,
    status: EmployeeSalaryStatus.ACTIVE,
    __v: 0,
    ...overrides,
  });

  const makeStructure = (overrides: Record<string, unknown> = {}) => ({
    _id: structureId,
    name: 'Standard Monthly CTC',
    code: 'STD_MONTHLY',
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 48600,
    isActive: true,
    __v: 1,
    components: [
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
      {
        componentId: basicId,
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 30000,
        percentage: null,
        percentageOf: null,
      },
    ],
    ...overrides,
  });

  const defaultComponents = [
    {
      _id: basicId,
      code: 'BASIC',
      name: 'Basic Salary',
      type: SalaryComponentType.EARNING,
      isActive: true,
    },
    {
      _id: hraId,
      code: 'HRA',
      name: 'House Rent Allowance',
      type: SalaryComponentType.EARNING,
      isActive: true,
    },
    {
      _id: pfEeId,
      code: 'PF_EE',
      name: 'Employee PF',
      type: SalaryComponentType.EMPLOYEE_DEDUCTION,
      isActive: true,
    },
    {
      _id: pfErId,
      code: 'PF_ER',
      name: 'Employer PF',
      type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
      isActive: true,
    },
  ];

  const mockEmployeeLookup = (doc: unknown) => {
    employeeModel.findById.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      }),
    });
  };

  const mockComponentBatch = (docs: unknown[]) => {
    componentModel.find.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(docs),
      }),
    });
  };

  const makeLeaveAttendanceResolution = (
    tenureCalendarDays: number,
    lopDays = 0,
  ): PayrollLeaveAttendanceResolution => ({
    employeeId: employeeId.toHexString(),
    branchId: 'UNASSIGNED',
    branchTimezone: 'UTC',
    tenureCalendarDays,
    eligibleWorkingDays: tenureCalendarDays,
    weeklyOffDays: 0,
    holidayDays: 0,
    presentDays: Math.max(0, tenureCalendarDays - lopDays),
    halfDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: lopDays,
    unpaidLeaveLopDays: lopDays,
    attendanceAbsenceDays: 0,
    attendanceAbsenceLopDays: 0,
    halfDayDeductions: 0,
    totalLopDays: lopDays,
    incompleteDays: 0,
    pendingCancellationLeaveDays: 0,
    leaveTypeBreakdown: [],
    warnings: [],
    missingDates: [],
    openSessionDates: [],
    incompleteDates: [],
    duplicateAttendanceDates: [],
    unapprovedRegularizedDates: [],
    leaveAttendanceMismatchDates: [],
    overlappingLeaveDates: [],
    conflictingLeaveDates: [],
    outsideTenureAttendanceDates: [],
  });

  const mockLopDaysOnce = (lopDays: number, tenureDays = 30) => {
    leaveAttendanceResolver.resolveForEmployee.mockResolvedValueOnce(
      makeLeaveAttendanceResolution(tenureDays, lopDays),
    );
  };

  beforeEach(async () => {
    leaveAttendanceResolver = {
      resolveForEmployee: jest.fn(
        ({ target }: { target: { tenure: { eligibleDays: number } } }) =>
          Promise.resolve(
            makeLeaveAttendanceResolution(target.tenure.eligibleDays, 0),
          ),
      ),
    };
    periodRepo = {
      findById: jest.fn().mockResolvedValue(makePeriod()),
      verifyPeriodMutableAndBumpVersion: jest.fn().mockResolvedValue(true),
    };
    employeeModel = { findById: jest.fn() };
    mockEmployeeLookup(makeEmployee());
    employeeSalaryRepo = {
      findAllByEmployeeId: jest.fn().mockResolvedValue([makeAssignment()]),
    };
    structureRepo = { findById: jest.fn().mockResolvedValue(makeStructure()) };
    componentModel = { find: jest.fn() };
    mockComponentBatch(defaultComponents);

    settingsRepo = {
      findActive: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        currency: 'INR',
        __v: 0,
      }),
    };
    ruleRepo = {
      findActive: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        roundingMode: PayrollRoundingMode.HALF_EVEN,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: false,
        negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
        componentExecutionOrder: [],
        __v: 0,
      }),
    };
    payrollRecordRepo = {
      findByPeriodAndEmployee: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      recalculateAtomically: jest.fn(),
      isDuplicateKeyError: jest.fn().mockReturnValue(false),
    };
    payrollProcessingFailureRepo = {
      deleteByPeriodAndEmployees: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue(undefined),
    };
    sessionMock = {
      withTransaction: jest.fn(async (work: (s: unknown) => Promise<unknown>) =>
        work(sessionMock),
      ),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connectionMock = {
      startSession: jest.fn().mockResolvedValue(sessionMock),
    };

    const module: TestingModule = await Test.createTestingModule({
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
        { provide: PayrollRecordRepository, useValue: payrollRecordRepo },
        {
          provide: PayrollProcessingFailureRepository,
          useValue: payrollProcessingFailureRepo,
        },
        { provide: PayrollPeriodRepository, useValue: periodRepo },
        { provide: getModelToken(Employee.name), useValue: employeeModel },
        { provide: EmployeeSalaryRepository, useValue: employeeSalaryRepo },
        { provide: SalaryStructureRepository, useValue: structureRepo },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: componentModel,
        },
        { provide: PayrollSettingsRepository, useValue: settingsRepo },
        { provide: PayrollCalculationRuleRepository, useValue: ruleRepo },
        {
          provide: PayrollLeaveAttendanceResolverService,
          useValue: leaveAttendanceResolver,
        },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: getConnectionToken(), useValue: connectionMock },
      ],
    }).compile();

    service = module.get(PayrollCalculationService);
  });

  describe('Input & Eligibility Validation', () => {
    it('rejects when employee is not found (404)', async () => {
      mockEmployeeLookup(null);

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('rejects when employee is soft-deleted (404)', async () => {
      mockEmployeeLookup(makeEmployee({ deletedAt: new Date() }));

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('rejects ineligible employment status (e.g. TERMINATED)', async () => {
      mockEmployeeLookup(
        makeEmployee({ employmentStatus: EmploymentStatus.TERMINATED }),
      );

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('allows mid-month joiner with salary assignment effective from joining date and automatically calculates eligible days', async () => {
      // Period is 2026-04-01 to 2026-04-30 (30 calendar days).
      // Employee joined mid-month on 2026-04-10 (21 eligible days: 10 to 30 April).
      mockEmployeeLookup(
        makeEmployee({ dateOfJoining: new Date('2026-04-10T00:00:00.000Z') }),
      );
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({
          effectiveFrom: new Date('2026-04-10T00:00:00.000Z'),
          effectiveTo: null,
        }),
      ]);

      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      // Period has 30 calendar days; employee has 21 payable days (April 10-30)
      expect(res.snapshot.calendarDays).toBe(30);
      expect(res.snapshot.payableDays).toBe(21);
      expect(res.snapshot.prorationApplied).toBe(true);

      // Monthly gross = 45,000 (Basic 30k + HRA 15k). Prorated = 45000 * 21 / 30 = 31,500.00
      expect(res.snapshot.grossEarnings).toBe('31500.00');
    });

    it('computes mid-month joiner payableDays strictly from tenure minus LOP without client overrides', async () => {
      mockEmployeeLookup(
        makeEmployee({ dateOfJoining: new Date('2026-04-10T00:00:00.000Z') }),
      );
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({
          effectiveFrom: new Date('2026-04-10T00:00:00.000Z'),
          effectiveTo: null,
        }),
      ]);
      // Eligible tenure = 21 days (Apr 10-30), minus 2 LOP days => 19 payable days
      mockLopDaysOnce(2, 21);

      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.tenureCalendarDays).toBe(21);
      expect(res.snapshot.totalLopDays).toBe(2);
      expect(res.snapshot.payableDays).toBe(19);
    });

    it('rejects employee who joined after payroll period end', async () => {
      // Period is April 2026; employee joined May 1, 2026
      mockEmployeeLookup(
        makeEmployee({ dateOfJoining: new Date('2026-05-01T00:00:00.000Z') }),
      );

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('calculates mid-month leaver based on exit date within the payroll period', async () => {
      // Period is 2026-04-01 to 2026-04-30 (30 days); employee leaves on 2026-04-20 (20 eligible days)
      mockEmployeeLookup(
        makeEmployee({
          dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
          lastWorkingDate: new Date('2026-04-20T00:00:00.000Z'),
        }),
      );
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
        }),
      ]);

      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.calendarDays).toBe(30);
      expect(res.snapshot.payableDays).toBe(20);
      expect(res.snapshot.prorationApplied).toBe(true);

      // Monthly gross = 45,000 (Basic 30k + HRA 15k). Prorated = 45000 * 20 / 30 = 30,000.00
      expect(res.snapshot.grossEarnings).toBe('30000.00');
    });

    it('handles employee who resigns on April 10 with last working date of May 31 (full pay in April & May, ineligible in June)', async () => {
      // 1. April 2026 (April 1 to April 30, 30 days)
      mockEmployeeLookup(
        makeEmployee({
          employmentStatus: EmploymentStatus.NOTICE_PERIOD,
          dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
          resignationDate: new Date('2026-04-10T00:00:00.000Z'),
          lastWorkingDate: new Date('2026-05-31T00:00:00.000Z'),
        }),
      );
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: null,
        }),
      ]);

      const aprilRes = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });
      // In April, last working date is in May, so full 30 days
      expect(aprilRes.snapshot.calendarDays).toBe(30);
      expect(aprilRes.snapshot.payableDays).toBe(30);
      expect(aprilRes.snapshot.prorationApplied).toBe(false);
      expect(aprilRes.snapshot.grossEarnings).toBe('45000.00');

      // 2. May 2026 (May 1 to May 31, 31 days)
      const mayPeriodId = new Types.ObjectId();
      periodRepo.findById.mockResolvedValueOnce(
        makePeriod({
          _id: mayPeriodId,
          periodCode: 'PR-2026-05',
          startDate: new Date('2026-05-01T00:00:00.000Z'),
          endDate: new Date('2026-05-31T00:00:00.000Z'),
          month: 5,
        }),
      );

      const mayRes = await service.preview({
        payrollPeriodId: mayPeriodId.toString(),
        employeeId: employeeId.toString(),
      });
      // In May, last working date is May 31, so full 31 days
      expect(mayRes.snapshot.calendarDays).toBe(31);
      expect(mayRes.snapshot.payableDays).toBe(31);
      expect(mayRes.snapshot.prorationApplied).toBe(false);
      expect(mayRes.snapshot.grossEarnings).toBe('45000.00');

      // 3. June 2026 (June 1 to June 30, 30 days) -> employee already left on May 31
      const junePeriodId = new Types.ObjectId();
      periodRepo.findById.mockResolvedValueOnce(
        makePeriod({
          _id: junePeriodId,
          periodCode: 'PR-2026-06',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: new Date('2026-06-30T00:00:00.000Z'),
          month: 6,
        }),
      );

      await expect(
        service.preview({
          payrollPeriodId: junePeriodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects mid-period salary assignment revision from May 16 in a May 1–31 payroll period with 400 VALIDATION_ERROR', async () => {
      const mayPeriodId = new Types.ObjectId();
      periodRepo.findById.mockResolvedValueOnce(
        makePeriod({
          _id: mayPeriodId,
          periodCode: 'PR-2027-05',
          startDate: new Date('2027-05-01T00:00:00.000Z'),
          endDate: new Date('2027-05-31T00:00:00.000Z'),
          month: 5,
          year: 2027,
        }),
      );
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({
          _id: new Types.ObjectId(),
          effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2027-05-16T00:00:00.000Z'),
          status: EmployeeSalaryStatus.SUPERSEDED,
        }),
        makeAssignment({
          _id: new Types.ObjectId(),
          effectiveFrom: new Date('2027-05-16T00:00:00.000Z'),
          effectiveTo: null,
          status: EmployeeSalaryStatus.ACTIVE,
        }),
      ]);

      await expect(
        service.preview({
          payrollPeriodId: mayPeriodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects when no salary assignment exists for employee', async () => {
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([]);

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('rejects when salary assignment does not cover entire period (starts mid-period)', async () => {
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({
          effectiveFrom: new Date('2026-04-10T00:00:00.000Z'),
          effectiveTo: null,
        }),
      ]);

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects mid-period salary revision cleanly without splitting period', async () => {
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({
          _id: new Types.ObjectId(),
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-04-15T00:00:00.000Z'),
          status: EmployeeSalaryStatus.SUPERSEDED,
        }),
        makeAssignment({
          _id: new Types.ObjectId(),
          effectiveFrom: new Date('2026-04-15T00:00:00.000Z'),
          effectiveTo: null,
          status: EmployeeSalaryStatus.ACTIVE,
        }),
      ]);

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('accepts SUPERSEDED assignment covering full April period when revision is on May 1', async () => {
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({
          _id: new Types.ObjectId(),
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-05-01T00:00:00.000Z'),
          status: EmployeeSalaryStatus.SUPERSEDED,
        }),
        makeAssignment({
          _id: new Types.ObjectId(),
          effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
          effectiveTo: null,
          status: EmployeeSalaryStatus.ACTIVE,
        }),
      ]);

      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.persisted).toBe(false);
      expect(res.snapshot.grossEarnings).toBe('45000.00');
    });

    it('rejects when multiple ambiguous assignments cover the full period', async () => {
      employeeSalaryRepo.findAllByEmployeeId.mockResolvedValue([
        makeAssignment({ _id: new Types.ObjectId() }),
        makeAssignment({ _id: new Types.ObjectId() }),
      ]);

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('rejects FINALIZED and COMPLETED payroll periods', async () => {
      periodRepo.findById.mockResolvedValue(
        makePeriod({ status: PayrollPeriodStatus.FINALIZED }),
      );
      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });

      periodRepo.findById.mockResolvedValue(
        makePeriod({ status: PayrollPeriodStatus.COMPLETED }),
      );
      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('permits calculation when payroll period is in DRAFT status', async () => {
      periodRepo.findById.mockResolvedValue(
        makePeriod({ status: PayrollPeriodStatus.DRAFT }),
      );
      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(res.persisted).toBe(false);
      expect(res.snapshot.grossEarnings).toBe('45000.00');
    });

    it('rejects when payroll period is not found (404) or soft-deleted (404)', async () => {
      periodRepo.findById.mockResolvedValue(null);
      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });

      periodRepo.findById.mockResolvedValue(
        makePeriod({ deletedAt: new Date() }),
      );
      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('rejects missing salary structure (404), empty components (400), and inactive master component (400)', async () => {
      structureRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });

      structureRepo.findById.mockResolvedValueOnce(
        makeStructure({ components: [] }),
      );
      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      mockComponentBatch([
        { ...defaultComponents[0], isActive: false },
        ...defaultComponents.slice(1),
      ]);
      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('clamps excessive LOP so payableDays is never negative', async () => {
      leaveAttendanceResolver.resolveForEmployee.mockResolvedValueOnce({
        ...makeLeaveAttendanceResolution(30, 35),
        totalLopDays: 30,
      });

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      }); // Rejected due to NegativeNetPayPolicy=REJECT when 0 payable days yields -3600 net
    });
  });

  describe('Calculation Engine & Business Rules', () => {
    it('calculates percentage components on FULL MONTHLY BASE first, then prorates earnings while tracking employer contribution separately', async () => {
      // Basic: 30,000, HRA: 50% of 30,000 = 15,000 monthly -> 15/30 => Basic 15,000, HRA 7,500 => Gross 22,500
      // PF_EE: 12% of 30,000 = 3,600 (prorateDeductions=false => 3,600)
      // PF_ER: 12% of 30,000 = 3,600 (not subtracted from net salary)
      // Net Salary = 22,500 - 3,600 = 18,900
      mockLopDaysOnce(15, 30);
      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.persisted).toBe(false);
      expect(res.snapshot.calendarDays).toBe(30);
      expect(res.snapshot.payableDays).toBe(15);
      expect(res.snapshot.prorationApplied).toBe(true);
      expect(res.snapshot.grossEarnings).toBe('22500.00');
      expect(res.snapshot.totalDeductions).toBe('3600.00');
      expect(res.snapshot.employerContributionsTotal).toBe('3600.00');
      expect(res.snapshot.netSalary).toBe('18900.00');

      const hraLine = res.snapshot.earnings.find(
        (e) => e.componentCode === 'HRA',
      );
      expect(hraLine?.monthlyBaseAmount).toBe('30000.00');
      expect(hraLine?.monthlyCalculatedAmount).toBe('15000.00');
      expect(hraLine?.finalAmount).toBe('7500.00');
      expect(hraLine?.prorationApplied).toBe(true);
      expect(payrollRecordRepo.create).not.toHaveBeenCalled();
    });

    it('supports prorateEmployerContributions=false (default/legacy) and prorateEmployerContributions=true for June 2027 fixture (PF ₹2,160, Gratuity ₹650, Special Allowance BALANCE ₹8,000)', async () => {
      const gratuityId = new Types.ObjectId();
      const specialId = new Types.ObjectId();
      const junePeriodId = new Types.ObjectId();

      periodRepo.findById.mockResolvedValue(
        makePeriod({
          _id: junePeriodId,
          periodCode: 'PR-2027-06',
          periodName: 'June 2027 Payroll',
          startDate: new Date('2027-06-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T00:00:00.000Z'),
          paymentDate: new Date('2027-07-05T00:00:00.000Z'),
          month: 6,
          year: 2027,
        }),
      );

      // Legacy config missing prorateEmployerContributions field behaves identically to false
      ruleRepo.findActive.mockResolvedValue({
        _id: new Types.ObjectId(),
        roundingMode: PayrollRoundingMode.HALF_UP,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: true,
        negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
        componentExecutionOrder: [],
        __v: 0,
      });

      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL_ALLOWANCE',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
        {
          _id: gratuityId,
          code: 'GRATUITY',
          name: 'Gratuity Provision',
          type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
          isActive: true,
        },
      ]);

      // Monthly Gross = 35,000 => BASIC 18,000 + HRA 9,000 + SPECIAL_ALLOWANCE (BALANCE) 8,000
      // PF_EE = 2,160; PF_ER = 2,160; GRATUITY = 650 => Total ER = 2,810
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 35000,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 18000,
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
              percentageOf: StructureComponentPercentageBasis.BASIC,
            },
            {
              componentId: pfErId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              amount: null,
              percentage: 12,
              percentageOf: StructureComponentPercentageBasis.BASIC,
            },
            {
              componentId: gratuityId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 650,
              percentage: null,
              percentageOf: null,
            },
          ],
        }),
      );

      // 1A. Flag absent (legacy = false) -> Full month (30/30)
      const fullDisabled = await service.preview({
        payrollPeriodId: junePeriodId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(fullDisabled.snapshot.prorateEmployerContributions).toBe(false);
      expect(fullDisabled.snapshot.prorationApplied).toBe(false);
      expect(fullDisabled.snapshot.grossEarnings).toBe('35000.00');
      expect(fullDisabled.snapshot.totalDeductions).toBe('2160.00');
      expect(fullDisabled.snapshot.employerContributionsTotal).toBe('2810.00');
      expect(fullDisabled.snapshot.netSalary).toBe('32840.00');

      // 1B. Flag absent (legacy = false) -> Partial month (15/30): Gross 17,500, Deductions 1,080, ER 2,810, Net 16,420
      mockLopDaysOnce(15, 30);
      const partialDisabled = await service.preview({
        payrollPeriodId: junePeriodId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(partialDisabled.snapshot.prorateEmployerContributions).toBe(false);
      expect(partialDisabled.snapshot.prorationApplied).toBe(true);
      expect(partialDisabled.snapshot.grossEarnings).toBe('17500.00');
      expect(partialDisabled.snapshot.totalDeductions).toBe('1080.00');
      expect(partialDisabled.snapshot.netSalary).toBe('16420.00');
      expect(partialDisabled.snapshot.employerContributionsTotal).toBe(
        '2810.00',
      );
      expect(
        partialDisabled.snapshot.employerContributions.find(
          (c) => c.componentCode === 'PF_ER',
        ),
      ).toMatchObject({
        monthlyCalculatedAmount: '2160.00',
        finalAmount: '2160.00',
        prorationApplied: false,
      });
      expect(
        partialDisabled.snapshot.employerContributions.find(
          (c) => c.componentCode === 'GRATUITY',
        ),
      ).toMatchObject({
        monthlyCalculatedAmount: '650.00',
        finalAmount: '650.00',
        prorationApplied: false,
      });

      // 2. Enable flag (prorateEmployerContributions = true)
      ruleRepo.findActive.mockResolvedValue({
        _id: new Types.ObjectId(),
        roundingMode: PayrollRoundingMode.HALF_UP,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: true,
        prorateEmployerContributions: true,
        negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
        componentExecutionOrder: [],
        __v: 1,
      });

      // 2A. Flag enabled -> Full month (30/30)
      const fullEnabled = await service.preview({
        payrollPeriodId: junePeriodId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(fullEnabled.snapshot.prorateEmployerContributions).toBe(true);
      expect(fullEnabled.snapshot.employerContributionsTotal).toBe('2810.00');

      // 2B. Flag enabled -> Partial month (15/30): Gross 17,500, Deductions 1,080, ER 1,405 (1,080 + 325), Net 16,420
      mockLopDaysOnce(15, 30);
      const partialEnabled = await service.preview({
        payrollPeriodId: junePeriodId.toString(),
        employeeId: employeeId.toString(),
      });
      expect(partialEnabled.snapshot.prorateEmployerContributions).toBe(true);
      expect(partialEnabled.snapshot.prorationApplied).toBe(true);
      expect(partialEnabled.snapshot.grossEarnings).toBe('17500.00');
      expect(partialEnabled.snapshot.totalDeductions).toBe('1080.00');
      expect(partialEnabled.snapshot.netSalary).toBe('16420.00');
      expect(partialEnabled.snapshot.employerContributionsTotal).toBe(
        '1405.00',
      );

      const erPfEnabled = partialEnabled.snapshot.employerContributions.find(
        (c) => c.componentCode === 'PF_ER',
      );
      const gratuityEnabled =
        partialEnabled.snapshot.employerContributions.find(
          (c) => c.componentCode === 'GRATUITY',
        );
      expect(erPfEnabled).toMatchObject({
        monthlyCalculatedAmount: '2160.00',
        finalAmount: '1080.00',
        prorationApplied: true,
      });
      expect(gratuityEnabled).toMatchObject({
        monthlyCalculatedAmount: '650.00',
        finalAmount: '325.00',
        prorationApplied: true,
      });
    });

    it('normalizes ANNUAL salary structure amounts to monthly before proration', async () => {
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryFrequency: SalaryStructureFrequency.ANNUAL,
          salaryAmount: 583200,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 360000, // 30,000/month
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
        }),
      );

      mockLopDaysOnce(15, 30);
      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.grossEarnings).toBe('22500.00');
    });

    it('rejects unsupported calculationType without silent miscalculation', async () => {
      const specialId = new Types.ObjectId();
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 30000,
              percentage: null,
              percentageOf: null,
            },
            {
              componentId: specialId,
              calculationType: 'CUSTOM' as StructureComponentCalculationType,
              amount: null,
              percentage: null,
              percentageOf: null,
            },
          ],
        }),
      );
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
      ]);

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('calculates GROSS + MONTHLY structure with BALANCE earning (FIXED + PERCENTAGE + BALANCE)', async () => {
      const specialId = new Types.ObjectId();
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL_ALLOWANCE',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
      ]);
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 40000,
          components: [
            {
              componentId: specialId,
              calculationType: StructureComponentCalculationType.BALANCE,
              amount: null,
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
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 20000,
              percentage: null,
              percentageOf: null,
            },
            {
              componentId: pfEeId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              amount: null,
              percentage: 12,
              percentageOf: StructureComponentPercentageBasis.BASIC,
            },
          ],
        }),
      );

      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.grossEarnings).toBe('40000.00');
      expect(res.snapshot.totalDeductions).toBe('2400.00');
      expect(res.snapshot.netSalary).toBe('37600.00');
      const special = res.snapshot.earnings.find(
        (e) => e.componentCode === 'SPECIAL_ALLOWANCE',
      );
      expect(special).toMatchObject({
        calculationMethod: StructureComponentCalculationType.BALANCE,
        monthlyBaseAmount: '40000.00',
        monthlyCalculatedAmount: '10000.00',
        finalAmount: '10000.00',
      });
    });

    it('normalizes GROSS + ANNUAL structure with BALANCE to monthly gross and earnings', async () => {
      const specialId = new Types.ObjectId();
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL_ALLOWANCE',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
      ]);
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.ANNUAL,
          salaryAmount: 540000, // 45,000 monthly
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 240000, // 20,000 monthly
              percentage: null,
              percentageOf: null,
            },
            {
              componentId: hraId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              amount: null,
              percentage: 50,
              percentageOf: StructureComponentPercentageBasis.BASIC, // 10,000 monthly
            },
            {
              componentId: specialId,
              calculationType: StructureComponentCalculationType.BALANCE,
              amount: null,
              percentage: null,
              percentageOf: null,
            },
          ],
        }),
      );

      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.grossEarnings).toBe('45000.00');
      const special = res.snapshot.earnings.find(
        (e) => e.componentCode === 'SPECIAL_ALLOWANCE',
      );
      expect(special).toMatchObject({
        monthlyCalculatedAmount: '15000.00',
        finalAmount: '15000.00',
      });
    });

    it('solves target monthly gross from CTC + MONTHLY structure with BALANCE without double-counting employer contributions', async () => {
      const specialId = new Types.ObjectId();
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL_ALLOWANCE',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
      ]);
      // Fixed BASIC = 20,000; HRA = 50% BASIC (10,000); PF_EE = 12% BASIC (2,400); PF_ER = 12% BASIC (2,400)
      // Target Monthly CTC = 42,400 -> Employer cost = 2,400 -> Monthly Gross = 40,000 -> BALANCE = 10,000
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 42400,
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
        }),
      );

      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.grossEarnings).toBe('40000.00');
      expect(res.snapshot.totalDeductions).toBe('2400.00');
      expect(res.snapshot.employerContributionsTotal).toBe('2400.00');
      expect(res.snapshot.netSalary).toBe('37600.00');
      const special = res.snapshot.earnings.find(
        (e) => e.componentCode === 'SPECIAL_ALLOWANCE',
      );
      expect(special!.finalAmount).toBe('10000.00');
    });

    it('solves target monthly gross from CTC + ANNUAL structure with BALANCE matching DB ENG_L2_CTC_001 values', async () => {
      const specialId = new Types.ObjectId();
      const lwfErId = new Types.ObjectId();
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL_ALLOWANCE',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
        {
          _id: lwfErId,
          code: 'LWF_ER',
          name: 'LWF Employer',
          type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
          isActive: true,
        },
      ]);
      // Annual CTC = 70,000, BASIC = 20,000/yr, HRA = 50% BASIC, PF_ER = 12% BASIC (2,400/yr),
      // LWF_ER = 723/yr => grossAnnual = 66,877 -> grossMonthly = 5,573.08
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.ANNUAL,
          salaryAmount: 70000,
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
              percentageOf: StructureComponentPercentageBasis.BASIC,
            },
            {
              componentId: pfErId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              amount: null,
              percentage: 12,
              percentageOf: StructureComponentPercentageBasis.BASIC,
            },
            {
              componentId: lwfErId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 723,
              percentage: null,
              percentageOf: null,
            },
          ],
        }),
      );

      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.grossEarnings).toBe('5573.08');
      const special = res.snapshot.earnings.find(
        (e) => e.componentCode === 'SPECIAL_ALLOWANCE',
      );
      expect(special!.monthlyCalculatedAmount).toBe('3073.08');
      expect(special!.finalAmount).toBe('3073.08');
    });

    it('calculates full monthly BALANCE before partial-period proration and evaluates GROSS deductions after BALANCE', async () => {
      const specialId = new Types.ObjectId();
      const esicEeId = new Types.ObjectId();
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL_ALLOWANCE',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
        {
          _id: esicEeId,
          code: 'ESIC_EE',
          name: 'Employee ESIC',
          type: SalaryComponentType.EMPLOYEE_DEDUCTION,
          isActive: true,
        },
      ]);
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 40000,
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
            {
              componentId: specialId,
              calculationType: StructureComponentCalculationType.BALANCE,
              amount: null,
              percentage: null,
              percentageOf: null,
            },
            {
              componentId: esicEeId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              amount: null,
              percentage: 1,
              percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
            },
          ],
        }),
      );

      mockLopDaysOnce(15, 30);
      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      const special = res.snapshot.earnings.find(
        (e) => e.componentCode === 'SPECIAL_ALLOWANCE',
      );
      expect(special).toMatchObject({
        monthlyCalculatedAmount: '10000.00',
        finalAmount: '5000.00',
      });
      // ESIC_EE = 1% of full 40,000 (not prorated since prorateDeductions=false) = 400.00
      expect(res.snapshot.grossEarnings).toBe('20000.00');
      expect(res.snapshot.totalDeductions).toBe('400.00');
      expect(res.snapshot.netSalary).toBe('19600.00');
    });

    it('rejects negative BALANCE when other earnings exceed target gross', async () => {
      const specialId = new Types.ObjectId();
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL_ALLOWANCE',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
      ]);
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 25000,
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
              percentageOf: StructureComponentPercentageBasis.BASIC, // total fixed+pct = 30,000 > 25,000
            },
            {
              componentId: specialId,
              calculationType: StructureComponentCalculationType.BALANCE,
              amount: null,
              percentage: null,
              percentageOf: null,
            },
          ],
        }),
      );

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects multiple BALANCE components in one salary structure', async () => {
      const special1Id = new Types.ObjectId();
      const special2Id = new Types.ObjectId();
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: special1Id,
          code: 'SPECIAL_1',
          name: 'Special 1',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
        {
          _id: special2Id,
          code: 'SPECIAL_2',
          name: 'Special 2',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
      ]);
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 40000,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 20000,
              percentage: null,
              percentageOf: null,
            },
            {
              componentId: special1Id,
              calculationType: StructureComponentCalculationType.BALANCE,
              amount: null,
              percentage: null,
              percentageOf: null,
            },
            {
              componentId: special2Id,
              calculationType: StructureComponentCalculationType.BALANCE,
              amount: null,
              percentage: null,
              percentageOf: null,
            },
          ],
        }),
      );

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects BALANCE component when classified as DEDUCTION', async () => {
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 40000,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 20000,
              percentage: null,
              percentageOf: null,
            },
            {
              componentId: pfEeId,
              calculationType: StructureComponentCalculationType.BALANCE,
              amount: null,
              percentage: null,
              percentageOf: null,
            },
          ],
        }),
      );

      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects negative net pay when NegativeNetPayPolicy is REJECT', async () => {
      // Payable days = 0 -> gross earnings = 0, deduction PF_EE = 3,600 (prorateDeductions=false) => net = -3,600
      mockLopDaysOnce(30, 30);
      await expect(
        service.preview({
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('clamps negative net pay to zero when NegativeNetPayPolicy is CLAMP_TO_ZERO', async () => {
      ruleRepo.findActive.mockResolvedValue({
        _id: new Types.ObjectId(),
        roundingMode: PayrollRoundingMode.HALF_EVEN,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: false,
        negativeNetPayPolicy: NegativeNetPayPolicy.CLAMP_TO_ZERO,
        componentExecutionOrder: [],
        __v: 0,
      });

      mockLopDaysOnce(30, 30);
      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.grossEarnings).toBe('0.00');
      expect(res.snapshot.totalDeductions).toBe('3600.00');
      expect(res.snapshot.netSalary).toBe('0.00');
      expect(res.snapshot.netPayClamped).toBe(true);
    });

    it('calculates multi-level chained percentage dependencies (BASIC -> HRA -> SPECIAL) using full monthly bases before proration', async () => {
      const specialId = new Types.ObjectId();
      mockComponentBatch([
        ...defaultComponents,
        {
          _id: specialId,
          code: 'SPECIAL',
          name: 'Special Allowance',
          type: SalaryComponentType.EARNING,
          isActive: true,
        },
      ]);
      structureRepo.findById.mockResolvedValue(
        makeStructure({
          components: [
            // Intentionally reversed order to ensure topological resolution
            {
              componentId: specialId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              amount: null,
              percentage: 20,
              percentageOf: 'HRA', // 20% of 15,000 = 3,000 monthly -> 1,500 prorated
            },
            {
              componentId: hraId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              amount: null,
              percentage: 50,
              percentageOf: 'BASIC', // 50% of 30,000 = 15,000 monthly -> 7,500 prorated
            },
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 30000, // 30,000 monthly -> 15,000 prorated
              percentage: null,
              percentageOf: null,
            },
          ],
        }),
      );

      mockLopDaysOnce(15, 30);
      const res = await service.preview({
        payrollPeriodId: periodId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(res.snapshot.executionOrder).toEqual(['BASIC', 'HRA', 'SPECIAL']);
      expect(res.snapshot.grossEarnings).toBe('24000.00');
    });
  });

  describe('Persistence, Duplicate Protection & Recalculation', () => {
    it('persists PayrollRecord with Decimal128 totals, immutable snapshot, and audit log', async () => {
      payrollRecordRepo.create.mockImplementation(
        (input: Record<string, unknown>) =>
          Promise.resolve({
            _id: new Types.ObjectId(),
            ...input,
            createdAt: new Date(),
            updatedAt: new Date(),
            __v: 0,
          }),
      );

      mockLopDaysOnce(15, 30);
      const res = await service.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
        },
        actorId,
      );

      expect(res.persisted).toBe(true);
      expect(res.status).toBe(PayrollRecordStatus.CALCULATED);
      expect(res.calculationVersion).toBe(1);
      expect(res.grossEarnings).toBe('22500.00');
      expect(res.totalDeductions).toBe('3600.00');
      expect(res.employerContributions).toBe('3600.00');
      expect(res.netSalary).toBe('18900.00');
      expect(payrollRecordRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payrollPeriodId: periodId,
          employeeId,
        }),
        sessionMock,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PAYROLL_CALCULATION_EXECUTED,
          targetModel: AuditTargetModel.PAYROLL_RECORD,
        }),
        sessionMock,
      );
    });

    it('rejects duplicate employee-period calculation when recalculate is false/omitted', async () => {
      payrollRecordRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: new Types.ObjectId(),
        status: PayrollRecordStatus.CALCULATED,
        __v: 0,
      });

      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('translates MongoDB E11000 duplicate key error on concurrent insert to 409 Conflict', async () => {
      payrollRecordRepo.create.mockRejectedValue(
        new Error('E11000 duplicate key error'),
      );
      payrollRecordRepo.isDuplicateKeyError.mockReturnValue(true);

      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('rethrows unexpected database errors on persistence', async () => {
      payrollRecordRepo.create.mockRejectedValue(
        new Error('Mongo connection reset'),
      );
      payrollRecordRepo.isDuplicateKeyError.mockReturnValue(false);

      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
          },
          actorId,
        ),
      ).rejects.toThrow('Mongo connection reset');
    });

    it('recalculates existing CALCULATED record atomically when recalculate=true and emits recalculation audit log', async () => {
      const existingId = new Types.ObjectId();
      payrollRecordRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: existingId,
        status: PayrollRecordStatus.CALCULATED,
        calculationVersion: 1,
        __v: 0,
      });
      payrollRecordRepo.recalculateAtomically.mockImplementation(
        (_id: unknown, _ver: unknown, input: Record<string, unknown>) =>
          Promise.resolve({
            _id: existingId,
            payrollPeriodId: periodId,
            employeeId,
            ...input,
            status: PayrollRecordStatus.CALCULATED,
            calculationVersion: 2,
            createdBy: actorId,
            createdAt: new Date(),
            updatedAt: new Date(),
            __v: 1,
          }),
      );

      const res = await service.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
          recalculate: true,
        },
        actorId,
      );

      expect(res.calculationVersion).toBe(2);
      expect(res.version).toBe(1);
      expect(res.netSalary).toBe('41400.00');
      expect(payrollRecordRepo.recalculateAtomically).toHaveBeenCalledWith(
        existingId,
        0,
        expect.any(Object),
        sessionMock,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PAYROLL_CALCULATION_RECALCULATED,
          targetModel: AuditTargetModel.PAYROLL_RECORD,
        }),
        sessionMock,
      );
    });

    it('rejects concurrent recalculation when document __v does not match (optimistic concurrency conflict)', async () => {
      const existingId = new Types.ObjectId();
      payrollRecordRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: existingId,
        status: PayrollRecordStatus.CALCULATED,
        calculationVersion: 1,
        __v: 0,
      });
      payrollRecordRepo.recalculateAtomically.mockResolvedValue(null);

      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
            recalculate: true,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('aborts transaction and rethrows when PAYROLL_CALCULATION_RECALCULATED audit creation fails', async () => {
      const existingId = new Types.ObjectId();
      payrollRecordRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: existingId,
        status: PayrollRecordStatus.CALCULATED,
        calculationVersion: 1,
        __v: 0,
      });
      payrollRecordRepo.recalculateAtomically.mockResolvedValue({
        _id: existingId,
        payrollPeriodId: periodId,
        employeeId,
        salaryAssignmentId: assignmentId,
        salaryStructureId: structureId,
        calculationSnapshot: {},
        grossEarnings: '45000.00',
        totalDeductions: '3600.00',
        employerContributions: '3600.00',
        netSalary: '41400.00',
        status: PayrollRecordStatus.CALCULATED,
        calculationVersion: 2,
        calculatedAt: new Date(),
        createdBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 1,
      });
      auditLogsService.createAuditLog.mockRejectedValueOnce(
        new Error('Audit write failure during recalculation'),
      );

      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
            recalculate: true,
          },
          actorId,
        ),
      ).rejects.toThrow('Audit write failure during recalculation');

      expect(sessionMock.withTransaction).toHaveBeenCalledTimes(1);
      expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
      expect(payrollRecordRepo.recalculateAtomically).toHaveBeenCalledWith(
        existingId,
        0,
        expect.any(Object),
        sessionMock,
      );
    });

    it('aborts transaction and rethrows when PAYROLL_CALCULATION_EXECUTED audit creation fails', async () => {
      payrollRecordRepo.create.mockImplementation(
        (input: Record<string, unknown>) =>
          Promise.resolve({
            _id: new Types.ObjectId(),
            ...input,
            createdAt: new Date(),
            updatedAt: new Date(),
            __v: 0,
          }),
      );
      auditLogsService.createAuditLog.mockRejectedValueOnce(
        new Error('Audit write failure during initial calculation'),
      );

      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
          },
          actorId,
        ),
      ).rejects.toThrow('Audit write failure during initial calculation');

      expect(sessionMock.withTransaction).toHaveBeenCalledTimes(1);
      expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
      expect(payrollRecordRepo.create).toHaveBeenCalledWith(
        expect.any(Object),
        sessionMock,
      );
    });

    it('rejects initial calculation and recalculation inside transaction when period becomes COMPLETED/FINALIZED before commit', async () => {
      periodRepo.verifyPeriodMutableAndBumpVersion.mockResolvedValue(false);

      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
      expect(payrollRecordRepo.create).not.toHaveBeenCalled();

      payrollRecordRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: new Types.ObjectId(),
        status: PayrollRecordStatus.CALCULATED,
        calculationVersion: 1,
        __v: 0,
      });

      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
            recalculate: true,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
      expect(payrollRecordRepo.recalculateAtomically).not.toHaveBeenCalled();
    });

    it('preserves fixed expectedVersion __v and period mutability check across withTransaction retries', async () => {
      const existingId = new Types.ObjectId();
      payrollRecordRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: existingId,
        status: PayrollRecordStatus.CALCULATED,
        calculationVersion: 1,
        __v: 3,
      });

      let attempt = 0;
      sessionMock.withTransaction.mockImplementationOnce(
        async (work: (s: unknown) => Promise<unknown>) => {
          attempt++;
          try {
            return await work(sessionMock);
          } catch {
            attempt++;
            return await work(sessionMock);
          }
        },
      );
      payrollRecordRepo.recalculateAtomically
        .mockRejectedValueOnce(new Error('TransientTransactionError'))
        .mockImplementationOnce(
          (_id: unknown, _ver: unknown, input: Record<string, unknown>) =>
            Promise.resolve({
              _id: existingId,
              payrollPeriodId: periodId,
              employeeId,
              ...input,
              status: PayrollRecordStatus.CALCULATED,
              calculationVersion: 2,
              createdBy: actorId,
              createdAt: new Date(),
              updatedAt: new Date(),
              __v: 4,
            }),
        );

      const res = await service.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
          recalculate: true,
        },
        actorId,
      );

      expect(attempt).toBe(2);
      expect(res.calculationVersion).toBe(2);
      expect(
        periodRepo.verifyPeriodMutableAndBumpVersion,
      ).toHaveBeenCalledTimes(2);
      expect(payrollRecordRepo.recalculateAtomically).toHaveBeenNthCalledWith(
        1,
        existingId,
        3,
        expect.any(Object),
        sessionMock,
      );
      expect(payrollRecordRepo.recalculateAtomically).toHaveBeenNthCalledWith(
        2,
        existingId,
        3,
        expect.any(Object),
        sessionMock,
      );
    });

    it('removes only the matching PayrollProcessingFailure inside the transaction after successful creation/recalculation and skips cleanup on failure', async () => {
      const existingId = new Types.ObjectId();
      payrollRecordRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: existingId,
        payrollPeriodId: periodId,
        employeeId,
        status: PayrollRecordStatus.CALCULATED,
        calculationVersion: 1,
        __v: 1,
      });
      payrollRecordRepo.recalculateAtomically.mockImplementation(
        (_id: unknown, _ver: unknown, input: Record<string, unknown>) =>
          Promise.resolve({
            _id: existingId,
            payrollPeriodId: periodId,
            employeeId,
            ...input,
            status: PayrollRecordStatus.CALCULATED,
            calculationVersion: 2,
            createdBy: actorId,
            createdAt: new Date(),
            updatedAt: new Date(),
            __v: 2,
          }),
      );

      await service.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: periodId.toString(),
          employeeId: employeeId.toString(),
          recalculate: true,
        },
        actorId,
      );

      expect(
        payrollProcessingFailureRepo.deleteByPeriodAndEmployees,
      ).toHaveBeenCalledTimes(1);
      expect(
        payrollProcessingFailureRepo.deleteByPeriodAndEmployees,
      ).toHaveBeenCalledWith(periodId, [employeeId], sessionMock);

      // Failed calculation (e.g., COMPLETED period or missing salary) must NOT call deleteByPeriodAndEmployees
      payrollProcessingFailureRepo.deleteByPeriodAndEmployees.mockClear();
      periodRepo.findById.mockResolvedValue(
        makePeriod({ status: PayrollPeriodStatus.COMPLETED }),
      );
      await expect(
        service.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: periodId.toString(),
            employeeId: employeeId.toString(),
            recalculate: true,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
      expect(
        payrollProcessingFailureRepo.deleteByPeriodAndEmployees,
      ).not.toHaveBeenCalled();
    });
  });
});
