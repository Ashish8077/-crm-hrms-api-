import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  LeaveTransaction,
  LeaveTransactionDocument,
} from '../schemas/leave-transaction.schema';
import { LeaveTransactionType } from '../constants/leaves.constant';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type LeaveTransactionLean = LeaveTransaction & {
  _id: Types.ObjectId;
  createdAt: Date;
};

@Injectable()
export class LeaveTransactionRepository implements OnModuleInit {
  private readonly logger = new Logger(LeaveTransactionRepository.name);

  constructor(
    @InjectModel(LeaveTransaction.name)
    private readonly transactionModel: Model<LeaveTransactionDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.transactionModel.syncIndexes();
      this.logger.log(
        'LeaveTransaction indexes synchronized with MongoDB WiredTiger',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to synchronize LeaveTransaction indexes: ${(error as Error).message}`,
      );
    }
  }

  async create(
    data: Partial<LeaveTransaction>,
    session?: ClientSession,
  ): Promise<LeaveTransactionLean> {
    const doc = new this.transactionModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as LeaveTransactionLean;
  }

  async findByReference(
    referenceId: Types.ObjectId | string,
    transactionType: LeaveTransactionType,
    session?: ClientSession,
  ): Promise<LeaveTransactionLean | null> {
    const query = this.transactionModel.findOne({
      referenceId:
        typeof referenceId === 'string'
          ? new Types.ObjectId(referenceId)
          : referenceId,
      transactionType,
    });
    if (session) query.session(session);
    return query.lean<LeaveTransactionLean>().exec();
  }

  async findCarryForwardTransaction(
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    toYear: number,
    session?: ClientSession,
  ): Promise<LeaveTransactionLean | null> {
    const query = this.transactionModel.findOne({
      employeeId:
        typeof employeeId === 'string'
          ? new Types.ObjectId(employeeId)
          : employeeId,
      leaveTypeId:
        typeof leaveTypeId === 'string'
          ? new Types.ObjectId(leaveTypeId)
          : leaveTypeId,
      year: toYear,
      transactionType: LeaveTransactionType.CARRY_FORWARD,
    });
    if (session) query.session(session);
    return query.lean<LeaveTransactionLean>().exec();
  }

  async findList(
    filter: Record<string, unknown> = {},
    page: number = 1,
    limit: number = 20,
    sort: Record<string, 1 | -1> = { createdAt: -1 },
  ): Promise<PaginatedResult<LeaveTransactionLean>> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<LeaveTransactionLean[]>()
        .exec(),
      this.transactionModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }
}
