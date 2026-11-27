import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import {
  AuditLogsService,
  CreateAuditLogParams,
} from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { PayrollSettingsRepository } from '../../payroll-configuration/repositories/payroll-settings.repository';
import {
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodRepository } from '../../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../../payroll-periods/schemas/payroll-period.schema';
import { SalaryComponentLean } from '../../salary-components/schemas/salary-component.schema';
import { SalaryStructureLean } from '../../salary-structures/schemas/salary-structure.schema';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import {
  PAYROLL_PROCESSING_CONSTANTS,
  PayrollRecordStatus,
  toDecimal128,
} from '../constants/payroll-calculation.constant';
import {
  ListPayrollProcessingFailuresQueryDto,
  PayrollPeriodProcessingStatusResponseDto,
  PayrollProcessingFailureItemDto,
  ProcessPayrollPeriodDto,
} from '../dto/payroll-processing.dto';
import {
  PayrollProcessingFailureRepository,
  UpsertPayrollProcessingFailureItem,
} from '../repositories/payroll-processing-failure.repository';
import {
  CreatePayrollRecordInput,
  PayrollRecordRepository,
  RecalculatePayrollRecordInput,
} from '../repositories/payroll-record.repository';
import { computePayrollInputFingerprint } from '../utils/payroll-input-fingerprint.util';
import { PayrollCalculationService } from './payroll-calculation.service';
import {
  PayrollInputResolver,
  ResolvedPayrollInputs,
} from './payroll-input.resolver';
import {
  ResolvedStructureComponents,
  SalaryComponentResolver,
} from './salary-component.resolver';

interface VerificationReadinessSummary {
  totalEligibleEmployees: number;
  calculatedRecordsCount: number;
  staleEmployeeCodes: string[];
  unprocessedEmployeeCodes: string[];
  unresolvedFailuresCount: number;
  ineligibleRecordEmployeeIds: string[];
  isProcessingActive: boolean;
}

type ComputedEmployeeBatchItem =
  | {
      kind: 'COMPUTED';
      inputs: ResolvedPayrollInputs;
      calculated: Awaited<
        ReturnType<PayrollCalculationService['computeFromResolvedInputs']>
      >;
    }
  | {
      kind: 'CALC_FAILED';
      inputs: ResolvedPayrollInputs;
      errorCode: string;
      errorMessage: string;
    };

@Injectable()
export class PayrollProcessingService {
  private readonly logger = new Logger(PayrollProcessingService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly payrollPeriodRepository: PayrollPeriodRepository,
    private readonly payrollRecordRepository: PayrollRecordRepository,
    private readonly payrollProcessingFailureRepository: PayrollProcessingFailureRepository,
    private readonly payrollSettingsRepository: PayrollSettingsRepository,
    private readonly inputResolver: PayrollInputResolver,
    private readonly componentResolver: SalaryComponentResolver,
    private readonly calculationService: PayrollCalculationService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Starts or safely retries bounded batch payroll processing for a period.
   * - Idempotent: skips up-to-date CALCULATED records whose inputFingerprint matches live inputs.
   * - Auditable invalidation: marks CALCULATED records of employees who became ineligible/deleted as INVALIDATED while preserving snapshots and rejecting finalized/approved mutations.
   * - Fenced multi-document transactions: verifies activeRunId lock ownership inside every write transaction so stale workers cannot overwrite newer state.
   */
  async processPeriod(
    periodId: Types.ObjectId,
    dto: ProcessPayrollPeriodDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<PayrollPeriodProcessingStatusResponseDto> {
    const settingsDoc = await this.payrollSettingsRepository.findActive();
    if (settingsDoc && !settingsDoc.isPayrollProcessingEnabled) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Payroll processing is currently disabled in system payroll configuration.',
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date();
    const runId = new Types.ObjectId().toHexString();
    const staleCutoff = new Date(
      now.getTime() - PAYROLL_PROCESSING_CONSTANTS.LOCK_STALE_TIMEOUT_MS,
    );

    const lockedPeriod = await this.runInTransaction(async (session) => {
      const acquired = await this.payrollPeriodRepository.acquireProcessingLock(
        {
          periodId,
          runId,
          actorId,
          now,
          staleCutoff,
        },
        session,
      );
      if (!acquired) {
        return null;
      }

      await this.auditLogsService.createAuditLog(
        {
          actorId,
          action: AuditAction.PAYROLL_PROCESSING_STARTED,
          targetId: acquired._id,
          targetModel: AuditTargetModel.PAYROLL_PERIOD,
          details: {
            periodCode: acquired.periodCode,
            attemptNumber: acquired.processing?.processingAttempts ?? 1,
            runId,
          },
          ipAddress: clientMetadata?.ipAddress ?? null,
          userAgent: clientMetadata?.userAgent ?? null,
        },
        session,
      );

      return acquired;
    });

    if (!lockedPeriod) {
      await this.throwSpecificLockAcquisitionFailure(periodId);
    }

    const attemptNumber = lockedPeriod!.processing?.processingAttempts ?? 1;

    const batchSize =
      dto?.batchSize ?? PAYROLL_PROCESSING_CONSTANTS.DEFAULT_BATCH_SIZE;

    let totalEligibleEmployees = 0;
    let processedEmployees = 0;
    let successfulEmployees = 0;
    let failedEmployees = 0;
    let skippedUpToDateEmployees = 0;
    let recalculatedEmployees = 0;

    try {
      const context =
        await this.inputResolver.preparePeriodBatchContext(periodId);

      if (!context.isPayrollProcessingEnabled) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Payroll processing is disabled in system payroll configuration.',
          HttpStatus.CONFLICT,
        );
      }

      if (context.period.status === PayrollPeriodStatus.FINALIZED) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          `Payroll period '${context.period.periodCode}' is FINALIZED and locked. Processing is not permitted.`,
          HttpStatus.CONFLICT,
        );
      }

      const { eligibleTargets } = context;
      totalEligibleEmployees = eligibleTargets.length;
      const eligibleEmployeeIds = eligibleTargets.map((t) => t.employee._id);
      const eligibleIdSet = new Set(
        eligibleEmployeeIds.map((id) => id.toHexString()),
      );
      const ineligibleReasonByEmpId = new Map(
        context.ineligibleEmployees.map((e) => [e.employeeId, e.reason]),
      );

      // Reconcile ineligible/deleted records, historical audit logs, and orphan failures inside ONE fenced transaction
      const unresolvedFailureEmpIdSet = new Set<string>();

      await this.runInTransaction(async (session) => {
        const lockHeld = await this.payrollPeriodRepository.touchActiveRunLock(
          { periodId, runId, now: new Date() },
          session,
        );
        if (!lockHeld) {
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            `Payroll processing run '${runId}' lost active ownership of period '${context.period.periodCode}'.`,
            HttpStatus.CONFLICT,
          );
        }

        const [existingSummaries, existingFailedEmpIds] = await Promise.all([
          this.payrollRecordRepository.findActiveSummariesByPeriod(
            periodId,
            session,
          ),
          this.payrollProcessingFailureRepository.findEmployeeIdsByPeriod(
            periodId,
            session,
          ),
        ]);

        const ineligibleExisting = existingSummaries.filter(
          (rec) => !eligibleIdSet.has(rec.employeeId.toHexString()),
        );

        const committedRecords = ineligibleExisting.filter(
          (rec) => rec.status !== PayrollRecordStatus.CALCULATED,
        );
        if (committedRecords.length > 0) {
          const statuses = Array.from(
            new Set(committedRecords.map((r) => String(r.status))),
          ).join(', ');
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            `Cannot invalidate ${committedRecords.length} payroll record(s) for ineligible employee(s) in period '${context.period.periodCode}' because they are in immutable status (${statuses}). Explicit financial reconciliation is required.`,
            HttpStatus.CONFLICT,
            {
              periodId: periodId.toHexString(),
              immutableEmployeeIds: committedRecords.map((r) =>
                r.employeeId.toHexString(),
              ),
              statuses,
            },
          );
        }

        if (ineligibleExisting.length > 0) {
          const ineligibleEmpIds = ineligibleExisting.map((r) => r.employeeId);
          const fullIneligibleRecords =
            await this.payrollRecordRepository.findFullByPeriodAndEmployees(
              periodId,
              ineligibleEmpIds,
              session,
            );
          const fullByEmpId = new Map(
            fullIneligibleRecords.map((r) => [r.employeeId.toHexString(), r]),
          );

          const groupedByReason = new Map<string, Types.ObjectId[]>();
          const invalidatedAt = new Date();
          const invalidationAuditEntries: CreateAuditLogParams[] = [];

          for (const rec of ineligibleExisting) {
            const empIdStr = rec.employeeId.toHexString();
            const rawReason = ineligibleReasonByEmpId.get(empIdStr);
            const reason = rawReason
              ? `INELIGIBLE:${rawReason}`
              : 'EMPLOYEE_SOFT_DELETED_OR_MISSING';
            const list = groupedByReason.get(reason);
            if (list) {
              list.push(rec.employeeId);
            } else {
              groupedByReason.set(reason, [rec.employeeId]);
            }

            const fullRec = fullByEmpId.get(empIdStr);
            invalidationAuditEntries.push({
              actorId,
              action: AuditAction.PAYROLL_RECORD_INVALIDATED,
              targetId: rec._id,
              targetModel: AuditTargetModel.PAYROLL_RECORD,
              details: {
                reason,
                payrollPeriodId: periodId.toHexString(),
                periodCode: lockedPeriod!.periodCode,
                employeeId: empIdStr,
                employeeCode:
                  fullRec?.calculationSnapshot?.employeeCode ?? empIdStr,
                previousStatus: rec.status,
                previousCalculationVersion: rec.calculationVersion,
                previousInputFingerprint: rec.inputFingerprint ?? null,
                previousGrossEarnings:
                  fullRec?.grossEarnings?.toString() ?? null,
                previousTotalDeductions:
                  fullRec?.totalDeductions?.toString() ?? null,
                previousEmployerContributions:
                  fullRec?.employerContributions?.toString() ?? null,
                previousNetSalary: fullRec?.netSalary?.toString() ?? null,
                previousCalculationSnapshot:
                  fullRec?.calculationSnapshot ?? null,
                invalidatedAt: invalidatedAt.toISOString(),
                runId,
                attemptNumber,
              },
              ipAddress: clientMetadata?.ipAddress ?? null,
              userAgent: clientMetadata?.userAgent ?? null,
            });
          }

          let totalInvalidated = 0;
          for (const [reason, empIds] of groupedByReason.entries()) {
            const modifiedCount =
              await this.payrollRecordRepository.invalidateCalculatedByPeriodAndEmployees(
                {
                  payrollPeriodId: periodId,
                  employeeIds: empIds,
                  reason,
                  actorId,
                  invalidatedAt,
                },
                session,
              );
            totalInvalidated += modifiedCount;
          }

          if (
            totalInvalidated > 0 &&
            totalInvalidated === invalidationAuditEntries.length
          ) {
            await this.persistAuditLogsInSession(
              invalidationAuditEntries,
              session,
            );
          } else if (totalInvalidated > 0) {
            await this.persistAuditLogsInSession(
              invalidationAuditEntries.slice(0, totalInvalidated),
              session,
            );
          }
        }

        const hasOrphanFailures = existingFailedEmpIds.some(
          (id) => !eligibleIdSet.has(id.toHexString()),
        );
        if (hasOrphanFailures) {
          await this.payrollProcessingFailureRepository.deleteByPeriodExcludingEmployees(
            periodId,
            eligibleEmployeeIds,
            session,
          );
        }

        unresolvedFailureEmpIdSet.clear();
        for (const fEmpId of existingFailedEmpIds) {
          const hex = fEmpId.toHexString();
          if (eligibleIdSet.has(hex)) {
            unresolvedFailureEmpIdSet.add(hex);
          }
        }

        if (totalEligibleEmployees === 0) {
          const completed =
            await this.payrollPeriodRepository.completeProcessingRun(
              {
                periodId,
                runId,
                processingStatus: PayrollProcessingStatus.COMPLETED,
                totalEligibleEmployees: 0,
                processedEmployees: 0,
                successfulEmployees: 0,
                failedEmployees: 0,
                skippedUpToDateEmployees: 0,
                recalculatedEmployees: 0,
                completedAt: new Date(),
                lastErrorSummary: null,
              },
              session,
            );
          if (!completed) {
            throw new AppError(
              ErrorCode.CONCURRENT_MODIFICATION,
              `Payroll processing run '${runId}' lost active ownership of period '${context.period.periodCode}'.`,
              HttpStatus.CONFLICT,
            );
          }

          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.PAYROLL_PROCESSING_COMPLETED,
              targetId: periodId,
              targetModel: AuditTargetModel.PAYROLL_PERIOD,
              details: {
                periodCode: lockedPeriod!.periodCode,
                attemptNumber,
                runId,
                processingStatus: PayrollProcessingStatus.COMPLETED,
                totalEligibleEmployees: 0,
              },
              ipAddress: clientMetadata?.ipAddress ?? null,
              userAgent: clientMetadata?.userAgent ?? null,
            },
            session,
          );
        }
      });

      if (totalEligibleEmployees === 0) {
        return this.getProcessingStatus(periodId);
      }

      const structureCache = new Map<string, SalaryStructureLean>();
      const masterComponentCache = new Map<string, SalaryComponentLean>();
      const resolvedStructureCache = new Map<
        string,
        ResolvedStructureComponents
      >();

      for (
        let offset = 0;
        offset < eligibleTargets.length;
        offset += batchSize
      ) {
        // Chunk-boundary fast check before reading/computing chunk inputs
        const stillOwnsLock =
          await this.payrollPeriodRepository.verifyActiveRunOwnership(
            periodId,
            runId,
          );
        if (!stillOwnsLock) {
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            `Payroll processing run '${runId}' lost active ownership of period '${context.period.periodCode}'.`,
            HttpStatus.CONFLICT,
          );
        }

        const chunkTargets = eligibleTargets.slice(offset, offset + batchSize);
        const chunkResult = await this.inputResolver.resolveChunkWithContext(
          chunkTargets,
          context,
          structureCache,
        );

        await this.warmComponentCacheForResolvedInputs(
          chunkResult.resolved,
          masterComponentCache,
          resolvedStructureCache,
        );

        const resolvedEmpIds = chunkResult.resolved.map((r) => r.employee._id);
        const preExistingRecords =
          await this.payrollRecordRepository.findActiveByPeriodAndEmployees(
            periodId,
            resolvedEmpIds,
          );
        const preExistingByEmpId = new Map(
          preExistingRecords.map((r) => [r.employeeId.toHexString(), r]),
        );

        // Pure in-memory preparation (zero DB writes; skips full snapshot allocation when fingerprint already matches)
        const computedList = await this.runWithBoundedConcurrency(
          chunkResult.resolved,
          PAYROLL_PROCESSING_CONSTANTS.MAX_CONCURRENT_WRITES_PER_BATCH,
          async (inputs) => {
            const existing = preExistingByEmpId.get(
              inputs.employee._id.toHexString(),
            );
            if (
              existing &&
              existing.status === PayrollRecordStatus.CALCULATED
            ) {
              const preResolved = resolvedStructureCache.get(
                inputs.salaryStructure._id.toHexString(),
              );
              if (preResolved) {
                const fastFingerprint = computePayrollInputFingerprint(
                  inputs,
                  preResolved,
                );
                if (
                  existing.calculationSnapshot?.inputFingerprint ===
                  fastFingerprint
                ) {
                  return {
                    kind: 'PRE_MATCHED_SKIP' as const,
                    inputs,
                    expectedFingerprint: fastFingerprint,
                  };
                }
              }
            }
            return this.computeEmployeeInBatch(inputs, resolvedStructureCache);
          },
        );

        // Fenced atomic multi-collection write per batch
        const batchOutcome = await this.runInTransaction(async (session) => {
          const existingRecords =
            await this.payrollRecordRepository.findActiveByPeriodAndEmployees(
              periodId,
              resolvedEmpIds,
              session,
            );
          const existingRecordByEmpId = new Map(
            existingRecords.map((r) => [r.employeeId.toHexString(), r]),
          );

          const toCreate: CreatePayrollRecordInput[] = [];
          const toRecalc: Array<{
            id: Types.ObjectId;
            expectedVersion: number;
            employeeId: Types.ObjectId;
            employeeCode: string;
            employeeName: string;
            previousStatus: PayrollRecordStatus;
            previousCalculationVersion: number;
            previousInputFingerprint: string | null;
            previousGrossEarnings: string | null;
            previousTotalDeductions: string | null;
            previousEmployerContributions: string | null;
            previousNetSalary: string | null;
            previousInvalidatedAt: Date | null;
            previousInvalidationReason: string | null;
            input: RecalculatePayrollRecordInput;
            payableDays: number;
            totalLopDays: number;
            paidLeaveDays: number;
            unpaidLeaveDays: number;
            calendarDays: number;
          }> = [];
          const txSucceededIds: Types.ObjectId[] = [];
          const txFailures: UpsertPayrollProcessingFailureItem[] =
            chunkResult.failures.map((f) => ({
              employeeId: new Types.ObjectId(f.employeeId),
              employeeCode: f.employeeCode,
              employeeName: f.employeeName,
              errorCode: f.errorCode,
              errorMessage: f.message,
              attemptNumber,
              lastAttemptAt: new Date(),
            }));

          let batchCreated = 0;
          let batchRecalc = 0;
          let batchSkipped = 0;
          let batchFailed = txFailures.length;

          for (const item of computedList) {
            const emp = item.inputs.employee;
            const empName =
              `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() ||
              emp.employeeCode;
            const existingRecord = existingRecordByEmpId.get(
              emp._id.toHexString(),
            );

            let computedItem: ComputedEmployeeBatchItem;
            if (item.kind === 'PRE_MATCHED_SKIP') {
              if (
                existingRecord &&
                existingRecord.status === PayrollRecordStatus.CALCULATED &&
                existingRecord.calculationSnapshot?.inputFingerprint ===
                  item.expectedFingerprint
              ) {
                batchSkipped++;
                txSucceededIds.push(emp._id);
                continue;
              }
              computedItem = await this.computeEmployeeInBatch(
                item.inputs,
                resolvedStructureCache,
              );
            } else {
              computedItem = item;
            }

            if (computedItem.kind === 'CALC_FAILED') {
              batchFailed++;
              txFailures.push({
                employeeId: emp._id,
                employeeCode: emp.employeeCode,
                employeeName: empName,
                errorCode: computedItem.errorCode,
                errorMessage: computedItem.errorMessage,
                attemptNumber,
                lastAttemptAt: new Date(),
              });
              continue;
            }

            const { inputs, calculated } = computedItem;

            if (
              existingRecord &&
              existingRecord.status === PayrollRecordStatus.CALCULATED &&
              existingRecord.calculationSnapshot?.inputFingerprint ===
                calculated.inputFingerprint
            ) {
              batchSkipped++;
              txSucceededIds.push(emp._id);
              continue;
            }

            const precision = inputs.configuration.roundingPrecision;
            const grossEarnings = toDecimal128(
              calculated.totals.grossEarningsDec,
              precision,
            );
            const totalDeductions = toDecimal128(
              calculated.totals.totalDeductionsDec,
              precision,
            );
            const employerContributions = toDecimal128(
              calculated.totals.employerContributionsDec,
              precision,
            );
            const netSalary = toDecimal128(
              calculated.totals.netSalaryDec,
              precision,
            );

            if (existingRecord) {
              if (
                existingRecord.status !== PayrollRecordStatus.CALCULATED &&
                existingRecord.status !== PayrollRecordStatus.INVALIDATED
              ) {
                batchFailed++;
                txFailures.push({
                  employeeId: emp._id,
                  employeeCode: emp.employeeCode,
                  employeeName: empName,
                  errorCode: ErrorCode.CONCURRENT_MODIFICATION,
                  errorMessage: `Existing PayrollRecord is in immutable status '${String(existingRecord.status)}'.`,
                  attemptNumber,
                  lastAttemptAt: new Date(),
                });
                continue;
              }

              toRecalc.push({
                id: existingRecord._id,
                expectedVersion: existingRecord.__v ?? 0,
                employeeId: emp._id,
                employeeCode: emp.employeeCode,
                employeeName: empName,
                previousStatus: existingRecord.status,
                previousCalculationVersion: existingRecord.calculationVersion,
                previousInputFingerprint:
                  existingRecord.calculationSnapshot?.inputFingerprint ?? null,
                previousGrossEarnings:
                  existingRecord.grossEarnings?.toString() ?? null,
                previousTotalDeductions:
                  existingRecord.totalDeductions?.toString() ?? null,
                previousEmployerContributions:
                  existingRecord.employerContributions?.toString() ?? null,
                previousNetSalary: existingRecord.netSalary?.toString() ?? null,
                previousInvalidatedAt: existingRecord.invalidatedAt ?? null,
                previousInvalidationReason:
                  existingRecord.invalidationReason ?? null,
                input: {
                  salaryAssignmentId: inputs.salaryAssignment._id,
                  salaryStructureId: inputs.salaryStructure._id,
                  calculationSnapshot: calculated.snapshot,
                  grossEarnings,
                  totalDeductions,
                  employerContributions,
                  netSalary,
                  calculatedAt: calculated.calculatedAt,
                  updatedBy: actorId,
                },
                payableDays: inputs.payableDays,
                totalLopDays: inputs.leaveAndAttendance.totalLopDays,
                paidLeaveDays: inputs.leaveAndAttendance.paidLeaveDays,
                unpaidLeaveDays: inputs.leaveAndAttendance.unpaidLeaveDays,
                calendarDays: inputs.calendarDays,
              });
              continue;
            }

            toCreate.push({
              payrollPeriodId: periodId,
              employeeId: emp._id,
              salaryAssignmentId: inputs.salaryAssignment._id,
              salaryStructureId: inputs.salaryStructure._id,
              calculationSnapshot: calculated.snapshot,
              grossEarnings,
              totalDeductions,
              employerContributions,
              netSalary,
              status: PayrollRecordStatus.CALCULATED,
              calculatedAt: calculated.calculatedAt,
              calculationVersion: 1,
              createdBy: actorId,
              updatedBy: actorId,
            });
          }

          const failureIdsToDelete = txSucceededIds.filter((id) =>
            unresolvedFailureEmpIdSet.has(id.toHexString()),
          );
          const hasRecordOrFailureWrites =
            toCreate.length > 0 ||
            toRecalc.length > 0 ||
            failureIdsToDelete.length > 0 ||
            txFailures.length > 0;

          if (hasRecordOrFailureWrites) {
            const lockHeld =
              await this.payrollPeriodRepository.touchActiveRunLock(
                { periodId, runId, now: new Date() },
                session,
              );
            if (!lockHeld) {
              throw new AppError(
                ErrorCode.CONCURRENT_MODIFICATION,
                `Payroll processing run '${runId}' lost active ownership of period '${context.period.periodCode}'.`,
                HttpStatus.CONFLICT,
              );
            }
          }

          if (toCreate.length > 0) {
            await this.payrollRecordRepository.createMany(toCreate, session);
            batchCreated += toCreate.length;
            for (const c of toCreate) {
              txSucceededIds.push(c.employeeId);
            }
          }

          if (toRecalc.length > 0) {
            const fullPriorRecords =
              await this.payrollRecordRepository.findFullByPeriodAndEmployees(
                periodId,
                toRecalc.map((r) => r.employeeId),
                session,
              );
            const fullPriorByEmpId = new Map(
              fullPriorRecords.map((r) => [r.employeeId.toHexString(), r]),
            );
            const recalcAuditEntries: CreateAuditLogParams[] = [];

            for (const recalcItem of toRecalc) {
              const updated =
                await this.payrollRecordRepository.recalculateAtomically(
                  recalcItem.id,
                  recalcItem.expectedVersion,
                  recalcItem.input,
                  session,
                );
              if (!updated) {
                batchFailed++;
                txFailures.push({
                  employeeId: recalcItem.employeeId,
                  employeeCode: recalcItem.employeeCode,
                  employeeName: recalcItem.employeeName,
                  errorCode: ErrorCode.CONCURRENT_MODIFICATION,
                  errorMessage:
                    'Concurrent modification detected while recalculating employee payroll record.',
                  attemptNumber,
                  lastAttemptAt: new Date(),
                });
              } else {
                batchRecalc++;
                txSucceededIds.push(recalcItem.employeeId);
                const fullPrior = fullPriorByEmpId.get(
                  recalcItem.employeeId.toHexString(),
                );
                recalcAuditEntries.push({
                  actorId,
                  action: AuditAction.PAYROLL_CALCULATION_RECALCULATED,
                  targetId: updated._id,
                  targetModel: AuditTargetModel.PAYROLL_RECORD,
                  details: {
                    reason:
                      recalcItem.previousStatus ===
                      PayrollRecordStatus.INVALIDATED
                        ? (recalcItem.previousInvalidationReason ??
                          'REACTIVATED_AFTER_INVALIDATION')
                        : 'BATCH_STALE_RECALCULATION',
                    payrollPeriodId: periodId.toHexString(),
                    periodCode: context.period.periodCode,
                    employeeId: recalcItem.employeeId.toHexString(),
                    employeeCode: recalcItem.employeeCode,
                    calculationVersion: updated.calculationVersion,
                    previousStatus: recalcItem.previousStatus,
                    previousCalculationVersion:
                      recalcItem.previousCalculationVersion,
                    previousInputFingerprint:
                      recalcItem.previousInputFingerprint,
                    previousGrossEarnings: recalcItem.previousGrossEarnings,
                    previousTotalDeductions: recalcItem.previousTotalDeductions,
                    previousEmployerContributions:
                      recalcItem.previousEmployerContributions,
                    previousNetSalary: recalcItem.previousNetSalary,
                    previousInvalidatedAt:
                      recalcItem.previousInvalidatedAt instanceof Date
                        ? recalcItem.previousInvalidatedAt.toISOString()
                        : (recalcItem.previousInvalidatedAt ?? null),
                    previousInvalidationReason:
                      recalcItem.previousInvalidationReason,
                    previousCalculationSnapshot:
                      fullPrior?.calculationSnapshot ?? null,
                    payableDays: recalcItem.payableDays,
                    totalLopDays: recalcItem.totalLopDays,
                    paidLeaveDays: recalcItem.paidLeaveDays,
                    unpaidLeaveDays: recalcItem.unpaidLeaveDays,
                    calendarDays: recalcItem.calendarDays,
                    netSalary: updated.netSalary.toString(),
                    runId,
                    attemptNumber,
                  },
                  ipAddress: clientMetadata?.ipAddress ?? null,
                  userAgent: clientMetadata?.userAgent ?? null,
                });
              }
            }

            if (recalcAuditEntries.length > 0) {
              await this.persistAuditLogsInSession(recalcAuditEntries, session);
            }
          }

          const actualFailureIdsToDelete = txSucceededIds.filter((id) =>
            unresolvedFailureEmpIdSet.has(id.toHexString()),
          );
          if (actualFailureIdsToDelete.length > 0) {
            await this.payrollProcessingFailureRepository.deleteByPeriodAndEmployees(
              periodId,
              actualFailureIdsToDelete,
              session,
            );
          }
          if (txFailures.length > 0) {
            await this.payrollProcessingFailureRepository.upsertFailuresBulk(
              periodId,
              txFailures,
              session,
            );
          }

          const nextSuccessful =
            successfulEmployees + batchCreated + batchRecalc + batchSkipped;
          const nextFailed = failedEmployees + batchFailed;
          const nextSkipped = skippedUpToDateEmployees + batchSkipped;
          const nextRecalc = recalculatedEmployees + batchRecalc;
          const nextProcessed = processedEmployees + chunkTargets.length;

          const lockUpdated =
            await this.payrollPeriodRepository.updateProcessingProgress(
              {
                periodId,
                runId,
                totalEligibleEmployees,
                processedEmployees: nextProcessed,
                successfulEmployees: nextSuccessful,
                failedEmployees: nextFailed,
                skippedUpToDateEmployees: nextSkipped,
                recalculatedEmployees: nextRecalc,
                heartbeatAt: new Date(),
              },
              session,
            );

          if (!lockUpdated) {
            throw new AppError(
              ErrorCode.CONCURRENT_MODIFICATION,
              `Payroll processing run '${runId}' lost active ownership of period '${context.period.periodCode}'.`,
              HttpStatus.CONFLICT,
            );
          }

          return {
            nextProcessed,
            nextSuccessful,
            nextFailed,
            nextSkipped,
            nextRecalc,
            clearedFailureIds: actualFailureIdsToDelete.map((id) =>
              id.toHexString(),
            ),
            addedFailureIds: txFailures.map((f) => f.employeeId.toHexString()),
          };
        });

        processedEmployees = batchOutcome.nextProcessed;
        successfulEmployees = batchOutcome.nextSuccessful;
        failedEmployees = batchOutcome.nextFailed;
        skippedUpToDateEmployees = batchOutcome.nextSkipped;
        recalculatedEmployees = batchOutcome.nextRecalc;
        for (const idStr of batchOutcome.clearedFailureIds) {
          unresolvedFailureEmpIdSet.delete(idStr);
        }
        for (const idStr of batchOutcome.addedFailureIds) {
          unresolvedFailureEmpIdSet.add(idStr);
        }
      }

      await this.runInTransaction(async (session) => {
        const lockHeld = await this.payrollPeriodRepository.touchActiveRunLock(
          { periodId, runId, now: new Date() },
          session,
        );
        if (!lockHeld) {
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            `Payroll processing run '${runId}' lost active ownership of period '${context.period.periodCode}'.`,
            HttpStatus.CONFLICT,
          );
        }

        const finalFailedCount =
          await this.payrollProcessingFailureRepository.countByPeriod(
            periodId,
            session,
          );

        let finalStatus:
          | PayrollProcessingStatus.COMPLETED
          | PayrollProcessingStatus.COMPLETED_WITH_ERRORS
          | PayrollProcessingStatus.FAILED;
        let lastErrorSummary: string | null = null;

        if (
          finalFailedCount === 0 &&
          successfulEmployees === totalEligibleEmployees
        ) {
          finalStatus = PayrollProcessingStatus.COMPLETED;
        } else if (successfulEmployees > 0) {
          finalStatus = PayrollProcessingStatus.COMPLETED_WITH_ERRORS;
          lastErrorSummary = `${finalFailedCount} of ${totalEligibleEmployees} eligible employee(s) failed calculation. Review processing failures and retry.`;
        } else {
          finalStatus = PayrollProcessingStatus.FAILED;
          lastErrorSummary = `All ${totalEligibleEmployees} eligible employee(s) failed payroll calculation.`;
        }

        const completedAt = new Date();
        const completed =
          await this.payrollPeriodRepository.completeProcessingRun(
            {
              periodId,
              runId,
              processingStatus: finalStatus,
              totalEligibleEmployees,
              processedEmployees,
              successfulEmployees,
              failedEmployees: finalFailedCount,
              skippedUpToDateEmployees,
              recalculatedEmployees,
              completedAt,
              lastErrorSummary: lastErrorSummary
                ? sanitizeSummary(lastErrorSummary)
                : null,
            },
            session,
          );

        if (!completed) {
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            `Payroll processing run '${runId}' lost active ownership of period '${context.period.periodCode}'.`,
            HttpStatus.CONFLICT,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action:
              finalStatus === PayrollProcessingStatus.FAILED
                ? AuditAction.PAYROLL_PROCESSING_FAILED
                : AuditAction.PAYROLL_PROCESSING_COMPLETED,
            targetId: periodId,
            targetModel: AuditTargetModel.PAYROLL_PERIOD,
            details: {
              periodCode: lockedPeriod!.periodCode,
              attemptNumber,
              runId,
              processingStatus: finalStatus,
              totalEligibleEmployees,
              processedEmployees,
              successfulEmployees,
              failedEmployees: finalFailedCount,
              skippedUpToDateEmployees,
              recalculatedEmployees,
            },
            ipAddress: clientMetadata?.ipAddress ?? null,
            userAgent: clientMetadata?.userAgent ?? null,
          },
          session,
        );
      });

      return this.getProcessingStatus(periodId);
    } catch (error: unknown) {
      const sanitizedErr = sanitizeSummary(
        error instanceof Error ? error.message : 'Unexpected processing error',
      );
      this.logger.error(
        `Payroll processing failed for period '${periodId.toString()}': ${sanitizedErr}`,
      );

      await this.runInTransaction(async (session) => {
        const failedRun =
          await this.payrollPeriodRepository.completeProcessingRun(
            {
              periodId,
              runId,
              processingStatus: PayrollProcessingStatus.FAILED,
              totalEligibleEmployees,
              processedEmployees,
              successfulEmployees,
              failedEmployees: Math.max(
                failedEmployees,
                totalEligibleEmployees - successfulEmployees,
              ),
              skippedUpToDateEmployees,
              recalculatedEmployees,
              completedAt: new Date(),
              lastErrorSummary: sanitizedErr,
            },
            session,
          );

        if (failedRun) {
          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.PAYROLL_PROCESSING_FAILED,
              targetId: periodId,
              targetModel: AuditTargetModel.PAYROLL_PERIOD,
              details: {
                periodCode: lockedPeriod!.periodCode,
                attemptNumber,
                runId,
                error: sanitizedErr,
              },
              ipAddress: clientMetadata?.ipAddress ?? null,
              userAgent: clientMetadata?.userAgent ?? null,
            },
            session,
          );
        }
      }).catch(() => undefined);

      throw error;
    }
  }

  /**
   * Returns accurate live payroll processing status, stale counts, failures, and completion eligibility.
   */
  async getProcessingStatus(
    periodId: Types.ObjectId,
  ): Promise<PayrollPeriodProcessingStatusResponseDto> {
    const period = await this.payrollPeriodRepository.findById(periodId);
    if (!period) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const readiness = await this.inspectPeriodReadiness(period);
    const proc = period.processing;
    const isProcessingActive = readiness.isProcessingActive;
    const processingStatus =
      proc?.processingStatus ?? PayrollProcessingStatus.NOT_STARTED;

    const totalEligible = readiness.totalEligibleEmployees;
    const staleCount = readiness.staleEmployeeCodes.length;
    const unprocessedCount = readiness.unprocessedEmployeeCodes.length;
    const failedCount = readiness.unresolvedFailuresCount;
    const currentSuccessful = Math.max(
      0,
      readiness.calculatedRecordsCount - staleCount,
    );
    const remainingEmployees = Math.max(0, totalEligible - currentSuccessful);

    const canRetry =
      !isProcessingActive &&
      (period.status === PayrollPeriodStatus.DRAFT ||
        period.status === PayrollPeriodStatus.PROCESSING) &&
      (failedCount > 0 || unprocessedCount > 0 || staleCount > 0);

    const canComplete =
      !isProcessingActive &&
      period.status === PayrollPeriodStatus.PROCESSING &&
      unprocessedCount === 0 &&
      staleCount === 0 &&
      failedCount === 0 &&
      readiness.ineligibleRecordEmployeeIds.length === 0;

    return {
      payrollPeriodId: period._id.toHexString(),
      periodCode: period.periodCode,
      periodStatus: period.status,
      processingStatus,
      totalEligibleEmployees: totalEligible,
      processedEmployees:
        proc?.processedEmployees ?? currentSuccessful + failedCount,
      successfulEmployees: currentSuccessful,
      failedEmployees: failedCount,
      remainingEmployees,
      staleEmployees: staleCount,
      skippedUpToDateEmployees: proc?.skippedUpToDateEmployees ?? 0,
      recalculatedEmployees: proc?.recalculatedEmployees ?? 0,
      processingAttempts: proc?.processingAttempts ?? 0,
      startedAt:
        proc?.startedAt instanceof Date
          ? proc.startedAt.toISOString()
          : proc?.startedAt
            ? String(proc.startedAt)
            : null,
      completedAt:
        proc?.completedAt instanceof Date
          ? proc.completedAt.toISOString()
          : proc?.completedAt
            ? String(proc.completedAt)
            : null,
      lastAttemptAt:
        proc?.lastAttemptAt instanceof Date
          ? proc.lastAttemptAt.toISOString()
          : proc?.lastAttemptAt
            ? String(proc.lastAttemptAt)
            : null,
      lastErrorSummary: proc?.lastErrorSummary ?? null,
      canRetry,
      canComplete,
    };
  }

  async getProcessingFailures(
    periodId: Types.ObjectId,
    query: ListPayrollProcessingFailuresQueryDto,
  ): Promise<PaginatedResult<PayrollProcessingFailureItemDto>> {
    const period = await this.payrollPeriodRepository.findById(periodId);
    if (!period) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const result =
      await this.payrollProcessingFailureRepository.findPaginatedByPeriod(
        periodId,
        query.page ?? 1,
        query.limit ?? 20,
      );

    return {
      data: result.data.map((item) => ({
        employeeId: item.employeeId.toHexString(),
        employeeCode: item.employeeCode,
        employeeName: item.employeeName,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        attemptNumber: item.attemptNumber,
        lastAttemptAt:
          item.lastAttemptAt instanceof Date
            ? item.lastAttemptAt.toISOString()
            : String(item.lastAttemptAt),
      })),
      meta: result.meta,
    };
  }

  /**
   * Authoritative completion & finalization readiness gate invoked by PayrollPeriodsService.
   * Ensures all eligible employees have valid, current (non-stale) PayrollRecords, zero unresolved failures,
   * consistent counters, and no active processing lock.
   */
  async verifyPeriodCompletionReadiness(
    period: PayrollPeriodLean,
  ): Promise<void> {
    const readiness = await this.inspectPeriodReadiness(period);

    if (readiness.isProcessingActive) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Cannot complete payroll period '${period.periodCode}' while batch payroll processing is actively running.`,
        HttpStatus.CONFLICT,
      );
    }

    const hasIncompleteOrInvalidRecords =
      readiness.unprocessedEmployeeCodes.length > 0 ||
      readiness.staleEmployeeCodes.length > 0 ||
      readiness.unresolvedFailuresCount > 0 ||
      readiness.ineligibleRecordEmployeeIds.length > 0;

    if (hasIncompleteOrInvalidRecords) {
      const cap = PAYROLL_PROCESSING_CONSTANTS.MAX_FAILURE_SAMPLE_IN_CONFLICT;
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Cannot mark payroll period '${period.periodCode}' ready: ${readiness.unprocessedEmployeeCodes.length} unprocessed, ${readiness.staleEmployeeCodes.length} stale, ${readiness.unresolvedFailuresCount} failed, ${readiness.ineligibleRecordEmployeeIds.length} ineligible record(s). Process or retry the period first.`,
        HttpStatus.CONFLICT,
        {
          totalEligibleEmployees: readiness.totalEligibleEmployees,
          unprocessedCount: readiness.unprocessedEmployeeCodes.length,
          staleCount: readiness.staleEmployeeCodes.length,
          unresolvedFailuresCount: readiness.unresolvedFailuresCount,
          ineligibleRecordsCount: readiness.ineligibleRecordEmployeeIds.length,
          sampleUnprocessedEmployeeCodes:
            readiness.unprocessedEmployeeCodes.slice(0, cap),
          sampleStaleEmployeeCodes: readiness.staleEmployeeCodes.slice(0, cap),
        },
      );
    }
  }

  private async inspectPeriodReadiness(
    period: PayrollPeriodLean,
  ): Promise<VerificationReadinessSummary> {
    const now = new Date();
    const staleCutoff = new Date(
      now.getTime() - PAYROLL_PROCESSING_CONSTANTS.LOCK_STALE_TIMEOUT_MS,
    );
    const proc = period.processing;
    const isProcessingActive =
      proc?.processingStatus === PayrollProcessingStatus.PROCESSING &&
      Boolean(
        (proc.heartbeatAt && proc.heartbeatAt >= staleCutoff) ||
        (!proc.heartbeatAt &&
          proc.lastAttemptAt &&
          proc.lastAttemptAt >= staleCutoff),
      );

    const [context, recordSummaries, unresolvedFailuresCount] =
      await Promise.all([
        this.inputResolver.preparePeriodBatchContext(period._id, {
          allowCompletedStatus: true,
        }),
        this.payrollRecordRepository.findActiveSummariesByPeriod(period._id),
        this.payrollProcessingFailureRepository.countByPeriod(period._id),
      ]);

    const recordByEmpId = new Map(
      recordSummaries.map((r) => [r.employeeId.toHexString(), r]),
    );
    const eligibleIdSet = new Set(
      context.eligibleTargets.map((t) => t.employee._id.toHexString()),
    );

    const ineligibleRecordEmployeeIds: string[] = [];
    for (const rec of recordSummaries) {
      const empIdStr = rec.employeeId.toHexString();
      if (!eligibleIdSet.has(empIdStr)) {
        ineligibleRecordEmployeeIds.push(empIdStr);
      }
    }

    const unprocessedEmployeeCodes: string[] = [];
    const staleEmployeeCodes: string[] = [];
    let calculatedRecordsCount = 0;

    if (context.eligibleTargets.length > 0) {
      const structureCache = new Map<string, SalaryStructureLean>();
      const masterComponentCache = new Map<string, SalaryComponentLean>();
      const resolvedStructureCache = new Map<
        string,
        ResolvedStructureComponents
      >();

      for (
        let offset = 0;
        offset < context.eligibleTargets.length;
        offset += PAYROLL_PROCESSING_CONSTANTS.MAX_BATCH_SIZE
      ) {
        const chunk = context.eligibleTargets.slice(
          offset,
          offset + PAYROLL_PROCESSING_CONSTANTS.MAX_BATCH_SIZE,
        );
        const chunkResult = await this.inputResolver.resolveChunkWithContext(
          chunk,
          context,
          structureCache,
        );

        await this.warmComponentCacheForResolvedInputs(
          chunkResult.resolved,
          masterComponentCache,
          resolvedStructureCache,
        );

        const resolvedByEmpId = new Map(
          chunkResult.resolved.map((r) => [r.employee._id.toHexString(), r]),
        );

        for (const target of chunk) {
          const empIdStr = target.employee._id.toHexString();
          const rec = recordByEmpId.get(empIdStr);
          if (!rec || rec.status !== PayrollRecordStatus.CALCULATED) {
            unprocessedEmployeeCodes.push(target.employee.employeeCode);
            continue;
          }

          calculatedRecordsCount++;
          const resolvedInputs = resolvedByEmpId.get(empIdStr);
          if (!resolvedInputs) {
            // Salary input resolution failed after record was calculated -> stale/invalid
            staleEmployeeCodes.push(target.employee.employeeCode);
            continue;
          }

          try {
            const compBundle = this.getResolvedStructureComponents(
              resolvedInputs.salaryStructure,
              masterComponentCache,
              resolvedStructureCache,
            );
            const expectedFingerprint = computePayrollInputFingerprint(
              resolvedInputs,
              compBundle,
            );
            if (rec.inputFingerprint !== expectedFingerprint) {
              staleEmployeeCodes.push(target.employee.employeeCode);
            }
          } catch {
            staleEmployeeCodes.push(target.employee.employeeCode);
          }
        }
      }
    }

    return {
      totalEligibleEmployees: context.eligibleTargets.length,
      calculatedRecordsCount,
      staleEmployeeCodes,
      unprocessedEmployeeCodes,
      unresolvedFailuresCount,
      ineligibleRecordEmployeeIds,
      isProcessingActive,
    };
  }

  private async runInTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(work);
    } finally {
      await session.endSession();
    }
  }

  private async persistAuditLogsInSession(
    entries: CreateAuditLogParams[],
    session: ClientSession,
  ): Promise<void> {
    if (entries.length === 0) return;
    if (typeof this.auditLogsService.createAuditLogsBulk === 'function') {
      await this.auditLogsService.createAuditLogsBulk(entries, session);
      return;
    }
    for (const entry of entries) {
      await this.auditLogsService.createAuditLog(entry, session);
    }
  }

  private async computeEmployeeInBatch(
    inputs: ResolvedPayrollInputs,
    resolvedStructureCache: Map<string, ResolvedStructureComponents>,
  ): Promise<ComputedEmployeeBatchItem> {
    try {
      const preResolvedComponents = resolvedStructureCache.get(
        inputs.salaryStructure._id.toHexString(),
      );
      const calculated =
        await this.calculationService.computeFromResolvedInputs(
          inputs,
          preResolvedComponents,
        );
      return { kind: 'COMPUTED', inputs, calculated };
    } catch (error: unknown) {
      return {
        kind: 'CALC_FAILED',
        inputs,
        errorCode:
          error instanceof AppError
            ? error.code
            : ErrorCode.INTERNAL_SERVER_ERROR,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unexpected employee payroll calculation error.',
      };
    }
  }

  private async warmComponentCacheForResolvedInputs(
    resolvedList: ResolvedPayrollInputs[],
    masterComponentCache: Map<string, SalaryComponentLean>,
    resolvedStructureCache: Map<string, ResolvedStructureComponents>,
  ): Promise<void> {
    const uncachedStructures: SalaryStructureLean[] = [];
    const seenIds = new Set<string>();

    for (const item of resolvedList) {
      const sId = item.salaryStructure._id.toHexString();
      if (!resolvedStructureCache.has(sId) && !seenIds.has(sId)) {
        seenIds.add(sId);
        uncachedStructures.push(item.salaryStructure);
      }
    }

    if (uncachedStructures.length === 0) return;

    const missingCompIds: SalaryStructureLean[] = [];
    for (const struct of uncachedStructures) {
      const needsFetch = struct.components.some(
        (c) => !masterComponentCache.has(c.componentId.toString()),
      );
      if (needsFetch) {
        missingCompIds.push(struct);
      }
    }

    if (missingCompIds.length > 0) {
      const fetchedMap =
        await this.componentResolver.fetchMasterMapForStructures(
          missingCompIds,
        );
      for (const [id, comp] of fetchedMap.entries()) {
        masterComponentCache.set(id, comp);
      }
    }

    for (const struct of uncachedStructures) {
      try {
        this.getResolvedStructureComponents(
          struct,
          masterComponentCache,
          resolvedStructureCache,
        );
      } catch {
        // Isolate invalid structures to per-employee batch error handling
      }
    }
  }

  private getResolvedStructureComponents(
    structure: SalaryStructureLean,
    masterComponentCache: Map<string, SalaryComponentLean>,
    resolvedStructureCache: Map<string, ResolvedStructureComponents>,
  ): ResolvedStructureComponents {
    const key = structure._id.toHexString();
    const cached = resolvedStructureCache.get(key);
    if (cached) return cached;

    const resolved = this.componentResolver.resolveWithMasterMap(
      structure,
      masterComponentCache,
    );
    resolvedStructureCache.set(key, resolved);
    return resolved;
  }

  private async runWithBoundedConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex++;
          results[currentIndex] = await worker(items[currentIndex]);
        }
      }),
    );

    return results;
  }

  private async throwSpecificLockAcquisitionFailure(
    periodId: Types.ObjectId,
  ): Promise<never> {
    const existing = await this.payrollPeriodRepository.findById(periodId);
    if (!existing || existing.deletedAt !== null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Payroll period '${periodId.toString()}' not found.`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.status === PayrollPeriodStatus.FINALIZED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${existing.periodCode}' is FINALIZED and locked. Processing is not permitted.`,
        HttpStatus.CONFLICT,
      );
    }

    if (existing.status === PayrollPeriodStatus.COMPLETED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${existing.periodCode}' is already COMPLETED. Transition it back to PROCESSING before reprocessing.`,
        HttpStatus.CONFLICT,
      );
    }

    if (
      existing.processing?.processingStatus ===
      PayrollProcessingStatus.PROCESSING
    ) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll processing is already in progress for period '${existing.periodCode}'.`,
        HttpStatus.CONFLICT,
      );
    }

    throw new AppError(
      ErrorCode.CONCURRENT_MODIFICATION,
      `Payroll period '${existing.periodCode}' is in '${existing.status}' status and cannot acquire processing lock.`,
      HttpStatus.CONFLICT,
    );
  }
}

function sanitizeSummary(message: string): string {
  const clean = message
    .replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, '[REDACTED_URI]')
    .replace(/\s+/g, ' ')
    .trim();
  const max = PAYROLL_PROCESSING_CONSTANTS.MAX_LAST_ERROR_SUMMARY_LENGTH;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}
