/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import {
  ExecutionContext,
  HttpStatus,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import {
  AttendanceStatus,
  RegularizationStatus,
} from '../attendance/constants/attendance.constant';
import { AttendanceRegularizationRepository } from '../attendance/repositories/attendance-regularization.repository';
import {
  AttendanceRepository,
  PayrollAttendanceBucket,
} from '../attendance/repositories/attendance.repository';
import { AuditAction } from '../audit-logs/constants/audit-log.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
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
import { LeaveRequestStatus } from '../leaves/constants/leaves.constant';
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
import { PayrollLeaveAttendanceResolverService } from '../payroll-periods/services/payroll-leave-attendance-resolver.service';
import { PayrollPeriodsService } from '../payroll-periods/services/payroll-periods.service';
import { PermissionKeys } from '../permissions/constants/permission.constant';
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
  PAYROLL_PROCESSING_CONSTANTS,
  PayrollRecordStatus,
} from './constants/payroll-calculation.constant';
import { PayrollPeriodProcessingController } from './controllers/payroll-period-processing.controller';
import {
  ListPayrollProcessingFailuresQueryDto,
  ProcessPayrollPeriodDto,
} from './dto/payroll-processing.dto';
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
import { PayrollInputResolver } from './services/payroll-input.resolver';
import { PayrollProcessingService } from './services/payroll-processing.service';
import { PayrollSnapshotBuilder } from './services/payroll-snapshot.builder';
import { PayrollTotalsCalculator } from './services/payroll-totals.calculator';
import { ProrationCalculator } from './services/proration.calculator';
import { SalaryComponentResolver } from './services/salary-component.resolver';

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

describe('Step 5 — Payroll Run / Processing Integration Suite', () => {
  let controller: PayrollPeriodProcessingController;
  let processingService: PayrollProcessingService;
  let periodsService: PayrollPeriodsService;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;

  let periodRepo: InMemoryPeriodRepo;
  let recordRepo: InMemoryPayrollRecordRepo;
  let failureRepo: InMemoryFailureRepo;

  const actorId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const roleId = new Types.ObjectId();

  let employees: Map<string, EmployeeLean>;
  let assignments: EmployeeSalaryLean[];
  let structures: Map<string, SalaryStructureLean>;
  let components: Map<string, SalaryComponentLean>;
  let attendanceBuckets: PayrollAttendanceBucket[];
  let leaves: LeaveRequestLean[];
  let settingsDoc: Record<string, unknown>;
  let rulesDoc: Record<string, unknown>;
  let grantedPermissions: string[];
  let auditLogs: Array<Record<string, unknown>>;

  let periodId: Types.ObjectId;
  let structureId: Types.ObjectId;
  let negNetStructureId: Types.ObjectId;
  let basicCompId: Types.ObjectId;
  let dedCompId: Types.ObjectId;

  const makeReq = (): AuthenticatedRequest =>
    ({
      user: {
        userId: actorId,
        sessionId: new Types.ObjectId(),
        roleIds: [roleId],
      },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Step5-Spec' },
    }) as unknown as AuthenticatedRequest;

  const makeExecContext = (
    handler: (...args: never[]) => unknown,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PayrollPeriodProcessingController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            userId: actorId,
            sessionId: new Types.ObjectId(),
            roleIds: [roleId],
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  const validateDto = async <T>(
    metatype: new () => T,
    payload: Record<string, unknown>,
    type: 'body' | 'query' = 'body',
  ): Promise<T> =>
    (await validationPipe.transform(payload, {
      type,
      metatype,
    })) as T;

  const addEmployee = (
    code: string,
    opts?: Partial<EmployeeLean> & {
      salary?: number;
      useNegativeNetStructure?: boolean;
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
      const targetStructureId = opts?.useNegativeNetStructure
        ? negNetStructureId
        : structureId;
      assignments.push({
        _id: new Types.ObjectId(),
        employeeId: id,
        salaryStructureId: targetStructureId,
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
    auditLogs = [];
    grantedPermissions = Object.values(PermissionKeys);

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
            find: jest.fn((filter: { _id?: { $in?: Types.ObjectId[] } }) => {
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
            }),
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
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            hasPermissions: jest.fn(
              async (_roles: Types.ObjectId[], required: string[]) =>
                required.every((perm) => grantedPermissions.includes(perm)),
            ),
          },
        },
      ],
    }).compile();

    controller = module.get(PayrollPeriodProcessingController);
    processingService = module.get(PayrollProcessingService);
    periodsService = module.get(PayrollPeriodsService);
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
    grantedPermissions = Object.values(PermissionKeys);

    periodId = new Types.ObjectId();
    structureId = new Types.ObjectId();
    negNetStructureId = new Types.ObjectId();
    basicCompId = new Types.ObjectId();
    dedCompId = new Types.ObjectId();

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

    components.set(dedCompId.toHexString(), {
      _id: dedCompId,
      code: 'LOAN_DED',
      name: 'Loan Recovery',
      type: SalaryComponentType.DEDUCTION,
      isActive: true,
      isTaxable: false,
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
      __v: 0,
    } as unknown as SalaryStructureLean);

    structures.set(negNetStructureId.toHexString(), {
      _id: negNetStructureId,
      name: 'Negative Net Monthly',
      code: 'STR-NEG',
      isActive: true,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryAmount: 10000,
      components: [
        {
          componentId: basicCompId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 10000,
          percentage: null,
          percentageOf: null,
        },
        {
          componentId: dedCompId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 15000,
          percentage: null,
          percentageOf: null,
        },
      ],
      deletedAt: null,
      __v: 0,
    } as unknown as SalaryStructureLean);

    settingsDoc = {
      _id: new Types.ObjectId(),
      currency: 'INR',
      fixedWorkingDaysPerMonth: 22,
      payrollFrequency: PayrollFrequency.MONTHLY,
      isPayrollProcessingEnabled: true,
      __v: 0,
    };

    rulesDoc = {
      _id: new Types.ObjectId(),
      prorationPolicy: PayrollProrationPolicy.FIXED_30_DAYS,
      prorateFixedComponents: true,
      prorateDeductions: false,
      prorateEmployerContributions: false,
      roundingMode: PayrollRoundingMode.HALF_UP,
      roundingPrecision: 2,
      negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
      allowAttendanceDeduction: true,
      allowLeaveWithoutPayDeduction: true,
      overtimeEnabled: false,
      overtimeRateMultiplier: 1.5,
      componentExecutionOrder: [],
      __v: 0,
    };
  });

  it('enforces RBAC permissions and rejects client-tampered DTO fields & out-of-range batchSize', async () => {
    grantedPermissions = [PermissionKeys.PAYROLL_CALCULATIONS_VIEW];
    await expect(
      guard.canActivate(makeExecContext(controller.processPeriod)),
    ).rejects.toMatchObject({ statusCode: HttpStatus.FORBIDDEN });

    await expect(
      guard.canActivate(makeExecContext(controller.getProcessingStatus)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeExecContext(controller.getProcessingFailures)),
    ).resolves.toBe(true);

    await expect(
      validateDto(ProcessPayrollPeriodDto, {
        batchSize: 50,
        payableDays: 30,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    await expect(
      validateDto(ProcessPayrollPeriodDto, { batchSize: 5 }),
    ).rejects.toMatchObject({ statusCode: HttpStatus.BAD_REQUEST });

    await expect(
      validateDto(ProcessPayrollPeriodDto, { batchSize: 201 }),
    ).rejects.toMatchObject({ statusCode: HttpStatus.BAD_REQUEST });
  });

  it('rejects processing when disabled in settings, or when period is COMPLETED/FINALIZED, or missing', async () => {
    settingsDoc.isPayrollProcessingEnabled = false;
    await expect(
      controller.processPeriod(periodId, {}, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    settingsDoc.isPayrollProcessingEnabled = true;
    const finalizedId = new Types.ObjectId();
    periodRepo.store.set(finalizedId.toHexString(), {
      ...(await periodRepo.findById(periodId))!,
      _id: finalizedId,
      periodCode: 'PR-FINAL',
      status: PayrollPeriodStatus.FINALIZED,
    });
    await expect(
      controller.processPeriod(finalizedId, {}, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    await expect(
      controller.processPeriod(new Types.ObjectId(), {}, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      statusCode: HttpStatus.NOT_FOUND,
    });
  });

  it('handles 0 eligible employees cleanly and allows period completion', async () => {
    const res = await controller.processPeriod(periodId, {}, makeReq());
    expect(res.data.processingStatus).toBe(PayrollProcessingStatus.COMPLETED);
    expect(res.data.totalEligibleEmployees).toBe(0);
    expect(res.data.canComplete).toBe(true);
    expect(res.data.canRetry).toBe(false);
  });

  it('processes eligible active & resigned overlapping employees across bounded chunks and respects eligibility exits', async () => {
    for (let i = 1; i <= 23; i++) {
      addEmployee(`EMP-${String(i).padStart(3, '0')}`);
    }
    // Resigned overlapping with valid lastWorkingDate -> included & prorated
    addEmployee('EMP-RES-VALID', {
      employmentStatus: EmploymentStatus.RESIGNED,
      lastWorkingDate: new Date('2026-04-15T00:00:00.000Z'),
    });
    // Resigned without lastWorkingDate -> excluded
    addEmployee('EMP-RES-NOEXIT', {
      employmentStatus: EmploymentStatus.RESIGNED,
      lastWorkingDate: null,
      terminationDate: null,
    });
    // Future joiner -> excluded
    addEmployee('EMP-FUTURE', {
      dateOfJoining: new Date('2026-05-05T00:00:00.000Z'),
    });

    const dto = await validateDto(ProcessPayrollPeriodDto, { batchSize: 10 });
    const res = await controller.processPeriod(periodId, dto, makeReq());

    expect(res.data.periodStatus).toBe(PayrollPeriodStatus.PROCESSING);
    expect(res.data.processingStatus).toBe(PayrollProcessingStatus.COMPLETED);
    expect(res.data.totalEligibleEmployees).toBe(24);
    expect(res.data.processedEmployees).toBe(24);
    expect(res.data.successfulEmployees).toBe(24);
    expect(res.data.failedEmployees).toBe(0);
    expect(res.data.remainingEmployees).toBe(0);
    expect(res.data.staleEmployees).toBe(0);
    expect(res.data.canRetry).toBe(false);
    expect(res.data.canComplete).toBe(true);
    expect(recordRepo.values()).toHaveLength(24);
    expect(
      recordRepo
        .values()
        .every((r) => Boolean(r.calculationSnapshot?.inputFingerprint)),
    ).toBe(true);
    expect(auditLogs.map((a) => a.action)).toEqual([
      AuditAction.PAYROLL_PROCESSING_STARTED,
      AuditAction.PAYROLL_PROCESSING_COMPLETED,
    ]);
  });

  it('isolates per-employee failures, sanitizes & paginates failures, and supports idempotent partial retry -> COMPLETED -> FINALIZED', async () => {
    const healthy1 = addEmployee('EMP-001', { salary: 30000 });
    const healthy2 = addEmployee('EMP-002', { salary: 40000 });
    const missingSalary = addEmployee('EMP-003', { skipAssignment: true });
    const negNetEmp = addEmployee('EMP-004', {
      salary: 10000,
      useNegativeNetStructure: true,
    });

    const run1 = await controller.processPeriod(periodId, {}, makeReq());
    expect(run1.data.processingStatus).toBe(
      PayrollProcessingStatus.COMPLETED_WITH_ERRORS,
    );
    expect(run1.data.totalEligibleEmployees).toBe(4);
    expect(run1.data.successfulEmployees).toBe(2);
    expect(run1.data.failedEmployees).toBe(2);
    expect(run1.data.remainingEmployees).toBe(2);
    expect(run1.data.canRetry).toBe(true);
    expect(run1.data.canComplete).toBe(false);
    expect(recordRepo.createCalls).toBe(2);

    // Verify failure pagination & sanitization
    const page1 = await controller.getProcessingFailures(
      periodId,
      await validateDto(
        ListPayrollProcessingFailuresQueryDto,
        { page: 1, limit: 1 },
        'query',
      ),
    );
    expect(page1.data).toHaveLength(1);
    expect(page1.meta.total).toBe(2);
    expect(page1.meta.totalPages).toBe(2);

    // Period completion blocked while failures/unprocessed exist
    await expect(
      periodsService.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.COMPLETED },
        actorId,
        [roleId],
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    // Retry immediately before fixing -> up-to-date healthy records NOT rewritten
    recordRepo.createCalls = 0;
    recordRepo.recalcCalls = 0;
    const run2 = await controller.processPeriod(periodId, {}, makeReq());
    expect(run2.data.skippedUpToDateEmployees).toBe(2);
    expect(run2.data.recalculatedEmployees).toBe(0);
    expect(recordRepo.createCalls).toBe(0);
    expect(recordRepo.recalcCalls).toBe(0);

    // Fix both broken employees
    assignments.push({
      _id: new Types.ObjectId(),
      employeeId: missingSalary,
      salaryStructureId: structureId,
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
      effectiveTo: null,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 25000,
      salaryStructureVersion: 1,
      salarySnapshot: {} as EmployeeSalaryLean['salarySnapshot'],
      status: EmployeeSalaryStatus.ACTIVE,
      __v: 0,
    } as unknown as EmployeeSalaryLean);
    const negAssign = assignments.find((a) => a.employeeId.equals(negNetEmp))!;
    negAssign.salaryStructureId = structureId;
    negAssign.salaryAmount = 30000;
    negAssign.__v = 1;

    recordRepo.createCalls = 0;
    recordRepo.recalcCalls = 0;
    const run3 = await controller.processPeriod(periodId, {}, makeReq());
    expect(run3.data.processingStatus).toBe(PayrollProcessingStatus.COMPLETED);
    expect(run3.data.successfulEmployees).toBe(4);
    expect(run3.data.failedEmployees).toBe(0);
    expect(run3.data.skippedUpToDateEmployees).toBe(2);
    expect(recordRepo.createCalls).toBe(2);
    expect(recordRepo.recalcCalls).toBe(0);
    expect(run3.data.canComplete).toBe(true);

    // Verify healthy1 & healthy2 remained at calculationVersion 1
    expect(
      (await recordRepo.findByPeriodAndEmployee(periodId, healthy1))!
        .calculationVersion,
    ).toBe(1);
    expect(
      (await recordRepo.findByPeriodAndEmployee(periodId, healthy2))!
        .calculationVersion,
    ).toBe(1);

    // Now transition PROCESSING -> COMPLETED -> FINALIZED succeeds cleanly
    const completed = await periodsService.updateStatus(
      periodId,
      { status: PayrollPeriodStatus.COMPLETED },
      actorId,
      [roleId],
    );
    expect(completed.status).toBe(PayrollPeriodStatus.COMPLETED);

    // Step 4.2 anomaly gate still protects FINALIZED (UNFINALIZED_MISSING_DAYS when no attendance buckets exist)
    await expect(
      periodsService.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.FINALIZED },
        actorId,
        [roleId],
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    const finalized = await controller.getProcessingStatus(periodId).then(() =>
      periodsService.updateStatus(
        periodId,
        {
          status: PayrollPeriodStatus.FINALIZED,
          acknowledgeAnomalies: true,
          reason:
            'Verified payroll completion and acknowledged test missing-day flags',
        },
        actorId,
        [roleId],
      ),
    );
    expect(finalized.status).toBe(PayrollPeriodStatus.FINALIZED);
  });

  it('detects stale records after leave/attendance/salary/rule change, blocks COMPLETED, and recalculates only affected employees', async () => {
    const empA = addEmployee('EMP-A', { salary: 30000 });
    const empB = addEmployee('EMP-B', { salary: 45000 });

    await controller.processPeriod(periodId, {}, makeReq());
    expect(recordRepo.createCalls).toBe(2);

    // Mutate only empA: approve 2-day unpaid leave + bump salary assignment
    leaves.push({
      _id: new Types.ObjectId(),
      employeeId: empA,
      leaveTypeId: new Types.ObjectId(),
      leaveTypeSnapshot: {
        name: 'Loss of Pay',
        code: 'LWP',
        isPaid: false,
        allowHalfDay: true,
        deductWeekends: false,
        deductHolidays: false,
      },
      startDate: '2026-04-06',
      endDate: '2026-04-07',
      status: LeaveRequestStatus.APPROVED,
      totalDays: 2,
      isHalfDay: false,
      halfDaySession: null,
      excludedDates: [],
    } as unknown as LeaveRequestLean);
    attendanceBuckets.push({
      employeeId: empA,
      attendanceDate: '2026-04-08',
      status: AttendanceStatus.ABSENT,
      regularizationId: null,
    } as unknown as PayrollAttendanceBucket);
    const assignA = assignments.find((a) => a.employeeId.equals(empA))!;
    assignA.salaryAmount = 33000;
    assignA.__v = 1;

    // Status reflects stale record and disallows completion until re-processed
    const statusBeforeRetry = await controller.getProcessingStatus(periodId);
    expect(statusBeforeRetry.data.staleEmployees).toBe(1);
    expect(statusBeforeRetry.data.canRetry).toBe(true);
    expect(statusBeforeRetry.data.canComplete).toBe(false);

    await expect(
      periodsService.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.COMPLETED },
        actorId,
        [roleId],
      ),
    ).rejects.toMatchObject({ statusCode: HttpStatus.CONFLICT });

    // Process again -> only empA recalculated (version 2), empB skipped (version 1)
    recordRepo.recalcCalls = 0;
    const retryRes = await controller.processPeriod(periodId, {}, makeReq());
    expect(retryRes.data.processingStatus).toBe(
      PayrollProcessingStatus.COMPLETED,
    );
    expect(retryRes.data.recalculatedEmployees).toBe(1);
    expect(retryRes.data.skippedUpToDateEmployees).toBe(1);
    expect(recordRepo.recalcCalls).toBe(1);

    const recA = (await recordRepo.findByPeriodAndEmployee(periodId, empA))!;
    const recB = (await recordRepo.findByPeriodAndEmployee(periodId, empB))!;
    expect(recA.calculationVersion).toBe(2);
    expect(recA.calculationSnapshot.totalLopDays).toBe(3); // 2 unpaid leave + 1 absent
    expect(recB.calculationVersion).toBe(1);

    // Changing payroll rule affects ALL employees -> staleEmployees = 2
    rulesDoc.__v = 1;
    rulesDoc.prorationPolicy = PayrollProrationPolicy.CALENDAR_DAYS;
    const statusAfterRule = await controller.getProcessingStatus(periodId);
    expect(statusAfterRule.data.staleEmployees).toBe(2);
  });

  it('prevents overlapping concurrent processing and recovers expired stale heartbeat locks safely', async () => {
    const empId = addEmployee('EMP-LOCK', { salary: 30000 });
    const period = periodRepo.store.get(periodId.toHexString())!;
    period.status = PayrollPeriodStatus.PROCESSING;
    period.processing = {
      processingStatus: PayrollProcessingStatus.PROCESSING,
      totalEligibleEmployees: 1,
      processedEmployees: 0,
      successfulEmployees: 0,
      failedEmployees: 0,
      skippedUpToDateEmployees: 0,
      recalculatedEmployees: 0,
      processingAttempts: 1,
      startedAt: new Date(),
      completedAt: null,
      lastAttemptAt: new Date(),
      heartbeatAt: new Date(), // fresh heartbeat
      activeRunId: 'live-worker-run-id',
      lastErrorSummary: null,
    };

    // Active run -> 409 conflict for both /process and /status COMPLETED
    await expect(
      controller.processPeriod(periodId, {}, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    await expect(
      periodsService.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.COMPLETED },
        actorId,
        [roleId],
      ),
    ).rejects.toMatchObject({ statusCode: HttpStatus.CONFLICT });

    // Simulate worker crash with expired heartbeat (> LOCK_STALE_TIMEOUT_MS)
    const staleDate = new Date(
      Date.now() - PAYROLL_PROCESSING_CONSTANTS.LOCK_STALE_TIMEOUT_MS - 10_000,
    );
    period.processing.heartbeatAt = staleDate;
    period.processing.lastAttemptAt = staleDate;

    const recovered = await controller.processPeriod(periodId, {}, makeReq());
    expect(recovered.data.processingStatus).toBe(
      PayrollProcessingStatus.COMPLETED,
    );
    expect(recovered.data.processingAttempts).toBe(2);
    expect(
      (await recordRepo.findByPeriodAndEmployee(periodId, empId))
        ?.calculationVersion,
    ).toBe(1);
    expect(recordRepo.values()).toHaveLength(1);
  });

  it('blocks completion if an existing PayrollRecord belongs to an employee who later became ineligible/deleted', async () => {
    const emp1 = addEmployee('EMP-ELIG-1');
    const emp2 = addEmployee('EMP-ELIG-2');
    await controller.processPeriod(periodId, {}, makeReq());

    // Soft-delete emp2 after processing
    const doc2 = employees.get(emp2.toHexString())!;
    doc2.deletedAt = new Date();

    await expect(
      periodsService.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.COMPLETED },
        actorId,
        [roleId],
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    // Removing orphaned record restores clean completion
    recordRepo.deleteByEmployeeId(emp2);
    const completed = await periodsService.updateStatus(
      periodId,
      { status: PayrollPeriodStatus.COMPLETED },
      actorId,
      [roleId],
    );
    expect(completed.status).toBe(PayrollPeriodStatus.COMPLETED);
    expect(
      (await recordRepo.findByPeriodAndEmployee(periodId, emp1))?.status,
    ).toBe(PayrollRecordStatus.CALCULATED);
  });

  it('sanitizes MongoDB connection URIs and overly long strings in error messages', () => {
    const sanitized = sanitizeProcessingErrorMessage(
      'Failed connecting to mongodb+srv://admin:secret@cluster0.mongodb.net/crm_hrms_test while processing ' +
        'x'.repeat(400),
    );
    expect(sanitized).toContain('[REDACTED_URI]');
    expect(sanitized).not.toContain('secret');
    expect(sanitized.length).toBeLessThanOrEqual(
      PAYROLL_PROCESSING_CONSTANTS.MAX_ERROR_MESSAGE_LENGTH,
    );
    expect(processingService).toBeDefined();
    expect(RegularizationStatus.APPROVED).toBe('APPROVED');
  });
});
