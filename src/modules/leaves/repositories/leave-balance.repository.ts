import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  LeaveBalance,
  LeaveBalanceDocument,
} from '../schemas/leave-balance.schema';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type LeaveBalanceLean = LeaveBalance & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function isClientSession(val: unknown): val is ClientSession {
  return (
    val !== null &&
    typeof val === 'object' &&
    'startTransaction' in val &&
    typeof (val as { startTransaction?: unknown }).startTransaction ===
      'function'
  );
}

function resolveUpdatedByAndSession(
  updatedBy?: Types.ObjectId | string | null | ClientSession,
  session?: ClientSession,
): {
  actualUpdatedBy: Types.ObjectId | null;
  actualSession: ClientSession | undefined;
} {
  let actualUpdatedBy: Types.ObjectId | null = null;
  let actualSession = session;

  if (updatedBy) {
    if (isClientSession(updatedBy)) {
      actualSession = updatedBy;
    } else if (typeof updatedBy === 'string') {
      actualUpdatedBy = new Types.ObjectId(updatedBy);
    } else if (updatedBy instanceof Types.ObjectId) {
      actualUpdatedBy = updatedBy;
    }
  }

  return { actualUpdatedBy, actualSession };
}

@Injectable()
export class LeaveBalanceRepository implements OnModuleInit {
  private readonly logger = new Logger(LeaveBalanceRepository.name);

  constructor(
    @InjectModel(LeaveBalance.name)
    private readonly leaveBalanceModel: Model<LeaveBalanceDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.leaveBalanceModel.syncIndexes();
      this.logger.log(
        'LeaveBalance indexes synchronized with MongoDB WiredTiger',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to synchronize LeaveBalance indexes: ${(error as Error).message}`,
      );
    }
  }

  async create(
    data: Partial<LeaveBalance>,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean> {
    const doc = new this.leaveBalanceModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as LeaveBalanceLean;
  }

  async findByEmployeeTypeYear(
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean | null> {
    const query = this.leaveBalanceModel.findOne({
      employeeId:
        typeof employeeId === 'string'
          ? new Types.ObjectId(employeeId)
          : employeeId,
      leaveTypeId:
        typeof leaveTypeId === 'string'
          ? new Types.ObjectId(leaveTypeId)
          : leaveTypeId,
      year,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<LeaveBalanceLean>().exec();
  }

  async findAllByEmployeeAndYear(
    employeeId: Types.ObjectId | string,
    year: number,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean[]> {
    const query = this.leaveBalanceModel
      .find({
        employeeId:
          typeof employeeId === 'string'
            ? new Types.ObjectId(employeeId)
            : employeeId,
        year,
        deletedAt: null,
      })
      .sort({ createdAt: 1 });
    if (session) query.session(session);
    return query.lean<LeaveBalanceLean[]>().exec();
  }

  async findList(
    filter: Record<string, unknown> = {},
    page: number = 1,
    limit: number = 20,
    sort: Record<string, 1 | -1> = { year: -1, createdAt: -1 },
  ): Promise<PaginatedResult<LeaveBalanceLean>> {
    const cleanFilter = { ...filter, deletedAt: null };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.leaveBalanceModel
        .find(cleanFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<LeaveBalanceLean[]>()
        .exec(),
      this.leaveBalanceModel.countDocuments(cleanFilter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Atomically upserts an allocation grant for an employee/leaveType/year.
   */
  async upsertAllocation(
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
    allocatedDays: number,
    carriedForwardDays: number = 0,
    updatedBy?: Types.ObjectId | string | null | ClientSession,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean> {
    const { actualUpdatedBy, actualSession } = resolveUpdatedByAndSession(
      updatedBy,
      session,
    );

    const eId =
      typeof employeeId === 'string'
        ? new Types.ObjectId(employeeId)
        : employeeId;
    const lId =
      typeof leaveTypeId === 'string'
        ? new Types.ObjectId(leaveTypeId)
        : leaveTypeId;

    const existing = await this.findByEmployeeTypeYear(
      eId,
      lId,
      year,
      actualSession,
    );

    if (!existing) {
      return this.create(
        {
          employeeId: eId,
          leaveTypeId: lId,
          year,
          allocatedDays,
          carriedForwardDays,
          creditedDays: 0,
          debitedDays: 0,
          pendingDays: 0,
          usedDays: 0,
          availableBalance: allocatedDays + carriedForwardDays,
          updatedBy: actualUpdatedBy,
        },
        actualSession,
      );
    }

    const finalAllocatedDays =
      allocatedDays > 0 ? allocatedDays : existing.allocatedDays;
    const finalCarriedForwardDays =
      carriedForwardDays > 0 ? carriedForwardDays : existing.carriedForwardDays;

    const newAvailable =
      finalAllocatedDays +
      finalCarriedForwardDays +
      (existing.creditedDays ?? 0) -
      ((existing.debitedDays ?? 0) +
        (existing.pendingDays ?? 0) +
        (existing.usedDays ?? 0));

    const updateSet: Record<string, unknown> = {
      allocatedDays: finalAllocatedDays,
      carriedForwardDays: finalCarriedForwardDays,
      availableBalance: newAvailable,
    };
    if (actualUpdatedBy) {
      updateSet.updatedBy = actualUpdatedBy;
    }

    const query = this.leaveBalanceModel.findOneAndUpdate(
      {
        _id: existing._id,
        deletedAt: null,
      },
      {
        $set: updateSet,
      },
      { new: true, session: actualSession },
    );

    return (await query.lean<LeaveBalanceLean>().exec())!;
  }

  /**
   * Layer 1 Atomic Reservation:
   * Increments pendingDays and decrements availableBalance atomically.
   * If allowNegative is false, enforces availableBalance >= days via find predicate.
   */
  async reserveBalance(
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
    days: number,
    allowNegative: boolean = false,
    updatedBy?: Types.ObjectId | string | null | ClientSession,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean | null> {
    const { actualUpdatedBy, actualSession } = resolveUpdatedByAndSession(
      updatedBy,
      session,
    );

    const filter: Record<string, unknown> = {
      employeeId:
        typeof employeeId === 'string'
          ? new Types.ObjectId(employeeId)
          : employeeId,
      leaveTypeId:
        typeof leaveTypeId === 'string'
          ? new Types.ObjectId(leaveTypeId)
          : leaveTypeId,
      year,
      deletedAt: null,
    };

    if (!allowNegative) {
      filter.availableBalance = { $gte: days };
    }

    const update: Record<string, unknown> = {
      $inc: {
        pendingDays: days,
        availableBalance: -days,
      },
    };

    if (actualUpdatedBy) {
      update.$set = { updatedBy: actualUpdatedBy };
    }

    const query = this.leaveBalanceModel.findOneAndUpdate(filter, update, {
      new: true,
      session: actualSession,
    });

    return query.lean<LeaveBalanceLean>().exec();
  }

  /**
   * Layer 2 Atomic Reservation Release:
   * Reverts reservation when a pending request is rejected or cancelled before approval.
   */
  async releaseReservation(
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
    days: number,
    updatedBy?: Types.ObjectId | string | null | ClientSession,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean | null> {
    const { actualUpdatedBy, actualSession } = resolveUpdatedByAndSession(
      updatedBy,
      session,
    );

    const update: Record<string, unknown> = {
      $inc: {
        pendingDays: -days,
        availableBalance: days,
      },
    };

    if (actualUpdatedBy) {
      update.$set = { updatedBy: actualUpdatedBy };
    }

    const query = this.leaveBalanceModel.findOneAndUpdate(
      {
        employeeId:
          typeof employeeId === 'string'
            ? new Types.ObjectId(employeeId)
            : employeeId,
        leaveTypeId:
          typeof leaveTypeId === 'string'
            ? new Types.ObjectId(leaveTypeId)
            : leaveTypeId,
        year,
        pendingDays: { $gte: days },
        deletedAt: null,
      },
      update,
      { new: true, session: actualSession },
    );

    return query.lean<LeaveBalanceLean>().exec();
  }

  /**
   * Layer 3 Atomic Approval Debit:
   * Moves reserved days from pendingDays to usedDays.
   * Note: availableBalance was already debited during reservation phase!
   */
  async debitApprovedBalance(
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
    days: number,
    updatedBy?: Types.ObjectId | string | null | ClientSession,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean | null> {
    const { actualUpdatedBy, actualSession } = resolveUpdatedByAndSession(
      updatedBy,
      session,
    );

    const update: Record<string, unknown> = {
      $inc: {
        pendingDays: -days,
        usedDays: days,
      },
    };

    if (actualUpdatedBy) {
      update.$set = { updatedBy: actualUpdatedBy };
    }

    const query = this.leaveBalanceModel.findOneAndUpdate(
      {
        employeeId:
          typeof employeeId === 'string'
            ? new Types.ObjectId(employeeId)
            : employeeId,
        leaveTypeId:
          typeof leaveTypeId === 'string'
            ? new Types.ObjectId(leaveTypeId)
            : leaveTypeId,
        year,
        pendingDays: { $gte: days },
        deletedAt: null,
      },
      update,
      { new: true, session: actualSession },
    );

    return query.lean<LeaveBalanceLean>().exec();
  }

  /**
   * Layer 4 Atomic Cancellation Credit:
   * Restores balance when an approved request is cancelled.
   */
  async creditCancelledBalance(
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
    days: number,
    updatedBy?: Types.ObjectId | string | null | ClientSession,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean | null> {
    const { actualUpdatedBy, actualSession } = resolveUpdatedByAndSession(
      updatedBy,
      session,
    );

    const update: Record<string, unknown> = {
      $inc: {
        usedDays: -days,
        availableBalance: days,
      },
    };

    if (actualUpdatedBy) {
      update.$set = { updatedBy: actualUpdatedBy };
    }

    const query = this.leaveBalanceModel.findOneAndUpdate(
      {
        employeeId:
          typeof employeeId === 'string'
            ? new Types.ObjectId(employeeId)
            : employeeId,
        leaveTypeId:
          typeof leaveTypeId === 'string'
            ? new Types.ObjectId(leaveTypeId)
            : leaveTypeId,
        year,
        usedDays: { $gte: days },
        deletedAt: null,
      },
      update,
      { new: true, session: actualSession },
    );

    return query.lean<LeaveBalanceLean>().exec();
  }

  /**
   * Layer 5 Atomic Manual Adjustment:
   * Handles HR CREDIT or DEBIT operations with atomic boundary checks.
   */
  async manualAdjust(
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
    adjustmentType: 'CREDIT' | 'DEBIT',
    days: number,
    updatedBy: Types.ObjectId | null,
    allowNegative: boolean = false,
    session?: ClientSession,
  ): Promise<LeaveBalanceLean | null> {
    const filter: Record<string, unknown> = {
      employeeId:
        typeof employeeId === 'string'
          ? new Types.ObjectId(employeeId)
          : employeeId,
      leaveTypeId:
        typeof leaveTypeId === 'string'
          ? new Types.ObjectId(leaveTypeId)
          : leaveTypeId,
      year,
      deletedAt: null,
    };

    const update: Record<string, unknown> = {
      $set: { updatedBy },
    };

    if (adjustmentType === 'CREDIT') {
      update.$inc = {
        creditedDays: days,
        availableBalance: days,
      };
    } else {
      if (!allowNegative) {
        filter.availableBalance = { $gte: days };
      }
      update.$inc = {
        debitedDays: days,
        availableBalance: -days,
      };
    }

    const query = this.leaveBalanceModel.findOneAndUpdate(filter, update, {
      new: true,
      session,
    });

    return query.lean<LeaveBalanceLean>().exec();
  }
}
