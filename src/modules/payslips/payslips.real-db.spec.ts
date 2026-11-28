/* eslint-disable @typescript-eslint/require-await */
import * as dns from 'node:dns/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  HttpStatus,
  INestApplication,
  ValidationError,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import type { NextFunction, Response } from 'express';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { RedisModule } from '../../common/redis/redis.module';
import { RedisService } from '../../common/redis/redis.service';
import { detectMimeTypeFromBuffer } from '../../common/utils/file-signature.util';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import configuration from '../../config/configuration';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/constants/audit-log.constant';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { AuthorizationService } from '../authorization/authorization.service';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import {
  Department,
  DepartmentDocument,
} from '../departments/schemas/department.schema';
import {
  Designation,
  DesignationDocument,
} from '../designations/schemas/designation.schema';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import { PayrollRecordStatus } from '../payroll-calculations/constants/payroll-calculation.constant';
import {
  PayrollRecord,
  PayrollRecordDocument,
} from '../payroll-calculations/schemas/payroll-record.schema';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollPeriodStatus } from '../payroll-periods/constants/payroll-period.constant';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
} from '../payroll-periods/schemas/payroll-period.schema';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../salary-structures/constants/salary-structure.constant';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { PayslipsModule } from './payslips.module';
import { Payslip, PayslipDocument } from './schemas/payslip.schema';

const EXPECTED_TEST_DATABASE = 'crm_hrms_test';

function resolveTestMongoUri(
  envPath: string = path.resolve(process.cwd(), '.env.test'),
): string | null {
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  const match = /^MONGODB_URI=(.+)$/m.exec(content);
  const uri = match?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!uri) return null;
  const dbName = decodeURIComponent(new URL(uri).pathname.slice(1));
  if (dbName !== EXPECTED_TEST_DATABASE) {
    throw new Error(
      `Unsafe DB '${dbName}', expected ${EXPECTED_TEST_DATABASE}`,
    );
  }
  return uri;
}

describe('Payslips — Real MongoDB Transactions, Indexes, Concurrency & RBAC', () => {
  jest.setTimeout(90000);

  let app: INestApplication<App>;
  let moduleRef: TestingModule;

  let periodModel: Model<PayrollPeriodDocument>;
  let recordModel: Model<PayrollRecordDocument>;
  let payslipModel: Model<PayslipDocument>;
  let employeeModel: Model<EmployeeDocument>;
  let branchModel: Model<BranchDocument>;
  let deptModel: Model<DepartmentDocument>;
  let desigModel: Model<DesignationDocument>;
  let auditLogModel: Model<AuditLogDocument>;
  let auditLogsService: AuditLogsService;

  const s3Memory = new Map<string, Buffer>();
  const hrUserId = new Types.ObjectId();
  const empUserId = new Types.ObjectId();
  const otherUserId = new Types.ObjectId();
  const roleId = new Types.ObjectId();

  let activeActorId = hrUserId;
  let activePermissions: string[] = [];

  const cleanupPeriodIds: Types.ObjectId[] = [];
  const cleanupEmployeeIds: Types.ObjectId[] = [];
  const cleanupBranchIds: Types.ObjectId[] = [];
  const cleanupDeptIds: Types.ObjectId[] = [];
  const cleanupDesigIds: Types.ObjectId[] = [];

  beforeAll(async () => {
    const uri = resolveTestMongoUri();
    if (!uri) {
      throw new Error('Test MongoDB URI not configured in .env.test');
    }

    const srvHost = uri.includes('mongodb+srv://')
      ? uri.split('@')[1]?.split('/')[0]
      : null;
    if (srvHost) {
      await Promise.race([
        dns.resolveSrv(`_mongodb._tcp.${srvHost}`),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('DNS offline timeout')), 2000),
        ),
      ]);
    }

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          envFilePath: '.env.test',
        }),
        MongooseModule.forRoot(uri, {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000,
        }),
        RedisModule,
        StorageModule,
        PayslipsModule,
      ],
    })
      .overrideProvider(RedisService)
      .useValue({
        exists: jest.fn().mockResolvedValue(false),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(0),
      })
      .overrideProvider(StorageService)
      .useValue({
        uploadFile: jest.fn(
          async (file: { buffer: Buffer }, folder: string) => {
            const key = `${folder}/${randomUUID()}.pdf`;
            s3Memory.set(key, Buffer.from(file.buffer));
            return { key };
          },
        ),
        downloadFile: jest.fn(async (key: string) => {
          const buf = s3Memory.get(key);
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
          s3Memory.delete(key);
        }),
        getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed'),
      })
      .overrideProvider(AuthorizationService)
      .useValue({
        hasPermissions: jest.fn(async (_roles: unknown, reqPerms: string[]) =>
          reqPerms.every((p) => activePermissions.includes(p)),
        ),
      })
      .compile();

    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.use((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.user = {
        userId: activeActorId,
        email: 'real-db-test@company.com',
        roleIds: [roleId],
      } as unknown as AuthenticatedRequest['user'];
      next();
    });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
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
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    periodModel = moduleRef.get(getModelToken(PayrollPeriod.name));
    recordModel = moduleRef.get(getModelToken(PayrollRecord.name));
    payslipModel = moduleRef.get(getModelToken(Payslip.name));
    employeeModel = moduleRef.get(getModelToken(Employee.name));
    branchModel = moduleRef.get(getModelToken(Branch.name));
    deptModel = moduleRef.get(getModelToken(Department.name));
    desigModel = moduleRef.get(getModelToken(Designation.name));
    auditLogModel = moduleRef.get(getModelToken(AuditLog.name));
    auditLogsService = moduleRef.get(AuditLogsService);

    await payslipModel.syncIndexes();
  });

  afterAll(async () => {
    if (payslipModel && cleanupPeriodIds.length > 0) {
      await payslipModel.deleteMany({
        payrollPeriodId: { $in: cleanupPeriodIds },
      });
    }
    if (recordModel && cleanupPeriodIds.length > 0) {
      await recordModel.deleteMany({
        payrollPeriodId: { $in: cleanupPeriodIds },
      });
    }
    if (periodModel && cleanupPeriodIds.length > 0) {
      await periodModel.deleteMany({ _id: { $in: cleanupPeriodIds } });
    }
    if (employeeModel && cleanupEmployeeIds.length > 0) {
      await employeeModel.deleteMany({ _id: { $in: cleanupEmployeeIds } });
    }
    if (branchModel && cleanupBranchIds.length > 0) {
      await branchModel.deleteMany({ _id: { $in: cleanupBranchIds } });
    }
    if (deptModel && cleanupDeptIds.length > 0) {
      await deptModel.deleteMany({ _id: { $in: cleanupDeptIds } });
    }
    if (desigModel && cleanupDesigIds.length > 0) {
      await desigModel.deleteMany({ _id: { $in: cleanupDesigIds } });
    }
    if (app) {
      await app.close();
    } else if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('verifies payslips indexes and executes end-to-end generation, idempotency, concurrency, rollback, download, and RBAC/IDOR on real MongoDB', async () => {
    const indexes = await payslipModel.collection.indexes();
    const uqIdx = indexes.find((i) => i.name === 'uq_payslips_period_employee');
    expect(uqIdx).toBeDefined();
    expect(uqIdx?.unique).toBe(true);

    const tag = `PS_${Date.now().toString(36).toUpperCase()}`;
    const branch = await branchModel.create({
      name: `${tag}_Branch`,
      address: 'Tech Tower 1',
      isActive: true,
    });
    const dept = await deptModel.create({
      name: `${tag}_Dept`,
      isActive: true,
    });
    const desig = await desigModel.create({
      name: `${tag}_Desig`,
      isActive: true,
    });
    cleanupBranchIds.push(branch._id);
    cleanupDeptIds.push(dept._id);
    cleanupDesigIds.push(desig._id);

    const emp1 = await employeeModel.create({
      userId: empUserId,
      employeeCode: `${tag}_E1`,
      firstName: 'Neha',
      lastName: 'Kapoor',
      workEmail: `${tag.toLowerCase()}_e1@company.com`,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
      departmentId: dept._id,
      designationId: desig._id,
      branchId: branch._id,
      employmentType: EmploymentType.FULL_TIME,
      employmentStatus: EmploymentStatus.ACTIVE,
      deletedAt: null,
    });
    const emp2 = await employeeModel.create({
      userId: otherUserId,
      employeeCode: `${tag}_E2`,
      firstName: 'Vikram',
      lastName: 'Rao',
      workEmail: `${tag.toLowerCase()}_e2@company.com`,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
      departmentId: dept._id,
      designationId: desig._id,
      branchId: branch._id,
      employmentType: EmploymentType.FULL_TIME,
      employmentStatus: EmploymentStatus.ACTIVE,
      deletedAt: null,
    });
    cleanupEmployeeIds.push(emp1._id, emp2._id);

    const period = await periodModel.create({
      periodName: `${tag} Payroll`,
      periodCode: `${tag}-2029-01`,
      payrollFrequency: PayrollFrequency.MONTHLY,
      startDate: new Date('2029-01-01T00:00:00.000Z'),
      endDate: new Date('2029-01-31T00:00:00.000Z'),
      paymentDate: new Date('2029-02-01T00:00:00.000Z'),
      month: 1,
      year: 2029,
      status: PayrollPeriodStatus.APPROVED,
      deletedAt: null,
      createdBy: hrUserId,
      updatedBy: hrUserId,
    });
    cleanupPeriodIds.push(period._id);

    const buildRecPayload = (
      eId: Types.ObjectId,
      eCode: string,
      eName: string,
    ) => ({
      payrollPeriodId: period._id,
      employeeId: eId,
      salaryAssignmentId: new Types.ObjectId(),
      salaryStructureId: new Types.ObjectId(),
      grossEarnings: Types.Decimal128.fromString('60000.00'),
      totalDeductions: Types.Decimal128.fromString('3000.00'),
      employerContributions: Types.Decimal128.fromString('1800.00'),
      netSalary: Types.Decimal128.fromString('57000.00'),
      status: PayrollRecordStatus.APPROVED,
      calculatedAt: new Date('2029-01-31T10:00:00.000Z'),
      approvedAt: new Date('2029-01-31T12:00:00.000Z'),
      approvedBy: hrUserId,
      calculationVersion: 1,
      deletedAt: null,
      createdBy: hrUserId,
      updatedBy: hrUserId,
      calculationSnapshot: {
        engineVersion: '1.0.0',
        inputFingerprint: 'fp',
        calculatedAt: new Date('2029-01-31T10:00:00.000Z'),
        payrollPeriodId: period._id.toHexString(),
        periodCode: period.periodCode,
        periodName: period.periodName,
        payrollFrequency: PayrollFrequency.MONTHLY,
        startDate: '2029-01-01',
        endDate: '2029-01-31',
        month: 1,
        year: 2029,
        employeeId: eId.toHexString(),
        employeeCode: eCode,
        employeeName: eName,
        employmentStatus: EmploymentStatus.ACTIVE,
        salaryAssignmentId: new Types.ObjectId().toHexString(),
        salaryAssignmentVersion: 1,
        salaryAssignmentEffectiveFrom: '2025-01-01',
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
        calendarDays: 31,
        tenureCalendarDays: 31,
        eligibleWorkingDays: 23,
        weeklyOffDays: 8,
        holidayDays: 0,
        presentDays: 23,
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
        prorationDenominatorDays: 31,
        payableDays: 31,
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
            monthlyBaseAmount: Types.Decimal128.fromString('60000.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('60000.00'),
            prorationApplied: false,
            payableDays: 31,
            calendarDays: 31,
            finalAmount: Types.Decimal128.fromString('60000.00'),
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
            monthlyBaseAmount: Types.Decimal128.fromString('3000.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('3000.00'),
            prorationApplied: false,
            payableDays: 31,
            calendarDays: 31,
            finalAmount: Types.Decimal128.fromString('3000.00'),
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
            monthlyBaseAmount: Types.Decimal128.fromString('1800.00'),
            monthlyCalculatedAmount: Types.Decimal128.fromString('1800.00'),
            prorationApplied: false,
            payableDays: 31,
            calendarDays: 31,
            finalAmount: Types.Decimal128.fromString('1800.00'),
          },
        ],
        grossEarnings: Types.Decimal128.fromString('60000.00'),
        totalDeductions: Types.Decimal128.fromString('3000.00'),
        employerContributionsTotal: Types.Decimal128.fromString('1800.00'),
        netSalary: Types.Decimal128.fromString('57000.00'),
        netPayClamped: false,
      },
    });

    await recordModel.create(
      buildRecPayload(emp1._id, emp1.employeeCode, 'Neha Kapoor'),
    );
    await recordModel.create(
      buildRecPayload(emp2._id, emp2.employeeCode, 'Vikram Rao'),
    );

    const httpServer = app.getHttpServer();
    activeActorId = hrUserId;
    activePermissions = [
      PermissionKeys.PAYSLIPS_VIEW,
      PermissionKeys.PAYSLIPS_CREATE,
      PermissionKeys.PAYSLIPS_EXPORT,
    ];

    // 1. Unfinalized APPROVED period rejected with 409
    await request(httpServer)
      .post(
        `/api/v1/payroll/periods/${period._id.toHexString()}/payslips/${emp1._id.toHexString()}/generate`,
      )
      .expect(HttpStatus.CONFLICT);

    // Move period to FINALIZED
    await periodModel.updateOne(
      { _id: period._id },
      { $set: { status: PayrollPeriodStatus.FINALIZED } },
    );

    // 2. Audit failure inside MongoDB tx rolls back Payslip persistence & cleans S3 object
    const origAudit = auditLogsService.createAuditLog.bind(auditLogsService);
    const failAuditSpy = jest
      .spyOn(auditLogsService, 'createAuditLog')
      .mockImplementationOnce(async (params, session) => {
        if (params.action === AuditAction.PAYSLIP_GENERATED) {
          throw new Error('Simulated audit crash during payslip tx');
        }
        return origAudit(params, session);
      });
    await request(httpServer)
      .post(
        `/api/v1/payroll/periods/${period._id.toHexString()}/payslips/${emp1._id.toHexString()}/generate`,
      )
      .expect(HttpStatus.INTERNAL_SERVER_ERROR);
    failAuditSpy.mockRestore();
    expect(
      await payslipModel.countDocuments({ payrollPeriodId: period._id }),
    ).toBe(0);
    expect(s3Memory.size).toBe(0);

    // 3. Concurrent generation for emp1 -> both HTTP requests settle cleanly, exactly 1 Payslip & 1 S3 file exist
    const [r1, r2] = await Promise.all([
      request(httpServer).post(
        `/api/v1/payroll/periods/${period._id.toHexString()}/payslips/${emp1._id.toHexString()}/generate`,
      ),
      request(httpServer).post(
        `/api/v1/payroll/periods/${period._id.toHexString()}/payslips/${emp1._id.toHexString()}/generate`,
      ),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([
      HttpStatus.OK,
      HttpStatus.OK,
    ]);
    expect(
      await payslipModel.countDocuments({
        payrollPeriodId: period._id,
        employeeId: emp1._id,
      }),
    ).toBe(1);
    expect(s3Memory.size).toBe(1);

    // 4. Download real PDF binary & verify signature + headers
    const dlRes = await request(httpServer)
      .get(
        `/api/v1/payroll/periods/${period._id.toHexString()}/payslips/${emp1._id.toHexString()}/download`,
      )
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(HttpStatus.OK);
    expect(dlRes.headers['content-type']).toContain('application/pdf');
    expect(dlRes.headers['cache-control']).toBe('no-store, private');
    expect(detectMimeTypeFromBuffer(dlRes.body as Buffer)).toBe(
      'application/pdf',
    );

    // 5. List endpoint returns sanitized paginated results
    const listRes = await request(httpServer)
      .get(
        `/api/v1/payroll/periods/${period._id.toHexString()}/payslips?search=${tag}_E1`,
      )
      .expect(HttpStatus.OK);
    const listBody = listRes.body as {
      data: Array<{ netSalary: string; fileKey?: string }>;
    };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].netSalary).toBe('57000.00');
    expect(listBody.data[0].fileKey).toBeUndefined();

    // 6. Real DB unique compound index directly prevents duplicate { payrollPeriodId, employeeId }
    const existingPayslip = await payslipModel
      .findOne({ payrollPeriodId: period._id, employeeId: emp1._id })
      .lean()
      .exec();
    await expect(
      payslipModel.create({
        payrollPeriodId: period._id,
        payrollRecordId: existingPayslip!.payrollRecordId,
        employeeId: emp1._id,
        payrollCalculationVersion: 1,
        templateVersion: '1.0.0',
        fileKey: 'dup-key-test.pdf',
        fileName: 'dup.pdf',
        mimeType: 'application/pdf',
        fileSize: 100,
        checksumSha256: 'abc',
        generatedAt: new Date(),
        generatedBy: hrUserId,
      }),
    ).rejects.toThrow(/E11000/);

    // 7. Employee self-service RBAC & IDOR check
    activeActorId = empUserId;
    activePermissions = [PermissionKeys.PAYSLIPS_VIEW_OWN];
    await request(httpServer)
      .get(
        `/api/v1/payroll/periods/${period._id.toHexString()}/payslips/${emp1._id.toHexString()}`,
      )
      .expect(HttpStatus.OK);
    await request(httpServer)
      .get(
        `/api/v1/payroll/periods/${period._id.toHexString()}/payslips/${emp2._id.toHexString()}/download`,
      )
      .expect(HttpStatus.FORBIDDEN);

    expect(
      await auditLogModel.countDocuments({
        targetId: existingPayslip!._id,
        action: AuditAction.PAYSLIP_GENERATED,
      }),
    ).toBe(1);
    expect(
      await auditLogModel.countDocuments({
        targetId: existingPayslip!._id,
        action: AuditAction.PAYSLIP_DOWNLOADED,
      }),
    ).toBe(1);
  });
});
