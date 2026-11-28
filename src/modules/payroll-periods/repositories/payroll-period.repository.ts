import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
  PayrollPeriodLean,
} from '../schemas/payroll-period.schema';
import {
  PayrollPeriodSortableField,
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../constants/payroll-period.constant';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';

export interface PayrollPeriodQueryFilter {
  year?: number;
  month?: number;
  status?: PayrollPeriodStatus;
  payrollFrequency?: PayrollFrequency;
  search?: string;
}

export interface PayrollPeriodPaginationOptions {
  page: number;
  limit: number;
  sortBy?: PayrollPeriodSortableField;
  sortOrder?: 'asc' | 'desc';
}

interface MongoErrorShape {
  code?: number;
  message?: string;
  cause?: { code?: number; message?: string };
}

@Injectable()
export class PayrollPeriodRepository {
  constructor(
    @InjectModel(PayrollPeriod.name)
    private readonly periodModel: Model<PayrollPeriodDocument>,
  ) {}

  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as MongoErrorShape;
    if (err.code === 11000) return true;
    if (typeof err.message === 'string' && err.message.includes('E11000')) {
      return true;
    }
    if (err.cause && typeof err.cause === 'object') {
      if (
        err.cause.code === 11000 ||
        (typeof err.cause.message === 'string' &&
          err.cause.message.includes('E11000'))
      ) {
        return true;
      }
    }
    return false;
  }

  async create(
    data: Partial<PayrollPeriod>,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean> {
    const doc = new this.periodModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as PayrollPeriodLean;
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const query = this.periodModel.findOne({
      _id: id,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollPeriodLean>().exec();
  }

  async findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const query = this.periodModel
      .findOne({
        periodCode: code.trim().toUpperCase(),
        deletedAt: null,
      })
      .collation({ locale: 'en', strength: 2 });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollPeriodLean>().exec();
  }

  async findOverlapping(
    startDate: Date,
    endDate: Date,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const query = this.periodModel.findOne(filter);
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollPeriodLean>().exec();
  }

  async findDuplicateCycle(
    year: number,
    month: number,
    frequency: PayrollFrequency,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      year,
      month,
      payrollFrequency: frequency,
    };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const query = this.periodModel.findOne(filter);
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollPeriodLean>().exec();
  }

  async findList(
    filter: PayrollPeriodQueryFilter,
    pagination: PayrollPeriodPaginationOptions,
  ): Promise<PaginatedResult<PayrollPeriodLean>> {
    const queryFilter: Record<string, unknown> = {
      deletedAt: null,
    };

    if (filter.year !== undefined) {
      queryFilter.year = filter.year;
    }
    if (filter.month !== undefined) {
      queryFilter.month = filter.month;
    }
    if (filter.status !== undefined) {
      queryFilter.status = filter.status;
    }
    if (filter.payrollFrequency !== undefined) {
      queryFilter.payrollFrequency = filter.payrollFrequency;
    }
    if (filter.search) {
      const sanitized = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      queryFilter.$or = [
        { periodName: { $regex: sanitized, $options: 'i' } },
        { periodCode: { $regex: sanitized, $options: 'i' } },
      ];
    }

    const page = Math.max(1, pagination.page);
    const limit = Math.max(1, pagination.limit);
    const skip = (page - 1) * limit;

    const sortBy = pagination.sortBy ?? 'startDate';
    const sortOrder = pagination.sortOrder === 'asc' ? 1 : -1;

    const [data, total] = await Promise.all([
      this.periodModel
        .find(queryFilter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean<PayrollPeriodLean[]>()
        .exec(),
      this.periodModel.countDocuments(queryFilter).exec(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async updateById(
    id: Types.ObjectId,
    updateData: Partial<PayrollPeriod>,
    expectedVersion?: number,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const sanitizedSet: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined) {
        sanitizedSet[key] = value;
      }
    }

    const queryFilter: Record<string, unknown> = {
      _id: id,
      deletedAt: null,
    };
    if (typeof expectedVersion === 'number') {
      queryFilter.__v = expectedVersion;
    }

    const query = this.periodModel.findOneAndUpdate(
      queryFilter,
      { $set: sanitizedSet, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true, session },
    );

    return query.lean<PayrollPeriodLean>().exec();
  }

  async updateStatus(
    id: Types.ObjectId,
    newStatus: PayrollPeriodStatus,
    actorId: Types.ObjectId,
    expectedVersion?: number,
    session?: ClientSession,
    options?: {
      expectedFromStatus?: PayrollPeriodStatus;
      requireApprovalMetadata?: boolean;
    },
  ): Promise<PayrollPeriodLean | null> {
    const queryFilter: Record<string, unknown> = {
      _id: id,
      deletedAt: null,
    };
    if (typeof expectedVersion === 'number') {
      queryFilter.__v = expectedVersion;
    }
    if (options?.expectedFromStatus !== undefined) {
      queryFilter.status = options.expectedFromStatus;
    }
    if (options?.requireApprovalMetadata) {
      queryFilter['approval.approvedBy'] = { $exists: true, $ne: null };
      queryFilter['approval.approvedAt'] = { $exists: true, $ne: null };
    }

    const query = this.periodModel.findOneAndUpdate(
      queryFilter,
      {
        $set: {
          status: newStatus,
          updatedBy: actorId,
        },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', runValidators: true, session },
    );

    return query.lean<PayrollPeriodLean>().exec();
  }

  /**
   * Atomically acquires the per-period payroll processing lock if the period is in DRAFT or PROCESSING
   * and no live worker holds an active non-stale lock. Recovering stale locks safely restores stuck runs.
   */
  async acquireProcessingLock(
    params: {
      periodId: Types.ObjectId;
      runId: string;
      actorId: Types.ObjectId;
      now: Date;
      staleCutoff: Date;
    },
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const { periodId, runId, actorId, now, staleCutoff } = params;

    return this.periodModel
      .findOneAndUpdate(
        {
          _id: periodId,
          deletedAt: null,
          status: {
            $in: [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.PROCESSING],
          },
          $or: [
            { 'processing.processingStatus': { $exists: false } },
            {
              'processing.processingStatus': {
                $ne: PayrollProcessingStatus.PROCESSING,
              },
            },
            { 'processing.heartbeatAt': { $lt: staleCutoff } },
            {
              'processing.heartbeatAt': null,
              'processing.lastAttemptAt': { $lt: staleCutoff },
            },
          ],
        },
        [
          {
            $set: {
              status: PayrollPeriodStatus.PROCESSING,
              updatedBy: actorId,
              __v: { $add: [{ $ifNull: ['$__v', 0] }, 1] },
              processing: {
                processingStatus: PayrollProcessingStatus.PROCESSING,
                totalEligibleEmployees: {
                  $ifNull: ['$processing.totalEligibleEmployees', 0],
                },
                processedEmployees: 0,
                successfulEmployees: {
                  $ifNull: ['$processing.successfulEmployees', 0],
                },
                failedEmployees: {
                  $ifNull: ['$processing.failedEmployees', 0],
                },
                skippedUpToDateEmployees: 0,
                recalculatedEmployees: 0,
                processingAttempts: {
                  $add: [{ $ifNull: ['$processing.processingAttempts', 0] }, 1],
                },
                startedAt: {
                  $ifNull: ['$processing.startedAt', now],
                },
                completedAt: null,
                lastAttemptAt: now,
                heartbeatAt: now,
                activeRunId: runId,
                lastErrorSummary: null,
              },
            },
          },
        ],
        { returnDocument: 'after', updatePipeline: true, session },
      )
      .lean<PayrollPeriodLean>()
      .exec();
  }

  async verifyActiveRunOwnership(
    periodId: Types.ObjectId,
    runId: string,
  ): Promise<boolean> {
    const count = await this.periodModel
      .countDocuments({
        _id: periodId,
        deletedAt: null,
        status: { $ne: PayrollPeriodStatus.FINALIZED },
        'processing.activeRunId': runId,
      })
      .exec();
    return count > 0;
  }

  async approvePeriodAtomically(
    params: {
      periodId: Types.ObjectId;
      expectedPeriodVersion: number;
      actorId: Types.ObjectId;
      approvalState: {
        approvedBy: Types.ObjectId;
        approvedAt: Date;
        approvedRecordsCount: number;
        alreadyApprovedRecordsCount: number;
        totalGrossEarnings: string;
        totalDeductions: string;
        totalEmployerContributions: string;
        totalNetSalary: string;
        totalEmployerCost: string;
        reason: string | null;
        acknowledgeAnomalies: boolean;
        acknowledgedAnomalyEmployees: number;
        acknowledgedWarningCodes: string[];
      };
    },
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const query = this.periodModel.findOneAndUpdate(
      {
        _id: params.periodId,
        deletedAt: null,
        status: PayrollPeriodStatus.COMPLETED,
        __v: params.expectedPeriodVersion,
        $or: [
          { 'processing.activeRunId': null },
          { 'processing.activeRunId': { $exists: false } },
        ],
      },
      {
        $set: {
          status: PayrollPeriodStatus.APPROVED,
          approval: params.approvalState,
          updatedBy: params.actorId,
        },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', runValidators: true, session },
    );

    return query.lean<PayrollPeriodLean>().exec();
  }

  async verifyPeriodMutableAndBumpVersion(
    periodId: Types.ObjectId,
    allowedStatuses: ReadonlyArray<PayrollPeriodStatus>,
    session?: ClientSession,
  ): Promise<boolean> {
    const updated = await this.periodModel
      .updateOne(
        {
          _id: periodId,
          deletedAt: null,
          status: { $in: allowedStatuses },
        },
        {
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return updated.matchedCount > 0;
  }

  async touchActiveRunLock(
    params: {
      periodId: Types.ObjectId;
      runId: string;
      now: Date;
    },
    session?: ClientSession,
  ): Promise<boolean> {
    const updated = await this.periodModel
      .updateOne(
        {
          _id: params.periodId,
          deletedAt: null,
          status: {
            $in: [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.PROCESSING],
          },
          'processing.activeRunId': params.runId,
        },
        {
          $set: {
            'processing.heartbeatAt': params.now,
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return updated.matchedCount > 0;
  }

  async updateProcessingProgress(
    params: {
      periodId: Types.ObjectId;
      runId: string;
      totalEligibleEmployees: number;
      processedEmployees: number;
      successfulEmployees: number;
      failedEmployees: number;
      skippedUpToDateEmployees: number;
      recalculatedEmployees: number;
      heartbeatAt: Date;
    },
    session?: ClientSession,
  ): Promise<boolean> {
    const {
      periodId,
      runId,
      totalEligibleEmployees,
      processedEmployees,
      successfulEmployees,
      failedEmployees,
      skippedUpToDateEmployees,
      recalculatedEmployees,
      heartbeatAt,
    } = params;

    const updated = await this.periodModel
      .updateOne(
        {
          _id: periodId,
          deletedAt: null,
          status: {
            $in: [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.PROCESSING],
          },
          'processing.activeRunId': runId,
        },
        {
          $set: {
            'processing.totalEligibleEmployees': totalEligibleEmployees,
            'processing.processedEmployees': processedEmployees,
            'processing.successfulEmployees': successfulEmployees,
            'processing.failedEmployees': failedEmployees,
            'processing.skippedUpToDateEmployees': skippedUpToDateEmployees,
            'processing.recalculatedEmployees': recalculatedEmployees,
            'processing.heartbeatAt': heartbeatAt,
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();

    return updated.matchedCount > 0;
  }

  async completeProcessingRun(
    params: {
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
    },
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const {
      periodId,
      runId,
      processingStatus,
      totalEligibleEmployees,
      processedEmployees,
      successfulEmployees,
      failedEmployees,
      skippedUpToDateEmployees,
      recalculatedEmployees,
      completedAt,
      lastErrorSummary,
    } = params;

    return this.periodModel
      .findOneAndUpdate(
        {
          _id: periodId,
          deletedAt: null,
          status: {
            $in: [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.PROCESSING],
          },
          'processing.activeRunId': runId,
        },
        {
          $set: {
            'processing.processingStatus': processingStatus,
            'processing.totalEligibleEmployees': totalEligibleEmployees,
            'processing.processedEmployees': processedEmployees,
            'processing.successfulEmployees': successfulEmployees,
            'processing.failedEmployees': failedEmployees,
            'processing.skippedUpToDateEmployees': skippedUpToDateEmployees,
            'processing.recalculatedEmployees': recalculatedEmployees,
            'processing.completedAt': completedAt,
            'processing.heartbeatAt': completedAt,
            'processing.activeRunId': null,
            'processing.lastErrorSummary': lastErrorSummary,
          },
          $inc: { __v: 1 },
        },
        { returnDocument: 'after', session },
      )
      .lean<PayrollPeriodLean>()
      .exec();
  }
}
