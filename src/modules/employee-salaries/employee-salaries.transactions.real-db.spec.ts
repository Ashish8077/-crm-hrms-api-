import * as dns from 'node:dns/promises';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  HttpStatus,
  INestApplication,
  ValidationError,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type { NextFunction, Response } from 'express';
import mongoose, { Connection, Model, Types } from 'mongoose';
import { EmployeeSalariesController } from './employee-salaries.controller';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { ErrorCode } from '../../common/errors/error-codes';
import { setupSwagger } from '../../config/swagger.config';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import {
  EmployeeSalary,
  EmployeeSalaryDocument,
  EmployeeSalarySchema,
} from './schemas/employee-salary.schema';
import {
  Employee,
  EmployeeDocument,
  EmployeeSchema,
} from '../employees/schemas/employee.schema';
import {
  SalaryStructure,
  SalaryStructureDocument,
  SalaryStructureSchema,
} from '../salary-structures/schemas/salary-structure.schema';
import {
  SalaryComponent,
  SalaryComponentDocument,
  SalaryComponentSchema,
} from '../salary-components/schemas/salary-component.schema';
import {
  AuditLog,
  AuditLogDocument,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { EmployeeSalaryRepository } from './repositories/employee-salary.repository';
import { EmployeeSalariesService } from './services/employee-salaries.service';
import { SalaryStructureCalculationService } from '../salary-structures/services/salary-structure-calculation.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditLogRepository } from '../audit-logs/repositories/audit-log.repository';
import { EmployeeSalaryStatus } from './constants/employee-salary.constant';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../salary-structures/constants/salary-structure.constant';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { AppError } from '../../common/errors/app-error';

const EXPECTED_TEST_DATABASE = 'crm_hrms_test';

function resolveMongoUri(
  testEnvPath: string = path.resolve(process.cwd(), '.env.test'),
): string | null {
  if (!fs.existsSync(testEnvPath)) {
    return null;
  }

  const content = fs.readFileSync(testEnvPath, 'utf8');
  const match = /^MONGODB_URI=(.+)$/m.exec(content);

  const uri = match?.[1]?.trim().replace(/^["']|["']$/g, '');

  if (!uri) {
    return null;
  }

  let databaseName: string;

  try {
    databaseName = decodeURIComponent(new URL(uri).pathname.slice(1));
  } catch {
    throw new Error('Invalid test MongoDB URI.');
  }

  if (databaseName !== EXPECTED_TEST_DATABASE) {
    throw new Error(
      `Unsafe test database. Expected ${EXPECTED_TEST_DATABASE}.`,
    );
  }

  return uri;
}

describe('EmployeeSalaries - Real MongoDB Replica Set Transactions & Concurrency', () => {
  jest.setTimeout(60000);

  let connection: Connection | null = null;
  let employeeSalaryModel: Model<EmployeeSalaryDocument>;
  let employeeModel: Model<EmployeeDocument>;
  let salaryStructureModel: Model<SalaryStructureDocument>;
  let salaryComponentModel: Model<SalaryComponentDocument>;
  let auditLogModel: Model<AuditLogDocument>;

  let repository: EmployeeSalaryRepository;
  let calculationService: SalaryStructureCalculationService;
  let auditLogsService: AuditLogsService;
  let service: EmployeeSalariesService;

  let isConnected = false;

  // Track created documents for teardown cleanup
  const createdEmployeeIds: Types.ObjectId[] = [];
  const createdStructureIds: Types.ObjectId[] = [];
  const createdComponentIds: Types.ObjectId[] = [];
  const actorId = new Types.ObjectId();

  beforeAll(async () => {
    const uri = resolveMongoUri();
    if (!uri) {
      console.warn('Real MongoDB URI not configured; skipping live DB checks.');
      return;
    }

    try {
      // Fast 1.5s DNS pre-check so offline sandboxes skip immediately without hanging
      const srvHost = uri.includes('mongodb+srv://')
        ? uri.split('@')[1]?.split('/')[0]
        : null;
      if (srvHost) {
        await Promise.race([
          dns.resolveSrv(`_mongodb._tcp.${srvHost}`),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DNS offline timeout')), 1500),
          ),
        ]);
      }

      const conn = await mongoose
        .createConnection(uri, {
          serverSelectionTimeoutMS: 8000,
          connectTimeoutMS: 10000,
        })
        .asPromise();
      connection = conn;

      employeeSalaryModel = conn.model<EmployeeSalaryDocument>(
        EmployeeSalary.name,
        EmployeeSalarySchema,
      );
      employeeModel = conn.model<EmployeeDocument>(
        EmployeeEmployeeSchemaModelName(conn),
        EmployeeSchema,
      );
      salaryStructureModel = conn.model<SalaryStructureDocument>(
        SalaryStructure.name,
        SalaryStructureSchema,
      );
      salaryComponentModel = conn.model<SalaryComponentDocument>(
        SalaryComponent.name,
        SalaryComponentSchema,
      );
      auditLogModel = conn.model<AuditLogDocument>(
        AuditLog.name,
        AuditLogSchema,
      );

      // Drop any conflicting legacy index if present, then build schema indexes on the real replica set
      try {
        await employeeSalaryModel.collection.dropIndex('salaryStructureId_1');
      } catch {
        // Ignored if does not exist
      }
      await employeeSalaryModel.createIndexes();

      repository = new EmployeeSalaryRepository(employeeSalaryModel);
      calculationService = new SalaryStructureCalculationService();
      const auditLogRepository = new AuditLogRepository(auditLogModel);
      auditLogsService = new AuditLogsService(auditLogRepository);
      service = new EmployeeSalariesService(
        conn,
        repository,
        calculationService,
        auditLogsService,
        employeeModel,
        salaryStructureModel,
        salaryComponentModel,
      );

      isConnected = true;
    } catch (err: unknown) {
      await connection?.close(true).catch(() => undefined);
      connection = null;
      isConnected = false;

      throw err;
    }
  });

  afterAll(async () => {
    if (!isConnected || !connection) return;

    try {
      if (createdEmployeeIds.length > 0) {
        await Promise.all([
          employeeSalaryModel.deleteMany({
            employeeId: { $in: createdEmployeeIds },
          }),
          employeeModel.deleteMany({ _id: { $in: createdEmployeeIds } }),
          auditLogModel.deleteMany({
            'details.employeeId': {
              $in: createdEmployeeIds.map((id) => id.toString()),
            },
          }),
        ]);
      }
      if (createdStructureIds.length > 0) {
        await salaryStructureModel.deleteMany({
          _id: { $in: createdStructureIds },
        });
      }
      if (createdComponentIds.length > 0) {
        await salaryComponentModel.deleteMany({
          _id: { $in: createdComponentIds },
        });
      }
    } finally {
      await connection.close(true);
      await mongoose.disconnect();
    }
  });

  function EmployeeEmployeeSchemaModelName(conn: Connection): string {
    return conn.models[Employee.name] ? `${Employee.name}_real` : Employee.name;
  }

  async function createTestEmployee(joiningDate = '2026-01-01') {
    const employeeId = new Types.ObjectId();
    const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    await employeeModel.create({
      _id: employeeId,
      employeeCode: `EMP_TEST_${uniqueSuffix}`,
      firstName: 'Integration',
      lastName: 'Tester',
      workEmail: `test_${uniqueSuffix}@example.com`,
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date(`${joiningDate}T00:00:00.000Z`),
      departmentId: new Types.ObjectId(),
      designationId: new Types.ObjectId(),
      branchId: new Types.ObjectId(),
      deletedAt: null,
    });
    createdEmployeeIds.push(employeeId);
    return employeeId;
  }

  async function createTestStructuresAndComponents() {
    const basicId = new Types.ObjectId();
    const hraId = new Types.ObjectId();

    await salaryComponentModel.create([
      {
        _id: basicId,
        name: 'Basic Test Salary',
        code: `BASIC_${Date.now()}`,
        type: SalaryComponentType.EARNING,
        description: 'Test basic component',
        isStatutory: false,
        isActive: true,
      },
      {
        _id: hraId,
        name: 'HRA Test Salary',
        code: `HRA_${Date.now()}`,
        type: SalaryComponentType.EARNING,
        description: 'Test HRA component',
        isStatutory: false,
        isActive: true,
      },
    ]);
    createdComponentIds.push(basicId, hraId);

    const structure1Id = new Types.ObjectId();
    const structure2Id = new Types.ObjectId();

    await salaryStructureModel.create([
      {
        _id: structure1Id,
        name: 'Test Structure 50K',
        code: `TEST_50K_${Date.now()}`,
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        isActive: true,
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
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 20000,
            percentage: null,
            percentageOf: null,
          },
        ],
      },
      {
        _id: structure2Id,
        name: 'Test Structure 80K',
        code: `TEST_80K_${Date.now()}`,
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 80000,
        isActive: true,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 50000,
            percentage: null,
            percentageOf: null,
          },
          {
            componentId: hraId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 30000,
            percentage: null,
            percentageOf: null,
          },
        ],
      },
    ]);
    createdStructureIds.push(structure1Id, structure2Id);

    return { basicId, hraId, structure1Id, structure2Id };
  }

  describe('0. Test MongoDB URI Validation', () => {
    it('reads strictly from .env.test, ignores process.env.MONGODB_URI, and enforces crm_hrms_test', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongo-uri-test-'));
      const tmpEnv = path.join(tmpDir, '.env.test');
      const prevEnv = process.env.MONGODB_URI;

      try {
        // Must ignore process.env.MONGODB_URI even if set to production
        process.env.MONGODB_URI = 'mongodb://localhost:27017/crm_hrms_prod';
        expect(resolveMongoUri(tmpEnv)).toBeNull();

        fs.writeFileSync(
          tmpEnv,
          'MONGODB_URI=mongodb+srv://cluster0.example.invalid/crm_hrms_test?retryWrites=true\n',
        );
        expect(resolveMongoUri(tmpEnv)).toContain('crm_hrms_test');

        fs.writeFileSync(tmpEnv, 'MONGODB_URI=not-a-valid-uri\n');
        expect(() => resolveMongoUri(tmpEnv)).toThrow(
          'Invalid test MongoDB URI.',
        );

        fs.writeFileSync(
          tmpEnv,
          'MONGODB_URI=mongodb+srv://cluster0.example.invalid/\n',
        );
        expect(() => resolveMongoUri(tmpEnv)).toThrow(
          `Unsafe test database. Expected ${EXPECTED_TEST_DATABASE}.`,
        );

        fs.writeFileSync(
          tmpEnv,
          'MONGODB_URI=mongodb+srv://cluster0.example.invalid/crm_hrms?retryWrites=true\n',
        );
        expect(() => resolveMongoUri(tmpEnv)).toThrow(
          `Unsafe test database. Expected ${EXPECTED_TEST_DATABASE}.`,
        );
      } finally {
        if (prevEnv === undefined) {
          delete process.env.MONGODB_URI;
        } else {
          process.env.MONGODB_URI = prevEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('1. Real MongoDB Index Verification', () => {
    it('verifies all 4 critical indexes exist on the real replica set collection', async () => {
      if (!isConnected) return;

      const indexes = await employeeSalaryModel.collection.indexes();
      const indexNames = indexes.map((idx) => idx.name);

      expect(indexNames).toContain('ix_employee_salary_history');
      expect(indexNames).toContain('ix_employee_salary_current');
      expect(indexNames).toContain('ix_employee_salary_structure');
      expect(indexNames).toContain('uq_employee_single_open_ended_active');

      // Verify partial unique filter expression
      const uqIndex = indexes.find(
        (idx) => idx.name === 'uq_employee_single_open_ended_active',
      );
      expect(uqIndex).toBeDefined();
      expect(uqIndex?.unique).toBe(true);
      expect(uqIndex?.partialFilterExpression).toEqual({
        effectiveTo: null,
        status: 'ACTIVE',
      });
    });

    it('enforces partial unique index constraint at the MongoDB database engine level', async () => {
      if (!isConnected) return;

      const employeeId = await createTestEmployee('2026-01-01');
      const { structure1Id } = await createTestStructuresAndComponents();

      // First open-ended active insert directly into collection
      await employeeSalaryModel.create({
        employeeId,
        salaryStructureId: structure1Id,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        salaryStructureVersion: 1,
        salarySnapshot: {
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          inputSalaryAmount: 50000,
          grossSalaryMonthly: 50000,
          grossSalaryAnnual: 600000,
          totalEmployerContributionsMonthly: 0,
          totalEmployerContributionsAnnual: 0,
          totalCtcMonthly: 50000,
          totalCtcAnnual: 600000,
          totalEmployeeDeductionsMonthly: 0,
          totalEmployeeDeductionsAnnual: 0,
          estimatedNetSalaryMonthly: 50000,
          estimatedNetSalaryAnnual: 600000,
          summary: {
            monthly: {
              grossSalary: 50000,
              employerContributions: 0,
              totalCtc: 50000,
              employeeDeductions: 0,
              estimatedNetSalary: 50000,
            },
            annual: {
              grossSalary: 600000,
              employerContributions: 0,
              totalCtc: 600000,
              employeeDeductions: 0,
              estimatedNetSalary: 600000,
            },
          },
          earnings: [],
          employeeDeductions: [],
          employerContributions: [],
        },
        status: EmployeeSalaryStatus.ACTIVE,
        createdBy: actorId,
        updatedBy: actorId,
      });

      // Second open-ended active insert for same employee must be rejected by MongoDB index
      await expect(
        employeeSalaryModel.create({
          employeeId,
          salaryStructureId: structure1Id,
          effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
          effectiveTo: null, // Collides with partial unique index!
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 50000,
          salaryStructureVersion: 1,
          salarySnapshot: {
            salaryBasis: SalaryStructureBasis.CTC,
            salaryFrequency: SalaryStructureFrequency.MONTHLY,
            inputSalaryAmount: 50000,
            grossSalaryMonthly: 50000,
            grossSalaryAnnual: 600000,
            totalEmployerContributionsMonthly: 0,
            totalEmployerContributionsAnnual: 0,
            totalCtcMonthly: 50000,
            totalCtcAnnual: 600000,
            totalEmployeeDeductionsMonthly: 0,
            totalEmployeeDeductionsAnnual: 0,
            estimatedNetSalaryMonthly: 50000,
            estimatedNetSalaryAnnual: 600000,
            summary: {
              monthly: {
                grossSalary: 50000,
                employerContributions: 0,
                totalCtc: 50000,
                employeeDeductions: 0,
                estimatedNetSalary: 50000,
              },
              annual: {
                grossSalary: 600000,
                employerContributions: 0,
                totalCtc: 600000,
                employeeDeductions: 0,
                estimatedNetSalary: 600000,
              },
            },
            earnings: [],
            employeeDeductions: [],
            employerContributions: [],
          },
          status: EmployeeSalaryStatus.ACTIVE,
          createdBy: actorId,
          updatedBy: actorId,
        }),
      ).rejects.toThrow(/E11000/);
    });
  });

  describe('2. Real Multi-Document Transactions: Commit & Atomicity', () => {
    it('commits initial salary assignment and audit log atomically in real MongoDB', async () => {
      if (!isConnected) return;

      const employeeId = await createTestEmployee('2026-01-01');
      const { structure1Id } = await createTestStructuresAndComponents();

      const result = await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        actorId,
      );

      expect(result).toBeDefined();
      expect(result.status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(result.effectiveTo).toBeNull();

      // Verify persisted in real MongoDB collection
      const inDb = await employeeSalaryModel.findById(result._id).exec();
      expect(inDb).not.toBeNull();
      expect(inDb?.salaryAmount).toBe(50000);

      // Verify audit log persisted
      const auditInDb = await auditLogModel
        .findOne({
          action: AuditAction.EMPLOYEE_SALARY_ASSIGNED,
          targetId: result._id,
        })
        .exec();
      expect(auditInDb).not.toBeNull();
      expect(auditInDb?.targetModel).toBe(AuditTargetModel.EMPLOYEE_SALARY);
    });

    it('commits salary revision: atomically closes previous assignment and inserts new assignment', async () => {
      if (!isConnected) return;

      const employeeId = await createTestEmployee('2026-01-01');
      const { structure1Id, structure2Id } =
        await createTestStructuresAndComponents();

      // 1. Initial assignment
      const initial = await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        actorId,
      );

      // 2. Revision assignment on 2026-07-01
      const revision = await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2026-07-01',
        },
        actorId,
      );

      // Verify previous assignment in real MongoDB: closed and SUPERSEDED
      const closedDoc = await employeeSalaryModel.findById(initial._id).exec();
      expect(closedDoc?.status).toBe(EmployeeSalaryStatus.SUPERSEDED);
      expect(closedDoc?.effectiveTo?.toISOString().slice(0, 10)).toBe(
        '2026-07-01',
      );
      // Historical snapshot unchanged
      expect(closedDoc?.salarySnapshot.grossSalaryMonthly).toBe(50000);

      // Verify new assignment in real MongoDB: ACTIVE and open-ended
      const activeDoc = await employeeSalaryModel.findById(revision._id).exec();
      expect(activeDoc?.status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(activeDoc?.effectiveTo).toBeNull();
      expect(activeDoc?.salaryAmount).toBe(80000);
      expect(activeDoc?.salarySnapshot.grossSalaryMonthly).toBe(80000);

      // Verify exact count of active records in MongoDB
      const activeCount = await employeeSalaryModel.countDocuments({
        employeeId,
        effectiveTo: null,
        status: EmployeeSalaryStatus.ACTIVE,
      });
      expect(activeCount).toBe(1);
    });
  });

  describe('3. Real Multi-Document Transactions: Rollback on Failure', () => {
    it('rolls back previous assignment closure and new assignment creation when audit logging fails inside transaction', async () => {
      if (!isConnected) return;

      const employeeId = await createTestEmployee('2026-01-01');
      const { structure1Id, structure2Id } =
        await createTestStructuresAndComponents();

      // 1. Initial assignment
      const initial = await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        actorId,
      );

      // 2. Mock audit log service to fail during revision transaction
      jest
        .spyOn(auditLogsService, 'createAuditLog')
        .mockRejectedValueOnce(new Error('Real simulated audit service crash'));

      // 3. Attempt revision - should throw
      await expect(
        service.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2026-07-01',
          },
          actorId,
        ),
      ).rejects.toThrow('Real simulated audit service crash');

      // 4. Inspect real MongoDB state: Transaction rollback MUST have occurred!
      const initialAfterRollback = await employeeSalaryModel
        .findById(initial._id)
        .exec();
      expect(initialAfterRollback?.status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(initialAfterRollback?.effectiveTo).toBeNull();

      // Verify no orphan revision was saved
      const allDocs = await employeeSalaryModel
        .find({ employeeId })
        .sort({ effectiveFrom: 1 })
        .exec();
      expect(allDocs.length).toBe(1);
      expect(allDocs[0].salaryAmount).toBe(50000);
    });
  });

  describe('4. Real Concurrency: Race Condition Protection', () => {
    it('guarantees exactly ONE revision succeeds and one fails with 409 when two concurrent requests race on real MongoDB', async () => {
      if (!isConnected) return;

      const employeeId = await createTestEmployee('2026-01-01');
      const { structure1Id, structure2Id } =
        await createTestStructuresAndComponents();

      // 1. Initial assignment
      await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        actorId,
      );

      // 2. Fire two competing revisions for the same employee at the exact same moment
      const [res1, res2] = await Promise.allSettled([
        service.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2026-07-01',
          },
          actorId,
        ),
        service.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2026-07-01',
          },
          actorId,
        ),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      // Exactly ONE must succeed and ONE must be rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const rejectedResult = rejected[0];
      const rejectedReason = rejectedResult.reason as AppError;

      // Verify the rejected request was safely aborted (either 409 CONCURRENT_MODIFICATION or 400 due to serialized date check)
      expect([HttpStatus.CONFLICT, HttpStatus.BAD_REQUEST]).toContain(
        rejectedReason.statusCode,
      );

      // Query real MongoDB: Verify that exactly ONE active assignment exists!
      const activeAssignments = await employeeSalaryModel
        .find({
          employeeId,
          effectiveTo: null,
          status: EmployeeSalaryStatus.ACTIVE,
        })
        .exec();
      expect(activeAssignments.length).toBe(1);
    });
  });

  describe('5. Real Query Evaluation on MongoDB Atlas', () => {
    it('evaluates current salary boundaries correctly with real MongoDB indexes and queries', async () => {
      if (!isConnected) return;

      const employeeId = await createTestEmployee('2026-01-01');
      const { structure1Id, structure2Id } =
        await createTestStructuresAndComponents();

      // Assignment 1: [2026-01-01, 2026-07-01) (50k)
      await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-01-01',
        },
        actorId,
      );

      // Assignment 2: [2026-07-01, null) (80k)
      await service.assignSalary(
        employeeId,
        {
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2026-07-01',
        },
        actorId,
      );

      // Real Query A: Before 2026-01-01 -> Null
      const qBefore = await service.getCurrentSalary(employeeId, '2025-12-31');
      expect(qBefore).toBeNull();

      // Real Query B: Day 1 (2026-01-01) -> 50k
      const qStart = await service.getCurrentSalary(employeeId, '2026-01-01');
      expect(qStart?.salaryAmount).toBe(50000);

      // Real Query C: Day before transition (2026-06-30) -> 50k
      const qMid = await service.getCurrentSalary(employeeId, '2026-06-30');
      expect(qMid?.salaryAmount).toBe(50000);

      // Real Query D: Transition day (2026-07-01) -> 80k (effectiveTo exclusive, effectiveFrom inclusive)
      const qTransition = await service.getCurrentSalary(
        employeeId,
        '2026-07-01',
      );
      expect(qTransition?.salaryAmount).toBe(80000);

      // Real Query E: Far future (2027-01-01) -> 80k (ongoing open-ended)
      const qFuture = await service.getCurrentSalary(employeeId, '2027-01-01');
      expect(qFuture?.salaryAmount).toBe(80000);
    });
  });

  describe('6. Real HTTP API + Swagger + SUPERSEDED Future-Revision Handling', () => {
    let app: INestApplication<App>;

    interface HttpCurrentSalaryBody {
      success: boolean;
      data: {
        id: string;
        employeeId: string;
        salaryStructureId: string;
        effectiveFrom: string;
        effectiveTo: string | null;
        salaryAmount: number;
        status: EmployeeSalaryStatus;
        salarySnapshot: {
          grossSalaryMonthly: number;
          totalCtcMonthly: number;
          estimatedNetSalaryMonthly: number;
        };
      } | null;
    }

    interface HttpHistoryBody {
      success: boolean;
      data: Array<{
        id: string;
        effectiveFrom: string;
        effectiveTo: string | null;
        salaryAmount: number;
        status: EmployeeSalaryStatus;
        grossSalaryMonthly: number;
        totalCtcMonthly: number;
        estimatedNetSalaryMonthly: number;
      }>;
      meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
    }

    interface SwaggerDocBody {
      paths: Record<
        string,
        Record<
          string,
          {
            tags?: string[];
            parameters?: Array<{ name: string; in: string }>;
          }
        >
      >;
    }

    beforeAll(async () => {
      if (!isConnected) return;

      const moduleRef = await Test.createTestingModule({
        controllers: [EmployeeSalariesController],
        providers: [
          EmployeeSalariesService,
          EmployeeSalaryRepository,
          SalaryStructureCalculationService,
          { provide: AuditLogsService, useValue: auditLogsService },
          { provide: getConnectionToken(), useValue: connection },
          {
            provide: getModelToken(EmployeeSalary.name),
            useValue: employeeSalaryModel,
          },
          { provide: getModelToken(Employee.name), useValue: employeeModel },
          {
            provide: getModelToken(SalaryStructure.name),
            useValue: salaryStructureModel,
          },
          {
            provide: getModelToken(SalaryComponent.name),
            useValue: salaryComponentModel,
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication<INestApplication<App>>();
      app.use(
        (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
          req.user = {
            userId: actorId,
            sessionId: new Types.ObjectId(),
            roleIds: [],
          };
          next();
        },
      );
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          exceptionFactory: (errors: ValidationError[]) => {
            const details = mapValidationErrors(errors);
            return new AppError(
              ErrorCode.VALIDATION_ERROR,
              'Request validation failed',
              HttpStatus.BAD_REQUEST,
              details,
            );
          },
        }),
      );
      app.useGlobalFilters(new GlobalExceptionFilter());
      setupSwagger(app);
      await app.init();
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    it('exposes Employee Salaries endpoints and query contracts in Swagger OpenAPI JSON', async () => {
      if (!isConnected) return;

      const res = await request(app.getHttpServer())
        .get('/docs/json')
        .expect(200);
      const swagger = res.body as SwaggerDocBody;

      const assignPath =
        swagger.paths['/api/v1/employees/{id}/salary-assignments'];
      const currentPath =
        swagger.paths['/api/v1/employees/{id}/salary-assignments/current'];

      expect(assignPath?.post?.tags).toContain('Employee Salaries');
      expect(assignPath?.get?.tags).toContain('Employee Salaries');
      expect(currentPath?.get?.tags).toContain('Employee Salaries');

      const currentParams =
        currentPath?.get?.parameters?.map((p) => p.name) ?? [];
      expect(currentParams).toEqual(expect.arrayContaining(['id', 'asOfDate']));

      const historyParams =
        assignPath?.get?.parameters?.map((p) => p.name) ?? [];
      expect(historyParams).toEqual(
        expect.arrayContaining(['id', 'page', 'limit', 'sortBy', 'sortOrder']),
      );
    });

    it('returns SUPERSEDED current salary during Nov-Dec 2026 interim window before Jan 2027 future revision and serves history GET API cleanly', async () => {
      if (!isConnected) return;

      const employeeId = await createTestEmployee('2026-01-01');
      const { structure1Id, structure2Id } =
        await createTestStructuresAndComponents();
      const basePath = `/api/v1/employees/${employeeId.toString()}/salary-assignments`;

      // 1. Assign July 2026 salary (50k)
      await request(app.getHttpServer())
        .post(basePath)
        .send({
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2026-07-01',
        })
        .expect(HttpStatus.CREATED);

      // 2. Assign future January 2027 revision (80k)
      await request(app.getHttpServer())
        .post(basePath)
        .send({
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2027-01-01',
        })
        .expect(HttpStatus.CREATED);

      // Confirm DB state directly: July 2026 record is marked SUPERSEDED with effectiveTo = 2027-01-01
      const dbRecords = await employeeSalaryModel
        .find({ employeeId })
        .sort({ effectiveFrom: 1 })
        .lean()
        .exec();
      expect(dbRecords).toHaveLength(2);
      expect(dbRecords[0].status).toBe(EmployeeSalaryStatus.SUPERSEDED);
      expect(dbRecords[0].effectiveTo?.toISOString().slice(0, 10)).toBe(
        '2027-01-01',
      );
      expect(dbRecords[1].status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(dbRecords[1].effectiveTo).toBeNull();

      // 3. GET /current in Nov 2026 -> MUST return the 50k SUPERSEDED record!
      const novRes = await request(app.getHttpServer())
        .get(`${basePath}/current?asOfDate=2026-11-25`)
        .expect(HttpStatus.OK);
      const novBody = novRes.body as HttpCurrentSalaryBody;
      expect(novBody.success).toBe(true);
      expect(novBody.data).not.toBeNull();
      expect(novBody.data?.salaryAmount).toBe(50000);
      expect(novBody.data?.effectiveFrom).toBe('2026-07-01');
      expect(novBody.data?.effectiveTo).toBe('2027-01-01');
      expect(novBody.data?.status).toBe(EmployeeSalaryStatus.SUPERSEDED);

      // 4. GET /current on 2026-12-31 -> still returns 50k SUPERSEDED record
      const decRes = await request(app.getHttpServer())
        .get(`${basePath}/current?asOfDate=2026-12-31`)
        .expect(HttpStatus.OK);
      expect((decRes.body as HttpCurrentSalaryBody).data?.salaryAmount).toBe(
        50000,
      );

      // 5. GET /current on 2027-01-01 -> transitions to 80k ACTIVE record
      const janRes = await request(app.getHttpServer())
        .get(`${basePath}/current?asOfDate=2027-01-01`)
        .expect(HttpStatus.OK);
      const janBody = janRes.body as HttpCurrentSalaryBody;
      expect(janBody.data?.salaryAmount).toBe(80000);
      expect(janBody.data?.effectiveFrom).toBe('2027-01-01');
      expect(janBody.data?.effectiveTo).toBeNull();
      expect(janBody.data?.status).toBe(EmployeeSalaryStatus.ACTIVE);

      // 6. GET /current validation edge cases -> invalid date & invalid ObjectId return 400
      await request(app.getHttpServer())
        .get(`${basePath}/current?asOfDate=not-a-date`)
        .expect(HttpStatus.BAD_REQUEST);
      await request(app.getHttpServer())
        .get('/api/v1/employees/bad-object-id/salary-assignments/current')
        .expect(HttpStatus.BAD_REQUEST);

      // 7. GET history API -> default desc sort + ascending paginated sort + validation
      const descHistoryRes = await request(app.getHttpServer())
        .get(basePath)
        .expect(HttpStatus.OK);
      const descHistory = descHistoryRes.body as HttpHistoryBody;
      expect(descHistory.success).toBe(true);
      expect(descHistory.meta.total).toBe(2);
      expect(descHistory.data[0].effectiveFrom).toBe('2027-01-01');
      expect(descHistory.data[0].status).toBe(EmployeeSalaryStatus.ACTIVE);
      expect(descHistory.data[1].effectiveFrom).toBe('2026-07-01');
      expect(descHistory.data[1].status).toBe(EmployeeSalaryStatus.SUPERSEDED);

      const ascHistoryRes = await request(app.getHttpServer())
        .get(`${basePath}?sortBy=effectiveFrom&sortOrder=asc&page=1&limit=1`)
        .expect(HttpStatus.OK);
      const ascHistory = ascHistoryRes.body as HttpHistoryBody;
      expect(ascHistory.data).toHaveLength(1);
      expect(ascHistory.data[0].effectiveFrom).toBe('2026-07-01');
      expect(ascHistory.meta.totalPages).toBe(2);
      expect(ascHistory.meta.hasNextPage).toBe(true);

      await request(app.getHttpServer())
        .get(`${basePath}?sortBy=salarySnapshot`)
        .expect(HttpStatus.BAD_REQUEST);

      await request(app.getHttpServer())
        .get(
          `/api/v1/employees/${new Types.ObjectId().toString()}/salary-assignments`,
        )
        .expect(HttpStatus.NOT_FOUND);
    });

    it('creates non-overlapping ACTIVE assignment when only closed SUPERSEDED history exists, preserves history, enforces partial unique index under concurrency, and rolls back on audit failure', async () => {
      if (!isConnected) return;

      const employeeId = await createTestEmployee('2026-01-01');
      const { structure1Id, structure2Id } =
        await createTestStructuresAndComponents();
      const basePath = `/api/v1/employees/${employeeId.toString()}/salary-assignments`;

      // Seed closed SUPERSEDED assignment [2026-10-27, 2027-01-01) with __v: 0 (no active assignment)
      const histDoc = await repository.create({
        employeeId,
        salaryStructureId: structure1Id,
        effectiveFrom: new Date('2026-10-27T00:00:00.000Z'),
        effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        salaryStructureVersion: 1,
        salarySnapshot: {
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          inputSalaryAmount: 50000,
          grossSalaryMonthly: 50000,
          grossSalaryAnnual: 600000,
          totalEmployerContributionsMonthly: 0,
          totalEmployerContributionsAnnual: 0,
          totalCtcMonthly: 50000,
          totalCtcAnnual: 600000,
          totalEmployeeDeductionsMonthly: 0,
          totalEmployeeDeductionsAnnual: 0,
          estimatedNetSalaryMonthly: 50000,
          estimatedNetSalaryAnnual: 600000,
          summary: {
            monthly: {
              grossSalary: 50000,
              employerContributions: 0,
              totalCtc: 50000,
              employeeDeductions: 0,
              estimatedNetSalary: 50000,
            },
            annual: {
              grossSalary: 600000,
              employerContributions: 0,
              totalCtc: 600000,
              employeeDeductions: 0,
              estimatedNetSalary: 600000,
            },
          },
          earnings: [],
          employeeDeductions: [],
          employerContributions: [],
        },
        status: EmployeeSalaryStatus.SUPERSEDED,
        createdBy: actorId,
        updatedBy: actorId,
      });

      // 1. Overlapping date against historical SUPERSEDED record -> 409 Conflict
      await request(app.getHttpServer())
        .post(basePath)
        .send({
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2026-12-01',
        })
        .expect(HttpStatus.CONFLICT);

      // 2. Transaction rollback on audit failure -> historical record stays untouched, no orphan created
      jest
        .spyOn(auditLogsService, 'createAuditLog')
        .mockRejectedValueOnce(
          new Error('Simulated MongoDB audit crash after superseded history'),
        );
      await request(app.getHttpServer())
        .post(basePath)
        .send({
          salaryStructureId: structure2Id.toString(),
          effectiveFrom: '2027-06-01',
        })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR);

      expect(await employeeSalaryModel.countDocuments({ employeeId })).toBe(1);

      // 3. Concurrent POST creation when only SUPERSEDED history exists -> exactly 1 succeeds, 1 rejected
      const [c1, c2] = await Promise.allSettled([
        service.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2027-06-01',
          },
          actorId,
        ),
        service.assignSalary(
          employeeId,
          {
            salaryStructureId: structure2Id.toString(),
            effectiveFrom: '2027-06-01',
          },
          actorId,
        ),
      ]);
      const fulfilled = [c1, c2].filter((r) => r.status === 'fulfilled');
      const rejected = [c1, c2].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect([HttpStatus.CONFLICT, HttpStatus.BAD_REQUEST]).toContain(
        (rejected[0].reason as AppError).statusCode,
      );

      // Historical doc preserved untouched, and unique partial index ensures exactly 1 open ACTIVE record
      const histAfter = await employeeSalaryModel.findById(histDoc._id).exec();
      expect(histAfter?.status).toBe(EmployeeSalaryStatus.SUPERSEDED);
      expect(histAfter?.effectiveTo?.toISOString().slice(0, 10)).toBe(
        '2027-01-01',
      );
      expect(histAfter?.__v).toBe(0);

      const activeDocs = await employeeSalaryModel
        .find({
          employeeId,
          effectiveTo: null,
          status: EmployeeSalaryStatus.ACTIVE,
        })
        .exec();
      expect(activeDocs).toHaveLength(1);
      expect(activeDocs[0].effectiveFrom.toISOString().slice(0, 10)).toBe(
        '2027-06-01',
      );

      const assignAudit = await auditLogModel
        .findOne({
          targetId: activeDocs[0]._id,
          action: AuditAction.EMPLOYEE_SALARY_ASSIGNED,
        })
        .exec();
      expect(assignAudit).not.toBeNull();

      // 4. Subsequent revision on activeDocs[0] -> 2028-01-01 closes 2027-06-01 cleanly and logs REVISED
      const revRes = await request(app.getHttpServer())
        .post(basePath)
        .send({
          salaryStructureId: structure1Id.toString(),
          effectiveFrom: '2028-01-01',
        })
        .expect(HttpStatus.CREATED);
      const revId = (revRes.body as { data: { id: string } }).data.id;

      const closedActive = await employeeSalaryModel
        .findById(activeDocs[0]._id)
        .exec();
      expect(closedActive?.status).toBe(EmployeeSalaryStatus.SUPERSEDED);
      expect(closedActive?.effectiveTo?.toISOString().slice(0, 10)).toBe(
        '2028-01-01',
      );

      const reviseAudit = await auditLogModel
        .findOne({
          targetId: new Types.ObjectId(revId),
          action: AuditAction.EMPLOYEE_SALARY_REVISED,
        })
        .exec();
      expect(reviseAudit).not.toBeNull();
      expect(
        await employeeSalaryModel.countDocuments({
          employeeId,
          effectiveTo: null,
          status: EmployeeSalaryStatus.ACTIVE,
        }),
      ).toBe(1);
    });
  });
});
