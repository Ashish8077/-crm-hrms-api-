import * as dns from 'node:dns/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import mongoose, { Connection, Model, Types } from 'mongoose';
import {
  PayrollCalculationSnapshot,
  PayrollRecord,
  PayrollRecordDocument,
  PayrollRecordSchema,
} from './schemas/payroll-record.schema';
import { PayrollRecordRepository } from './repositories/payroll-record.repository';
import { PayrollRecordStatus } from './constants/payroll-calculation.constant';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../payroll-configuration/constants/payroll-configuration.constant';
import { EmploymentStatus } from '../employees/constants/employee.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
} from '../salary-structures/constants/salary-structure.constant';

const EXPECTED_TEST_DATABASE = 'crm_hrms_test';

function resolveMongoUri(): string | null {
  const testEnvPath = path.resolve(process.cwd(), '.env.test');

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

describe('PayrollCalculations - Real MongoDB Persistence & Unique Index Verification', () => {
  jest.setTimeout(20000);

  let connection: Connection | null = null;
  let model: Model<PayrollRecordDocument>;
  let repository: PayrollRecordRepository;
  let isConnected = false;
  const createdIds: Types.ObjectId[] = [];

  beforeAll(async () => {
    const uri = resolveMongoUri();
    if (!uri) {
      console.warn('Real MongoDB URI not configured; skipping live DB checks.');
      return;
    }

    try {
      // Fast 1.5s DNS pre-check so offline sandboxes skip immediately without hanging 30s
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

      connection = await mongoose
        .createConnection(uri, {
          serverSelectionTimeoutMS: 4000,
          connectTimeoutMS: 5000,
        })
        .asPromise();

      model = connection.model<PayrollRecordDocument>(
        PayrollRecord.name,
        PayrollRecordSchema,
      );
      await model.init();
      repository = new PayrollRecordRepository(model);
      isConnected = true;
    } catch (err: unknown) {
      await connection?.close(true).catch(() => undefined);
      connection = null;
      isConnected = false;

      throw err;
    }
  });

  afterAll(async () => {
    if (isConnected && connection) {
      try {
        if (createdIds.length > 0) {
          await model.deleteMany({ _id: { $in: createdIds } });
        }
      } finally {
        await connection.close(true);
      }
    }
  });

  it('verifies uq_payroll_records_period_employee index exists on real MongoDB collection', async () => {
    if (!isConnected) return;

    const indexes = await model.collection.indexes();
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('uq_payroll_records_period_employee');
    expect(indexNames).toContain('idx_payroll_records_period_status');
    expect(indexNames).toContain('idx_payroll_records_employee_history');
  });

  it('enforces unique { payrollPeriodId, employeeId } constraint and Decimal128 persistence on real MongoDB', async () => {
    if (!isConnected) return;

    const periodId = new Types.ObjectId();
    const employeeId = new Types.ObjectId();
    const actorId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();
    const structureId = new Types.ObjectId();

    const snapshot: PayrollCalculationSnapshot = {
      engineVersion: '1.0.0',
      calculatedAt: new Date(),
      payrollPeriodId: periodId.toString(),
      periodCode: 'PR-REAL-DB',
      periodName: 'Real DB Test',
      payrollFrequency: PayrollFrequency.MONTHLY,
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      month: 4,
      year: 2026,
      employeeId: employeeId.toString(),
      employeeCode: 'EMP-REAL',
      employeeName: 'Real Tester',
      employmentStatus: EmploymentStatus.ACTIVE,
      salaryAssignmentId: assignmentId.toString(),
      salaryAssignmentVersion: 0,
      salaryAssignmentEffectiveFrom: '2026-01-01',
      salaryAssignmentEffectiveTo: null,
      salaryStructureId: structureId.toString(),
      salaryStructureCode: 'STR_REAL',
      salaryStructureName: 'Real Structure',
      salaryStructureVersion: 0,
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
      prorationDenominatorDays: 30,
      payableDays: 30,
      prorationApplied: false,
      prorationFactor: '1',
      executionOrder: [],
      earnings: [],
      deductions: [],
      employerContributions: [],
      grossEarnings: Types.Decimal128.fromString('30000.00'),
      totalDeductions: Types.Decimal128.fromString('200.00'),
      employerContributionsTotal: Types.Decimal128.fromString('3600.00'),
      netSalary: Types.Decimal128.fromString('29800.00'),
      netPayClamped: false,
    };

    const created = await repository.create({
      payrollPeriodId: periodId,
      employeeId,
      salaryAssignmentId: assignmentId,
      salaryStructureId: structureId,
      calculationSnapshot: snapshot,
      grossEarnings: Types.Decimal128.fromString('30000.00'),
      totalDeductions: Types.Decimal128.fromString('200.00'),
      employerContributions: Types.Decimal128.fromString('3600.00'),
      netSalary: Types.Decimal128.fromString('29800.00'),
      status: PayrollRecordStatus.CALCULATED,
      calculatedAt: new Date(),
      calculationVersion: 1,
      createdBy: actorId,
      updatedBy: actorId,
    });
    createdIds.push(created._id);

    expect(created.netSalary.toString()).toBe('29800.00');

    // Concurrent duplicate insertion for same (periodId, employeeId) must trigger E11000
    await expect(
      repository.create({
        payrollPeriodId: periodId,
        employeeId,
        salaryAssignmentId: assignmentId,
        salaryStructureId: structureId,
        calculationSnapshot: snapshot,
        grossEarnings: Types.Decimal128.fromString('30000.00'),
        totalDeductions: Types.Decimal128.fromString('200.00'),
        employerContributions: Types.Decimal128.fromString('3600.00'),
        netSalary: Types.Decimal128.fromString('29800.00'),
        status: PayrollRecordStatus.CALCULATED,
        calculatedAt: new Date(),
        calculationVersion: 1,
        createdBy: actorId,
        updatedBy: actorId,
      }),
    ).rejects.toThrow(/E11000/);

    // Atomic optimistic concurrency recalculation check
    const staleAttempt = await repository.recalculateAtomically(
      created._id,
      99, // wrong __v
      {
        salaryAssignmentId: assignmentId,
        salaryStructureId: structureId,
        calculationSnapshot: snapshot,
        grossEarnings: Types.Decimal128.fromString('31000.00'),
        totalDeductions: Types.Decimal128.fromString('200.00'),
        employerContributions: Types.Decimal128.fromString('3600.00'),
        netSalary: Types.Decimal128.fromString('30800.00'),
        calculatedAt: new Date(),
        updatedBy: actorId,
      },
    );
    expect(staleAttempt).toBeNull();
  });
});
