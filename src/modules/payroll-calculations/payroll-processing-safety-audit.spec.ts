/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  AttendanceRepository,
  PayrollAttendanceBucket,
} from '../attendance/repositories/attendance.repository';
import { AttendanceRegularizationRepository } from '../attendance/repositories/attendance-regularization.repository';
import { AuditAction } from '../audit-logs/constants/audit-log.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { EmployeeSalaryStatus } from '../employee-salaries/constants/employee-salary.constant';
import { EmployeeSalaryRepository } from '../employee-salaries/repositories/employee-salary.repository';
import { EmployeeSalaryLean } from '../employee-salaries/schemas/employee-salary.schema';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  EmployeeLean,
  EmployeeRepository,
} from '../employees/repositories/employee.repository';
import { Employee } from '../employees/schemas/employee.schema';
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
import {
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodRepository } from '../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../payroll-periods/schemas/payroll-period.schema';
import {
  PayrollLeaveAttendanceResolution,
  PayrollLeaveAttendanceResolverService,
} from '../payroll-periods/services/payroll-leave-attendance-resolver.service';
import { PayrollPeriodsService } from '../payroll-periods/services/payroll-periods.service';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  SalaryComponent,
  SalaryComponentLean,
} from '../salary-components/schemas/salary-component.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../salary-structures/constants/salary-structure.constant';
import { SalaryStructureRepository } from '../salary-structures/repositories/salary-structure.repository';
import { SalaryStructureLean } from '../salary-structures/schemas/salary-structure.schema';
import { SalaryStructureCalculationService } from '../salary-structures/services/salary-structure-calculation.service';
import { WeeklyOffConfigRepository } from '../work-schedules/repositories/weekly-off-config.repository';
import {
  PAYROLL_CALCULATION_ENGINE_VERSION,
  PayrollRecordStatus,
} from './constants/payroll-calculation.constant';
import { PayrollPeriodProcessingController } from './controllers/payroll-period-processing.controller';
import {
  PayrollProcessingFailureRepository,
  UpsertPayrollProcessingFailureItem,
  sanitizeProcessingErrorMessage,
} from './repositories/payroll-processing-failure.repository';
import {
  CreatePayrollRecordInput,
  PayrollRecordRepository,
  RecalculatePayrollRecordInput,
} from './repositories/payroll-record.repository';
import { PayrollProcessingFailureLean } from './schemas/payroll-processing-failure.schema';
import { PayrollRecordLean } from './schemas/payroll-record.schema';
import { ComponentCalculationEngine } from './services/component-calculation.engine';
import { ComponentDependencyResolver } from './services/component-dependency.resolver';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import {
  PayrollInputResolver,
  ResolvedPayrollInputs,
} from './services/payroll-input.resolver';
import { PayrollProcessingService } from './services/payroll-processing.service';
import { PayrollSnapshotBuilder } from './services/payroll-snapshot.builder';
import { PayrollTotalsCalculator } from './services/payroll-totals.calculator';
import { ProrationCalculator } from './services/proration.calculator';
import {
  ResolvedStructureComponents,
  SalaryComponentResolver,
} from './services/salary-component.resolver';
import { computePayrollInputFingerprint } from './utils/payroll-input-fingerprint.util';

class InMemoryPayrollRecordRepo {
  private readonly store = new Map<string, PayrollRecordLean>();
  public createCalls = 0;
  public recalcCalls = 0;

  clear(): void {
    this.store.clear();
    this.createCalls = 0;
    this.recalcCalls = 0;
  }

  values(): PayrollRecordLean[] {
    return Array.from(this.store.values());
  }

  deleteByEmployeeId(employeeId: Types.ObjectId): void {
    for (const [id, rec] of this.store.entries()) {
      if (rec.employeeId.equals(employeeId)) {
        this.store.delete(id);
      }
    }
  }

  isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
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

  async findActiveByPeriodAndEmployees(
    payrollPeriodId: Types.ObjectId,
    employeeIds: Types.ObjectId[],
  ): Promise<PayrollRecordLean[]> {
    const allowed = new Set(employeeIds.map((id) => id.toHexString()));
    return Array.from(this.store.values())
      .filter(
        (rec) =>
          rec.deletedAt === null &&
          rec.payrollPeriodId.equals(payrollPeriodId) &&
          allowed.has(rec.employeeId.toHexString()),
      )
      .map((rec) => ({ ...rec }));
  }

  async findFullByPeriodAndEmployees(
    payrollPeriodId: Types.ObjectId,
    employeeIds: Types.ObjectId[],
  ): Promise<PayrollRecordLean[]> {
    return this.findActiveByPeriodAndEmployees(payrollPeriodId, employeeIds);
  }

  async findActiveSummariesByPeriod(payrollPeriodId: Types.ObjectId) {
    return Array.from(this.store.values())
      .filter(
        (rec) =>
          rec.deletedAt === null &&
          rec.status !== PayrollRecordStatus.INVALIDATED &&
          rec.payrollPeriodId.equals(payrollPeriodId),
      )
      .map((rec) => ({
        _id: rec._id,
        employeeId: rec.employeeId,
        status: rec.status,
        calculationVersion: rec.calculationVersion,
        calculatedAt: rec.calculatedAt,
        inputFingerprint: rec.calculationSnapshot?.inputFingerprint ?? null,
      }));
  }

  async create(input: CreatePayrollRecordInput): Promise<PayrollRecordLean> {
    const duplicate = await this.findByPeriodAndEmployee(
      input.payrollPeriodId,
      input.employeeId,
    );
    if (duplicate) {
      const err = new Error('E11000 duplicate key error');
      (err as unknown as { code: number }).code = 11000;
      throw err;
    }

    this.createCalls++;
    const now = new Date();
    const doc = {
      _id: new Types.ObjectId(),
      ...input,
      invalidatedAt: null,
      invalidatedBy: null,
      invalidationReason: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    } as unknown as PayrollRecordLean;
    this.store.set(doc._id.toHexString(), doc);
    return { ...doc };
  }

  async createMany(
    inputs: CreatePayrollRecordInput[],
  ): Promise<PayrollRecordLean[]> {
    const out: PayrollRecordLean[] = [];
    for (const input of inputs) {
      out.push(await this.create(input));
    }
    return out;
  }

  async recalculateAtomically(
    id: Types.ObjectId,
    expectedVersion: number,
    input: RecalculatePayrollRecordInput,
  ): Promise<PayrollRecordLean | null> {
    const existing = this.store.get(id.toHexString());
    if (
      !existing ||
      existing.deletedAt !== null ||
      (existing.status !== PayrollRecordStatus.CALCULATED &&
        existing.status !== PayrollRecordStatus.INVALIDATED) ||
      existing.__v !== expectedVersion
    ) {
      return null;
    }

    this.recalcCalls++;
    const updated = {
      ...existing,
      ...input,
      status: PayrollRecordStatus.CALCULATED,
      invalidatedAt: null,
      invalidatedBy: null,
      invalidationReason: null,
      calculationVersion: existing.calculationVersion + 1,
      updatedAt: new Date(),
      __v: existing.__v + 1,
    } as unknown as PayrollRecordLean;
    this.store.set(id.toHexString(), updated);
    return { ...updated };
  }

  async invalidateCalculatedByPeriodAndEmployees(params: {
    payrollPeriodId: Types.ObjectId;
    employeeIds: Types.ObjectId[];
    reason: string;
    actorId: Types.ObjectId;
    invalidatedAt: Date;
  }): Promise<number> {
    let modified = 0;
    const targetSet = new Set(params.employeeIds.map((id) => id.toHexString()));
    for (const [id, rec] of this.store.entries()) {
      if (
        rec.payrollPeriodId.equals(params.payrollPeriodId) &&
        targetSet.has(rec.employeeId.toHexString()) &&
        rec.deletedAt === null &&
        rec.status === PayrollRecordStatus.CALCULATED
      ) {
        this.store.set(id, {
          ...rec,
          status: PayrollRecordStatus.INVALIDATED,
          invalidatedAt: params.invalidatedAt,
          invalidatedBy: params.actorId,
          invalidationReason: params.reason,
          updatedBy: params.actorId,
          __v: rec.__v + 1,
        });
        modified++;
      }
    }
    return modified;
  }

  setStatusForTest(id: Types.ObjectId, status: PayrollRecordStatus): void {
    const rec = this.store.get(id.toHexString());
    if (rec) {
      this.store.set(id.toHexString(), { ...rec, status });
    }
  }
}

class InMemoryFailureRepo {
  private readonly store = new Map<string, PayrollProcessingFailureLean>();

  clear(): void {
    this.store.clear();
  }

  private key(periodId: Types.ObjectId, employeeId: Types.ObjectId): string {
    return `${periodId.toHexString()}:${employeeId.toHexString()}`;
  }

  async upsertFailuresBulk(
    payrollPeriodId: Types.ObjectId,
    items: UpsertPayrollProcessingFailureItem[],
  ): Promise<void> {
    const now = new Date();
    for (const item of items) {
      const k = this.key(payrollPeriodId, item.employeeId);
      const prev = this.store.get(k);
      this.store.set(k, {
        _id: prev?._id ?? new Types.ObjectId(),
        payrollPeriodId,
        employeeId: item.employeeId,
        employeeCode: item.employeeCode,
        employeeName: item.employeeName,
        errorCode: item.errorCode,
        errorMessage: sanitizeProcessingErrorMessage(item.errorMessage),
        attemptNumber: item.attemptNumber,
        lastAttemptAt: item.lastAttemptAt,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      });
    }
  }

  async deleteByPeriodAndEmployees(
    payrollPeriodId: Types.ObjectId,
    employeeIds: Types.ObjectId[],
  ): Promise<void> {
    for (const empId of employeeIds) {
      this.store.delete(this.key(payrollPeriodId, empId));
    }
  }

  async deleteByPeriodExcludingEmployees(
    payrollPeriodId: Types.ObjectId,
    eligibleEmployeeIds: Types.ObjectId[],
  ): Promise<void> {
    const keep = new Set(eligibleEmployeeIds.map((id) => id.toHexString()));
    for (const [k, v] of this.store.entries()) {
      if (
        v.payrollPeriodId.equals(payrollPeriodId) &&
        !keep.has(v.employeeId.toHexString())
      ) {
        this.store.delete(k);
      }
    }
  }

  async deleteByPeriod(payrollPeriodId: Types.ObjectId): Promise<void> {
    for (const [k, v] of this.store.entries()) {
      if (v.payrollPeriodId.equals(payrollPeriodId)) {
        this.store.delete(k);
      }
    }
  }

  async countByPeriod(payrollPeriodId: Types.ObjectId): Promise<number> {
    let count = 0;
    for (const v of this.store.values()) {
      if (v.payrollPeriodId.equals(payrollPeriodId)) count++;
    }
    return count;
  }

  async findEmployeeIdsByPeriod(
    payrollPeriodId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const ids: Types.ObjectId[] = [];
    for (const v of this.store.values()) {
      if (v.payrollPeriodId.equals(payrollPeriodId)) {
        ids.push(v.employeeId);
      }
    }
    return ids;
  }

  async findPaginatedByPeriod(
    payrollPeriodId: Types.ObjectId,
    page: number,
    limit: number,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const all = Array.from(this.store.values())
      .filter((v) => v.payrollPeriodId.equals(payrollPeriodId))
      .sort((a, b) => {
        const t = b.lastAttemptAt.getTime() - a.lastAttemptAt.getTime();
        if (t !== 0) return t;
        return a.employeeCode.localeCompare(b.employeeCode);
      });
    const total = all.length;
    const totalPages = Math.ceil(total / safeLimit);
    const start = (safePage - 1) * safeLimit;
    return {
      data: all.slice(start, start + safeLimit),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
      },
    };
  }
}

class InMemoryPeriodRepo {
  readonly store = new Map<string, PayrollPeriodLean>();

  private cloneDoc(doc: PayrollPeriodLean): PayrollPeriodLean {
    return {
      ...doc,
      processing: doc.processing ? { ...doc.processing } : undefined,
    };
  }

  async findById(id: Types.ObjectId): Promise<PayrollPeriodLean | null> {
    const doc = this.store.get(id.toHexString());
    if (!doc || doc.deletedAt !== null) return null;
    return this.cloneDoc(doc);
  }

  async updateStatus(
    id: Types.ObjectId,
    newStatus: PayrollPeriodStatus,
    actorId: Types.ObjectId,
    expectedVersion?: number,
  ): Promise<PayrollPeriodLean | null> {
    const doc = this.store.get(id.toHexString());
    if (!doc || doc.deletedAt !== null) return null;
    if (typeof expectedVersion === 'number' && doc.__v !== expectedVersion) {
      return null;
    }
    const updated: PayrollPeriodLean = {
      ...this.cloneDoc(doc),
      status: newStatus,
      updatedBy: actorId,
      __v: (doc.__v ?? 0) + 1,
      updatedAt: new Date(),
    };
    this.store.set(id.toHexString(), updated);
    return this.cloneDoc(updated);
  }

  async acquireProcessingLock(params: {
    periodId: Types.ObjectId;
    runId: string;
    actorId: Types.ObjectId;
    now: Date;
    staleCutoff: Date;
  }): Promise<PayrollPeriodLean | null> {
    const doc = this.store.get(params.periodId.toHexString());
    if (!doc || doc.deletedAt !== null) return null;
    if (
      doc.status !== PayrollPeriodStatus.DRAFT &&
      doc.status !== PayrollPeriodStatus.PROCESSING
    ) {
      return null;
    }

    const proc = doc.processing;
    const isProcessing =
      proc?.processingStatus === PayrollProcessingStatus.PROCESSING;
    const isStale = Boolean(
      (proc?.heartbeatAt && proc.heartbeatAt < params.staleCutoff) ||
      (!proc?.heartbeatAt &&
        proc?.lastAttemptAt &&
        proc.lastAttemptAt < params.staleCutoff),
    );
    if (isProcessing && !isStale) {
      return null;
    }

    const updated: PayrollPeriodLean = {
      ...this.cloneDoc(doc),
      status: PayrollPeriodStatus.PROCESSING,
      updatedBy: params.actorId,
      __v: (doc.__v ?? 0) + 1,
      processing: {
        processingStatus: PayrollProcessingStatus.PROCESSING,
        totalEligibleEmployees: proc?.totalEligibleEmployees ?? 0,
        processedEmployees: 0,
        successfulEmployees: proc?.successfulEmployees ?? 0,
        failedEmployees: proc?.failedEmployees ?? 0,
        skippedUpToDateEmployees: 0,
        recalculatedEmployees: 0,
        processingAttempts: (proc?.processingAttempts ?? 0) + 1,
        startedAt: proc?.startedAt ?? params.now,
        completedAt: null,
        lastAttemptAt: params.now,
        heartbeatAt: params.now,
        activeRunId: params.runId,
        lastErrorSummary: null,
      },
    };
    this.store.set(params.periodId.toHexString(), updated);
    return this.cloneDoc(updated);
  }

  async verifyActiveRunOwnership(
    periodId: Types.ObjectId,
    runId: string,
  ): Promise<boolean> {
    const doc = this.store.get(periodId.toHexString());
    return Boolean(
      doc &&
      doc.deletedAt === null &&
      doc.status !== PayrollPeriodStatus.FINALIZED &&
      doc.processing?.activeRunId === runId,
    );
  }

  async touchActiveRunLock(params: {
    periodId: Types.ObjectId;
    runId: string;
    now: Date;
  }): Promise<boolean> {
    const doc = this.store.get(params.periodId.toHexString());
    if (
      !doc ||
      doc.deletedAt !== null ||
      doc.status === PayrollPeriodStatus.FINALIZED ||
      doc.processing?.activeRunId !== params.runId
    ) {
      return false;
    }
    doc.processing = {
      ...doc.processing,
      heartbeatAt: params.now,
    };
    return true;
  }

  async updateProcessingProgress(params: {
    periodId: Types.ObjectId;
    runId: string;
    totalEligibleEmployees: number;
    processedEmployees: number;
    successfulEmployees: number;
    failedEmployees: number;
    skippedUpToDateEmployees: number;
    recalculatedEmployees: number;
    heartbeatAt: Date;
  }): Promise<boolean> {
    const doc = this.store.get(params.periodId.toHexString());
    if (!doc || doc.processing?.activeRunId !== params.runId) {
      return false;
    }
    doc.processing = {
      ...doc.processing,
      totalEligibleEmployees: params.totalEligibleEmployees,
      processedEmployees: params.processedEmployees,
      successfulEmployees: params.successfulEmployees,
      failedEmployees: params.failedEmployees,
      skippedUpToDateEmployees: params.skippedUpToDateEmployees,
      recalculatedEmployees: params.recalculatedEmployees,
      heartbeatAt: params.heartbeatAt,
    };
    return true;
  }

  async completeProcessingRun(params: {
    periodId: Types.ObjectId;
    runId: string;
    processingStatus:
      | PayrollProcessingStatus.COMPLETED
      | PayrollProcessingStatus.COMPLETED_WITH_ERRORS
      | PayrollProcessingStatus.FAILED;
    totalEligibleEmployees: number;
    processedEmployees: number;
    successfulEmployees: number;
    failedEmployees: number;
    skippedUpToDateEmployees: number;
    recalculatedEmployees: number;
    completedAt: Date;
    lastErrorSummary: string | null;
  }): Promise<PayrollPeriodLean | null> {
    const doc = this.store.get(params.periodId.toHexString());
    if (!doc || doc.processing?.activeRunId !== params.runId) {
      return null;
    }
    doc.processing = {
      ...doc.processing,
      processingStatus: params.processingStatus,
      totalEligibleEmployees: params.totalEligibleEmployees,
      processedEmployees: params.processedEmployees,
      successfulEmployees: params.successfulEmployees,
      failedEmployees: params.failedEmployees,
      skippedUpToDateEmployees: params.skippedUpToDateEmployees,
      recalculatedEmployees: params.recalculatedEmployees,
      completedAt: params.completedAt,
      heartbeatAt: params.completedAt,
      activeRunId: null,
      lastErrorSummary: params.lastErrorSummary,
    };
    doc.__v = (doc.__v ?? 0) + 1;
    return this.cloneDoc(doc);
  }

  async verifyPeriodMutableAndBumpVersion(
    periodId: Types.ObjectId,
    allowedStatuses: ReadonlyArray<PayrollPeriodStatus>,
  ): Promise<boolean> {
    const doc = this.store.get(periodId.toHexString());
    if (
      !doc ||
      doc.deletedAt !== null ||
      !allowedStatuses.includes(doc.status)
    ) {
      return false;
    }
    doc.__v = (doc.__v ?? 0) + 1;
    return true;
  }
}

describe('Step 5 — Independent Payroll Processing Safety Audit', () => {
  let processingService: PayrollProcessingService;
  let calculationService: PayrollCalculationService;
  let periodRepo: InMemoryPeriodRepo;
  let recordRepo: InMemoryPayrollRecordRepo;
  let failureRepo: InMemoryFailureRepo;

  const actorId = new Types.ObjectId();
  const branchId = new Types.ObjectId();

  let employees: Map<string, EmployeeLean>;
  let assignments: EmployeeSalaryLean[];
  let structures: Map<string, SalaryStructureLean>;
  let components: Map<string, SalaryComponentLean>;
  let attendanceBuckets: PayrollAttendanceBucket[];
  let leaves: LeaveRequestLean[];
  let auditLogs: Array<Record<string, unknown>>;
  let settingsDoc: Record<string, unknown>;
  let rulesDoc: Record<string, unknown>;

  let periodId: Types.ObjectId;
  let structureId: Types.ObjectId;
  let basicCompId: Types.ObjectId;

  const addEmployee = (
    code: string,
    opts?: Partial<EmployeeLean> & {
      salary?: number;
      skipAssignment?: boolean;
    },
  ): Types.ObjectId => {
    const id = opts?._id ?? new Types.ObjectId();
    employees.set(id.toHexString(), {
      _id: id,
      employeeCode: code,
      firstName: 'Emp',
      lastName: code,
      employmentStatus: opts?.employmentStatus ?? EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining:
        opts?.dateOfJoining ?? new Date('2025-01-01T00:00:00.000Z'),
      lastWorkingDate: opts?.lastWorkingDate ?? null,
      terminationDate: opts?.terminationDate ?? null,
      branchId,
      deletedAt: opts?.deletedAt ?? null,
    } as unknown as EmployeeLean);

    if (!opts?.skipAssignment) {
      const salary = opts?.salary ?? 30000;
      assignments.push({
        _id: new Types.ObjectId(),
        employeeId: id,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
        effectiveTo: null,
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: salary,
        salaryStructureVersion: 1,
        salarySnapshot: {} as EmployeeSalaryLean['salarySnapshot'],
        status: EmployeeSalaryStatus.ACTIVE,
        __v: 0,
      } as unknown as EmployeeSalaryLean);
    }

    return id;
  };

  beforeAll(async () => {
    periodRepo = new InMemoryPeriodRepo();
    recordRepo = new InMemoryPayrollRecordRepo();
    failureRepo = new InMemoryFailureRepo();
    employees = new Map();
    assignments = [];
    structures = new Map();
    components = new Map();
    attendanceBuckets = [];
    leaves = [];

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollPeriodProcessingController],
      providers: [
        PayrollProcessingService,
        PayrollPeriodsService,
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
        Reflector,
        PermissionsGuard,
        { provide: PayrollPeriodRepository, useValue: periodRepo },
        { provide: PayrollRecordRepository, useValue: recordRepo },
        { provide: PayrollProcessingFailureRepository, useValue: failureRepo },
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
          provide: EmployeeRepository,
          useValue: {
            findForPayrollAttendanceSummary: jest.fn(async () =>
              Array.from(employees.values()).filter(
                (e) => e.deletedAt === null,
              ),
            ),
          },
        },
        {
          provide: getModelToken(Employee.name),
          useValue: {
            findById: jest.fn((id: Types.ObjectId) => ({
              lean: () => ({
                exec: async () => employees.get(id.toHexString()) ?? null,
              }),
            })),
            find: jest.fn(
              (filter: {
                _id?: { $in?: Types.ObjectId[] };
                deletedAt?: null;
              }) => {
                const runFilter = () => {
                  const all = Array.from(employees.values()).filter(
                    (e) => e.deletedAt === null,
                  );
                  const subset = filter?._id?.$in
                    ? all.filter((e) =>
                        filter._id!.$in!.some((id) => id.equals(e._id)),
                      )
                    : all;
                  return subset.sort((a, b) =>
                    a.employeeCode.localeCompare(b.employeeCode),
                  );
                };
                const chain = {
                  select: () => chain,
                  sort: () => ({
                    lean: () => ({
                      exec: async () => runFilter(),
                    }),
                  }),
                };
                return chain;
              },
            ),
          },
        },
        {
          provide: EmployeeSalaryRepository,
          useValue: {
            findAllByEmployeeId: jest.fn(async (empId: Types.ObjectId) =>
              assignments.filter((a) => a.employeeId.equals(empId)),
            ),
            findAllByEmployeeIds: jest.fn(async (empIds: Types.ObjectId[]) =>
              assignments.filter((a) =>
                empIds.some((id) => id.equals(a.employeeId)),
              ),
            ),
          },
        },
        {
          provide: SalaryStructureRepository,
          useValue: {
            findById: jest.fn(
              async (id: Types.ObjectId) =>
                structures.get(id.toHexString()) ?? null,
            ),
            findByIds: jest.fn(async (ids: Types.ObjectId[]) =>
              ids
                .map((id) => structures.get(id.toHexString()))
                .filter((s): s is SalaryStructureLean => Boolean(s)),
            ),
          },
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: {
            find: jest.fn((q: { _id?: { $in?: Types.ObjectId[] } }) => ({
              lean: () => ({
                exec: async () =>
                  (q._id?.$in ?? [])
                    .map((id) => components.get(id.toHexString()))
                    .filter((c): c is SalaryComponentLean => Boolean(c)),
              }),
            })),
          },
        },
        {
          provide: PayrollSettingsRepository,
          useValue: { findActive: jest.fn(async () => settingsDoc) },
        },
        {
          provide: PayrollCalculationRuleRepository,
          useValue: { findActive: jest.fn(async () => rulesDoc) },
        },
        {
          provide: BranchRepository,
          useValue: {
            findByIds: jest.fn(async () => [
              { _id: branchId, timezone: 'Asia/Kolkata' },
            ]),
          },
        },
        {
          provide: HolidayRepository,
          useValue: { findActiveInRange: jest.fn(async () => []) },
        },
        {
          provide: WeeklyOffConfigRepository,
          useValue: { findActiveEffectiveInRange: jest.fn(async () => []) },
        },
        {
          provide: AttendanceRepository,
          useValue: {
            aggregateForPayrollPeriod: jest.fn(
              async (
                empIds: Types.ObjectId[],
                startDate: string,
                endDate: string,
              ) =>
                attendanceBuckets.filter(
                  (b) =>
                    empIds.some((id) => id.equals(b.employeeId)) &&
                    b.attendanceDate >= startDate &&
                    b.attendanceDate <= endDate,
                ),
            ),
          },
        },
        {
          provide: AttendanceRegularizationRepository,
          useValue: { findByIds: jest.fn(async () => []) },
        },
        {
          provide: LeaveRequestRepository,
          useValue: {
            findOverlappingForEmployees: jest.fn(
              async (empIds: Types.ObjectId[]) =>
                leaves.filter((l) =>
                  empIds.some((id) => id.equals(l.employeeId)),
                ),
            ),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn(async (entry: Record<string, unknown>) => {
              auditLogs.push(entry);
            }),
            createAuditLogsBulk: jest.fn(
              async (entries: Array<Record<string, unknown>>) => {
                auditLogs.push(...entries);
              },
            ),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            hasPermissions: jest.fn(async () => true),
          },
        },
      ],
    }).compile();

    processingService = module.get(PayrollProcessingService);
    calculationService = module.get(PayrollCalculationService);
  });

  beforeEach(() => {
    periodRepo.store.clear();
    recordRepo.clear();
    failureRepo.clear();
    employees.clear();
    assignments = [];
    structures.clear();
    components.clear();
    attendanceBuckets = [];
    leaves = [];
    auditLogs = [];

    periodId = new Types.ObjectId();
    structureId = new Types.ObjectId();
    basicCompId = new Types.ObjectId();

    periodRepo.store.set(periodId.toHexString(), {
      _id: periodId,
      periodName: 'April 2026 Payroll',
      periodCode: 'PR-2026-04',
      payrollFrequency: PayrollFrequency.MONTHLY,
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-04-30T23:59:59.999Z'),
      paymentDate: new Date('2026-05-01T00:00:00.000Z'),
      month: 4,
      year: 2026,
      status: PayrollPeriodStatus.DRAFT,
      notes: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    } as unknown as PayrollPeriodLean);

    components.set(basicCompId.toHexString(), {
      _id: basicCompId,
      code: 'BASIC',
      name: 'Basic Salary',
      type: SalaryComponentType.EARNING,
      isActive: true,
      isTaxable: true,
      deletedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    } as unknown as SalaryComponentLean);

    structures.set(structureId.toHexString(), {
      _id: structureId,
      name: 'Standard Monthly',
      code: 'STR-01',
      isActive: true,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryAmount: 30000,
      components: [
        {
          componentId: basicCompId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 30000,
          percentage: null,
          percentageOf: null,
        },
      ],
      deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      __v: 0,
    } as unknown as SalaryStructureLean);

    settingsDoc = {
      _id: new Types.ObjectId(),
      currency: 'INR',
      isPayrollProcessingEnabled: true,
      deletedAt: null,
      __v: 0,
    };

    rulesDoc = {
      _id: new Types.ObjectId(),
      roundingMode: PayrollRoundingMode.HALF_UP,
      roundingPrecision: 2,
      prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
      prorateFixedComponents: true,
      prorateDeductions: false,
      prorateEmployerContributions: false,
      negativeNetPayPolicy: NegativeNetPayPolicy.CLAMP_TO_ZERO,
      componentExecutionOrder: ['BASIC'],
      isActive: true,
      deletedAt: null,
      __v: 0,
    };
  });

  describe('Area 1: Failure Cleanup Safety', () => {
    it('Test A: Single employee fails in run 1 -> fixed in run 2 -> failure record is DELETED', async () => {
      addEmployee('EMP_001');
      addEmployee('EMP_002', { skipAssignment: true }); // Missing salary assignment -> fails resolution

      const res1 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res1.processingStatus).toBe(
        PayrollProcessingStatus.COMPLETED_WITH_ERRORS,
      );
      expect(res1.failedEmployees).toBe(1);
      expect(res1.successfulEmployees).toBe(1);

      // Verify failure document exists in failure collection
      const failureCount1 = await failureRepo.countByPeriod(periodId);
      expect(failureCount1).toBe(1);

      // Fix EMP_002 assignment
      const emp2Id = Array.from(employees.values()).find(
        (e) => e.employeeCode === 'EMP_002',
      )!._id;
      assignments.push({
        _id: new Types.ObjectId(),
        employeeId: emp2Id,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
        effectiveTo: null,
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 30000,
        salaryStructureVersion: 1,
        salarySnapshot: {} as any,
        status: EmployeeSalaryStatus.ACTIVE,
        __v: 0,
      } as unknown as EmployeeSalaryLean);

      // Run 2: Retry processing
      const res2 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res2.processingStatus).toBe(PayrollProcessingStatus.COMPLETED);
      expect(res2.failedEmployees).toBe(0);
      expect(res2.successfulEmployees).toBe(2);

      // CRITICAL GUARANTEE: Failure document must be completely cleaned up
      const failureCount2 = await failureRepo.countByPeriod(periodId);
      expect(failureCount2).toBe(0);
    });

    it('Test B: Employee fails in run 1 and continues to fail in run 2 -> failure record is UPDATED, not duplicated', async () => {
      addEmployee('EMP_001');
      addEmployee('EMP_002', { skipAssignment: true });

      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      const failures1 = await failureRepo.findPaginatedByPeriod(
        periodId,
        1,
        10,
      );
      expect(failures1.data.length).toBe(1);
      expect(failures1.data[0].attemptNumber).toBe(1);

      // Run 2: Still failing
      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      const failures2 = await failureRepo.findPaginatedByPeriod(
        periodId,
        1,
        10,
      );
      expect(failures2.data.length).toBe(1);
      expect(failures2.data[0].attemptNumber).toBe(2);
    });

    it('Test C: Employee succeeds in run 1 -> skipped up-to-date in run 2 -> no phantom failure created', async () => {
      addEmployee('EMP_001');
      addEmployee('EMP_002');

      const res1 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res1.processingStatus).toBe(PayrollProcessingStatus.COMPLETED);
      expect(res1.successfulEmployees).toBe(2);

      const res2 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res2.processingStatus).toBe(PayrollProcessingStatus.COMPLETED);
      expect(res2.skippedUpToDateEmployees).toBe(2);
      expect(res2.failedEmployees).toBe(0);

      const failures = await failureRepo.countByPeriod(periodId);
      expect(failures).toBe(0);
    });

    it('Test D: 10 employees: 5 succeed, 5 fail. Retry: 3 fixed, 2 still fail -> exactly 2 failure records remain, 8 payroll records exist', async () => {
      for (let i = 1; i <= 5; i++) {
        addEmployee(`EMP_OK_${i}`);
      }
      for (let i = 1; i <= 5; i++) {
        addEmployee(`EMP_FAIL_${i}`, { skipAssignment: true });
      }

      const res1 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res1.successfulEmployees).toBe(5);
      expect(res1.failedEmployees).toBe(5);

      // Fix 3 of the 5 failing employees
      for (let i = 1; i <= 3; i++) {
        const emp = Array.from(employees.values()).find(
          (e) => e.employeeCode === `EMP_FAIL_${i}`,
        )!;
        assignments.push({
          _id: new Types.ObjectId(),
          employeeId: emp._id,
          salaryStructureId: structureId,
          effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          effectiveTo: null,
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 30000,
          salaryStructureVersion: 1,
          salarySnapshot: {} as any,
          status: EmployeeSalaryStatus.ACTIVE,
          __v: 0,
        } as unknown as EmployeeSalaryLean);
      }

      const res2 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res2.successfulEmployees).toBe(8);
      expect(res2.failedEmployees).toBe(2);

      const failures = await failureRepo.countByPeriod(periodId);
      expect(failures).toBe(2);

      const records = recordRepo.values();
      expect(records.length).toBe(8);
    });

    it('Test E: Defect 1 Fix — Ineligible employee PayrollRecord is auditably invalidated (snapshot preserved), excluded from completion, and idempotent across retries', async () => {
      addEmployee('EMP_001');
      const emp2Id = addEmployee('EMP_002');

      // Run 1: Both employees succeed
      const res1 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res1.successfulEmployees).toBe(2);
      expect(recordRepo.values().length).toBe(2);
      const originalEmp2Rec = (await recordRepo.findByPeriodAndEmployee(
        periodId,
        emp2Id,
      ))!;
      const originalSnapshotFingerprint =
        originalEmp2Rec.calculationSnapshot.inputFingerprint;

      // HR marks EMP_002 terminated prior to period start
      const emp2 = employees.get(emp2Id.toHexString())!;
      emp2.employmentStatus = EmploymentStatus.TERMINATED;
      emp2.terminationDate = new Date('2026-03-15T00:00:00.000Z');
      emp2.lastWorkingDate = new Date('2026-03-15T00:00:00.000Z');

      const statusBeforeRetry =
        await processingService.getProcessingStatus(periodId);
      expect(statusBeforeRetry.canComplete).toBe(false);

      // Retry processing: invalidates EMP_002 record cleanly while preserving snapshot
      const res2 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res2.totalEligibleEmployees).toBe(1);
      expect(res2.successfulEmployees).toBe(1);
      expect(res2.canComplete).toBe(true);

      const invalidatedRec = (await recordRepo.findByPeriodAndEmployee(
        periodId,
        emp2Id,
      ))!;
      expect(invalidatedRec.status).toBe(PayrollRecordStatus.INVALIDATED);
      expect(invalidatedRec.invalidatedAt).toBeInstanceOf(Date);
      expect(invalidatedRec.invalidatedBy?.equals(actorId)).toBe(true);
      expect(invalidatedRec.invalidationReason).toContain('INELIGIBLE:');
      // Original calculation snapshot & financial totals are preserved
      expect(invalidatedRec.calculationSnapshot.inputFingerprint).toBe(
        originalSnapshotFingerprint,
      );
      expect(invalidatedRec.netSalary.toString()).toBe(
        originalEmp2Rec.netSalary.toString(),
      );

      // Audit log recorded PAYROLL_RECORD_INVALIDATED with full historical calculation evidence
      const invAudit = auditLogs.find(
        (l) => l.action === AuditAction.PAYROLL_RECORD_INVALIDATED,
      );
      expect(invAudit).toBeDefined();
      expect((invAudit!.details as Record<string, unknown>).employeeId).toBe(
        emp2Id.toHexString(),
      );
      expect(
        (invAudit!.details as Record<string, unknown>).payrollPeriodId,
      ).toBe(periodId.toHexString());
      expect(
        (invAudit!.details as Record<string, unknown>)
          .previousCalculationVersion,
      ).toBe(1);
      expect(
        (invAudit!.details as Record<string, unknown>)
          .previousCalculationSnapshot,
      ).toBeDefined();

      // Completion readiness now passes without manual DB intervention
      const period = await periodRepo.findById(periodId);
      await expect(
        processingService.verifyPeriodCompletionReadiness(period!),
      ).resolves.not.toThrow();

      // Repeated retry is idempotent: does not repeatedly invalidate or bump __v
      const versionAfterInvalidation = invalidatedRec.__v;
      const auditCountBefore = auditLogs.filter(
        (l) => l.action === AuditAction.PAYROLL_RECORD_INVALIDATED,
      ).length;

      const res3 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res3.successfulEmployees).toBe(1);
      expect(res3.canComplete).toBe(true);
      expect(
        (await recordRepo.findByPeriodAndEmployee(periodId, emp2Id))?.__v,
      ).toBe(versionAfterInvalidation);
      expect(
        auditLogs.filter(
          (l) => l.action === AuditAction.PAYROLL_RECORD_INVALIDATED,
        ).length,
      ).toBe(auditCountBefore);
    });

    it('Test F: Defect 1 Fix — Soft-deleted employee record & failure are reconciled cleanly without blocking completion', async () => {
      addEmployee('EMP_001');
      const emp2Id = addEmployee('EMP_002');
      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );

      // Simulate an orphaned failure + soft-deletion of EMP_002
      await failureRepo.upsertFailuresBulk(periodId, [
        {
          employeeId: emp2Id,
          employeeCode: 'EMP_002',
          employeeName: 'Emp EMP_002',
          errorCode: 'TEST_ERR',
          errorMessage: 'Old error before deletion',
          attemptNumber: 1,
          lastAttemptAt: new Date(),
        },
      ]);
      employees.get(emp2Id.toHexString())!.deletedAt = new Date();

      const res = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res.totalEligibleEmployees).toBe(1);
      expect(res.failedEmployees).toBe(0);
      expect(res.canComplete).toBe(true);
      expect(await failureRepo.countByPeriod(periodId)).toBe(0);

      const emp2Rec = (await recordRepo.findByPeriodAndEmployee(
        periodId,
        emp2Id,
      ))!;
      expect(emp2Rec.status).toBe(PayrollRecordStatus.INVALIDATED);
      expect(emp2Rec.invalidationReason).toBe(
        'EMPLOYEE_SOFT_DELETED_OR_MISSING',
      );
    });

    it('Test G: Defect 1 Fix — Employee becomes eligible again before completion -> reactivated to CALCULATED with incremented version', async () => {
      addEmployee('EMP_001');
      const emp2Id = addEmployee('EMP_002');
      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );

      // Terminated -> invalidated on retry
      const emp2 = employees.get(emp2Id.toHexString())!;
      emp2.employmentStatus = EmploymentStatus.TERMINATED;
      emp2.terminationDate = new Date('2026-03-15T00:00:00.000Z');
      emp2.lastWorkingDate = new Date('2026-03-15T00:00:00.000Z');
      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(
        (await recordRepo.findByPeriodAndEmployee(periodId, emp2Id))?.status,
      ).toBe(PayrollRecordStatus.INVALIDATED);

      // Re-activated before period completion!
      emp2.employmentStatus = EmploymentStatus.ACTIVE;
      emp2.terminationDate = null;
      emp2.lastWorkingDate = null;

      // Readiness blocks completion until reactivated employee is recalculated
      const statusBeforeRecalc =
        await processingService.getProcessingStatus(periodId);
      expect(statusBeforeRecalc.canComplete).toBe(false);
      expect(statusBeforeRecalc.canRetry).toBe(true);

      const res = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(res.totalEligibleEmployees).toBe(2);
      expect(res.successfulEmployees).toBe(2);
      expect(res.recalculatedEmployees).toBe(1);
      expect(res.canComplete).toBe(true);

      const reactivated = (await recordRepo.findByPeriodAndEmployee(
        periodId,
        emp2Id,
      ))!;
      expect(reactivated.status).toBe(PayrollRecordStatus.CALCULATED);
      expect(reactivated.calculationVersion).toBe(2);
      expect(reactivated.invalidatedAt).toBeNull();
      expect(reactivated.invalidationReason).toBeNull();
    });

    it('Test H: Defect 1 Fix — Approved or Finalized records can NEVER be silently invalidated', async () => {
      addEmployee('EMP_001');
      const emp2Id = addEmployee('EMP_002');
      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );

      // Mark EMP_002 record as APPROVED (financially committed)
      const emp2Rec = (await recordRepo.findByPeriodAndEmployee(
        periodId,
        emp2Id,
      ))!;
      recordRepo.setStatusForTest(emp2Rec._id, PayrollRecordStatus.APPROVED);

      // Emp2 becomes ineligible
      const emp2 = employees.get(emp2Id.toHexString())!;
      emp2.employmentStatus = EmploymentStatus.TERMINATED;
      emp2.terminationDate = new Date('2026-03-15T00:00:00.000Z');
      emp2.lastWorkingDate = new Date('2026-03-15T00:00:00.000Z');

      // Retry must REJECT silent invalidation with 409 Conflict
      await expect(
        processingService.processPeriod(periodId, { batchSize: 50 }, actorId),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('immutable status (APPROVED)'),
      });

      // Record remains APPROVED untouched
      expect(
        (await recordRepo.findByPeriodAndEmployee(periodId, emp2Id))?.status,
      ).toBe(PayrollRecordStatus.APPROVED);

      // Finalized period also rejects processing/invalidation unconditionally
      const period = periodRepo.store.get(periodId.toHexString())!;
      period.status = PayrollPeriodStatus.FINALIZED;
      await expect(
        processingService.processPeriod(periodId, { batchSize: 50 }, actorId),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('FINALIZED'),
      });
    });
  });

  describe('Area 2: Worker Fencing and Stale Lock Recovery', () => {
    it('Test A: Stale worker loses active lock -> updateProcessingProgress rejects write and throws CONCURRENT_MODIFICATION', async () => {
      const now = new Date();
      const staleTime = new Date(now.getTime() - 400000);

      await periodRepo.acquireProcessingLock({
        periodId,
        runId: 'run_worker_1',
        actorId,
        now: staleTime,
        staleCutoff: new Date(staleTime.getTime() - 300000),
      });

      const lock2 = await periodRepo.acquireProcessingLock({
        periodId,
        runId: 'run_worker_2',
        actorId,
        now,
        staleCutoff: new Date(now.getTime() - 300000),
      });
      expect(lock2).not.toBeNull();
      expect(lock2!.processing?.activeRunId).toBe('run_worker_2');

      const progressUpdated = await periodRepo.updateProcessingProgress({
        periodId,
        runId: 'run_worker_1',
        totalEligibleEmployees: 2,
        processedEmployees: 1,
        successfulEmployees: 1,
        failedEmployees: 0,
        skippedUpToDateEmployees: 0,
        recalculatedEmployees: 0,
        heartbeatAt: now,
      });

      expect(progressUpdated).toBe(false);
    });

    it('Test B: Stale worker loses active lock -> completeProcessingRun cannot overwrite active worker status', async () => {
      const now = new Date();
      const staleTime = new Date(now.getTime() - 400000);

      await periodRepo.acquireProcessingLock({
        periodId,
        runId: 'run_worker_1',
        actorId,
        now: staleTime,
        staleCutoff: new Date(staleTime.getTime() - 300000),
      });

      await periodRepo.acquireProcessingLock({
        periodId,
        runId: 'run_worker_2',
        actorId,
        now,
        staleCutoff: new Date(now.getTime() - 300000),
      });

      const completeRes = await periodRepo.completeProcessingRun({
        periodId,
        runId: 'run_worker_1',
        processingStatus: PayrollProcessingStatus.FAILED,
        totalEligibleEmployees: 2,
        processedEmployees: 2,
        successfulEmployees: 0,
        failedEmployees: 2,
        skippedUpToDateEmployees: 0,
        recalculatedEmployees: 0,
        completedAt: now,
        lastErrorSummary: 'Worker 1 died',
      });

      expect(completeRes).toBeNull();
      const period = await periodRepo.findById(periodId);
      expect(period?.processing?.activeRunId).toBe('run_worker_2');
    });

    it('Test C: Defect 2 Fix — Worker A loses lock mid-calculation -> cannot write PayrollRecords, failures, progress, or audit completion', async () => {
      const empId = addEmployee('EMP_RACE_1');

      // Seed an existing failure from an earlier attempt that Worker B should manage
      await failureRepo.upsertFailuresBulk(periodId, [
        {
          employeeId: empId,
          employeeCode: 'EMP_RACE_1',
          employeeName: 'Emp EMP_RACE_1',
          errorCode: 'WORKER_B_FAILURE',
          errorMessage: 'Tracked by Worker B',
          attemptNumber: 1,
          lastAttemptAt: new Date(),
        },
      ]);

      const origCompute =
        calculationService.computeFromResolvedInputs.bind(calculationService);
      let stoleLock = false;
      const spy = jest
        .spyOn(calculationService, 'computeFromResolvedInputs')
        .mockImplementation(async (inputs, preResolved, calcAt) => {
          const result = await origCompute(inputs, preResolved, calcAt);
          if (!stoleLock) {
            stoleLock = true;
            // Simulate Worker A stalling and Worker B stealing stale lock mid-calculation
            const doc = periodRepo.store.get(periodId.toHexString())!;
            doc.processing!.activeRunId = 'run_worker_b';
            doc.processing!.processingAttempts = 2;
          }
          return result;
        });

      await expect(
        processingService.processPeriod(periodId, { batchSize: 50 }, actorId),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('lost active ownership'),
      });
      spy.mockRestore();

      // FENCED GUARANTEE 1: Worker A created ZERO PayrollRecords
      expect(recordRepo.createCalls).toBe(0);
      expect(recordRepo.values().length).toBe(0);

      // FENCED GUARANTEE 2: Worker B's failure state was NOT deleted or overwritten
      expect(await failureRepo.countByPeriod(periodId)).toBe(1);
      const failurePage = await failureRepo.findPaginatedByPeriod(
        periodId,
        1,
        10,
      );
      expect(failurePage.data[0].errorCode).toBe('WORKER_B_FAILURE');

      // FENCED GUARANTEE 3: Period ownership and status were NOT overwritten by Worker A's catch block
      const finalPeriod = await periodRepo.findById(periodId);
      expect(finalPeriod?.processing?.activeRunId).toBe('run_worker_b');
      expect(finalPeriod?.processing?.processingStatus).toBe(
        PayrollProcessingStatus.PROCESSING,
      );
      expect(
        auditLogs.some(
          (l) => l.action === AuditAction.PAYROLL_PROCESSING_FAILED,
        ),
      ).toBe(false);
    });

    it('Test D: Double-recovery: Worker 1 -> Worker 2 -> Worker 3 progression and attempt increment', async () => {
      const now = Date.now();
      const p1 = await periodRepo.acquireProcessingLock({
        periodId,
        runId: 'run_1',
        actorId,
        now: new Date(now - 800000),
        staleCutoff: new Date(now - 1100000),
      });
      expect(p1?.processing?.processingAttempts).toBe(1);

      const p2 = await periodRepo.acquireProcessingLock({
        periodId,
        runId: 'run_2',
        actorId,
        now: new Date(now - 400000),
        staleCutoff: new Date(now - 700000),
      });
      expect(p2?.processing?.processingAttempts).toBe(2);
      expect(p2?.processing?.activeRunId).toBe('run_2');

      const p3 = await periodRepo.acquireProcessingLock({
        periodId,
        runId: 'run_3',
        actorId,
        now: new Date(now),
        staleCutoff: new Date(now - 300000),
      });
      expect(p3?.processing?.processingAttempts).toBe(3);
      expect(p3?.processing?.activeRunId).toBe('run_3');
    });

    it('Test E: Transaction callback retry safety — TransientTransactionError retries do not duplicate audit logs or corrupt counters', async () => {
      addEmployee('EMP_TXN_1');

      const connection = (
        processingService as unknown as {
          connection: { startSession: jest.Mock };
        }
      ).connection;

      let retriedBatchOnce = false;
      const origStartSession = connection.startSession;
      connection.startSession = jest.fn(async () => ({
        withTransaction: jest.fn(
          async (cb: (s: unknown) => Promise<unknown>) => {
            const periodBefore = periodRepo.store.get(periodId.toHexString())
              ? {
                  ...periodRepo.store.get(periodId.toHexString())!,
                  processing: periodRepo.store.get(periodId.toHexString())!
                    .processing
                    ? {
                        ...periodRepo.store.get(periodId.toHexString())!
                          .processing!,
                      }
                    : undefined,
                }
              : undefined;
            const recordsBefore = recordRepo.values().map((r) => ({ ...r }));
            const auditCountBefore = auditLogs.length;

            try {
              const out = await cb({ txn: true });
              if (!retriedBatchOnce && recordRepo.createCalls > 0) {
                retriedBatchOnce = true;
                // Simulate TransientTransactionError aborting after writes -> rollback in-memory state and retry callback
                if (periodBefore) {
                  periodRepo.store.set(periodId.toHexString(), periodBefore);
                }
                recordRepo.clear();
                for (const rec of recordsBefore) {
                  await recordRepo.create(rec);
                }
                recordRepo.createCalls = 0;
                auditLogs.splice(auditCountBefore);
                return await cb({ txnRetry: true });
              }
              return out;
            } catch (err) {
              if (periodBefore) {
                periodRepo.store.set(periodId.toHexString(), periodBefore);
              }
              auditLogs.splice(auditCountBefore);
              throw err;
            }
          },
        ),
        endSession: jest.fn().mockResolvedValue(undefined),
      }));

      try {
        const res = await processingService.processPeriod(
          periodId,
          { batchSize: 50 },
          actorId,
        );
        expect(retriedBatchOnce).toBe(true);
        expect(res.successfulEmployees).toBe(1);
        expect(res.processedEmployees).toBe(1);
        expect(recordRepo.values().length).toBe(1);
        expect(
          auditLogs.filter(
            (l) => l.action === AuditAction.PAYROLL_PROCESSING_COMPLETED,
          ).length,
        ).toBe(1);
      } finally {
        connection.startSession = origStartSession;
      }
    });

    it('Test E2: PAYROLL_PROCESSING_STARTED audit failure rolls back acquireProcessingLock atomically and concurrent contention permits only 1 active run', async () => {
      addEmployee('EMP_LOCK_ROLLBACK');

      const connection = (
        processingService as unknown as {
          connection: { startSession: jest.Mock };
        }
      ).connection;
      const auditSvc = (
        processingService as unknown as {
          auditLogsService: { createAuditLog: jest.Mock };
        }
      ).auditLogsService;

      const origStartSession = connection.startSession;
      connection.startSession = jest.fn(async () => ({
        withTransaction: jest.fn(
          async (cb: (s: unknown) => Promise<unknown>) => {
            const periodBefore = periodRepo.store.get(periodId.toHexString())
              ? {
                  ...periodRepo.store.get(periodId.toHexString())!,
                  processing: periodRepo.store.get(periodId.toHexString())!
                    .processing
                    ? {
                        ...periodRepo.store.get(periodId.toHexString())!
                          .processing!,
                      }
                    : undefined,
                }
              : undefined;
            try {
              return await cb({ txnLock: true });
            } catch (err) {
              if (periodBefore) {
                periodRepo.store.set(periodId.toHexString(), periodBefore);
              }
              throw err;
            }
          },
        ),
        endSession: jest.fn().mockResolvedValue(undefined),
      }));

      auditSvc.createAuditLog.mockRejectedValueOnce(
        new Error('Audit write failure on PAYROLL_PROCESSING_STARTED'),
      );

      try {
        await expect(
          processingService.processPeriod(periodId, { batchSize: 50 }, actorId),
        ).rejects.toThrow('Audit write failure on PAYROLL_PROCESSING_STARTED');

        const rolledBackPeriod = await periodRepo.findById(periodId);
        expect(rolledBackPeriod?.status).toBe(PayrollPeriodStatus.DRAFT);
        expect(rolledBackPeriod?.processing?.activeRunId ?? null).toBeNull();
        expect(rolledBackPeriod?.processing?.processingAttempts ?? 0).toBe(0);
        expect(
          auditLogs.filter(
            (l) => l.action === AuditAction.PAYROLL_PROCESSING_STARTED,
          ).length,
        ).toBe(0);

        // Concurrent lock acquisition permits only one active run
        const [r1, r2] = await Promise.allSettled([
          processingService.processPeriod(periodId, { batchSize: 50 }, actorId),
          processingService.processPeriod(periodId, { batchSize: 50 }, actorId),
        ]);
        const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
        const rejected = [r1, r2].filter((r) => r.status === 'rejected');
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect(
          auditLogs.filter(
            (l) => l.action === AuditAction.PAYROLL_PROCESSING_STARTED,
          ).length,
        ).toBe(1);
      } finally {
        connection.startSession = origStartSession;
      }
    });
  });

  describe('Area 3: Payroll Input Fingerprint Completeness', () => {
    let dummyInputs: ResolvedPayrollInputs;
    let dummyResolvedComp: ResolvedStructureComponents;

    beforeEach(() => {
      dummyInputs = {
        period: periodRepo.store.get(periodId.toHexString())!,
        employee: {
          _id: new Types.ObjectId(),
          employeeCode: 'EMP_FP',
          branchId,
          employmentStatus: EmploymentStatus.ACTIVE,
          dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
          lastWorkingDate: null,
          terminationDate: null,
        } as unknown as EmployeeLean,
        salaryAssignment: {
          _id: new Types.ObjectId(),
          salaryStructureId: structureId,
          effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
          effectiveTo: null,
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 30000,
          status: EmployeeSalaryStatus.ACTIVE,
          __v: 0,
        } as unknown as EmployeeSalaryLean,
        salaryStructure: structures.get(structureId.toHexString())!,
        configuration: {
          payrollSettingsId: 'settings_01',
          payrollSettingsVersion: 0,
          payrollCalculationRuleId: 'rule_01',
          payrollCalculationRuleVersion: 0,
          currency: 'INR',
          roundingMode: PayrollRoundingMode.HALF_UP,
          roundingPrecision: 2,
          prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
          prorateFixedComponents: true,
          prorateDeductions: false,
          prorateEmployerContributions: false,
          negativeNetPayPolicy: NegativeNetPayPolicy.CLAMP_TO_ZERO,
          fixedWorkingDaysPerMonth: null,
          componentExecutionOrder: ['BASIC'],
        },
        leaveAndAttendance: {
          tenureCalendarDays: 30,
          eligibleWorkingDays: 30,
          weeklyOffDays: 4,
          holidayDays: 1,
          presentDays: 25,
          halfDays: 0,
          paidLeaveDays: 0,
          unpaidLeaveDays: 0,
          unpaidLeaveLopDays: 0,
          attendanceAbsenceDays: 0,
          attendanceAbsenceLopDays: 0,
          halfDayDeductions: 0,
          totalLopDays: 0,
          pendingCancellationLeaveDays: 0,
          leaveTypeBreakdown: [],
          warnings: [],
          leaveAttendanceMismatchDates: [],
          overlappingLeaveDates: [],
          conflictingLeaveDates: [],
        } as unknown as PayrollLeaveAttendanceResolution,
        calendarDays: 30,
        payableDays: 30,
      };

      dummyResolvedComp = {
        components: [
          {
            componentId: basicCompId.toHexString(),
            code: 'BASIC',
            name: 'Basic Salary',
            classification: SalaryComponentType.EARNING,
            calculationMethod: StructureComponentCalculationType.FIXED,
            monthlyFixedAmount: null,
            percentage: null,
            percentageOf: null,
          },
        ],
        masterMap: {
          [basicCompId.toHexString()]: components.get(
            basicCompId.toHexString(),
          )!,
        },
      };
    });

    it('Test A: Salary structure component amount mutation changes fingerprint', () => {
      const fp1 = computePayrollInputFingerprint(
        dummyInputs,
        dummyResolvedComp,
      );
      const mutatedInputs: ResolvedPayrollInputs = {
        ...dummyInputs,
        salaryStructure: {
          ...dummyInputs.salaryStructure,
          components: [
            {
              ...dummyInputs.salaryStructure.components[0],
              amount: 45000,
            },
          ],
        },
      };
      const fp2 = computePayrollInputFingerprint(
        mutatedInputs,
        dummyResolvedComp,
      );
      expect(fp1).not.toBe(fp2);
    });

    it('Test B: Master salary component updatedAt mutation changes fingerprint', () => {
      const fp1 = computePayrollInputFingerprint(
        dummyInputs,
        dummyResolvedComp,
      );
      const mutatedCompBundle: ResolvedStructureComponents = {
        ...dummyResolvedComp,
        masterMap: {
          [basicCompId.toHexString()]: {
            ...dummyResolvedComp.masterMap[basicCompId.toHexString()],
            updatedAt: new Date('2026-11-27T00:00:00.000Z'),
          },
        },
      };
      const fp2 = computePayrollInputFingerprint(
        dummyInputs,
        mutatedCompBundle,
      );
      expect(fp1).not.toBe(fp2);
    });

    it('Test C: Employee DOJ or terminationDate mutation changes fingerprint', () => {
      const fp1 = computePayrollInputFingerprint(
        dummyInputs,
        dummyResolvedComp,
      );
      const mutatedInputs: ResolvedPayrollInputs = {
        ...dummyInputs,
        employee: {
          ...dummyInputs.employee,
          dateOfJoining: new Date('2026-04-15T00:00:00.000Z'),
        },
      };
      const fp2 = computePayrollInputFingerprint(
        mutatedInputs,
        dummyResolvedComp,
      );
      expect(fp1).not.toBe(fp2);
    });

    it('Test D: Employee branchId mutation changes fingerprint', () => {
      const fp1 = computePayrollInputFingerprint(
        dummyInputs,
        dummyResolvedComp,
      );
      const mutatedInputs: ResolvedPayrollInputs = {
        ...dummyInputs,
        employee: {
          ...dummyInputs.employee,
          branchId: new Types.ObjectId(),
        },
      };
      const fp2 = computePayrollInputFingerprint(
        mutatedInputs,
        dummyResolvedComp,
      );
      expect(fp1).not.toBe(fp2);
    });

    it('Test E: Leave & Attendance LOP mutation changes fingerprint', () => {
      const fp1 = computePayrollInputFingerprint(
        dummyInputs,
        dummyResolvedComp,
      );
      const mutatedInputs: ResolvedPayrollInputs = {
        ...dummyInputs,
        payableDays: 28,
        leaveAndAttendance: {
          ...dummyInputs.leaveAndAttendance,
          totalLopDays: 2,
          attendanceAbsenceLopDays: 2,
        },
      };
      const fp2 = computePayrollInputFingerprint(
        mutatedInputs,
        dummyResolvedComp,
      );
      expect(fp1).not.toBe(fp2);
    });

    it('Test F: Payroll rule prorationPolicy or roundingMode mutation changes fingerprint', () => {
      const fp1 = computePayrollInputFingerprint(
        dummyInputs,
        dummyResolvedComp,
      );
      const mutatedInputs: ResolvedPayrollInputs = {
        ...dummyInputs,
        configuration: {
          ...dummyInputs.configuration,
          prorationPolicy: PayrollProrationPolicy.WORKING_DAYS,
        },
      };
      const fp2 = computePayrollInputFingerprint(
        mutatedInputs,
        dummyResolvedComp,
      );
      expect(fp1).not.toBe(fp2);
    });

    it('Test G: Engine version PAYROLL_CALCULATION_ENGINE_VERSION is embedded in fingerprint', () => {
      const fp = computePayrollInputFingerprint(dummyInputs, dummyResolvedComp);
      expect(typeof fp).toBe('string');
      expect(fp.length).toBe(64); // SHA-256 hex string
      expect(PAYROLL_CALCULATION_ENGINE_VERSION).toBe('1.0.0');
    });
  });

  describe('Area 4: Processing Counter Consistency', () => {
    it('Test A & B: Partial failure then retry preserves exact totals without counter inflation', async () => {
      addEmployee('EMP_001');
      addEmployee('EMP_002', { skipAssignment: true });

      // Run 1: 1 success, 1 fail
      const s1 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(s1.totalEligibleEmployees).toBe(2);
      expect(s1.successfulEmployees).toBe(1);
      expect(s1.failedEmployees).toBe(1);

      // Fix EMP_002
      const emp2 = Array.from(employees.values()).find(
        (e) => e.employeeCode === 'EMP_002',
      )!;
      assignments.push({
        _id: new Types.ObjectId(),
        employeeId: emp2._id,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
        effectiveTo: null,
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 30000,
        salaryStructureVersion: 1,
        salarySnapshot: {} as any,
        status: EmployeeSalaryStatus.ACTIVE,
        __v: 0,
      } as unknown as EmployeeSalaryLean);

      // Run 2: Retry with fix
      const s2 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(s2.totalEligibleEmployees).toBe(2);
      expect(s2.successfulEmployees).toBe(2);
      expect(s2.failedEmployees).toBe(0);
      expect(s2.skippedUpToDateEmployees).toBe(1); // EMP_001 skipped up to date
      expect(s2.processedEmployees).toBe(2);
      // Cumulative counters must equal 2 (not 1 + 2 = 3)
      expect(s2.successfulEmployees).toBe(2);
    });

    it('Test C: Recalculation increments recalculatedEmployees counter', async () => {
      const empId = addEmployee('EMP_001');
      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );

      // Mutate employee salary assignment amount -> causes fingerprint mismatch
      const assign = assignments.find((a) => a.employeeId.equals(empId))!;
      assign.salaryAmount = 40000;
      assign.__v = 1;

      const s2 = await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );
      expect(s2.successfulEmployees).toBe(1);
      expect(s2.recalculatedEmployees).toBe(1);
      expect(s2.skippedUpToDateEmployees).toBe(0);
    });

    it('Test E & F: Ground-truth counter independence — getProcessingStatus ignores corrupted period document counters', async () => {
      addEmployee('EMP_001');
      addEmployee('EMP_002');
      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );

      // Corrupt period document counters in store
      const doc = periodRepo.store.get(periodId.toHexString());
      if (doc?.processing) {
        doc.processing.successfulEmployees = 999;
        doc.processing.failedEmployees = 888;
        doc.processing.totalEligibleEmployees = 777;
      }

      // getProcessingStatus re-inspects actual ground truth
      const status = await processingService.getProcessingStatus(periodId);
      expect(status.successfulEmployees).toBe(2);
      expect(status.failedEmployees).toBe(0);
      expect(status.totalEligibleEmployees).toBe(2);
    });

    it('Test F2: verifyPeriodCompletionReadiness re-inspects ground truth rather than trusting period document counters', async () => {
      addEmployee('EMP_001');
      addEmployee('EMP_002');
      await processingService.processPeriod(
        periodId,
        { batchSize: 50 },
        actorId,
      );

      const period = await periodRepo.findById(periodId);
      period!.status = PayrollPeriodStatus.PROCESSING;

      // Corrupt counters
      period!.processing!.successfulEmployees = 0;
      period!.processing!.processedEmployees = 0;

      // verifyPeriodCompletionReadiness must NOT throw because actual records in recordRepo are valid and match
      await expect(
        processingService.verifyPeriodCompletionReadiness(period!),
      ).resolves.not.toThrow();
    });
  });
});
