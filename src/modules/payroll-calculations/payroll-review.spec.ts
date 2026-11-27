/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import {
  ExecutionContext,
  HttpStatus,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AttendanceStatus } from '../attendance/constants/attendance.constant';
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
import { PayrollRecordStatus } from './constants/payroll-calculation.constant';
import { PayrollPeriodProcessingController } from './controllers/payroll-period-processing.controller';
import { PayrollPeriodReviewController } from './controllers/payroll-period-review.controller';
import {
  ApprovePayrollPeriodDto,
  ListPayrollReviewRecordsQueryDto,
} from './dto/payroll-review.dto';
import { PayrollProcessingFailureRepository } from './repositories/payroll-processing-failure.repository';
import {
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
import { PayrollReviewService } from './services/payroll-review.service';
import { PayrollSnapshotBuilder } from './services/payroll-snapshot.builder';
import { PayrollTotalsCalculator } from './services/payroll-totals.calculator';
import { ProrationCalculator } from './services/proration.calculator';
import { SalaryComponentResolver } from './services/salary-component.resolver';

describe('Step 6 — Payroll Review & Approval Integration Suite', () => {
  let reviewController: PayrollPeriodReviewController;
  let processingController: PayrollPeriodProcessingController;
  let processingService: PayrollProcessingService;
  let periodsService: PayrollPeriodsService;
  let calculationService: PayrollCalculationService;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;

  const actorId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const deptAId = new Types.ObjectId();
  const deptBId = new Types.ObjectId();
  const roleId = new Types.ObjectId();

  let periodStore: Map<string, PayrollPeriodLean>;
  let recordStore: Map<string, PayrollRecordLean>;
  let failureStore: Map<string, PayrollProcessingFailureLean>;
  let employees: Map<string, EmployeeLean>;
  let assignments: EmployeeSalaryLean[];
  let structures: Map<string, SalaryStructureLean>;
  let components: Map<string, SalaryComponentLean>;
  let attendanceBuckets: PayrollAttendanceBucket[];
  let leaves: LeaveRequestLean[];
  let auditLogs: Array<Record<string, unknown>>;
  let activePermissions: string[];
  let connectionMock: { startSession: jest.Mock };

  let periodId: Types.ObjectId;
  let structureId: Types.ObjectId;
  let basicCompId: Types.ObjectId;

  const clonePeriod = (doc: PayrollPeriodLean): PayrollPeriodLean => ({
    ...doc,
    processing: doc.processing ? { ...doc.processing } : undefined,
    approval: doc.approval ? { ...doc.approval } : null,
  });

  const makeReq = (perms?: string[]): AuthenticatedRequest =>
    ({
      user: {
        userId: actorId,
        email: 'reviewer@example.com',
        roleIds: [roleId],
      },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest-step6' },
      ...(perms ? { activePermissions: perms } : {}),
    }) as unknown as AuthenticatedRequest;

  const makeExecCtx = (
    handler: object,
    req: AuthenticatedRequest = makeReq(),
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PayrollPeriodReviewController,
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;

  const validateDto = async <T>(
    metatype: new () => T,
    payload: Record<string, unknown>,
    type: 'body' | 'query' = 'body',
  ): Promise<T> =>
    (await validationPipe.transform(payload, { type, metatype })) as T;

  const addEmployee = (
    code: string,
    opts?: Partial<EmployeeLean> & {
      departmentId?: Types.ObjectId;
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
      departmentId: opts?.departmentId ?? deptAId,
      branchId: opts?.branchId ?? branchId,
      deletedAt: opts?.deletedAt ?? null,
    } as unknown as EmployeeLean);

    if (!opts?.skipAssignment) {
      assignments.push({
        _id: new Types.ObjectId(),
        employeeId: id,
        salaryStructureId: structureId,
        effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
        effectiveTo: null,
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: opts?.salary ?? 30000,
        salaryStructureVersion: 1,
        salarySnapshot: {} as EmployeeSalaryLean['salarySnapshot'],
        status: EmployeeSalaryStatus.ACTIVE,
        __v: 0,
      } as unknown as EmployeeSalaryLean);
    }

    return id;
  };

  beforeAll(async () => {
    periodStore = new Map();
    recordStore = new Map();
    failureStore = new Map();
    employees = new Map();
    assignments = [];
    structures = new Map();
    components = new Map();
    attendanceBuckets = [];
    leaves = [];
    auditLogs = [];
    activePermissions = [];

    connectionMock = {
      startSession: jest.fn(async () => ({
        withTransaction: jest.fn(
          async (cb: (s: unknown) => Promise<unknown>) => {
            const periodSnap = new Map(
              Array.from(periodStore.entries()).map(([k, v]) => [
                k,
                clonePeriod(v),
              ]),
            );
            const recordSnap = new Map(
              Array.from(recordStore.entries()).map(([k, v]) => [k, { ...v }]),
            );
            const failureSnap = new Map(
              Array.from(failureStore.entries()).map(([k, v]) => [k, { ...v }]),
            );
            const auditCount = auditLogs.length;
            try {
              return await cb({ txSession: true });
            } catch (err) {
              periodStore = periodSnap;
              recordStore = recordSnap;
              failureStore = failureSnap;
              auditLogs.splice(auditCount);
              throw err;
            }
          },
        ),
        endSession: jest.fn().mockResolvedValue(undefined),
      })),
    };

    const periodRepoMock = {
      findById: jest.fn(async (id: Types.ObjectId) => {
        const doc = periodStore.get(id.toHexString());
        return doc && doc.deletedAt === null ? clonePeriod(doc) : null;
      }),
      updateStatus: jest.fn(
        async (
          id: Types.ObjectId,
          newStatus: PayrollPeriodStatus,
          updActor: Types.ObjectId,
          expectedVersion?: number,
          _session?: unknown,
          options?: {
            expectedFromStatus?: PayrollPeriodStatus;
            requireApprovalMetadata?: boolean;
          },
        ) => {
          const doc = periodStore.get(id.toHexString());
          if (!doc || doc.deletedAt !== null) return null;
          if (
            typeof expectedVersion === 'number' &&
            doc.__v !== expectedVersion
          ) {
            return null;
          }
          if (
            options?.expectedFromStatus !== undefined &&
            doc.status !== options.expectedFromStatus
          ) {
            return null;
          }
          if (
            options?.requireApprovalMetadata &&
            (!doc.approval?.approvedBy || !doc.approval?.approvedAt)
          ) {
            return null;
          }
          const updated: PayrollPeriodLean = {
            ...clonePeriod(doc),
            status: newStatus,
            updatedBy: updActor,
            __v: (doc.__v ?? 0) + 1,
          };
          periodStore.set(id.toHexString(), updated);
          return clonePeriod(updated);
        },
      ),
      approvePeriodAtomically: jest.fn(
        async (params: {
          periodId: Types.ObjectId;
          expectedPeriodVersion: number;
          actorId: Types.ObjectId;
          approvalState: NonNullable<PayrollPeriodLean['approval']>;
        }) => {
          const doc = periodStore.get(params.periodId.toHexString());
          if (
            !doc ||
            doc.deletedAt !== null ||
            doc.status !== PayrollPeriodStatus.COMPLETED ||
            doc.__v !== params.expectedPeriodVersion ||
            doc.processing?.activeRunId
          ) {
            return null;
          }
          const updated: PayrollPeriodLean = {
            ...clonePeriod(doc),
            status: PayrollPeriodStatus.APPROVED,
            approval: { ...params.approvalState },
            updatedBy: params.actorId,
            __v: (doc.__v ?? 0) + 1,
          };
          periodStore.set(params.periodId.toHexString(), updated);
          return clonePeriod(updated);
        },
      ),
      acquireProcessingLock: jest.fn(
        async (params: {
          periodId: Types.ObjectId;
          runId: string;
          actorId: Types.ObjectId;
          now: Date;
          staleCutoff: Date;
        }) => {
          const doc = periodStore.get(params.periodId.toHexString());
          if (
            !doc ||
            doc.deletedAt !== null ||
            (doc.status !== PayrollPeriodStatus.DRAFT &&
              doc.status !== PayrollPeriodStatus.PROCESSING)
          ) {
            return null;
          }
          const proc = doc.processing;
          if (
            proc?.processingStatus === PayrollProcessingStatus.PROCESSING &&
            proc.heartbeatAt &&
            proc.heartbeatAt >= params.staleCutoff
          ) {
            return null;
          }
          const updated: PayrollPeriodLean = {
            ...clonePeriod(doc),
            status: PayrollPeriodStatus.PROCESSING,
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
          periodStore.set(params.periodId.toHexString(), updated);
          return clonePeriod(updated);
        },
      ),
      verifyActiveRunOwnership: jest.fn(
        async (id: Types.ObjectId, runId: string) => {
          const doc = periodStore.get(id.toHexString());
          return Boolean(
            doc &&
            doc.deletedAt === null &&
            doc.status !== PayrollPeriodStatus.FINALIZED &&
            doc.processing?.activeRunId === runId,
          );
        },
      ),
      touchActiveRunLock: jest.fn(
        async (params: {
          periodId: Types.ObjectId;
          runId: string;
          now: Date;
        }) => {
          const doc = periodStore.get(params.periodId.toHexString());
          if (
            !doc ||
            (doc.status !== PayrollPeriodStatus.DRAFT &&
              doc.status !== PayrollPeriodStatus.PROCESSING) ||
            doc.processing?.activeRunId !== params.runId
          ) {
            return false;
          }
          doc.processing.heartbeatAt = params.now;
          doc.__v = (doc.__v ?? 0) + 1;
          return true;
        },
      ),
      updateProcessingProgress: jest.fn(
        async (params: {
          periodId: Types.ObjectId;
          runId: string;
          totalEligibleEmployees: number;
          processedEmployees: number;
          successfulEmployees: number;
          failedEmployees: number;
          skippedUpToDateEmployees: number;
          recalculatedEmployees: number;
          heartbeatAt: Date;
        }) => {
          const doc = periodStore.get(params.periodId.toHexString());
          if (
            !doc ||
            (doc.status !== PayrollPeriodStatus.DRAFT &&
              doc.status !== PayrollPeriodStatus.PROCESSING) ||
            doc.processing?.activeRunId !== params.runId
          ) {
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
          doc.__v = (doc.__v ?? 0) + 1;
          return true;
        },
      ),
      completeProcessingRun: jest.fn(
        async (params: {
          periodId: Types.ObjectId;
          runId: string;
          processingStatus: PayrollProcessingStatus;
          totalEligibleEmployees: number;
          processedEmployees: number;
          successfulEmployees: number;
          failedEmployees: number;
          skippedUpToDateEmployees: number;
          recalculatedEmployees: number;
          completedAt: Date;
          lastErrorSummary: string | null;
        }) => {
          const doc = periodStore.get(params.periodId.toHexString());
          if (
            !doc ||
            (doc.status !== PayrollPeriodStatus.DRAFT &&
              doc.status !== PayrollPeriodStatus.PROCESSING) ||
            doc.processing?.activeRunId !== params.runId
          ) {
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
          return clonePeriod(doc);
        },
      ),
      verifyPeriodMutableAndBumpVersion: jest.fn(
        async (
          id: Types.ObjectId,
          allowed: ReadonlyArray<PayrollPeriodStatus>,
        ) => {
          const doc = periodStore.get(id.toHexString());
          if (!doc || doc.deletedAt !== null || !allowed.includes(doc.status)) {
            return false;
          }
          doc.__v = (doc.__v ?? 0) + 1;
          return true;
        },
      ),
    };

    const recordRepoMock = {
      isDuplicateKeyError: jest.fn(() => false),
      findByPeriodAndEmployee: jest.fn(
        async (pId: Types.ObjectId, empId: Types.ObjectId) => {
          for (const rec of recordStore.values()) {
            if (
              rec.deletedAt === null &&
              rec.payrollPeriodId.equals(pId) &&
              rec.employeeId.equals(empId)
            ) {
              return { ...rec };
            }
          }
          return null;
        },
      ),
      findByIdAndPeriod: jest.fn(
        async (recId: Types.ObjectId, pId: Types.ObjectId) => {
          const rec = recordStore.get(recId.toHexString());
          if (
            !rec ||
            rec.deletedAt !== null ||
            !rec.payrollPeriodId.equals(pId)
          ) {
            return null;
          }
          return { ...rec };
        },
      ),
      create: jest.fn(async (input: Record<string, unknown>) => {
        const _id = new Types.ObjectId();
        const created = {
          _id,
          ...input,
          deletedAt: null,
          approvedAt: null,
          approvedBy: null,
          invalidatedAt: null,
          invalidatedBy: null,
          invalidationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          __v: 0,
        } as unknown as PayrollRecordLean;
        recordStore.set(_id.toHexString(), created);
        return { ...created };
      }),
      createMany: jest.fn(async (inputs: Array<Record<string, unknown>>) =>
        inputs.map((inp) => {
          const _id = new Types.ObjectId();
          const created = {
            _id,
            ...inp,
            deletedAt: null,
            approvedAt: null,
            approvedBy: null,
            invalidatedAt: null,
            invalidatedBy: null,
            invalidationReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            __v: 0,
          } as unknown as PayrollRecordLean;
          recordStore.set(_id.toHexString(), created);
          return { ...created };
        }),
      ),
      recalculateAtomically: jest.fn(
        async (
          id: Types.ObjectId,
          expectedVersion: number,
          input: RecalculatePayrollRecordInput,
        ) => {
          const existing = recordStore.get(id.toHexString());
          if (
            !existing ||
            existing.deletedAt !== null ||
            (existing.status !== PayrollRecordStatus.CALCULATED &&
              existing.status !== PayrollRecordStatus.INVALIDATED) ||
            existing.__v !== expectedVersion
          ) {
            return null;
          }
          const updated: PayrollRecordLean = {
            ...existing,
            ...input,
            status: PayrollRecordStatus.CALCULATED,
            invalidatedAt: null,
            invalidatedBy: null,
            invalidationReason: null,
            calculationVersion: existing.calculationVersion + 1,
            updatedAt: new Date(),
            __v: existing.__v + 1,
          };
          recordStore.set(id.toHexString(), updated);
          return { ...updated };
        },
      ),
      invalidateCalculatedByPeriodAndEmployees: jest.fn(
        async (params: {
          payrollPeriodId: Types.ObjectId;
          employeeIds: Types.ObjectId[];
          reason: string;
          actorId: Types.ObjectId;
          invalidatedAt: Date;
        }) => {
          let count = 0;
          for (const rec of recordStore.values()) {
            if (
              rec.deletedAt === null &&
              rec.payrollPeriodId.equals(params.payrollPeriodId) &&
              params.employeeIds.some((id) => id.equals(rec.employeeId)) &&
              rec.status === PayrollRecordStatus.CALCULATED
            ) {
              rec.status = PayrollRecordStatus.INVALIDATED;
              rec.invalidatedAt = params.invalidatedAt;
              rec.invalidatedBy = params.actorId;
              rec.invalidationReason = params.reason;
              rec.__v = (rec.__v ?? 0) + 1;
              count++;
            }
          }
          return count;
        },
      ),
      findActiveByPeriodAndEmployees: jest.fn(
        async (pId: Types.ObjectId, empIds: Types.ObjectId[]) =>
          Array.from(recordStore.values())
            .filter(
              (r) =>
                r.deletedAt === null &&
                r.payrollPeriodId.equals(pId) &&
                empIds.some((id) => id.equals(r.employeeId)),
            )
            .map((r) => ({ ...r })),
      ),
      findFullByPeriodAndEmployees: jest.fn(
        async (pId: Types.ObjectId, empIds: Types.ObjectId[]) =>
          Array.from(recordStore.values())
            .filter(
              (r) =>
                r.deletedAt === null &&
                r.payrollPeriodId.equals(pId) &&
                empIds.some((id) => id.equals(r.employeeId)),
            )
            .map((r) => ({ ...r })),
      ),
      findActiveSummariesByPeriod: jest.fn(async (pId: Types.ObjectId) =>
        Array.from(recordStore.values())
          .filter(
            (r) =>
              r.deletedAt === null &&
              r.payrollPeriodId.equals(pId) &&
              r.status !== PayrollRecordStatus.INVALIDATED,
          )
          .map((r) => ({
            _id: r._id,
            employeeId: r.employeeId,
            status: r.status,
            calculationVersion: r.calculationVersion,
            calculatedAt: r.calculatedAt,
            inputFingerprint: r.calculationSnapshot?.inputFingerprint ?? null,
          })),
      ),
      approveCalculatedRecordsByIds: jest.fn(
        async (params: {
          payrollPeriodId: Types.ObjectId;
          recordIds: Types.ObjectId[];
          actorId: Types.ObjectId;
          approvedAt: Date;
        }) => {
          let modified = 0;
          let matched = 0;
          for (const rec of recordStore.values()) {
            if (
              rec.deletedAt === null &&
              rec.payrollPeriodId.equals(params.payrollPeriodId) &&
              params.recordIds.some((id) => id.equals(rec._id)) &&
              rec.status === PayrollRecordStatus.CALCULATED
            ) {
              matched++;
              rec.status = PayrollRecordStatus.APPROVED;
              rec.approvedAt = params.approvedAt;
              rec.approvedBy = params.actorId;
              rec.updatedBy = params.actorId;
              rec.__v = (rec.__v ?? 0) + 1;
              modified++;
            }
          }
          return { matchedCount: matched, modifiedCount: modified };
        },
      ),
      aggregateReviewSummary: jest.fn(async (pId: Types.ObjectId) => {
        const docs = Array.from(recordStore.values()).filter(
          (r) => r.deletedAt === null && r.payrollPeriodId.equals(pId),
        );
        let calculatedCount = 0;
        let approvedCount = 0;
        let invalidatedCount = 0;
        let gross = 0;
        let ded = 0;
        let er = 0;
        let net = 0;
        const versionCounts: Record<string, number> = {};
        for (const r of docs) {
          if (r.status === PayrollRecordStatus.CALCULATED) calculatedCount++;
          else if (r.status === PayrollRecordStatus.APPROVED) approvedCount++;
          else if (r.status === PayrollRecordStatus.INVALIDATED) {
            invalidatedCount++;
            continue;
          }
          gross += Number(r.grossEarnings.toString());
          ded += Number(r.totalDeductions.toString());
          er += Number(r.employerContributions.toString());
          net += Number(r.netSalary.toString());
          versionCounts[String(r.calculationVersion)] =
            (versionCounts[String(r.calculationVersion)] ?? 0) + 1;
        }
        return {
          calculatedCount,
          approvedCount,
          invalidatedCount,
          totalGrossEarnings: gross.toFixed(2),
          totalDeductions: ded.toFixed(2),
          totalEmployerContributions: er.toFixed(2),
          totalNetSalary: net.toFixed(2),
          versionCounts,
        };
      }),
      findPaginatedForReview: jest.fn(
        async (
          pId: Types.ObjectId,
          query: {
            page: number;
            limit: number;
            search?: string;
            departmentId?: Types.ObjectId;
            branchId?: Types.ObjectId;
            status?: PayrollRecordStatus;
            hasAnomalies?: boolean;
          },
        ) => {
          const rows = Array.from(recordStore.values())
            .filter(
              (r) => r.deletedAt === null && r.payrollPeriodId.equals(pId),
            )
            .filter((r) => !query.status || r.status === query.status)
            .filter((r) => {
              const hasWarn =
                (r.calculationSnapshot?.attendanceLeaveWarnings?.length ?? 0) >
                  0 ||
                (r.calculationSnapshot?.leaveAttendanceMismatchDates?.length ??
                  0) > 0;
              if (query.hasAnomalies === true) return hasWarn;
              if (query.hasAnomalies === false) return !hasWarn;
              return true;
            })
            .map((r) => {
              const emp = employees.get(r.employeeId.toHexString());
              return {
                id: r._id,
                employeeId: r.employeeId,
                employeeCode:
                  emp?.employeeCode ?? r.calculationSnapshot.employeeCode,
                employeeName: r.calculationSnapshot.employeeName,
                employmentStatus: r.calculationSnapshot.employmentStatus,
                departmentId: emp?.departmentId ?? null,
                branchId: emp?.branchId ?? null,
                status: r.status,
                grossEarnings: r.grossEarnings,
                totalDeductions: r.totalDeductions,
                employerContributions: r.employerContributions,
                netSalary: r.netSalary,
                payableDays: r.calculationSnapshot.payableDays,
                totalLopDays: r.calculationSnapshot.totalLopDays,
                calculationVersion: r.calculationVersion,
                calculatedAt: r.calculatedAt,
                approvedAt: r.approvedAt ?? null,
                approvedBy: r.approvedBy ?? null,
                invalidatedAt: r.invalidatedAt ?? null,
                invalidationReason: r.invalidationReason ?? null,
                warnings: r.calculationSnapshot.attendanceLeaveWarnings ?? [],
                leaveAttendanceMismatchDates:
                  r.calculationSnapshot.leaveAttendanceMismatchDates ?? [],
              };
            })
            .filter(
              (row) =>
                !query.departmentId ||
                Boolean(row.departmentId?.equals(query.departmentId)),
            )
            .filter(
              (row) =>
                !query.branchId ||
                Boolean(row.branchId?.equals(query.branchId)),
            )
            .filter((row) => {
              if (!query.search) return true;
              const q = query.search.toLowerCase();
              return (
                row.employeeCode.toLowerCase().includes(q) ||
                row.employeeName.toLowerCase().includes(q)
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

    const failureRepoMock = {
      upsertFailuresBulk: jest.fn(
        async (pId: Types.ObjectId, items: Array<Record<string, unknown>>) => {
          for (const item of items) {
            const empId = item.employeeId as Types.ObjectId;
            failureStore.set(`${pId.toHexString()}:${empId.toHexString()}`, {
              _id: new Types.ObjectId(),
              payrollPeriodId: pId,
              ...item,
            } as unknown as PayrollProcessingFailureLean);
          }
        },
      ),
      deleteByPeriodAndEmployees: jest.fn(
        async (pId: Types.ObjectId, empIds: Types.ObjectId[]) => {
          for (const empId of empIds) {
            failureStore.delete(`${pId.toHexString()}:${empId.toHexString()}`);
          }
        },
      ),
      deleteByPeriodExcludingEmployees: jest.fn(async () => undefined),
      deleteByPeriod: jest.fn(async () => undefined),
      findEmployeeIdsByPeriod: jest.fn(async (pId: Types.ObjectId) =>
        Array.from(failureStore.values())
          .filter((f) => f.payrollPeriodId.equals(pId))
          .map((f) => f.employeeId),
      ),
      countByPeriod: jest.fn(
        async (pId: Types.ObjectId) =>
          Array.from(failureStore.values()).filter((f) =>
            f.payrollPeriodId.equals(pId),
          ).length,
      ),
      findPaginatedByPeriod: jest.fn(
        async (pId: Types.ObjectId, page: number, limit: number) => {
          const rows = Array.from(failureStore.values()).filter((f) =>
            f.payrollPeriodId.equals(pId),
          );
          const skip = (page - 1) * limit;
          return {
            data: rows.slice(skip, skip + limit),
            meta: {
              total: rows.length,
              page,
              limit,
              totalPages: Math.max(1, Math.ceil(rows.length / limit)),
              hasNextPage: skip + limit < rows.length,
              hasPreviousPage: page > 1,
            },
          };
        },
      ),
    };

    const auditLogsServiceMock = {
      createAuditLog: jest.fn(async (entry: Record<string, unknown>) => {
        auditLogs.push(entry);
      }),
      createAuditLogsBulk: jest.fn(
        async (entries: Array<Record<string, unknown>>) => {
          auditLogs.push(...entries);
        },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        PayrollPeriodReviewController,
        PayrollPeriodProcessingController,
      ],
      providers: [
        PayrollReviewService,
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
        { provide: getConnectionToken(), useValue: connectionMock },
        { provide: PayrollPeriodRepository, useValue: periodRepoMock },
        { provide: PayrollRecordRepository, useValue: recordRepoMock },
        {
          provide: PayrollProcessingFailureRepository,
          useValue: failureRepoMock,
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
            find: jest.fn(() => {
              const chain = {
                select: () => chain,
                sort: () => ({
                  lean: () => ({
                    exec: async () =>
                      Array.from(employees.values()).filter(
                        (e) => e.deletedAt === null,
                      ),
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
            find: jest.fn(() => ({
              lean: () => ({
                exec: async () => Array.from(components.values()),
              }),
            })),
          },
        },
        {
          provide: PayrollSettingsRepository,
          useValue: {
            findActive: jest.fn(async () => ({
              _id: branchId,
              currency: 'INR',
              isPayrollProcessingEnabled: true,
              __v: 0,
            })),
          },
        },
        {
          provide: PayrollCalculationRuleRepository,
          useValue: {
            findActive: jest.fn(async () => ({
              _id: deptAId,
              roundingMode: PayrollRoundingMode.HALF_EVEN,
              roundingPrecision: 2,
              prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
              prorateFixedComponents: true,
              prorateDeductions: false,
              prorateEmployerContributions: false,
              negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
              componentExecutionOrder: [],
              __v: 0,
            })),
          },
        },
        {
          provide: BranchRepository,
          useValue: { findByIds: jest.fn(async () => []) },
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
            aggregateForPayrollPeriod: jest.fn(async () => attendanceBuckets),
          },
        },
        {
          provide: AttendanceRegularizationRepository,
          useValue: { findByIds: jest.fn(async () => []) },
        },
        {
          provide: LeaveRequestRepository,
          useValue: {
            findOverlappingForEmployees: jest.fn(async () => leaves),
          },
        },
        { provide: AuditLogsService, useValue: auditLogsServiceMock },
        {
          provide: AuthorizationService,
          useValue: {
            hasPermissions: jest.fn(async (_r: unknown, reqPerms: string[]) =>
              reqPerms.every((p) => activePermissions.includes(p)),
            ),
          },
        },
      ],
    }).compile();

    reviewController = module.get(PayrollPeriodReviewController);
    processingController = module.get(PayrollPeriodProcessingController);
    processingService = module.get(PayrollProcessingService);
    periodsService = module.get(PayrollPeriodsService);
    calculationService = module.get(PayrollCalculationService);
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
    failureStore.clear();
    employees.clear();
    assignments = [];
    structures.clear();
    components.clear();
    attendanceBuckets = [];
    leaves = [];
    auditLogs = [];
    activePermissions = [
      PermissionKeys.PAYROLL_CALCULATIONS_VIEW,
      PermissionKeys.PAYROLL_CALCULATIONS_CREATE,
      PermissionKeys.PAYROLL_PERIODS_VIEW,
      PermissionKeys.PAYROLL_PERIODS_EDIT,
      PermissionKeys.PAYROLL_PERIODS_APPROVE,
    ];
    jest.restoreAllMocks();

    basicCompId = new Types.ObjectId();
    components.set(basicCompId.toHexString(), {
      _id: basicCompId,
      name: 'Basic Salary',
      code: 'BASIC',
      type: SalaryComponentType.EARNING,
      calculationType: null,
      percentageOf: null,
      isTaxable: true,
      isStatutory: false,
      isActive: true,
      deletedAt: null,
    } as unknown as SalaryComponentLean);

    structureId = new Types.ObjectId();
    structures.set(structureId.toHexString(), {
      _id: structureId,
      name: 'Standard Structure',
      code: 'STD_1',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 30000,
      components: [
        {
          componentId: basicCompId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 30000,
          percentage: null,
          percentageOf: null,
          order: 1,
        },
      ],
      isActive: true,
      __v: 1,
    } as unknown as SalaryStructureLean);

    periodId = new Types.ObjectId();
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
      status: PayrollPeriodStatus.DRAFT,
      deletedAt: null,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
  });

  const seedCompletedPeriodWithTwoEmployees = async () => {
    const emp1Id = addEmployee('EMP001', { departmentId: deptAId });
    const emp2Id = addEmployee('EMP002', { departmentId: deptBId });
    await processingController.processPeriod(periodId, {}, makeReq());
    await periodsService.updateStatus(
      periodId,
      { status: PayrollPeriodStatus.COMPLETED },
      actorId,
      [roleId],
    );
    return { emp1Id, emp2Id };
  };

  it('enforces strict RBAC separation between payroll review and approval + DTO whitelist validation', async () => {
    activePermissions = [PermissionKeys.PAYROLL_CALCULATIONS_VIEW];
    await expect(
      guard.canActivate(makeExecCtx(reviewController.getReviewSummary)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeExecCtx(reviewController.listPeriodRecords)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeExecCtx(reviewController.getRecordDetails)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeExecCtx(reviewController.approvePeriod)),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      statusCode: HttpStatus.FORBIDDEN,
    });

    await expect(
      validateDto(ApprovePayrollPeriodDto, {
        totalNetSalary: '999999.00', // non-whitelisted client tampering
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    await expect(
      validateDto(
        ListPayrollReviewRecordsQueryDto,
        { departmentId: 'not-an-object-id' },
        'query',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });

  it('reviews completed period with exact totals excluding INVALIDATED records, supports filters, and never recalculates on read', async () => {
    const { emp1Id, emp2Id } = await seedCompletedPeriodWithTwoEmployees();
    const emp3Inv = addEmployee('EMP003_INV', {
      employmentStatus: EmploymentStatus.TERMINATED,
      terminationDate: new Date('2026-01-01T00:00:00.000Z'),
      lastWorkingDate: new Date('2026-01-01T00:00:00.000Z'),
    });

    // Inject an INVALIDATED record + corrupt period counters to verify totals ignore both
    const invRecId = new Types.ObjectId();
    recordStore.set(invRecId.toHexString(), {
      ...Array.from(recordStore.values())[0],
      _id: invRecId,
      employeeId: emp3Inv,
      status: PayrollRecordStatus.INVALIDATED,
      invalidationReason: 'INELIGIBLE:TERMINATED_BEFORE_PERIOD',
    });
    const period = periodStore.get(periodId.toHexString())!;
    period.processing!.successfulEmployees = 999;

    const computeSpy = jest.spyOn(
      calculationService,
      'computeFromResolvedInputs',
    );

    const summaryRes = await reviewController.getReviewSummary(periodId);
    expect(summaryRes.data.periodStatus).toBe(PayrollPeriodStatus.COMPLETED);
    expect(summaryRes.data.totalEligibleEmployees).toBe(2);
    expect(summaryRes.data.totalCalculatedEmployees).toBe(2);
    expect(summaryRes.data.totalApprovedEmployees).toBe(0);
    expect(summaryRes.data.totalPendingApprovalEmployees).toBe(2);
    expect(summaryRes.data.totalInvalidatedEmployees).toBe(1);
    expect(summaryRes.data.totalGrossEarnings).toBe('60000.00');
    expect(summaryRes.data.totalNetSalary).toBe('60000.00');
    expect(summaryRes.data.totalEmployerCost).toBe('60000.00');
    expect(summaryRes.data.approvalEligibility.canApprove).toBe(true);

    const listDeptB = await reviewController.listPeriodRecords(
      periodId,
      await validateDto(
        ListPayrollReviewRecordsQueryDto,
        { departmentId: deptBId.toHexString(), page: 1, limit: 10 },
        'query',
      ),
    );
    expect(listDeptB.data).toHaveLength(1);
    expect(listDeptB.data[0].employeeId).toBe(emp2Id.toHexString());
    expect(listDeptB.meta.total).toBe(1);

    const emp1Rec = Array.from(recordStore.values()).find((r) =>
      r.employeeId.equals(emp1Id),
    )!;
    const detail = await reviewController.getRecordDetails(
      periodId,
      emp1Rec._id,
    );
    expect(detail.data.id).toBe(emp1Rec._id.toHexString());
    expect(detail.data.employerCost).toBe('30000.00');
    expect(detail.data.calculationSnapshot.earnings).toHaveLength(1);
    expect(computeSpy).not.toHaveBeenCalled();

    // Nonexistent period & cross-period record access -> 404
    await expect(
      reviewController.getReviewSummary(new Types.ObjectId()),
    ).rejects.toMatchObject({ statusCode: HttpStatus.NOT_FOUND });

    await expect(
      reviewController.getRecordDetails(periodId, new Types.ObjectId()),
    ).rejects.toMatchObject({ statusCode: HttpStatus.NOT_FOUND });
  });

  it('blocks approval when failures, missing records, stale records, or unresolved anomalies exist', async () => {
    const { emp1Id } = await seedCompletedPeriodWithTwoEmployees();

    // 1. Unresolved failure blocks approval
    const failKey = `${periodId.toHexString()}:${emp1Id.toHexString()}`;
    failureStore.set(failKey, {
      _id: new Types.ObjectId(),
      payrollPeriodId: periodId,
      employeeId: emp1Id,
      employeeCode: 'EMP001',
      employeeName: 'Emp EMP001',
      errorCode: ErrorCode.VALIDATION_ERROR,
      errorMessage: 'Missing assignment',
      attemptNumber: 1,
      lastAttemptAt: new Date(),
    } as unknown as PayrollProcessingFailureLean);
    await expect(
      reviewController.approvePeriod(periodId, {}, makeReq()),
    ).rejects.toMatchObject({ statusCode: HttpStatus.CONFLICT });
    failureStore.delete(failKey);

    // 2. Missing eligible employee record blocks approval
    const missingEmpId = addEmployee('EMP_MISSING');
    await expect(
      reviewController.approvePeriod(periodId, {}, makeReq()),
    ).rejects.toMatchObject({ statusCode: HttpStatus.CONFLICT });
    employees.delete(missingEmpId.toHexString());

    // 3. Stale record blocks approval (input change makes fingerprint stale)
    assignments[0].salaryAmount = 42000;
    await expect(
      reviewController.approvePeriod(periodId, {}, makeReq()),
    ).rejects.toMatchObject({ statusCode: HttpStatus.CONFLICT });
    assignments[0].salaryAmount = 30000;

    // 4. Hard-blocking anomaly blocks approval unconditionally
    leaves.push({
      _id: new Types.ObjectId(),
      employeeId: emp1Id,
      leaveTypeId: new Types.ObjectId(),
      leaveTypeSnapshot: {
        name: 'LWP',
        code: 'LWP',
        isPaid: false,
        allowHalfDay: true,
        deductWeekends: false,
        deductHolidays: false,
      },
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      totalDays: 1,
      isHalfDay: false,
      halfDaySession: null,
      status: LeaveRequestStatus.CANCELLATION_REQUESTED,
      deletedAt: null,
    } as unknown as LeaveRequestLean);
    await expect(
      reviewController.approvePeriod(
        periodId,
        { acknowledgeAnomalies: true, reason: 'Trying to bypass hard block' },
        makeReq(),
      ),
    ).rejects.toMatchObject({ statusCode: HttpStatus.CONFLICT });
    leaves.length = 0;

    // 5. Reviewable anomaly requires acknowledgment + reason, and passes once acknowledged
    const altPeriodId = new Types.ObjectId();
    periodStore.set(altPeriodId.toHexString(), {
      _id: altPeriodId,
      periodName: 'May 2026 Payroll',
      periodCode: 'PR-2026-05',
      payrollFrequency: PayrollFrequency.MONTHLY,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: new Date('2026-05-31T00:00:00.000Z'),
      paymentDate: new Date('2026-06-01T00:00:00.000Z'),
      month: 5,
      year: 2026,
      status: PayrollPeriodStatus.DRAFT,
      deletedAt: null,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
    // Seed partial attendance on a weekday so employee has UNFINALIZED_MISSING_DAYS (reviewable warning)
    attendanceBuckets.push({
      employeeId: emp1Id,
      attendanceDate: '2026-05-04',
      recordCount: 1,
      status: AttendanceStatus.PRESENT,
      statuses: [AttendanceStatus.PRESENT],
      isLate: false,
      lateMinutes: 0,
      isEarlyDeparture: false,
      earlyDepartureMinutes: 0,
      totalWorkMinutes: 480,
      totalBreakMinutes: 0,
      overtimeMinutes: 0,
      regularizationId: null,
      leaveRequestId: null,
    });
    await processingController.processPeriod(altPeriodId, {}, makeReq());
    await periodsService.updateStatus(
      altPeriodId,
      { status: PayrollPeriodStatus.COMPLETED },
      actorId,
      [roleId],
    );
    await expect(
      reviewController.approvePeriod(altPeriodId, {}, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    await expect(
      reviewController.approvePeriod(
        altPeriodId,
        { acknowledgeAnomalies: true, reason: 'ok' },
        makeReq(),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
    const ackApproved = await reviewController.approvePeriod(
      altPeriodId,
      {
        acknowledgeAnomalies: true,
        reason: 'Missing days verified with site lead',
      },
      makeReq(),
    );
    expect(ackApproved.data.periodStatus).toBe(PayrollPeriodStatus.APPROVED);
    attendanceBuckets.length = 0;
  });

  it('approves COMPLETED period atomically (keeping FINALIZED separate), blocks duplicate approval and recalculation, and rolls back on audit failure', async () => {
    const { emp1Id } = await seedCompletedPeriodWithTwoEmployees();

    // Direct PATCH /status -> APPROVED rejected
    await expect(
      periodsService.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.APPROVED },
        actorId,
        [roleId],
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    // Audit failure rolls back both period status and record status
    const auditSvc = (
      processingService as unknown as {
        auditLogsService: { createAuditLog: jest.Mock };
      }
    ).auditLogsService;
    auditSvc.createAuditLog.mockRejectedValueOnce(
      new Error('Simulated PAYROLL_PERIOD_APPROVED audit write failure'),
    );
    await expect(
      reviewController.approvePeriod(
        periodId,
        { acknowledgeAnomalies: true, reason: 'Quarterly payroll sign-off' },
        makeReq(),
      ),
    ).rejects.toThrow('Simulated PAYROLL_PERIOD_APPROVED audit write failure');

    expect(periodStore.get(periodId.toHexString())?.status).toBe(
      PayrollPeriodStatus.COMPLETED,
    );
    for (const rec of recordStore.values()) {
      expect(rec.status).toBe(PayrollRecordStatus.CALCULATED);
    }

    // Successful approval persists APPROVED records, APPROVED period (NOT FINALIZED), and audit log
    const approved = await reviewController.approvePeriod(
      periodId,
      {
        acknowledgeAnomalies: true,
        reason: 'Verified all numbers for April 2026',
      },
      makeReq(),
    );
    expect(approved.data.periodStatus).toBe(PayrollPeriodStatus.APPROVED);
    expect(approved.data.approvedRecordsCount).toBe(2);
    expect(approved.data.totalNetSalary).toBe('60000.00');
    expect(approved.data.eligibleForFinalization).toBe(true);
    expect(
      auditLogs.some((l) => l.action === AuditAction.PAYROLL_PERIOD_APPROVED),
    ).toBe(true);

    // Duplicate approval rejected safely
    await expect(
      reviewController.approvePeriod(periodId, {}, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    // Recalculation after approval blocked
    await expect(
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: periodId.toString(),
          employeeId: emp1Id.toString(),
          recalculate: true,
        },
        actorId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    // Step 7 finalization handoff: APPROVED -> FINALIZED succeeds
    const fin = await periodsService.updateStatus(
      periodId,
      {
        status: PayrollPeriodStatus.FINALIZED,
        acknowledgeAnomalies: true,
        reason: 'Final Step 7 lock',
      },
      actorId,
      [roleId],
    );
    expect(fin.status).toBe(PayrollPeriodStatus.FINALIZED);

    // GET /review-summary remains readable on FINALIZED period
    const finalizedSummary = await reviewController.getReviewSummary(periodId);
    expect(finalizedSummary.data.periodStatus).toBe(
      PayrollPeriodStatus.FINALIZED,
    );
    expect(finalizedSummary.data.approvalEligibility.canApprove).toBe(false);
  });

  it('blocks stale approval version, concurrent recalculation/invalidation race, and concurrent finalization race during approval', async () => {
    const { emp1Id } = await seedCompletedPeriodWithTwoEmployees();
    const currentPeriod = periodStore.get(periodId.toHexString())!;

    // 1. Stale client version rejected
    await expect(
      reviewController.approvePeriod(
        periodId,
        { version: currentPeriod.__v - 1 },
        makeReq(),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    // 2. Concurrent recalculation/version drift after pre-tx snapshot -> rejected 409 inside tx
    const failRepoRef = (
      processingService as unknown as {
        payrollProcessingFailureRepository: {
          countByPeriod: jest.Mock;
        };
      }
    ).payrollProcessingFailureRepository;
    const origCountByPeriod = failRepoRef.countByPeriod;
    failRepoRef.countByPeriod = jest.fn(
      async (pId: Types.ObjectId, session?: unknown) => {
        if (session) {
          failRepoRef.countByPeriod = origCountByPeriod;
          const targetRec = Array.from(recordStore.values()).find((r) =>
            r.employeeId.equals(emp1Id),
          )!;
          targetRec.calculationVersion = targetRec.calculationVersion + 1;
        }
        return 0;
      },
    );

    try {
      await expect(
        reviewController.approvePeriod(
          periodId,
          {
            acknowledgeAnomalies: true,
            reason: 'Concurrent recalc check after readiness',
          },
          makeReq(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    } finally {
      failRepoRef.countByPeriod = origCountByPeriod;
    }

    for (const rec of recordStore.values()) {
      expect(rec.status).toBe(PayrollRecordStatus.CALCULATED);
    }

    // 3. Concurrent finalization before approvePeriodAtomically commits -> aborts and rolls back record approvals
    const finalizeRaceSpy = jest
      .spyOn(periodsService, 'evaluatePeriodAnomalies')
      .mockImplementationOnce(async () => {
        periodStore.get(periodId.toHexString())!.status =
          PayrollPeriodStatus.FINALIZED;
        return {
          blockingFindings: [],
          reviewableFindings: [],
          distinctBlockingCodes: [],
          distinctReviewableCodes: [],
          acknowledgmentMeta: {
            acknowledgeAnomalies: false,
            acknowledgedAnomalyEmployees: 0,
            acknowledgedWarningCodes: [],
          },
        };
      });

    await expect(
      reviewController.approvePeriod(periodId, {}, makeReq()),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    finalizeRaceSpy.mockRestore();

    for (const rec of recordStore.values()) {
      expect(rec.status).toBe(PayrollRecordStatus.CALCULATED);
    }
  });

  it('enforces COMPLETED -> PROCESSING remediation with transactional failure cleanup and strict COMPLETED -> APPROVED -> FINALIZED finalization', async () => {
    const healthyEmpId = addEmployee('EMP-OK', { salary: 30000 });
    const failedEmp1Id = new Types.ObjectId();
    const failedEmp2Id = new Types.ObjectId();

    employees.set(failedEmp1Id.toHexString(), {
      _id: failedEmp1Id,
      employeeCode: 'EMP-F1',
      firstName: 'Tara',
      lastName: 'Nair',
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
      departmentId: deptAId,
      branchId,
      deletedAt: null,
    } as unknown as EmployeeLean);
    employees.set(failedEmp2Id.toHexString(), {
      _id: failedEmp2Id,
      employeeCode: 'EMP-F2',
      firstName: 'Kiran',
      lastName: 'Bose',
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
      departmentId: deptBId,
      branchId,
      deletedAt: null,
    } as unknown as EmployeeLean);

    // Process period -> 1 succeeds, 2 fail
    const run1 = await processingService.processPeriod(periodId, {}, actorId);
    expect(run1.failedEmployees).toBe(2);
    expect(failureStore.size).toBe(2);

    // Move period manually into COMPLETED to simulate remediation from COMPLETED
    periodStore.get(periodId.toHexString())!.status =
      PayrollPeriodStatus.COMPLETED;

    // 1. Direct recalculation, batch retry, and direct FINALIZED all rejected (409) in COMPLETED
    await expect(
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: periodId.toHexString(),
          employeeId: healthyEmpId.toHexString(),
          recalculate: true,
        },
        actorId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    await expect(
      processingService.processPeriod(periodId, {}, actorId),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    await expect(
      periodsService.updateStatus(
        periodId,
        {
          status: PayrollPeriodStatus.FINALIZED,
          acknowledgeAnomalies: true,
          reason: 'Direct finalization bypass check',
        },
        actorId,
        [roleId],
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    // 2. Roll back COMPLETED -> PROCESSING
    const rolledBack = await periodsService.updateStatus(
      periodId,
      { status: PayrollPeriodStatus.PROCESSING, reason: 'Fix failures' },
      actorId,
      [roleId],
    );
    expect(rolledBack.status).toBe(PayrollPeriodStatus.PROCESSING);

    // 3. Failed calculation on EMP-F1 must NOT delete EMP-F1 failure doc
    await expect(
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: periodId.toHexString(),
          employeeId: failedEmp1Id.toHexString(),
          recalculate: true,
        },
        actorId,
      ),
    ).rejects.toMatchObject({
      statusCode: HttpStatus.NOT_FOUND,
    });
    expect(failureStore.size).toBe(2);

    // 4. Fix EMP-F1 salary assignment & compute via single-employee calculation
    assignments.push({
      _id: new Types.ObjectId(),
      employeeId: failedEmp1Id,
      salaryStructureId: structureId,
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
      effectiveTo: null,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 28000,
      salaryStructureVersion: 1,
      salarySnapshot: {} as EmployeeSalaryLean['salarySnapshot'],
      status: EmployeeSalaryStatus.ACTIVE,
      __v: 0,
    } as unknown as EmployeeSalaryLean);

    await calculationService.calculateAndPersistEmployeePayroll(
      {
        payrollPeriodId: periodId.toHexString(),
        employeeId: failedEmp1Id.toHexString(),
        recalculate: true,
      },
      actorId,
    );

    // EMP-F1 failure removed, EMP-F2 failure preserved
    expect(
      failureStore.has(
        `${periodId.toHexString()}:${failedEmp1Id.toHexString()}`,
      ),
    ).toBe(false);
    expect(
      failureStore.has(
        `${periodId.toHexString()}:${failedEmp2Id.toHexString()}`,
      ),
    ).toBe(true);
    expect(failureStore.size).toBe(1);

    const midStatus = await processingService.getProcessingStatus(periodId);
    expect(midStatus.failedEmployees).toBe(1);
    expect(midStatus.successfulEmployees).toBe(2);
    expect(midStatus.canComplete).toBe(false);

    // Fix EMP-F2 and run single-employee calculation -> clears remaining failure & makes period completable
    assignments.push({
      _id: new Types.ObjectId(),
      employeeId: failedEmp2Id,
      salaryStructureId: structureId,
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
      effectiveTo: null,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 32000,
      salaryStructureVersion: 1,
      salarySnapshot: {} as EmployeeSalaryLean['salarySnapshot'],
      status: EmployeeSalaryStatus.ACTIVE,
      __v: 0,
    } as unknown as EmployeeSalaryLean);

    await calculationService.calculateAndPersistEmployeePayroll(
      {
        payrollPeriodId: periodId.toHexString(),
        employeeId: failedEmp2Id.toHexString(),
        recalculate: true,
      },
      actorId,
    );
    expect(failureStore.size).toBe(0);

    const readyStatus = await processingService.getProcessingStatus(periodId);
    expect(readyStatus.failedEmployees).toBe(0);
    expect(readyStatus.successfulEmployees).toBe(3);
    expect(readyStatus.canComplete).toBe(true);

    // 5. PROCESSING -> COMPLETED succeeds
    const reCompleted = await periodsService.updateStatus(
      periodId,
      { status: PayrollPeriodStatus.COMPLETED },
      actorId,
      [roleId],
    );
    expect(reCompleted.status).toBe(PayrollPeriodStatus.COMPLETED);

    // 6. Period approved cleanly via POST /approve
    await reviewController.approvePeriod(
      periodId,
      { acknowledgeAnomalies: true, reason: 'Remediation verified & approved' },
      makeReq(),
    );

    // Tampering one record back to CALCULATED blocks FINALIZED (409)
    const firstRec = Array.from(recordStore.values())[0];
    const savedRecStatus = firstRec.status;
    firstRec.status = PayrollRecordStatus.CALCULATED;
    await expect(
      periodsService.updateStatus(
        periodId,
        {
          status: PayrollPeriodStatus.FINALIZED,
          acknowledgeAnomalies: true,
          reason: 'Should fail while CALCULATED record remains',
        },
        actorId,
        [roleId],
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    firstRec.status = savedRecStatus;

    // 7. APPROVED -> FINALIZED succeeds once all records are APPROVED + approval metadata intact
    const finalized = await periodsService.updateStatus(
      periodId,
      {
        status: PayrollPeriodStatus.FINALIZED,
        acknowledgeAnomalies: true,
        reason: 'Finalized after Step 6 approval',
      },
      actorId,
      [roleId],
    );
    expect(finalized.status).toBe(PayrollPeriodStatus.FINALIZED);
  });
});
