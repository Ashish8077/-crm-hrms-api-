import { HttpStatus, Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { Decimal, toDecimal } from '../../../common/utils/financial-math.util';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { PAYROLL_CONFIGURATION_DEFAULTS } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollCalculationRuleRepository } from '../../payroll-configuration/repositories/payroll-calculation-rule.repository';
import { PayrollSettingsRepository } from '../../payroll-configuration/repositories/payroll-settings.repository';
import {
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodMapper } from '../../payroll-periods/mappers/payroll-period.mapper';
import { PayrollPeriodRepository } from '../../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../../payroll-periods/schemas/payroll-period.schema';
import { PayrollPeriodsService } from '../../payroll-periods/services/payroll-periods.service';
import {
  PayrollRecordStatus,
  decimal128ToString,
} from '../constants/payroll-calculation.constant';
import {
  ApprovePayrollPeriodDto,
  ApprovePayrollPeriodResponseDto,
  ListPayrollReviewRecordsQueryDto,
  PayrollReviewAttentionEmployeeDto,
  PayrollReviewRecordDetailResponseDto,
  PayrollReviewRecordListItemDto,
  PayrollReviewSummaryResponseDto,
} from '../dto/payroll-review.dto';
import { PayrollCalculationMapper } from '../mappers/payroll-calculation.mapper';
import { PayrollProcessingFailureRepository } from '../repositories/payroll-processing-failure.repository';
import { PayrollRecordRepository } from '../repositories/payroll-record.repository';
import { PayrollProcessingService } from './payroll-processing.service';

const MAX_ATTENTION_ITEMS = 50;

@Injectable()
export class PayrollReviewService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly payrollPeriodRepository: PayrollPeriodRepository,
    private readonly payrollRecordRepository: PayrollRecordRepository,
    private readonly payrollProcessingFailureRepository: PayrollProcessingFailureRepository,
    private readonly payrollSettingsRepository: PayrollSettingsRepository,
    private readonly payrollCalculationRuleRepository: PayrollCalculationRuleRepository,
    private readonly payrollProcessingService: PayrollProcessingService,
    @Inject(forwardRef(() => PayrollPeriodsService))
    private readonly payrollPeriodsService: PayrollPeriodsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getReviewSummary(
    periodId: Types.ObjectId,
  ): Promise<PayrollReviewSummaryResponseDto> {
    const period = await this.requirePeriod(periodId);

    const [
      readiness,
      anomalies,
      aggregated,
      failuresPage,
      settingsDoc,
      ruleDoc,
    ] = await Promise.all([
      this.payrollProcessingService.getPeriodReadinessReport(period),
      this.payrollPeriodsService.evaluatePeriodAnomalies(period, {
        enforceGate: false,
      }),
      this.payrollRecordRepository.aggregateReviewSummary(periodId),
      this.payrollProcessingFailureRepository.findPaginatedByPeriod(
        periodId,
        1,
        20,
      ),
      this.payrollSettingsRepository.findActive(),
      this.payrollCalculationRuleRepository.findActive(),
    ]);

    const precision =
      ruleDoc?.roundingPrecision ??
      PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION;
    const currency =
      settingsDoc?.currency ?? PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY;

    const grossStr = this.formatMoney(aggregated.totalGrossEarnings, precision);
    const dedStr = this.formatMoney(aggregated.totalDeductions, precision);
    const erStr = this.formatMoney(
      aggregated.totalEmployerContributions,
      precision,
    );
    const netStr = this.formatMoney(aggregated.totalNetSalary, precision);
    const employerCostStr = toDecimal(grossStr)
      .plus(toDecimal(erStr))
      .toDecimalPlaces(precision, Decimal.ROUND_HALF_EVEN)
      .toFixed(precision);

    const attention: PayrollReviewAttentionEmployeeDto[] = [];
    for (const fail of failuresPage.data) {
      if (attention.length >= MAX_ATTENTION_ITEMS) break;
      attention.push({
        employeeId: fail.employeeId.toHexString(),
        employeeCode: fail.employeeCode,
        employeeName: fail.employeeName,
        issueType: 'PROCESSING_FAILURE',
        severity: 'BLOCKING',
        message: fail.errorMessage,
        codes: [fail.errorCode],
      });
    }
    for (const empIdStr of readiness.ineligibleRecordEmployeeIds) {
      if (attention.length >= MAX_ATTENTION_ITEMS) break;
      attention.push({
        employeeId: empIdStr,
        employeeCode: empIdStr,
        employeeName: null,
        issueType: 'INELIGIBLE_ACTIVE_RECORD',
        severity: 'BLOCKING',
        message:
          'Active PayrollRecord belongs to an ineligible or deleted employee and must be reconciled.',
        codes: ['INELIGIBLE_ACTIVE_RECORD'],
      });
    }
    for (const code of readiness.staleEmployeeCodes) {
      if (attention.length >= MAX_ATTENTION_ITEMS) break;
      attention.push({
        employeeId: null,
        employeeCode: code,
        employeeName: null,
        issueType: 'STALE_RECORD',
        severity: 'BLOCKING',
        message:
          'Employee salary, attendance, or leave inputs changed after payroll calculation.',
        codes: ['STALE_PAYROLL_RECORD'],
      });
    }
    for (const code of readiness.unprocessedEmployeeCodes) {
      if (attention.length >= MAX_ATTENTION_ITEMS) break;
      attention.push({
        employeeId: null,
        employeeCode: code,
        employeeName: null,
        issueType: 'UNPROCESSED',
        severity: 'BLOCKING',
        message: 'Eligible employee does not have a valid calculated record.',
        codes: ['UNPROCESSED_EMPLOYEE'],
      });
    }
    for (const finding of anomalies.blockingFindings) {
      if (attention.length >= MAX_ATTENTION_ITEMS) break;
      attention.push({
        employeeId: finding.employeeId,
        employeeCode: finding.employeeCode,
        employeeName: null,
        issueType: 'BLOCKING_ANOMALY',
        severity: 'BLOCKING',
        message: `Unresolved leave/attendance conflict(s): ${finding.warnings.join(', ')}`,
        codes: finding.warnings,
      });
    }
    for (const finding of anomalies.reviewableFindings) {
      if (attention.length >= MAX_ATTENTION_ITEMS) break;
      attention.push({
        employeeId: finding.employeeId,
        employeeCode: finding.employeeCode,
        employeeName: null,
        issueType: 'REVIEWABLE_ANOMALY',
        severity: 'WARNING',
        message: `Attendance/leave anomaly notice: ${finding.warnings.join(', ')}`,
        codes: finding.warnings,
      });
    }

    const blockingReasons: string[] = [];
    if (period.status === PayrollPeriodStatus.FINALIZED) {
      blockingReasons.push('Period is FINALIZED and locked.');
    } else if (period.status === PayrollPeriodStatus.APPROVED) {
      blockingReasons.push('Period is already APPROVED.');
    } else if (period.status !== PayrollPeriodStatus.COMPLETED) {
      blockingReasons.push(
        `Period must be in COMPLETED status before approval (current: ${period.status}).`,
      );
    }
    if (readiness.isProcessingActive) {
      blockingReasons.push('Batch payroll processing is currently active.');
    }
    if (readiness.unprocessedEmployeeCodes.length > 0) {
      blockingReasons.push(
        `${readiness.unprocessedEmployeeCodes.length} eligible employee(s) lack a calculated PayrollRecord.`,
      );
    }
    if (readiness.staleEmployeeCodes.length > 0) {
      blockingReasons.push(
        `${readiness.staleEmployeeCodes.length} employee(s) have stale PayrollRecords requiring recalculation.`,
      );
    }
    if (readiness.unresolvedFailuresCount > 0) {
      blockingReasons.push(
        `${readiness.unresolvedFailuresCount} unresolved processing failure(s) remain.`,
      );
    }
    if (readiness.ineligibleRecordEmployeeIds.length > 0) {
      blockingReasons.push(
        `${readiness.ineligibleRecordEmployeeIds.length} active PayrollRecord(s) belong to ineligible employees.`,
      );
    }
    if (anomalies.blockingFindings.length > 0) {
      blockingReasons.push(
        `${anomalies.blockingFindings.length} employee(s) have hard-blocking leave/attendance conflicts (${anomalies.distinctBlockingCodes.join(', ')}).`,
      );
    }

    const mappedPeriod = PayrollPeriodMapper.toResponse(period);

    return {
      period: {
        id: mappedPeriod.id,
        periodCode: mappedPeriod.periodCode,
        periodName: mappedPeriod.periodName,
        payrollFrequency: mappedPeriod.payrollFrequency,
        startDate: mappedPeriod.startDate,
        endDate: mappedPeriod.endDate,
        paymentDate: mappedPeriod.paymentDate,
        month: mappedPeriod.month,
        year: mappedPeriod.year,
        version: mappedPeriod.version,
      },
      periodStatus: period.status,
      processingStatus:
        period.processing?.processingStatus ??
        PayrollProcessingStatus.NOT_STARTED,
      currency,
      totalEligibleEmployees: readiness.totalEligibleEmployees,
      totalCalculatedEmployees:
        aggregated.calculatedCount + aggregated.approvedCount,
      totalApprovedEmployees: aggregated.approvedCount,
      totalPendingApprovalEmployees: aggregated.calculatedCount,
      totalInvalidatedEmployees: aggregated.invalidatedCount,
      totalProcessingFailures: readiness.unresolvedFailuresCount,
      totalGrossEarnings: grossStr,
      totalEmployeeDeductions: dedStr,
      totalNetSalary: netStr,
      totalEmployerContributions: erStr,
      totalEmployerCost: employerCostStr,
      employeesRequiringAttention: attention,
      readiness: {
        isProcessingActive: readiness.isProcessingActive,
        unprocessedCount: readiness.unprocessedEmployeeCodes.length,
        staleCount: readiness.staleEmployeeCodes.length,
        unresolvedFailuresCount: readiness.unresolvedFailuresCount,
        ineligibleRecordsCount: readiness.ineligibleRecordEmployeeIds.length,
        hasBlockingAnomalies: anomalies.blockingFindings.length > 0,
        reviewableAnomalyCount: anomalies.reviewableFindings.length,
        blockingWarningCodes: anomalies.distinctBlockingCodes,
        reviewableWarningCodes: anomalies.distinctReviewableCodes,
      },
      approvalEligibility: {
        canApprove: blockingReasons.length === 0,
        alreadyApproved: period.status === PayrollPeriodStatus.APPROVED,
        requiresAnomalyAcknowledgment: anomalies.reviewableFindings.length > 0,
        blockingReasons,
      },
      approval:
        (mappedPeriod.approval as Record<string, unknown> | null) ?? null,
    };
  }

  async listPeriodRecords(
    periodId: Types.ObjectId,
    query: ListPayrollReviewRecordsQueryDto,
  ): Promise<PaginatedResult<PayrollReviewRecordListItemDto>> {
    await this.requirePeriod(periodId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [ruleDoc, result] = await Promise.all([
      this.payrollCalculationRuleRepository.findActive(),
      this.payrollRecordRepository.findPaginatedForReview(periodId, {
        page,
        limit,
        search: query.search,
        departmentId: query.departmentId
          ? new Types.ObjectId(query.departmentId)
          : undefined,
        branchId: query.branchId
          ? new Types.ObjectId(query.branchId)
          : undefined,
        status: query.status,
        hasAnomalies: query.hasAnomalies,
      }),
    ]);

    const precision =
      ruleDoc?.roundingPrecision ??
      PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION;

    const data: PayrollReviewRecordListItemDto[] = result.data.map((row) => {
      const grossEarnings = this.formatMoney(
        decimal128ToString(row.grossEarnings),
        precision,
      );
      const employeeDeductions = this.formatMoney(
        decimal128ToString(row.totalDeductions),
        precision,
      );
      const employerContributions = this.formatMoney(
        decimal128ToString(row.employerContributions),
        precision,
      );
      const netSalary = this.formatMoney(
        decimal128ToString(row.netSalary),
        precision,
      );
      const employerCost = toDecimal(grossEarnings)
        .plus(toDecimal(employerContributions))
        .toDecimalPlaces(precision, Decimal.ROUND_HALF_EVEN)
        .toFixed(precision);

      return {
        id: row.id.toString(),
        employeeId: row.employeeId.toString(),
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        employmentStatus: row.employmentStatus,
        departmentId: row.departmentId ? row.departmentId.toString() : null,
        branchId: row.branchId ? row.branchId.toString() : null,
        status: row.status,
        grossEarnings,
        employeeDeductions,
        netSalary,
        employerContributions,
        employerCost,
        payableDays: row.payableDays,
        lopDays: row.totalLopDays,
        calculationVersion: row.calculationVersion,
        calculatedAt:
          row.calculatedAt instanceof Date
            ? row.calculatedAt.toISOString()
            : String(row.calculatedAt),
        approvedAt:
          row.approvedAt instanceof Date
            ? row.approvedAt.toISOString()
            : row.approvedAt
              ? String(row.approvedAt)
              : null,
        approvedBy: row.approvedBy ? row.approvedBy.toString() : null,
        invalidatedAt:
          row.invalidatedAt instanceof Date
            ? row.invalidatedAt.toISOString()
            : row.invalidatedAt
              ? String(row.invalidatedAt)
              : null,
        invalidationReason: row.invalidationReason ?? null,
        warnings: row.warnings ?? [],
        leaveAttendanceMismatchDates: row.leaveAttendanceMismatchDates ?? [],
      };
    });

    return {
      data,
      meta: buildPaginationMeta(result.total, page, limit),
    };
  }

  async getRecordDetails(
    periodId: Types.ObjectId,
    recordId: Types.ObjectId,
  ): Promise<PayrollReviewRecordDetailResponseDto> {
    await this.requirePeriod(periodId);

    const record = await this.payrollRecordRepository.findByIdAndPeriod(
      recordId,
      periodId,
    );
    if (!record) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Payroll record '${recordId.toString()}' not found in payroll period '${periodId.toString()}'.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const mapped = PayrollCalculationMapper.toRecordResponse(record);
    const precision = mapped.calculationSnapshot.roundingPrecision;
    const employerCost = toDecimal(mapped.grossEarnings)
      .plus(toDecimal(mapped.employerContributions))
      .toDecimalPlaces(precision, Decimal.ROUND_HALF_EVEN)
      .toFixed(precision);

    return {
      ...mapped,
      employerCost,
      approvedAt:
        record.approvedAt instanceof Date
          ? record.approvedAt.toISOString()
          : record.approvedAt
            ? String(record.approvedAt)
            : null,
      approvedBy: record.approvedBy ? record.approvedBy.toString() : null,
      invalidatedAt:
        record.invalidatedAt instanceof Date
          ? record.invalidatedAt.toISOString()
          : record.invalidatedAt
            ? String(record.invalidatedAt)
            : null,
      invalidatedBy: record.invalidatedBy
        ? record.invalidatedBy.toString()
        : null,
      invalidationReason: record.invalidationReason ?? null,
      warnings: mapped.calculationSnapshot.attendanceLeaveWarnings,
      leaveAttendanceMismatchDates:
        mapped.calculationSnapshot.leaveAttendanceMismatchDates,
    };
  }

  async approvePeriod(
    periodId: Types.ObjectId,
    dto: ApprovePayrollPeriodDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<ApprovePayrollPeriodResponseDto> {
    const period = await this.requirePeriod(periodId);

    if (period.status === PayrollPeriodStatus.FINALIZED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${period.periodCode}' is FINALIZED and locked. Approval is not permitted.`,
        HttpStatus.CONFLICT,
      );
    }

    if (period.status === PayrollPeriodStatus.APPROVED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${period.periodCode}' has already been approved. Duplicate approval is not permitted.`,
        HttpStatus.CONFLICT,
      );
    }

    if (period.status !== PayrollPeriodStatus.COMPLETED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${period.periodCode}' is in '${period.status}' status and must be COMPLETED before approval.`,
        HttpStatus.CONFLICT,
      );
    }

    if (dto.version !== undefined && dto.version !== period.__v) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payroll period '${period.periodCode}' was modified concurrently. Expected version ${period.__v}, but received ${dto.version}. Please refresh and try again.`,
        HttpStatus.CONFLICT,
      );
    }

    await this.payrollProcessingService.verifyPeriodCompletionReadiness(period);

    const anomalyReport =
      await this.payrollPeriodsService.evaluatePeriodAnomalies(period, {
        enforceGate: true,
        acknowledgeAnomalies: dto.acknowledgeAnomalies,
        reason: dto.reason,
        gateLabel: 'approve',
      });

    const [preTxRecords, ruleDoc] = await Promise.all([
      this.payrollRecordRepository.findActiveSummariesByPeriod(periodId),
      this.payrollCalculationRuleRepository.findActive(),
    ]);
    const precision =
      ruleDoc?.roundingPrecision ??
      PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION;

    const preTxByEmpId = new Map(
      preTxRecords.map((r) => [r.employeeId.toHexString(), r]),
    );
    const approvedAt = new Date();
    const expectedVersion = dto.version ?? period.__v;

    const txOutcome = await this.runInTransaction(async (session) => {
      const failuresCount =
        await this.payrollProcessingFailureRepository.countByPeriod(
          periodId,
          session,
        );
      if (failuresCount > 0) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          `Payroll period '${period.periodCode}' has ${failuresCount} unresolved failure(s). Resolve failures before approval.`,
          HttpStatus.CONFLICT,
        );
      }

      const activeInTx =
        await this.payrollRecordRepository.findActiveSummariesByPeriod(
          periodId,
          session,
        );

      if (activeInTx.length !== preTxRecords.length) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          `Payroll records for period '${period.periodCode}' changed concurrently during approval. Refresh review and retry.`,
          HttpStatus.CONFLICT,
        );
      }

      const toApproveIds: Types.ObjectId[] = [];
      let alreadyApprovedRecordsCount = 0;

      for (const rec of activeInTx) {
        const before = preTxByEmpId.get(rec.employeeId.toHexString());
        if (
          !before ||
          !before._id.equals(rec._id) ||
          before.status !== rec.status ||
          before.calculationVersion !== rec.calculationVersion ||
          before.inputFingerprint !== rec.inputFingerprint
        ) {
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            `Payroll calculation for period '${period.periodCode}' changed concurrently after review. Refresh review and retry.`,
            HttpStatus.CONFLICT,
          );
        }

        if (rec.status === PayrollRecordStatus.CALCULATED) {
          toApproveIds.push(rec._id);
        } else if (rec.status === PayrollRecordStatus.APPROVED) {
          alreadyApprovedRecordsCount++;
        } else {
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            `Unexpected record status '${String(rec.status)}' encountered during approval.`,
            HttpStatus.CONFLICT,
          );
        }
      }

      if (toApproveIds.length > 0) {
        const updateRes =
          await this.payrollRecordRepository.approveCalculatedRecordsByIds(
            {
              payrollPeriodId: periodId,
              recordIds: toApproveIds,
              actorId,
              approvedAt,
            },
            session,
          );

        if (updateRes.modifiedCount !== toApproveIds.length) {
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            `Concurrent modification detected while approving payroll records for period '${period.periodCode}'.`,
            HttpStatus.CONFLICT,
          );
        }
      }

      const aggregated =
        await this.payrollRecordRepository.aggregateReviewSummary(
          periodId,
          session,
        );
      const totalGrossEarnings = this.formatMoney(
        aggregated.totalGrossEarnings,
        precision,
      );
      const totalDeductions = this.formatMoney(
        aggregated.totalDeductions,
        precision,
      );
      const totalEmployerContributions = this.formatMoney(
        aggregated.totalEmployerContributions,
        precision,
      );
      const totalNetSalary = this.formatMoney(
        aggregated.totalNetSalary,
        precision,
      );
      const totalEmployerCost = toDecimal(totalGrossEarnings)
        .plus(toDecimal(totalEmployerContributions))
        .toDecimalPlaces(precision, Decimal.ROUND_HALF_EVEN)
        .toFixed(precision);

      const approvedPeriod =
        await this.payrollPeriodRepository.approvePeriodAtomically(
          {
            periodId,
            expectedPeriodVersion: expectedVersion,
            actorId,
            approvalState: {
              approvedBy: actorId,
              approvedAt,
              approvedRecordsCount: toApproveIds.length,
              alreadyApprovedRecordsCount,
              totalGrossEarnings,
              totalDeductions,
              totalEmployerContributions,
              totalNetSalary,
              totalEmployerCost,
              reason: dto.reason ?? null,
              acknowledgeAnomalies:
                anomalyReport.acknowledgmentMeta.acknowledgeAnomalies,
              acknowledgedAnomalyEmployees:
                anomalyReport.acknowledgmentMeta.acknowledgedAnomalyEmployees,
              acknowledgedWarningCodes:
                anomalyReport.acknowledgmentMeta.acknowledgedWarningCodes,
            },
          },
          session,
        );

      if (!approvedPeriod) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          `Payroll period '${period.periodCode}' was modified, already approved, or locked concurrently. Please refresh and try again.`,
          HttpStatus.CONFLICT,
        );
      }

      await this.auditLogsService.createAuditLog(
        {
          actorId,
          action: AuditAction.PAYROLL_PERIOD_APPROVED,
          targetId: approvedPeriod._id,
          targetModel: AuditTargetModel.PAYROLL_PERIOD,
          details: {
            payrollPeriodId: approvedPeriod._id.toHexString(),
            periodCode: approvedPeriod.periodCode,
            fromStatus: period.status,
            toStatus: approvedPeriod.status,
            approverId: actorId.toHexString(),
            approvedAt: approvedAt.toISOString(),
            approvedRecordsCount: toApproveIds.length,
            alreadyApprovedRecordsCount,
            approvedRecordIds: toApproveIds.map((id) => id.toHexString()),
            calculationVersionsApproved: aggregated.versionCounts,
            totalGrossEarnings,
            totalEmployeeDeductions: totalDeductions,
            totalEmployerContributions,
            totalNetSalary,
            totalEmployerCost,
            reason: dto.reason ?? null,
            ...anomalyReport.acknowledgmentMeta,
          },
          ipAddress: clientMetadata?.ipAddress ?? null,
          userAgent: clientMetadata?.userAgent ?? null,
        },
        session,
      );

      return {
        approvedPeriod,
        approvedRecordsCount: toApproveIds.length,
        alreadyApprovedRecordsCount,
        totalGrossEarnings,
        totalEmployeeDeductions: totalDeductions,
        totalEmployerContributions,
        totalNetSalary,
        totalEmployerCost,
        calculationVersionsApproved: aggregated.versionCounts,
      };
    });

    return {
      payrollPeriodId: txOutcome.approvedPeriod._id.toHexString(),
      periodCode: txOutcome.approvedPeriod.periodCode,
      periodStatus: txOutcome.approvedPeriod.status,
      approvedRecordsCount: txOutcome.approvedRecordsCount,
      alreadyApprovedRecordsCount: txOutcome.alreadyApprovedRecordsCount,
      approvedBy: actorId.toHexString(),
      approvedAt: approvedAt.toISOString(),
      totalGrossEarnings: txOutcome.totalGrossEarnings,
      totalEmployeeDeductions: txOutcome.totalEmployeeDeductions,
      totalEmployerContributions: txOutcome.totalEmployerContributions,
      totalNetSalary: txOutcome.totalNetSalary,
      totalEmployerCost: txOutcome.totalEmployerCost,
      calculationVersionsApproved: txOutcome.calculationVersionsApproved,
      eligibleForFinalization: true,
      version: txOutcome.approvedPeriod.__v ?? 0,
    };
  }

  private async requirePeriod(
    periodId: Types.ObjectId,
  ): Promise<PayrollPeriodLean> {
    const period = await this.payrollPeriodRepository.findById(periodId);
    if (!period) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Payroll period '${periodId.toString()}' not found.`,
        HttpStatus.NOT_FOUND,
      );
    }
    return period;
  }

  private formatMoney(rawValue: string, precision: number): string {
    return toDecimal(rawValue || '0')
      .toDecimalPlaces(precision, Decimal.ROUND_HALF_EVEN)
      .toFixed(precision);
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
}
