import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CompOffRecord,
  CompOffRecordDocument,
} from '../schemas/comp-off-record.schema';
import { CompOffStatus } from '../constants/leaves.constant';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type CompOffRecordLean = CompOffRecord & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class CompOffRepository implements OnModuleInit {
  private readonly logger = new Logger(CompOffRepository.name);

  constructor(
    @InjectModel(CompOffRecord.name)
    private readonly compOffModel: Model<CompOffRecordDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.compOffModel.syncIndexes();
      this.logger.log(
        'CompOffRecord indexes synchronized with MongoDB WiredTiger',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to synchronize CompOffRecord indexes: ${(error as Error).message}`,
      );
    }
  }

  async create(
    data: Partial<CompOffRecord>,
    session?: ClientSession,
  ): Promise<CompOffRecordLean> {
    const doc = new this.compOffModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as CompOffRecordLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<CompOffRecordLean | null> {
    const query = this.compOffModel.findOne({
      _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<CompOffRecordLean>().exec();
  }

  async findByEmployeeAndAttendanceDate(
    employeeId: Types.ObjectId | string,
    attendanceDate: string,
    session?: ClientSession,
  ): Promise<CompOffRecordLean | null> {
    const query = this.compOffModel.findOne({
      employeeId:
        typeof employeeId === 'string'
          ? new Types.ObjectId(employeeId)
          : employeeId,
      attendanceDate,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<CompOffRecordLean>().exec();
  }

  /**
   * Finds active, approved, unexpired comp-offs for an employee eligible for leave redemption.
   */
  async findAvailableCompOffs(
    employeeId: Types.ObjectId | string,
    currentDate: string,
    session?: ClientSession,
  ): Promise<CompOffRecordLean[]> {
    const query = this.compOffModel
      .find({
        employeeId:
          typeof employeeId === 'string'
            ? new Types.ObjectId(employeeId)
            : employeeId,
        status: CompOffStatus.APPROVED,
        expiryDate: { $gte: currentDate },
        deletedAt: null,
      })
      .sort({ expiryDate: 1 }); // FIFO: oldest expiring comp-off first

    if (session) query.session(session);
    return query.lean<CompOffRecordLean[]>().exec();
  }

  async findList(
    filter: Record<string, unknown> = {},
    page: number = 1,
    limit: number = 20,
    sort: Record<string, 1 | -1> = { createdAt: -1 },
  ): Promise<PaginatedResult<CompOffRecordLean>> {
    const cleanFilter = { ...filter, deletedAt: null };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.compOffModel
        .find(cleanFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<CompOffRecordLean[]>()
        .exec(),
      this.compOffModel.countDocuments(cleanFilter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateStatus(
    id: Types.ObjectId | string,
    fromStatus: CompOffStatus,
    toStatus: CompOffStatus,
    extraFields: Record<string, unknown> = {},
    session?: ClientSession,
  ): Promise<CompOffRecordLean | null> {
    const query = this.compOffModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        status: fromStatus,
        deletedAt: null,
      },
      {
        $set: {
          status: toStatus,
          ...extraFields,
        },
      },
      { new: true, session },
    );

    return query.lean<CompOffRecordLean>().exec();
  }

  async redeemCompOff(
    id: Types.ObjectId | string,
    leaveRequestId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<CompOffRecordLean | null> {
    const query = this.compOffModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        status: CompOffStatus.APPROVED,
        deletedAt: null,
      },
      {
        $set: {
          status: CompOffStatus.REDEEMED,
          redeemedAt: new Date(),
          redeemedLeaveRequestId:
            typeof leaveRequestId === 'string'
              ? new Types.ObjectId(leaveRequestId)
              : leaveRequestId,
        },
      },
      { new: true, session },
    );

    return query.lean<CompOffRecordLean>().exec();
  }

  async revertCompOffRedemption(
    leaveRequestId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<number> {
    const lId =
      typeof leaveRequestId === 'string'
        ? new Types.ObjectId(leaveRequestId)
        : leaveRequestId;

    const result = await this.compOffModel.updateMany(
      {
        redeemedLeaveRequestId: lId,
        status: CompOffStatus.REDEEMED,
        deletedAt: null,
      },
      {
        $set: {
          status: CompOffStatus.APPROVED,
          redeemedAt: null,
          redeemedLeaveRequestId: null,
        },
      },
      { session },
    );

    return result.modifiedCount;
  }

  async softDelete(
    id: Types.ObjectId | string,
    deletedBy: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<CompOffRecordLean | null> {
    const query = this.compOffModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
        },
      },
      { new: true, session },
    );
    return query.lean<CompOffRecordLean>().exec();
  }
}
