/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import {
  ExecutionContext,
  HttpStatus,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { toDecimal } from '../../common/utils/financial-math.util';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { EmploymentStatus } from '../employees/constants/employee.constant';
import { EmployeeRepository } from '../employees/repositories/employee.repository';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollRecordStatus } from '../payroll-calculations/constants/payroll-calculation.constant';
import { PayrollRecordLean } from '../payroll-calculations/schemas/payroll-record.schema';
import {
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodLean } from '../payroll-periods/schemas/payroll-period.schema';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../salary-structures/constants/salary-structure.constant';
import { PAYROLL_REPORTING_CONSTANTS } from './constants/payroll-reporting.constant';
import { PayrollHistoryController } from './controllers/payroll-history.controller';
import { PayrollReportsController } from './controllers/payroll-reports.controller';
import { ListPayrollHistoryQueryDto } from './dto/payroll-history.dto';
import { EmployeeWiseReportQueryDto } from './dto/payroll-reports.dto';
import {
  PayrollReportingMapper,
  computeEmployerCost,
} from './mappers/payroll-reporting.mapper';
import { PayrollReportingRepository } from './repositories/payroll-reporting.repository';
import { PayrollHistoryService } from './services/payroll-history.service';
import { PayrollReportsService } from './services/payroll-reports.service';
import {
  buildSafeCsvFilename,
  escapeCsvCell,
  formatCsvRow,
  sanitizeCsvCell,
} from './utils/csv-export.util';

describe('Payroll Reporting — Unit Tests (Financial Math, CSV Security, Mappers, DTO & RBAC)', () => {
  const periodId = new Types.ObjectId();
  const emp1Id = new Types.ObjectId();
  const emp2Id = new Types.ObjectId();
  const emp1UserId = new Types.ObjectId();
  const actorId = new Types.ObjectId();
  const roleId = new Types.ObjectId();

  const makePeriod = (
    overrides: Partial<PayrollPeriodLean> = {},
  ): PayrollPeriodLean => ({
    _id: periodId,
    periodName: 'April 2026 Payroll',
    periodCode: 'PR-2026-04',
    payrollFrequency: PayrollFrequency.MONTHLY,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-04-30T00:00:00.000Z'),
    paymentDate: new Date('2026-05-01T00:00:00.000Z'),
    month: 4,
    year: 2026,
    status: PayrollPeriodStatus.FINALIZED,
    notes: null,
    processing: {
      processingStatus: PayrollProcessingStatus.COMPLETED,
      totalEligibleEmployees: 2,
      processedEmployees: 2,
      successfulEmployees: 2,
      failedEmployees: 0,
      skippedUpToDateEmployees: 0,
      recalculatedEmployees: 0,
      processingAttempts: 1,
    },
    approval: {
      approvedBy: actorId,
      approvedAt: new Date('2026-04-30T10:00:00.000Z'),
      approvedRecordsCount: 2,
      alreadyApprovedRecordsCount: 0,
      totalGrossEarnings: '100000.00',
      totalDeductions: '4000.00',
      totalEmployerContributions: '3600.00',
      totalNetSalary: '96000.00',
      totalEmployerCost: '103600.00',
      reason: 'Approved',
      acknowledgeAnomalies: false,
      acknowledgedAnomalyEmployees: 0,
      acknowledgedWarningCodes: [],
    },
    deletedAt: null,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T09:00:00.000Z'),
    __v: 3,
    ...overrides,
  });

  const makeRecord = (
    overrides: Partial<PayrollRecordLean> = {},
  ): PayrollRecordLean => ({
    _id: new Types.ObjectId(),
    payrollPeriodId: periodId,
    employeeId: emp1Id,
    salaryAssignmentId: new Types.ObjectId(),
    salaryStructureId: new Types.ObjectId(),
    grossEarnings: Types.Decimal128.fromString('50000.00'),
    totalDeductions: Types.Decimal128.fromString('2500.50'),
    employerContributions: Types.Decimal128.fromString('1800.25'),
    netSalary: Types.Decimal128.fromString('47499.50'),
    status: PayrollRecordStatus.APPROVED,
    calculatedAt: new Date('2026-04-29T00:00:00.000Z'),
    calculationVersion: 1,
    approvedAt: new Date('2026-04-30T00:00:00.000Z'),
    approvedBy: actorId,
    deletedAt: null,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    updatedAt: new Date('2026-04-30T00:00:00.000Z'),
    __v: 1,
    calculationSnapshot: {
      engineVersion: '1.0.0',
      calculatedAt: new Date('2026-04-29T00:00:00.000Z'),
      payrollPeriodId: periodId.toHexString(),
      periodCode: 'PR-2026-04',
      periodName: 'April 2026 Payroll',
      payrollFrequency: PayrollFrequency.MONTHLY,
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      month: 4,
      year: 2026,
      employeeId: emp1Id.toHexString(),
      employeeCode: 'EMP-001',
      employeeName: 'Jane Doe',
      employmentStatus: EmploymentStatus.ACTIVE,
      salaryAssignmentId: new Types.ObjectId().toHexString(),
      salaryAssignmentVersion: 0,
      salaryAssignmentEffectiveFrom: '2026-01-01',
      salaryAssignmentEffectiveTo: null,
      salaryStructureId: new Types.ObjectId().toHexString(),
      salaryStructureCode: 'STD',
      salaryStructureName: 'Standard',
      salaryStructureVersion: 0,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      payrollSettingsId: null,
      payrollSettingsVersion: null,
      payrollCalculationRuleId: null,
      payrollCalculationRuleVersion: null,
      currency: 'INR',
      roundingMode: PayrollRoundingMode.HALF_UP,
      roundingPrecision: 2,
      prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
      prorateFixedComponents: true,
      prorateDeductions: true,
      prorateEmployerContributions: true,
      negativeNetPayPolicy: NegativeNetPayPolicy.CLAMP_TO_ZERO,
      calendarDays: 30,
      tenureCalendarDays: 30,
      eligibleWorkingDays: 22,
      weeklyOffDays: 8,
      holidayDays: 0,
      presentDays: 20,
      halfDays: 1,
      paidLeaveDays: 1,
      unpaidLeaveDays: 1,
      unpaidLeaveLopDays: 1,
      attendanceAbsenceDays: 0,
      attendanceAbsenceLopDays: 0,
      halfDayDeductions: 0.5,
      totalLopDays: 1.5,
      pendingCancellationLeaveDays: 0,
      attendanceLeaveWarnings: [],
      leaveAttendanceMismatchDates: [],
      prorationDenominatorDays: 30,
      payableDays: 28.5,
      prorationApplied: true,
      prorationFactor: '0.95',
      executionOrder: ['BASIC', 'PF_EE', 'PF_ER'],
      earnings: [
        {
          componentId: '1',
          componentCode: 'BASIC',
          componentName: 'Basic',
          classification: SalaryComponentType.EARNING,
          calculationMethod: StructureComponentCalculationType.FIXED,
          percentage: null,
          percentageOf: null,
          monthlyBaseAmount: Types.Decimal128.fromString('50000.00'),
          monthlyCalculatedAmount: Types.Decimal128.fromString('50000.00'),
          prorationApplied: false,
          payableDays: 28.5,
          calendarDays: 30,
          finalAmount: Types.Decimal128.fromString('50000.00'),
        },
      ],
      deductions: [
        {
          componentId: '2',
          componentCode: 'PF_EE',
          componentName: 'PF Employee',
          classification: SalaryComponentType.EMPLOYEE_DEDUCTION,
          calculationMethod: StructureComponentCalculationType.FIXED,
          percentage: null,
          percentageOf: null,
          monthlyBaseAmount: Types.Decimal128.fromString('2500.50'),
          monthlyCalculatedAmount: Types.Decimal128.fromString('2500.50'),
          prorationApplied: false,
          payableDays: 28.5,
          calendarDays: 30,
          finalAmount: Types.Decimal128.fromString('2500.50'),
        },
      ],
      employerContributions: [
        {
          componentId: '3',
          componentCode: 'PF_ER',
          componentName: 'PF Employer',
          classification: SalaryComponentType.EMPLOYER_CONTRIBUTION,
          calculationMethod: StructureComponentCalculationType.FIXED,
          percentage: null,
          percentageOf: null,
          monthlyBaseAmount: Types.Decimal128.fromString('1800.25'),
          monthlyCalculatedAmount: Types.Decimal128.fromString('1800.25'),
          prorationApplied: false,
          payableDays: 28.5,
          calendarDays: 30,
          finalAmount: Types.Decimal128.fromString('1800.25'),
        },
      ],
      grossEarnings: Types.Decimal128.fromString('50000.00'),
      totalDeductions: Types.Decimal128.fromString('2500.50'),
      employerContributionsTotal: Types.Decimal128.fromString('1800.25'),
      netSalary: Types.Decimal128.fromString('47499.50'),
      netPayClamped: false,
    },
    ...overrides,
  });

  describe('Financial Math & CSV Formula Injection Prevention', () => {
    it('computes exact Decimal128 totals and employer cost without JS float drift', () => {
      const gross = Types.Decimal128.fromString('123456.78');
      const er = Types.Decimal128.fromString('5432.22');
      expect(computeEmployerCost(gross, er, 2)).toBe('128889.00');

      const mapped = PayrollReportingMapper.toEmployeeHistoryDetails({
        period: makePeriod(),
        record: makeRecord(),
        payslipAvailable: true,
      });

      expect(mapped.grossEarnings).toBe('50000.00');
      expect(mapped.totalDeductions).toBe('2500.50');
      expect(mapped.employerContributions).toBe('1800.25');
      expect(mapped.netSalary).toBe('47499.50');
      expect(mapped.employerCost).toBe('51800.25');
      expect(
        toDecimal(mapped.grossEarnings)
          .minus(toDecimal(mapped.totalDeductions))
          .equals(toDecimal(mapped.netSalary)),
      ).toBe(true);
      expect(
        toDecimal(mapped.grossEarnings)
          .plus(toDecimal(mapped.employerContributions))
          .equals(toDecimal(mapped.employerCost)),
      ).toBe(true);
    });

    it('sanitizes spreadsheet formula injection triggers and formats safe CSV rows', () => {
      expect(sanitizeCsvCell('=cmd|"/C calc"!A0')).toBe('\'=cmd|"/C calc"!A0');
      expect(sanitizeCsvCell('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
      expect(sanitizeCsvCell('-1+1')).toBe("'-1+1");
      expect(sanitizeCsvCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
      expect(sanitizeCsvCell('  =1+1')).toBe("'  =1+1");
      expect(sanitizeCsvCell('\t=2+2')).toBe("'\t=2+2");
      expect(sanitizeCsvCell('Normal "Employee"')).toBe('Normal "Employee"');
      expect(escapeCsvCell('A "B"')).toBe('"A ""B"""');
      expect(formatCsvRow(['=1+1', 'Safe\nText', 100])).toBe(
        '"\'=1+1","Safe Text","100"\r\n',
      );
      expect(buildSafeCsvFilename('../Payroll Report!!')).toMatch(
        /^payroll-report-\d{4}-\d{2}-\d{2}\.csv$/,
      );
    });
  });

  describe('DTO Validation, Service Rules & RBAC/IDOR Guards', () => {
    let historyService: PayrollHistoryService;
    let reportsService: PayrollReportsService;
    let historyController: PayrollHistoryController;
    let reportsController: PayrollReportsController;
    let repo: jest.Mocked<PayrollReportingRepository>;
    let employeeRepo: jest.Mocked<EmployeeRepository>;
    let guard: PermissionsGuard;
    let reflector: Reflector;
    let activePermissions: string[];
    let validationPipe: ValidationPipe;

    beforeEach(async () => {
      activePermissions = [
        PermissionKeys.PAYROLL_HISTORY_VIEW,
        PermissionKeys.PAYROLL_REPORTS_VIEW,
        PermissionKeys.PAYROLL_REPORTS_EXPORT,
      ];

      repo = {
        findFinalizedPeriodsPaginated: jest
          .fn()
          .mockResolvedValue({ data: [], total: 0 }),
        aggregateTotalsByPeriodIds: jest.fn().mockResolvedValue([]),
        findFinalizedPeriodById: jest.fn().mockResolvedValue(null),
        getPeriodBreakdownStats: jest.fn().mockResolvedValue({
          currencyRows: [],
          invalidatedCount: 0,
          payslipCount: 0,
        }),
        findActiveEmployeeById: jest.fn().mockResolvedValue({ _id: emp1Id }),
        findEmployeeFinalizedHistory: jest
          .fn()
          .mockResolvedValue({ data: [], total: 0 }),
        findEmployeeFinalizedRecordDetails: jest.fn().mockResolvedValue(null),
        findFinalizedPeriodsForReport: jest.fn().mockResolvedValue([]),
        aggregateMonthlySummary: jest.fn().mockResolvedValue([]),
        aggregateDepartmentWise: jest.fn().mockResolvedValue([]),
        aggregateBranchWise: jest.fn().mockResolvedValue([]),
        aggregateEmployeeWise: jest
          .fn()
          .mockResolvedValue({ data: [], total: 0 }),
        openEmployeeWiseCursor: jest.fn(),
        aggregateComponents: jest.fn().mockResolvedValue([]),
      } as unknown as jest.Mocked<PayrollReportingRepository>;

      employeeRepo = {
        findByUserId: jest.fn(async (uid: Types.ObjectId) =>
          uid.equals(emp1UserId) ? ({ _id: emp1Id } as never) : null,
        ),
      } as unknown as jest.Mocked<EmployeeRepository>;

      const module: TestingModule = await Test.createTestingModule({
        controllers: [PayrollHistoryController, PayrollReportsController],
        providers: [
          PayrollHistoryService,
          PayrollReportsService,
          PermissionsGuard,
          Reflector,
          { provide: PayrollReportingRepository, useValue: repo },
          { provide: EmployeeRepository, useValue: employeeRepo },
          {
            provide: AuthorizationService,
            useValue: {
              hasPermissions: jest.fn(
                async (_roles: unknown, reqPerms: string[]) =>
                  reqPerms.every((p) => activePermissions.includes(p)),
              ),
            },
          },
        ],
      }).compile();

      historyService = module.get(PayrollHistoryService);
      reportsService = module.get(PayrollReportsService);
      historyController = module.get(PayrollHistoryController);
      reportsController = module.get(PayrollReportsController);
      guard = module.get(PermissionsGuard);
      reflector = module.get(Reflector);
      expect(reflector).toBeDefined();

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

    it('rejects non-FINALIZED status queries safely without querying non-finalized history', async () => {
      for (const nonFinalized of [
        PayrollPeriodStatus.DRAFT,
        PayrollPeriodStatus.PROCESSING,
        PayrollPeriodStatus.COMPLETED,
        PayrollPeriodStatus.APPROVED,
      ]) {
        const res = await historyService.listHistory({
          status: nonFinalized,
          page: 1,
          limit: 20,
        });
        expect(res.data).toEqual([]);
        expect(res.meta.total).toBe(0);
      }
      expect(repo.findFinalizedPeriodsPaginated).not.toHaveBeenCalled();
    });

    it('validates max page size (100) and rejects unknown query parameters', async () => {
      await expect(
        validationPipe.transform(
          { page: 1, limit: PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT + 1 },
          { type: 'query', metatype: ListPayrollHistoryQueryDto },
        ),
      ).rejects.toMatchObject({ statusCode: HttpStatus.BAD_REQUEST });

      await expect(
        validationPipe.transform(
          { year: 2026, includeSalarySecret: true },
          { type: 'query', metatype: EmployeeWiseReportQueryDto },
        ),
      ).rejects.toMatchObject({ statusCode: HttpStatus.BAD_REQUEST });
    });

    it('enforces self-service IDOR ownership and blocks organization reports from ordinary employees', async () => {
      activePermissions = [PermissionKeys.PAYROLL_HISTORY_VIEW_OWN];

      const makeCtx = (
        handler: (...args: never[]) => unknown,
      ): ExecutionContext =>
        ({
          getHandler: () => handler,
          getClass: () => PayrollReportsController,
          switchToHttp: () => ({
            getRequest: () => ({
              user: { userId: emp1UserId, roleIds: [roleId] },
            }),
          }),
        }) as unknown as ExecutionContext;

      // Org endpoints blocked by PermissionsGuard
      for (const orgEndpoint of [
        historyController.listHistory,
        historyController.getPeriodHistoryDetails,
        reportsController.getMonthlySummary,
        reportsController.getDepartmentWiseReport,
        reportsController.getBranchWiseReport,
        reportsController.getEmployeeWiseReport,
        reportsController.getComponentReport,
        reportsController.exportMonthlySummary,
        reportsController.exportEmployeeWiseReport,
      ]) {
        await expect(
          guard.canActivate(makeCtx(orgEndpoint as never)),
        ).rejects.toMatchObject({ statusCode: HttpStatus.FORBIDDEN });
      }

      // Employee 1 can access own history
      await expect(
        historyController.listEmployeeHistory(emp1Id, {}, {
          user: { userId: emp1UserId, roleIds: [roleId] },
        } as unknown as AuthenticatedRequest),
      ).resolves.toMatchObject({ success: true, data: [] });

      // Employee 1 CANNOT access Employee 2 history or details (403 IDOR block)
      await expect(
        historyController.listEmployeeHistory(emp2Id, {}, {
          user: { userId: emp1UserId, roleIds: [roleId] },
        } as unknown as AuthenticatedRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });

      await expect(
        historyController.getEmployeePeriodHistoryDetails(emp2Id, periodId, {
          user: { userId: emp1UserId, roleIds: [roleId] },
        } as unknown as AuthenticatedRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('streams sanitized CSV responses cleanly with safe headers', async () => {
      repo.findFinalizedPeriodsForReport.mockResolvedValue([makePeriod()]);
      repo.aggregateMonthlySummary.mockResolvedValue([
        {
          currency: 'INR',
          precision: 2,
          totalEmployees: 1,
          totalRecords: 1,
          totalGrossEarnings: Types.Decimal128.fromString('50000.00'),
          totalEmployeeDeductions: Types.Decimal128.fromString('2500.50'),
          totalNetSalary: Types.Decimal128.fromString('47499.50'),
          totalEmployerContributions: Types.Decimal128.fromString('1800.25'),
          totalLOPDays: 1.5,
        },
      ]);
      repo.openEmployeeWiseCursor.mockReturnValue(
        (async function* () {
          yield {
            employeeId: emp1Id,
            employeeCode: '=EMP-001',
            employeeName: '+Evil Admin',
            departmentId: null,
            departmentName: '@Ops',
            branchId: null,
            branchName: '-HQ',
            currency: 'INR',
            precision: 2,
            periodCount: 1,
            grossEarnings: Types.Decimal128.fromString('50000.00'),
            deductions: Types.Decimal128.fromString('2500.50'),
            netSalary: Types.Decimal128.fromString('47499.50'),
            employerContributions: Types.Decimal128.fromString('1800.25'),
            totalLOPDays: 1.5,
          };
        })(),
      );

      const chunks1: string[] = [];
      const headers1: Record<string, unknown> = {};
      await reportsService.streamEmployeeWiseCsv({}, {
        set: (h: Record<string, unknown>) => Object.assign(headers1, h),
        write: (c: string) => chunks1.push(c),
        end: jest.fn(),
      } as unknown as Response);

      const csvText = chunks1.join('');
      expect(headers1['Content-Type']).toBe('text/csv; charset=utf-8');
      expect(headers1['Cache-Control']).toBe('no-store, private');
      expect(headers1['X-Content-Type-Options']).toBe('nosniff');
      expect(csvText).toContain('"\'=EMP-001"');
      expect(csvText).toContain('"\'+Evil Admin"');
      expect(csvText).toContain('"\'@Ops"');
      expect(csvText).toContain('"\'-HQ"');
      expect(csvText).toContain('"51800.25"');

      const chunks2: string[] = [];
      await reportsService.streamMonthlySummaryCsv({}, {
        set: jest.fn(),
        write: (c: string) => chunks2.push(c),
        end: jest.fn(),
      } as unknown as Response);
      expect(chunks2.join('')).toContain(
        '"PR-2026-04","INR","1","1","50000.00"',
      );
    });
  });
});
