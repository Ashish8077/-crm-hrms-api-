/* eslint-disable @typescript-eslint/require-await */
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { detectMimeTypeFromBuffer } from '../../common/utils/file-signature.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { DepartmentRepository } from '../departments/repositories/department.repository';
import { DesignationRepository } from '../designations/repositories/designation.repository';
import { EmploymentStatus } from '../employees/constants/employee.constant';
import { EmployeeRepository } from '../employees/repositories/employee.repository';
import { PayrollRecordStatus } from '../payroll-calculations/constants/payroll-calculation.constant';
import { PayrollRecordRepository } from '../payroll-calculations/repositories/payroll-record.repository';
import { PayrollRecordLean } from '../payroll-calculations/schemas/payroll-record.schema';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollPeriodStatus } from '../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodRepository } from '../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../payroll-periods/schemas/payroll-period.schema';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../salary-structures/constants/salary-structure.constant';
import {
  FailedStorageOperation,
  FailedStorageStatus,
  StorageOperationType,
} from '../storage/schemas/failed-storage-operation.schema';
import { StorageService } from '../storage/storage.service';
import {
  buildSafePayslipFilename,
  formatMoneyAmountInWords,
  PAYSLIP_CONSTANTS,
  PAYSLIP_TEMPLATE_VERSION,
} from './constants/payslip.constant';
import { PayslipMapper } from './mappers/payslip.mapper';
import { PayslipRepository } from './repositories/payslip.repository';
import { PayslipPdfRendererService } from './services/payslip-pdf-renderer.service';
import { PayslipsService } from './services/payslips.service';

describe('Payslips — Unit Tests (Mapper, Renderer, Safety & Storage Compensation)', () => {
  const periodId = new Types.ObjectId();
  const recordId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const actorId = new Types.ObjectId();

  const makePeriod = (
    overrides: Partial<PayrollPeriodLean> = {},
  ): PayrollPeriodLean =>
    ({
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
      deletedAt: null,
      __v: 3,
      ...overrides,
    }) as unknown as PayrollPeriodLean;

  const makeRecord = (
    overrides: Partial<PayrollRecordLean> = {},
  ): PayrollRecordLean =>
    ({
      _id: recordId,
      payrollPeriodId: periodId,
      employeeId,
      salaryAssignmentId: new Types.ObjectId(),
      salaryStructureId: new Types.ObjectId(),
      grossEarnings: Types.Decimal128.fromString('50000.00'),
      totalDeductions: Types.Decimal128.fromString('2500.50'),
      employerContributions: Types.Decimal128.fromString('1800.00'),
      netSalary: Types.Decimal128.fromString('47499.50'),
      status: PayrollRecordStatus.APPROVED,
      calculatedAt: new Date('2026-04-30T10:00:00.000Z'),
      approvedAt: new Date('2026-04-30T14:00:00.000Z'),
      approvedBy: actorId,
      calculationVersion: 1,
      deletedAt: null,
      createdBy: actorId,
      updatedBy: actorId,
      __v: 1,
      calculationSnapshot: {
        engineVersion: '1.0.0',
        inputFingerprint: 'sha256:secret-internal-fingerprint',
        calculatedAt: new Date('2026-04-30T10:00:00.000Z'),
        payrollPeriodId: periodId.toHexString(),
        periodCode: 'PR-2026-04',
        periodName: 'April 2026 Payroll',
        payrollFrequency: PayrollFrequency.MONTHLY,
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        month: 4,
        year: 2026,
        employeeId: employeeId.toHexString(),
        employeeCode: 'EMP-001',
        employeeName: 'Alice Verma',
        employmentStatus: EmploymentStatus.ACTIVE,
        salaryAssignmentId: new Types.ObjectId().toHexString(),
        salaryAssignmentVersion: 1,
        salaryAssignmentEffectiveFrom: '2026-01-01',
        salaryAssignmentEffectiveTo: null,
        salaryStructureId: new Types.ObjectId().toHexString(),
        salaryStructureCode: 'STD',
        salaryStructureName: 'Standard',
        salaryStructureVersion: 1,
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        payrollSettingsId: null,
        payrollSettingsVersion: null,
        payrollCalculationRuleId: null,
        payrollCalculationRuleVersion: null,
        currency: 'INR',
        roundingMode: PayrollRoundingMode.HALF_EVEN,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: false,
        prorateEmployerContributions: false,
        negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
        calendarDays: 30,
        tenureCalendarDays: 30,
        eligibleWorkingDays: 22,
        weeklyOffDays: 8,
        holidayDays: 0,
        presentDays: 22,
        halfDays: 0,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        unpaidLeaveLopDays: 0,
        attendanceAbsenceDays: 0,
        attendanceAbsenceLopDays: 0,
        halfDayDeductions: 0,
        totalLopDays: 0,
        pendingCancellationLeaveDays: 0,
        attendanceLeaveWarnings: ['INTERNAL_WARNING_DO_NOT_SHOW'],
        leaveAttendanceMismatchDates: [],
        prorationDenominatorDays: 30,
        payableDays: 30,
        prorationApplied: false,
        prorationFactor: '1',
        executionOrder: ['BASIC', 'HRA', 'PF_EE', 'PF_ER'],
        earnings: [
          {
            componentId: '1',
            componentCode: 'BASIC',
            componentName: 'Basic Salary',
            classification: SalaryComponentType.EARNING,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString('30000.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('30000.00'),
            prorationApplied: false,
            payableDays: 30,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString('30000.00'),
          },
          {
            componentId: '2',
            componentCode: 'HRA',
            componentName: 'House Rent Allowance',
            classification: SalaryComponentType.EARNING,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString('20000.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('20000.00'),
            prorationApplied: false,
            payableDays: 30,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString('20000.00'),
          },
        ],
        deductions: [
          {
            componentId: '3',
            componentCode: 'PF_EE',
            componentName: 'Provident Fund (Employee)',
            classification: SalaryComponentType.EMPLOYEE_DEDUCTION,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString('2500.50'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('2500.50'),
            prorationApplied: false,
            payableDays: 30,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString('2500.50'),
          },
        ],
        employerContributions: [
          {
            componentId: '4',
            componentCode: 'PF_ER',
            componentName: 'Provident Fund (Employer)',
            classification: SalaryComponentType.EMPLOYER_CONTRIBUTION,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString('1800.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('1800.00'),
            prorationApplied: false,
            payableDays: 30,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString('1800.00'),
          },
        ],
        grossEarnings: Types.Decimal128.fromString('50000.00'),
        totalDeductions: Types.Decimal128.fromString('2500.50'),
        employerContributionsTotal: Types.Decimal128.fromString('1800.00'),
        netSalary: Types.Decimal128.fromString('47499.50'),
        netPayClamped: false,
      },
      ...overrides,
    }) as unknown as PayrollRecordLean;

  describe('Utilities & Snapshot Mapping', () => {
    it('builds safe sanitized PDF filenames rejecting path traversal characters', () => {
      expect(buildSafePayslipFilename('../PR 2026/04', 'EMP\\001;rm -rf')).toBe(
        'payslip-PR-2026-04-EMP-001-RM-RF.pdf',
      );
      expect(buildSafePayslipFilename('', '')).toBe(
        'payslip-PERIOD-EMPLOYEE.pdf',
      );
    });

    it('formats exact decimal currency amounts in words cleanly without float drift', () => {
      expect(formatMoneyAmountInWords('47499.50', 'INR', 2)).toBe(
        'INR Rupees Forty Seven Thousand Four Hundred Ninety Nine and Fifty Paise Only',
      );
      expect(formatMoneyAmountInWords('1000.00', 'USD', 2)).toBe(
        'USD Dollars One Thousand Only',
      );
      expect(formatMoneyAmountInWords('0.00', 'INR', 2)).toBe(
        'INR Rupees Zero Only',
      );
    });

    it('maps persisted PayrollRecord snapshot accurately into PayslipRenderData', () => {
      const renderData = PayslipMapper.buildRenderData(
        makePeriod(),
        makeRecord(),
        {
          companyName: 'Acme Pvt Ltd',
          companyAddress: '100 Tech Park',
          departmentName: 'Engineering',
          designationName: 'Senior Engineer',
          branchName: 'Bengaluru HQ',
        },
      );

      expect(renderData.companyName).toBe('Acme Pvt Ltd');
      expect(renderData.departmentName).toBe('Engineering');
      expect(renderData.designationName).toBe('Senior Engineer');
      expect(renderData.grossEarnings).toBe('50000.00');
      expect(renderData.totalDeductions).toBe('2500.50');
      expect(renderData.totalEmployerContributions).toBe('1800.00');
      expect(renderData.totalEmployerCost).toBe('51800.00');
      expect(renderData.netSalary).toBe('47499.50');
      expect(renderData.earnings).toHaveLength(2);
      expect(renderData.deductions).toHaveLength(1);
      expect(renderData.employerContributions).toHaveLength(1);
      expect(renderData.fileName).toBe('payslip-PR-2026-04-EMP-001.pdf');
    });

    it('rejects missing snapshot or missing required snapshot fields', () => {
      const missingSnap = makeRecord({
        calculationSnapshot: undefined as never,
      });
      expect(() =>
        PayslipMapper.buildRenderData(makePeriod(), missingSnap),
      ).toThrow(AppError);

      const badRec = makeRecord();
      badRec.calculationSnapshot.employeeName = '   ';
      let caughtBadRec: unknown;
      try {
        PayslipMapper.buildRenderData(makePeriod(), badRec);
      } catch (err) {
        caughtBadRec = err;
      }
      expect(caughtBadRec).toBeInstanceOf(AppError);
      expect(caughtBadRec).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    });

    it('rejects snapshot whose component totals do not reconcile with persisted totals', () => {
      const mismatched = makeRecord();
      mismatched.calculationSnapshot.earnings[0].finalAmount =
        Types.Decimal128.fromString('29000.00');

      let caughtMismatch: unknown;
      try {
        PayslipMapper.buildRenderData(makePeriod(), mismatched);
      } catch (err) {
        caughtMismatch = err;
      }
      expect(caughtMismatch).toBeInstanceOf(AppError);
      expect(caughtMismatch).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    });

    it('renders deterministic PDF buffer with valid %PDF magic bytes', async () => {
      const renderer = new PayslipPdfRendererService();
      const renderData = PayslipMapper.buildRenderData(
        makePeriod(),
        makeRecord(),
      );

      const buf1 = await renderer.renderPdfBuffer(renderData);
      const buf2 = await renderer.renderPdfBuffer(renderData);

      expect(buf1.length).toBeGreaterThan(500);
      expect(detectMimeTypeFromBuffer(buf1)).toBe(PAYSLIP_CONSTANTS.MIME_TYPE);
      expect(buf1.equals(buf2)).toBe(true);
    });
  });

  describe('PayslipsService — PDF Failure, Storage Failure & Transaction Rollback Compensation', () => {
    let service: PayslipsService;
    let payslipRepo: {
      findByPeriodAndEmployee: jest.Mock;
      create: jest.Mock;
      updateRegeneratedAtomically: jest.Mock;
      isDuplicateKeyError: jest.Mock;
    };
    let periodRepo: { findById: jest.Mock };
    let recordRepo: { findByPeriodAndEmployee: jest.Mock };
    let storageService: {
      uploadFile: jest.Mock;
      deleteFile: jest.Mock;
      downloadFile: jest.Mock;
    };
    let failedStorageModel: { create: jest.Mock };
    let pdfRenderer: { renderPdfBuffer: jest.Mock };
    let auditLogsService: { createAuditLog: jest.Mock };

    beforeEach(async () => {
      payslipRepo = {
        findByPeriodAndEmployee: jest.fn().mockResolvedValue(null),
        create: jest.fn(
          (input: Record<string, unknown>): Promise<Record<string, unknown>> =>
            Promise.resolve({
              _id: new Types.ObjectId(),
              ...input,
              createdAt: new Date(),
              updatedAt: new Date(),
              __v: 0,
            }),
        ),
        updateRegeneratedAtomically: jest.fn(
          (
            id: Types.ObjectId,
            expectedVersion: number,
            update: Record<string, unknown>,
          ): Promise<Record<string, unknown>> =>
            Promise.resolve({
              _id: id,
              payrollPeriodId: periodId,
              employeeId,
              ...update,
              createdAt: new Date(),
              updatedAt: new Date(),
              __v: expectedVersion + 1,
            }),
        ),
        isDuplicateKeyError: jest.fn().mockReturnValue(false),
      };
      periodRepo = {
        findById: jest.fn().mockResolvedValue(makePeriod()),
      };
      recordRepo = {
        findByPeriodAndEmployee: jest.fn().mockResolvedValue(makeRecord()),
      };
      storageService = {
        uploadFile: jest.fn().mockResolvedValue({
          key: 'hrms/payroll/payslips/test-uuid.pdf',
        }),
        deleteFile: jest.fn().mockResolvedValue(undefined),
        downloadFile: jest.fn(),
      };
      failedStorageModel = {
        create: jest.fn().mockResolvedValue({}),
      };
      pdfRenderer = {
        renderPdfBuffer: jest
          .fn()
          .mockResolvedValue(Buffer.from('%PDF-1.4 deterministic content')),
      };
      auditLogsService = {
        createAuditLog: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PayslipsService,
          { provide: PayslipRepository, useValue: payslipRepo },
          { provide: PayrollPeriodRepository, useValue: periodRepo },
          { provide: PayrollRecordRepository, useValue: recordRepo },
          {
            provide: EmployeeRepository,
            useValue: { findById: jest.fn().mockResolvedValue(null) },
          },
          {
            provide: DepartmentRepository,
            useValue: { findById: jest.fn().mockResolvedValue(null) },
          },
          {
            provide: DesignationRepository,
            useValue: { findById: jest.fn().mockResolvedValue(null) },
          },
          {
            provide: BranchRepository,
            useValue: { findById: jest.fn().mockResolvedValue(null) },
          },
          {
            provide: AuthorizationService,
            useValue: { hasPermissions: jest.fn().mockResolvedValue(true) },
          },
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: StorageService, useValue: storageService },
          {
            provide: getModelToken(FailedStorageOperation.name),
            useValue: failedStorageModel,
          },
          { provide: PayslipPdfRendererService, useValue: pdfRenderer },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
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
        ],
      }).compile();

      service = module.get(PayslipsService);
    });

    it('handles PDF generation failure cleanly without touching storage or MongoDB', async () => {
      pdfRenderer.renderPdfBuffer.mockRejectedValueOnce(
        new AppError(
          ErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to generate payslip PDF document.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );

      await expect(
        service.generatePayslip(periodId, employeeId, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      });

      expect(storageService.uploadFile).not.toHaveBeenCalled();
      expect(payslipRepo.create).not.toHaveBeenCalled();
    });

    it('handles storage upload failure cleanly without writing Payslip DB record', async () => {
      storageService.uploadFile.mockRejectedValueOnce(
        new AppError(
          ErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to upload file to storage',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );

      await expect(
        service.generatePayslip(periodId, employeeId, actorId, {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
          requestId: 'req-retry-001',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      });

      expect(storageService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          mimetype: PAYSLIP_CONSTANTS.MIME_TYPE,
          originalname: 'payslip-PR-2026-04-EMP-001.pdf',
        }),
        `hrms/payroll/payslips/${periodId.toHexString()}/${employeeId.toHexString()}`,
        [PAYSLIP_CONSTANTS.MIME_TYPE],
        PAYSLIP_CONSTANTS.MAX_PDF_SIZE_BYTES,
        '.pdf',
        'req-retry-001',
      );
      expect(payslipRepo.create).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();

      // Safe retry succeeds cleanly without duplicate outbox or stale state
      const retried = await service.generatePayslip(
        periodId,
        employeeId,
        actorId,
        {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
          requestId: 'req-retry-002',
        },
      );
      expect(retried.fileName).toBe('payslip-PR-2026-04-EMP-001.pdf');
      expect(payslipRepo.create).toHaveBeenCalledTimes(1);
    });

    it('cleans up uploaded storage object and queues outbox entry if DB write fails and S3 cleanup fails', async () => {
      auditLogsService.createAuditLog.mockRejectedValueOnce(
        new Error('Audit write failure'),
      );
      storageService.deleteFile.mockRejectedValueOnce(
        new Error('S3 delete transient error'),
      );

      await expect(
        service.generatePayslip(periodId, employeeId, actorId, {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
          requestId: 'req-comp-001',
        }),
      ).rejects.toThrow('Audit write failure');

      expect(storageService.deleteFile).toHaveBeenCalledWith(
        'hrms/payroll/payslips/test-uuid.pdf',
        'req-comp-001',
      );
      expect(failedStorageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileKey: 'hrms/payroll/payslips/test-uuid.pdf',
          operation: StorageOperationType.DELETE,
          status: FailedStorageStatus.PENDING,
        }),
      );
    });

    it('never exposes internal fileKey in PayslipResponseDto', async () => {
      const res = await service.generatePayslip(periodId, employeeId, actorId);
      expect(
        (res as unknown as Record<string, unknown>).fileKey,
      ).toBeUndefined();
      expect(res.fileName).toBe(`payslip-PR-2026-04-EMP-001.pdf`);
      expect(res.templateVersion).toBe(PAYSLIP_TEMPLATE_VERSION);
    });

    it('downloads and idempotently preserves legacy payslip records without reconstructing keys', async () => {
      const legacyKey = `employees/payslips/${periodId.toHexString()}/${employeeId.toHexString()}/legacy-uuid.pdf`;
      const legacyBuf = Buffer.from('%PDF-1.4 legacy-payslip-bytes');
      const legacySha = createHash('sha256').update(legacyBuf).digest('hex');

      payslipRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: new Types.ObjectId(),
        payrollPeriodId: periodId,
        payrollRecordId: makeRecord()._id,
        employeeId,
        payrollCalculationVersion: 1,
        templateVersion: PAYSLIP_TEMPLATE_VERSION,
        fileKey: legacyKey,
        fileName: 'payslip-PR-2026-04-EMP-001.pdf',
        mimeType: PAYSLIP_CONSTANTS.MIME_TYPE,
        fileSize: legacyBuf.length,
        checksumSha256: legacySha,
        generatedAt: new Date('2026-05-01T00:00:00.000Z'),
        generatedBy: actorId,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z'),
        __v: 0,
      });
      storageService.downloadFile.mockResolvedValue(legacyBuf);

      // Idempotent generate returns existing legacy payslip without uploading/overwriting
      const gen = await service.generatePayslip(periodId, employeeId, actorId, {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        requestId: 'req-legacy-gen',
      });
      expect(gen.fileName).toBe('payslip-PR-2026-04-EMP-001.pdf');
      expect(storageService.downloadFile).toHaveBeenCalledWith(
        legacyKey,
        'req-legacy-gen',
      );
      expect(storageService.uploadFile).not.toHaveBeenCalled();

      // Download reads stored legacyKey verbatim
      const dl = await service.downloadPayslip(
        periodId,
        employeeId,
        actorId,
        [new Types.ObjectId()],
        {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
          requestId: 'req-legacy-dl',
        },
      );
      expect(dl.buffer).toEqual(legacyBuf);
      expect(storageService.downloadFile).toHaveBeenCalledWith(
        legacyKey,
        'req-legacy-dl',
      );
    });

    it('regenerates missing legacy payslip into hrms/payroll/payslips and cleans up old legacy key', async () => {
      const legacyKey = `employees/payslips/${periodId.toHexString()}/${employeeId.toHexString()}/missing-old.pdf`;
      payslipRepo.findByPeriodAndEmployee.mockResolvedValue({
        _id: new Types.ObjectId(),
        payrollPeriodId: periodId,
        payrollRecordId: makeRecord()._id,
        employeeId,
        payrollCalculationVersion: 1,
        templateVersion: PAYSLIP_TEMPLATE_VERSION,
        fileKey: legacyKey,
        fileName: 'payslip-PR-2026-04-EMP-001.pdf',
        mimeType: PAYSLIP_CONSTANTS.MIME_TYPE,
        fileSize: 500,
        checksumSha256: 'deadbeef',
        generatedAt: new Date('2026-05-01T00:00:00.000Z'),
        generatedBy: actorId,
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-01T00:00:00.000Z'),
        __v: 0,
      });
      storageService.downloadFile.mockRejectedValueOnce(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Stored file not found in storage',
          HttpStatus.NOT_FOUND,
        ),
      );

      const regen = await service.generatePayslip(
        periodId,
        employeeId,
        actorId,
        { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-regen-1' },
      );
      expect(regen.version).toBe(1);
      expect(storageService.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        `hrms/payroll/payslips/${periodId.toHexString()}/${employeeId.toHexString()}`,
        [PAYSLIP_CONSTANTS.MIME_TYPE],
        PAYSLIP_CONSTANTS.MAX_PDF_SIZE_BYTES,
        '.pdf',
        'req-regen-1',
      );
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        legacyKey,
        'req-regen-1',
      );
    });
  });
});
