import { HttpStatus } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { AttendanceRegularizationRepository } from '../attendance/repositories/attendance-regularization.repository';
import { AttendanceRepository } from '../attendance/repositories/attendance.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { EmployeeSalaryRepository } from '../employee-salaries/repositories/employee-salary.repository';
import { EmployeeSalaryStatus } from '../employee-salaries/constants/employee-salary.constant';
import { EmployeeSalaryLean } from '../employee-salaries/schemas/employee-salary.schema';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  EmployeeLean,
  EmployeeRepository,
  PayrollAttendanceEmployeeProjection,
} from '../employees/repositories/employee.repository';
import { EmployeeDocument } from '../employees/schemas/employee.schema';
import { HolidayRepository } from '../leaves/repositories/holiday.repository';
import { LeaveRequestRepository } from '../leaves/repositories/leave-request.repository';
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
import { PayrollAttendanceSummaryService } from '../payroll-periods/services/payroll-attendance-summary.service';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
} from '../salary-structures/constants/salary-structure.constant';
import { SalaryStructureRepository } from '../salary-structures/repositories/salary-structure.repository';
import { WeeklyOffConfigRepository } from '../work-schedules/repositories/weekly-off-config.repository';
import { PayrollInputResolver } from './services/payroll-input.resolver';

describe('Payroll Eligibility Consistency (PayrollAttendanceSummaryService vs PayrollInputResolver)', () => {
  const periodId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const deptId = new Types.ObjectId();
  const desigId = new Types.ObjectId();
  const salaryStructureId = new Types.ObjectId();

  const period: PayrollPeriodLean = {
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
    createdBy: new Types.ObjectId(),
    updatedBy: new Types.ObjectId(),
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    __v: 0,
  };

  const makeEmployee = (
    code: string,
    overrides: Partial<EmployeeLean> & { resignationDate?: Date | null } = {},
  ): EmployeeLean & { resignationDate?: Date | null } => ({
    _id: new Types.ObjectId(),
    userId: null,
    employeeCode: code,
    firstName: 'Test',
    lastName: code,
    workEmail: `${code.toLowerCase()}@example.com`,
    dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
    lastWorkingDate: null,
    terminationDate: null,
    departmentId: deptId,
    designationId: desigId,
    branchId,
    teamId: null,
    reportingManagerId: null,
    shiftId: null,
    employmentType: EmploymentType.FULL_TIME,
    employmentStatus: EmploymentStatus.ACTIVE,
    bankDetails: null,
    emergencyContact: null,
    skills: [],
    certifications: [],
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
    ...overrides,
  });

  const makeAssignment = (employeeId: Types.ObjectId): EmployeeSalaryLean =>
    ({
      _id: new Types.ObjectId(),
      employeeId,
      salaryStructureId,
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
      effectiveTo: null,
      status: EmployeeSalaryStatus.ACTIVE,
      baseAmount: 30000,
    }) as unknown as EmployeeSalaryLean;

  function buildServices(
    employees: Array<EmployeeLean & { resignationDate?: Date | null }>,
  ) {
    const employeeById = new Map(
      employees.map((e) => [e._id.toHexString(), e]),
    );

    const periodRepo = {
      findById: jest.fn().mockResolvedValue(period),
    } as unknown as PayrollPeriodRepository;

    const employeeRepo = {
      findForPayrollAttendanceSummary: jest.fn().mockResolvedValue(
        employees
          .filter((e) => e.deletedAt === null)
          .map((e): PayrollAttendanceEmployeeProjection => ({
            _id: e._id,
            employeeCode: e.employeeCode,
            firstName: e.firstName,
            lastName: e.lastName,
            dateOfJoining: e.dateOfJoining,
            lastWorkingDate: e.lastWorkingDate ?? null,
            terminationDate: e.terminationDate ?? null,
            employmentStatus: e.employmentStatus,
            branchId: e.branchId,
            departmentId: e.departmentId,
            designationId: e.designationId,
          })),
      ),
    } as unknown as EmployeeRepository;

    const branchRepo = {
      findByIds: jest.fn().mockResolvedValue([
        {
          _id: branchId,
          name: 'Main Branch',
          timezone: 'Asia/Kolkata',
          isActive: true,
        },
      ]),
    } as unknown as BranchRepository;

    const attendanceRepo = {
      aggregateForPayrollPeriod: jest.fn().mockResolvedValue([]),
    } as unknown as AttendanceRepository;

    const regRepo = {
      findByIds: jest.fn().mockResolvedValue([]),
    } as unknown as AttendanceRegularizationRepository;

    const leaveRepo = {
      findOverlappingForEmployees: jest.fn().mockResolvedValue([]),
    } as unknown as LeaveRequestRepository;

    const holidayRepo = {
      findActiveInRange: jest.fn().mockResolvedValue([]),
    } as unknown as HolidayRepository;

    const weeklyOffRepo = {
      findActiveEffectiveInRange: jest.fn().mockResolvedValue([]),
    } as unknown as WeeklyOffConfigRepository;

    const summaryService = new PayrollAttendanceSummaryService(
      periodRepo,
      employeeRepo,
      branchRepo,
      attendanceRepo,
      regRepo,
      leaveRepo,
      holidayRepo,
      weeklyOffRepo,
    );

    const employeeModel = {
      findById: jest.fn((id: Types.ObjectId) => ({
        lean: () => ({
          exec: () =>
            Promise.resolve(employeeById.get(id.toHexString()) ?? null),
        }),
      })),
    } as unknown as Model<EmployeeDocument>;

    const salaryRepo = {
      findAllByEmployeeId: jest.fn((id: Types.ObjectId) =>
        Promise.resolve([makeAssignment(id)]),
      ),
    } as unknown as EmployeeSalaryRepository;

    const structureRepo = {
      findById: jest.fn().mockResolvedValue({
        _id: salaryStructureId,
        code: 'STD',
        basis: SalaryStructureBasis.GROSS,
        frequency: SalaryStructureFrequency.MONTHLY,
        components: [
          {
            componentId: new Types.ObjectId(),
            code: 'BASIC',
            name: 'Basic',
            type: SalaryComponentType.EARNING,
            fixedAmount: 30000,
          },
        ],
      }),
    } as unknown as SalaryStructureRepository;

    const settingsRepo = {
      findActive: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        currency: 'INR',
        fixedWorkingDaysPerMonth: null,
        __v: 0,
      }),
    } as unknown as PayrollSettingsRepository;

    const ruleRepo = {
      findActive: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        roundingMode: PayrollRoundingMode.HALF_UP,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: true,
        prorateEmployerContributions: true,
        negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
        componentExecutionOrder: [],
        __v: 0,
      }),
    } as unknown as PayrollCalculationRuleRepository;

    const inputResolver = new PayrollInputResolver(
      periodRepo,
      employeeModel,
      salaryRepo,
      structureRepo,
      settingsRepo,
      ruleRepo,
    );

    return { summaryService, inputResolver };
  }

  it('produces identical inclusion, exclusion, and tenure day counts across PayrollAttendanceSummaryService and PayrollInputResolver', async () => {
    const activeFull = makeEmployee('EMP-ACTIVE');
    const midJoiner = makeEmployee('EMP-MID-JOIN', {
      dateOfJoining: new Date('2026-04-10T00:00:00.000Z'),
    });
    const resignedOverlapping = makeEmployee('EMP-RESIGNED-OK', {
      employmentStatus: EmploymentStatus.RESIGNED,
      lastWorkingDate: new Date('2026-04-15T00:00:00.000Z'),
    });
    const terminatedOverlapping = makeEmployee('EMP-TERMINATED-OK', {
      employmentStatus: EmploymentStatus.TERMINATED,
      terminationDate: new Date('2026-04-12T00:00:00.000Z'),
      lastWorkingDate: new Date('2026-04-18T00:00:00.000Z'),
    });
    const noticeResignationOnly = makeEmployee('EMP-NOTICE-SUBMIT-ONLY', {
      employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      resignationDate: new Date('2026-04-10T00:00:00.000Z'),
      lastWorkingDate: null,
    });
    const separatedNoExitDate = makeEmployee('EMP-RESIGNED-NO-EXIT', {
      employmentStatus: EmploymentStatus.RESIGNED,
      resignationDate: new Date('2026-04-18T00:00:00.000Z'),
      lastWorkingDate: null,
      terminationDate: null,
    });
    const terminatedBeforePeriod = makeEmployee('EMP-TERMINATED-OLD', {
      employmentStatus: EmploymentStatus.TERMINATED,
      terminationDate: new Date('2026-03-31T00:00:00.000Z'),
    });
    const postPeriodJoiner = makeEmployee('EMP-FUTURE-JOIN', {
      dateOfJoining: new Date('2026-05-01T00:00:00.000Z'),
    });
    const softDeleted = makeEmployee('EMP-DELETED', {
      deletedAt: new Date('2026-04-05T00:00:00.000Z'),
    });

    const allEmployees = [
      activeFull,
      midJoiner,
      resignedOverlapping,
      terminatedOverlapping,
      noticeResignationOnly,
      separatedNoExitDate,
      terminatedBeforePeriod,
      postPeriodJoiner,
      softDeleted,
    ];

    const { summaryService, inputResolver } = buildServices(allEmployees);
    const summaryRes =
      await summaryService.getPeriodAttendanceSummary(periodId);

    const summaryByCode = new Map(
      summaryRes.employees.map((e) => [e.employeeCode, e]),
    );

    const expectedEligibleDays = new Map<string, number>([
      ['EMP-ACTIVE', 30],
      ['EMP-MID-JOIN', 21],
      ['EMP-RESIGNED-OK', 15],
      ['EMP-TERMINATED-OK', 12],
      ['EMP-NOTICE-SUBMIT-ONLY', 30],
    ]);

    for (const emp of allEmployees) {
      const expectedDays = expectedEligibleDays.get(emp.employeeCode);
      const summaryEntry = summaryByCode.get(emp.employeeCode);

      if (expectedDays !== undefined) {
        expect(summaryEntry).toBeDefined();
        expect(summaryEntry!.tenureCalendarDays).toBe(expectedDays);

        const resolved = await inputResolver.resolve(periodId, emp._id);
        expect(resolved.payableDays).toBe(expectedDays);
      } else {
        expect(summaryEntry).toBeUndefined();
        await expect(
          inputResolver.resolve(periodId, emp._id),
        ).rejects.toMatchObject({
          statusCode:
            emp.deletedAt !== null
              ? HttpStatus.NOT_FOUND
              : HttpStatus.BAD_REQUEST,
        });
      }
    }
  });
});
