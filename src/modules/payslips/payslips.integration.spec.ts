/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import {
  ExecutionContext,
  HttpStatus,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { detectMimeTypeFromBuffer } from '../../common/utils/file-signature.util';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/constants/audit-log.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { DepartmentRepository } from '../departments/repositories/department.repository';
import { DesignationRepository } from '../designations/repositories/designation.repository';
import { EmploymentStatus } from '../employees/constants/employee.constant';
import {
  EmployeeLean,
  EmployeeRepository,
} from '../employees/repositories/employee.repository';
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
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../salary-structures/constants/salary-structure.constant';
import { FailedStorageOperation } from '../storage/schemas/failed-storage-operation.schema';
import { StorageService } from '../storage/storage.service';
import { PAYSLIP_CONSTANTS } from './constants/payslip.constant';
import { ListPayslipsQueryDto } from './dto/payslip.dto';
import { PayslipsController } from './payslips.controller';
import {
  CreatePayslipInput,
  PayslipRepository,
} from './repositories/payslip.repository';
import { PayslipLean } from './schemas/payslip.schema';
import { PayslipPdfRendererService } from './services/payslip-pdf-renderer.service';
import { PayslipsService } from './services/payslips.service';

describe('PayslipsModule — Integration Suite (Eligibility, RBAC/IDOR, Idempotency, Concurrency & Storage Integrity)', () => {
  let controller: PayslipsController;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;

  let periodStore: Map<string, PayrollPeriodLean>;
  let recordStore: Map<string, PayrollRecordLean>;
  let payslipStore: Map<string, PayslipLean>;
  let employeeStore: Map<string, EmployeeLean>;
  let s3Buckets: Map<string, Buffer>;
  let auditLogs: Array<Record<string, unknown>>;
  let activePermissions: string[];

  const hrUserId = new Types.ObjectId();
  const emp1UserId = new Types.ObjectId();
  const emp2UserId = new Types.ObjectId();
  const managerUserId = new Types.ObjectId();
  const roleId = new Types.ObjectId();

  const periodId = new Types.ObjectId();
  const emp1Id = new Types.ObjectId();
  const emp2Id = new Types.ObjectId();
  const deptId = new Types.ObjectId();
  const desigId = new Types.ObjectId();
  const branchId = new Types.ObjectId();

  let simulateDupKeyOnce = false;

  const clonePayslip = (doc: PayslipLean): PayslipLean => ({ ...doc });

  const makeReq = (userId: Types.ObjectId = hrUserId): AuthenticatedRequest =>
    ({
      user: {
        userId,
        email: 'actor@company.com',
        roleIds: [roleId],
      },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest-payslips' },
    }) as unknown as AuthenticatedRequest;

  const makeExecCtx = (
    handler: object,
    req: AuthenticatedRequest = makeReq(),
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PayslipsController,
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;

  const makeRecordFor = (
    eId: Types.ObjectId,
    eCode: string,
    eName: string,
    status: PayrollRecordStatus = PayrollRecordStatus.APPROVED,
    pId: Types.ObjectId = periodId,
  ): PayrollRecordLean =>
    ({
      _id: new Types.ObjectId(),
      payrollPeriodId: pId,
      employeeId: eId,
      salaryAssignmentId: new Types.ObjectId(),
      salaryStructureId: new Types.ObjectId(),
      grossEarnings: Types.Decimal128.fromString('50000.00'),
      totalDeductions: Types.Decimal128.fromString('2000.00'),
      employerContributions: Types.Decimal128.fromString('1500.00'),
      netSalary: Types.Decimal128.fromString('48000.00'),
      status,
      calculatedAt: new Date('2026-04-30T10:00:00.000Z'),
      approvedAt:
        status === PayrollRecordStatus.APPROVED
          ? new Date('2026-04-30T15:00:00.000Z')
          : null,
      approvedBy: status === PayrollRecordStatus.APPROVED ? hrUserId : null,
      calculationVersion: 1,
      deletedAt: null,
      createdBy: hrUserId,
      updatedBy: hrUserId,
      __v: 1,
      calculationSnapshot: {
        engineVersion: '1.0.0',
        inputFingerprint: 'fp-internal-only',
        calculatedAt: new Date('2026-04-30T10:00:00.000Z'),
        payrollPeriodId: pId.toHexString(),
        periodCode: 'PR-2026-04',
        periodName: 'April 2026 Payroll',
        payrollFrequency: PayrollFrequency.MONTHLY,
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        month: 4,
        year: 2026,
        employeeId: eId.toHexString(),
        employeeCode: eCode,
        employeeName: eName,
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
        attendanceLeaveWarnings: [],
        leaveAttendanceMismatchDates: [],
        prorationDenominatorDays: 30,
        payableDays: 30,
        prorationApplied: false,
        prorationFactor: '1',
        executionOrder: ['BASIC', 'PF_EE', 'PF_ER'],
        earnings: [
          {
            componentId: '1',
            componentCode: 'BASIC',
            componentName: 'Basic Salary',
            classification: SalaryComponentType.EARNING,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString('50000.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('50000.00'),
            prorationApplied: false,
            payableDays: 30,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString('50000.00'),
          },
        ],
        deductions: [
          {
            componentId: '2',
            componentCode: 'PF_EE',
            componentName: 'Employee PF',
            classification: SalaryComponentType.EMPLOYEE_DEDUCTION,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString('2000.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('2000.00'),
            prorationApplied: false,
            payableDays: 30,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString('2000.00'),
          },
        ],
        employerContributions: [
          {
            componentId: '3',
            componentCode: 'PF_ER',
            componentName: 'Employer PF',
            classification: SalaryComponentType.EMPLOYER_CONTRIBUTION,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString('1500.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('1500.00'),
            prorationApplied: false,
            payableDays: 30,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString('1500.00'),
          },
        ],
        grossEarnings: Types.Decimal128.fromString('50000.00'),
        totalDeductions: Types.Decimal128.fromString('2000.00'),
        employerContributionsTotal: Types.Decimal128.fromString('1500.00'),
        netSalary: Types.Decimal128.fromString('48000.00'),
        netPayClamped: false,
      },
    }) as unknown as PayrollRecordLean;

  beforeAll(async () => {
    periodStore = new Map();
    recordStore = new Map();
    payslipStore = new Map();
    employeeStore = new Map();
    s3Buckets = new Map();
    auditLogs = [];
    activePermissions = [];

    const payslipRepoMock = {
      isDuplicateKeyError: jest.fn(
        (err: unknown) =>
          typeof err === 'object' &&
          err !== null &&
          (err as { code?: number }).code === 11000,
      ),
      create: jest.fn(async (input: CreatePayslipInput) => {
        if (simulateDupKeyOnce) {
          simulateDupKeyOnce = false;
          throw Object.assign(new Error('E11000 duplicate key'), {
            code: 11000,
          });
        }
        const key = `${input.payrollPeriodId.toHexString()}:${input.employeeId.toHexString()}`;
        if (payslipStore.has(key)) {
          throw Object.assign(new Error('E11000 duplicate key'), {
            code: 11000,
          });
        }
        const doc: PayslipLean = {
          _id: new Types.ObjectId(),
          ...input,
          createdAt: new Date(),
          updatedAt: new Date(),
          __v: 0,
        };
        payslipStore.set(key, doc);
        return clonePayslip(doc);
      }),
      findByPeriodAndEmployee: jest.fn(
        async (pId: Types.ObjectId, eId: Types.ObjectId) => {
          const doc = payslipStore.get(
            `${pId.toHexString()}:${eId.toHexString()}`,
          );
          return doc ? clonePayslip(doc) : null;
        },
      ),
      updateRegeneratedAtomically: jest.fn(
        async (
          id: Types.ObjectId,
          expectedVersion: number,
          update: Record<string, unknown>,
        ) => {
          for (const [key, doc] of payslipStore.entries()) {
            if (doc._id.equals(id) && (doc.__v ?? 0) === expectedVersion) {
              const updated: PayslipLean = {
                ...doc,
                ...update,
                updatedAt: new Date(),
                __v: (doc.__v ?? 0) + 1,
              };
              payslipStore.set(key, updated);
              return clonePayslip(updated);
            }
          }
          return null;
        },
      ),
      findPaginatedByPeriod: jest.fn(
        async (
          pId: Types.ObjectId,
          query: { page: number; limit: number; search?: string },
        ) => {
          const rows = Array.from(payslipStore.values())
            .filter((p) => p.payrollPeriodId.equals(pId))
            .map((p) => {
              const rec = Array.from(recordStore.values()).find((r) =>
                r._id.equals(p.payrollRecordId),
              )!;
              return {
                id: p._id,
                payrollPeriodId: p.payrollPeriodId,
                payrollRecordId: p.payrollRecordId,
                employeeId: p.employeeId,
                employeeCode: rec.calculationSnapshot.employeeCode,
                employeeName: rec.calculationSnapshot.employeeName,
                currency: rec.calculationSnapshot.currency,
                grossEarnings: rec.grossEarnings,
                totalDeductions: rec.totalDeductions,
                netSalary: rec.netSalary,
                payrollCalculationVersion: p.payrollCalculationVersion,
                templateVersion: p.templateVersion,
                fileName: p.fileName,
                mimeType: p.mimeType,
                fileSize: p.fileSize,
                generatedAt: p.generatedAt,
                generatedBy: p.generatedBy,
              };
            })
            .filter((row) => {
              if (!query.search) return true;
              const s = query.search.toLowerCase();
              return (
                row.employeeCode.toLowerCase().includes(s) ||
                row.employeeName.toLowerCase().includes(s)
              );
            });
          const skip = (query.page - 1) * query.limit;
          return {
            data: rows.slice(skip, skip + query.limit),
            total: rows.length,
          };
        },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayslipsController],
      providers: [
        PayslipsService,
        PayslipPdfRendererService,
        Reflector,
        PermissionsGuard,
        { provide: PayslipRepository, useValue: payslipRepoMock },
        {
          provide: PayrollPeriodRepository,
          useValue: {
            findById: jest.fn(
              async (id: Types.ObjectId) =>
                periodStore.get(id.toHexString()) ?? null,
            ),
          },
        },
        {
          provide: PayrollRecordRepository,
          useValue: {
            findByPeriodAndEmployee: jest.fn(
              async (pId: Types.ObjectId, eId: Types.ObjectId) =>
                recordStore.get(`${pId.toHexString()}:${eId.toHexString()}`) ??
                null,
            ),
          },
        },
        {
          provide: EmployeeRepository,
          useValue: {
            findById: jest.fn(
              async (id: Types.ObjectId) =>
                employeeStore.get(id.toHexString()) ?? null,
            ),
            findByUserId: jest.fn(
              async (userId: Types.ObjectId) =>
                Array.from(employeeStore.values()).find(
                  (e) => e.userId && e.userId.equals(userId),
                ) ?? null,
            ),
          },
        },
        {
          provide: DepartmentRepository,
          useValue: {
            findById: jest.fn(async (id: Types.ObjectId) =>
              id.equals(deptId) ? { _id: deptId, name: 'Engineering' } : null,
            ),
          },
        },
        {
          provide: DesignationRepository,
          useValue: {
            findById: jest.fn(async (id: Types.ObjectId) =>
              id.equals(desigId)
                ? { _id: desigId, name: 'Principal Engineer' }
                : null,
            ),
          },
        },
        {
          provide: BranchRepository,
          useValue: {
            findById: jest.fn(async (id: Types.ObjectId) =>
              id.equals(branchId)
                ? {
                    _id: branchId,
                    name: 'HQ Mumbai',
                    address: 'BKC, Mumbai',
                  }
                : null,
            ),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            hasPermissions: jest.fn(
              async (_roles: unknown, required: string[]) =>
                required.every((p) => activePermissions.includes(p)),
            ),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn(async (entry: Record<string, unknown>) => {
              auditLogs.push(entry);
            }),
          },
        },
        {
          provide: StorageService,
          useValue: {
            uploadFile: jest.fn(
              async (file: { buffer: Buffer }, folder: string) => {
                const key = `${folder}/${randomUUID()}.pdf`;
                s3Buckets.set(key, Buffer.from(file.buffer));
                return { key };
              },
            ),
            downloadFile: jest.fn(async (key: string) => {
              const buf = s3Buckets.get(key);
              if (!buf) {
                throw new AppError(
                  ErrorCode.RESOURCE_NOT_FOUND,
                  'Stored file not found in storage',
                  HttpStatus.NOT_FOUND,
                );
              }
              return Buffer.from(buf);
            }),
            deleteFile: jest.fn(async (key: string) => {
              s3Buckets.delete(key);
            }),
          },
        },
        {
          provide: getModelToken(FailedStorageOperation.name),
          useValue: { create: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: getConnectionToken(),
          useValue: {
            startSession: jest.fn(async () => ({
              withTransaction: jest.fn(
                async (cb: (s: unknown) => Promise<unknown>) => {
                  const snap = new Map(payslipStore);
                  const auditLen = auditLogs.length;
                  try {
                    return await cb({ tx: true });
                  } catch (err) {
                    payslipStore = snap;
                    auditLogs.splice(auditLen);
                    throw err;
                  }
                },
              ),
              endSession: jest.fn().mockResolvedValue(undefined),
            })),
          },
        },
      ],
    }).compile();

    controller = module.get(PayslipsController);
    guard = module.get(PermissionsGuard);
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
    periodStore.clear();
    recordStore.clear();
    payslipStore.clear();
    employeeStore.clear();
    s3Buckets.clear();
    auditLogs = [];
    simulateDupKeyOnce = false;
    activePermissions = [
      PermissionKeys.PAYSLIPS_VIEW,
      PermissionKeys.PAYSLIPS_CREATE,
      PermissionKeys.PAYSLIPS_EXPORT,
    ];

    periodStore.set(periodId.toHexString(), {
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
    } as unknown as PayrollPeriodLean);

    employeeStore.set(emp1Id.toHexString(), {
      _id: emp1Id,
      userId: emp1UserId,
      employeeCode: 'EMP-001',
      firstName: 'Alice',
      lastName: 'Verma',
      departmentId: deptId,
      designationId: desigId,
      branchId,
      deletedAt: null,
    } as unknown as EmployeeLean);

    employeeStore.set(emp2Id.toHexString(), {
      _id: emp2Id,
      userId: emp2UserId,
      employeeCode: 'EMP-002',
      firstName: 'Bob',
      lastName: 'Shah',
      departmentId: deptId,
      designationId: desigId,
      branchId,
      deletedAt: null,
    } as unknown as EmployeeLean);

    recordStore.set(
      `${periodId.toHexString()}:${emp1Id.toHexString()}`,
      makeRecordFor(emp1Id, 'EMP-001', 'Alice Verma'),
    );
    recordStore.set(
      `${periodId.toHexString()}:${emp2Id.toHexString()}`,
      makeRecordFor(emp2Id, 'EMP-002', 'Bob Shah'),
    );
  });

  it('rejects generation for DRAFT, PROCESSING, COMPLETED, and APPROVED (unfinalized) periods', async () => {
    for (const badStatus of [
      PayrollPeriodStatus.DRAFT,
      PayrollPeriodStatus.PROCESSING,
      PayrollPeriodStatus.COMPLETED,
      PayrollPeriodStatus.APPROVED,
    ]) {
      periodStore.get(periodId.toHexString())!.status = badStatus;
      await expect(
        controller.generatePayslip(periodId, emp1Id, makeReq()),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    }
    expect(s3Buckets.size).toBe(0);
    expect(payslipStore.size).toBe(0);
  });

  it('rejects missing PayrollRecord (404), INVALIDATED record (409), and unapproved CALCULATED record (409)', async () => {
    const unknownEmpId = new Types.ObjectId();
    await expect(
      controller.generatePayslip(periodId, unknownEmpId, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      statusCode: HttpStatus.NOT_FOUND,
    });

    const emp1Key = `${periodId.toHexString()}:${emp1Id.toHexString()}`;
    recordStore.get(emp1Key)!.status = PayrollRecordStatus.INVALIDATED;
    await expect(
      controller.generatePayslip(periodId, emp1Id, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    recordStore.get(emp1Key)!.status = PayrollRecordStatus.CALCULATED;
    await expect(
      controller.generatePayslip(periodId, emp1Id, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
  });

  it('generates PDF idempotently, streams download cleanly, regenerates missing/corrupt files, and handles duplicate-key concurrency', async () => {
    // 1. Initial generate
    const gen1 = await controller.generatePayslip(periodId, emp1Id, makeReq());
    expect(gen1.data.fileName).toBe('payslip-PR-2026-04-EMP-001.pdf');
    expect(gen1.data.netSalary).toBe('48000.00');
    expect(
      (gen1.data as unknown as Record<string, unknown>).fileKey,
    ).toBeUndefined();
    expect(s3Buckets.size).toBe(1);
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe(AuditAction.PAYSLIP_GENERATED);
    // Audit details never leak netSalary or storage keys
    expect(
      (auditLogs[0].details as Record<string, unknown>).netSalary,
    ).toBeUndefined();
    expect(
      (auditLogs[0].details as Record<string, unknown>).fileKey,
    ).toBeUndefined();

    const firstKey = Array.from(s3Buckets.keys())[0];
    expect(firstKey.startsWith('hrms/payroll/payslips/')).toBe(true);

    // 2. Repeat generate -> returns same payslip idempotently without extra upload or DB write
    const gen2 = await controller.generatePayslip(periodId, emp1Id, makeReq());
    expect(gen2.data.id).toBe(gen1.data.id);
    expect(gen2.data.version).toBe(0);
    expect(s3Buckets.size).toBe(1);
    expect(auditLogs).toHaveLength(1);

    // 3. Download streams exact verified %PDF buffer with safe headers
    const headersSet: Record<string, unknown> = {};
    let sentBuffer: Buffer | null = null;
    const mockRes = {
      set: jest.fn((h: Record<string, unknown>) =>
        Object.assign(headersSet, h),
      ),
      end: jest.fn((b: Buffer) => {
        sentBuffer = b;
      }),
    } as unknown as Response;

    await controller.downloadPayslip(periodId, emp1Id, makeReq(), mockRes);
    expect(headersSet['Content-Type']).toBe(PAYSLIP_CONSTANTS.MIME_TYPE);
    expect(headersSet['Content-Disposition']).toBe(
      'attachment; filename="payslip-PR-2026-04-EMP-001.pdf"',
    );
    expect(headersSet['Cache-Control']).toBe('no-store, private');
    expect(headersSet['X-Content-Type-Options']).toBe('nosniff');
    expect(detectMimeTypeFromBuffer(sentBuffer!)).toBe('application/pdf');
    expect(
      auditLogs.some((a) => a.action === AuditAction.PAYSLIP_DOWNLOADED),
    ).toBe(true);

    // 4. Missing stored PDF on download -> 404; regenerate recreates new S3 file
    s3Buckets.delete(firstKey);
    await expect(
      controller.downloadPayslip(periodId, emp1Id, makeReq(), mockRes),
    ).rejects.toMatchObject({ statusCode: HttpStatus.NOT_FOUND });

    const regenMissing = await controller.generatePayslip(
      periodId,
      emp1Id,
      makeReq(),
    );
    expect(regenMissing.data.version).toBe(1);
    expect(s3Buckets.size).toBe(1);
    expect(
      auditLogs.some((a) => a.action === AuditAction.PAYSLIP_REGENERATED),
    ).toBe(true);

    // 5. Corrupt stored PDF detected on download (500), then healed cleanly by regenerate
    const secondKey = Array.from(s3Buckets.keys())[0];
    s3Buckets.set(secondKey, Buffer.from('corrupt-non-pdf-bytes'));
    await expect(
      controller.downloadPayslip(periodId, emp1Id, makeReq(), mockRes),
    ).rejects.toMatchObject({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR });

    const regenCorrupt = await controller.generatePayslip(
      periodId,
      emp1Id,
      makeReq(),
    );
    expect(regenCorrupt.data.version).toBe(2);
    expect(s3Buckets.has(secondKey)).toBe(false);
    expect(s3Buckets.size).toBe(1);

    // 6. Concurrent duplicate generation for emp2 returns winner and deletes losing upload
    await controller.generatePayslip(periodId, emp2Id, makeReq());
    // Force a duplicate-key collision simulation for emp2 path by removing and resetting simulateDupKeyOnce
    const emp2Stored = payslipStore.get(
      `${periodId.toHexString()}:${emp2Id.toHexString()}`,
    )!;
    const winnerKey = emp2Stored.fileKey;
    const origFind = payslipStore.get.bind(payslipStore);
    const findSpy = jest
      .spyOn(payslipStore, 'get')
      .mockImplementationOnce(() => undefined) // pre-check returns null to simulate concurrent start
      .mockImplementation((k: string) => origFind(k));
    simulateDupKeyOnce = true;

    const bucketCountBeforeRace = s3Buckets.size;
    const raceResult = await controller.generatePayslip(
      periodId,
      emp2Id,
      makeReq(),
    );
    findSpy.mockRestore();
    expect(raceResult.data.id).toBe(emp2Stored._id.toHexString());
    expect(s3Buckets.has(winnerKey)).toBe(true);
    expect(s3Buckets.size).toBe(bucketCountBeforeRace);
  });

  it('enforces RBAC, prevents IDOR on employee payslips, and validates paginated list queries', async () => {
    await controller.generatePayslip(periodId, emp1Id, makeReq(hrUserId));
    await controller.generatePayslip(periodId, emp2Id, makeReq(hrUserId));

    // Guard check for controller routes requiring PAYSLIPS_CREATE / PAYSLIPS_VIEW
    activePermissions = [PermissionKeys.PAYSLIPS_VIEW_OWN];
    await expect(
      guard.canActivate(
        makeExecCtx(controller.generatePayslip, makeReq(emp1UserId)),
      ),
    ).rejects.toMatchObject({ statusCode: HttpStatus.FORBIDDEN });
    await expect(
      guard.canActivate(
        makeExecCtx(controller.listPeriodPayslips, makeReq(emp1UserId)),
      ),
    ).rejects.toMatchObject({ statusCode: HttpStatus.FORBIDDEN });

    // Employee 1 with PAYSLIPS_VIEW_OWN can view & download OWN payslip
    const ownMeta = await controller.getPayslip(
      periodId,
      emp1Id,
      makeReq(emp1UserId),
    );
    expect(ownMeta.data.employeeCode).toBe('EMP-001');

    const mockRes = {
      set: jest.fn(),
      end: jest.fn(),
    } as unknown as Response;
    await controller.downloadPayslip(
      periodId,
      emp1Id,
      makeReq(emp1UserId),
      mockRes,
    );

    // Employee 1 CANNOT view or download Employee 2 payslip (403 Forbidden)
    await expect(
      controller.getPayslip(periodId, emp2Id, makeReq(emp1UserId)),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      statusCode: HttpStatus.FORBIDDEN,
    });
    await expect(
      controller.downloadPayslip(
        periodId,
        emp2Id,
        makeReq(emp1UserId),
        mockRes,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      statusCode: HttpStatus.FORBIDDEN,
    });

    // Manager without org PAYSLIPS_VIEW / PAYSLIPS_EXPORT cannot view emp1
    await expect(
      controller.getPayslip(periodId, emp1Id, makeReq(managerUserId)),
    ).rejects.toMatchObject({ statusCode: HttpStatus.FORBIDDEN });

    // HR list endpoint filters and excludes binary / fileKey
    activePermissions = [PermissionKeys.PAYSLIPS_VIEW];
    const queryDto = (await validationPipe.transform(
      { page: 1, limit: 10, search: 'EMP-002' },
      { type: 'query', metatype: ListPayslipsQueryDto },
    )) as ListPayslipsQueryDto;
    const listed = await controller.listPeriodPayslips(periodId, queryDto);
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].employeeCode).toBe('EMP-002');
    expect(
      (listed.data[0] as unknown as Record<string, unknown>).fileKey,
    ).toBeUndefined();

    // Non-whitelisted query field rejected
    await expect(
      validationPipe.transform(
        { page: 1, includePdfBuffer: true },
        { type: 'query', metatype: ListPayslipsQueryDto },
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });
});
