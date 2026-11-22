import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { LeaveType, LeaveTypeDocument } from '../schemas/leave-type.schema';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type LeaveTypeLean = LeaveType & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class LeaveTypeRepository implements OnModuleInit {
  private readonly logger = new Logger(LeaveTypeRepository.name);

  constructor(
    @InjectModel(LeaveType.name)
    private readonly leaveTypeModel: Model<LeaveTypeDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.leaveTypeModel.syncIndexes();
      this.logger.log('LeaveType indexes synchronized with MongoDB WiredTiger');
    } catch (error) {
      this.logger.warn(
        `Failed to synchronize LeaveType indexes: ${(error as Error).message}`,
      );
    }
  }

  async create(
    data: Partial<LeaveType>,
    session?: ClientSession,
  ): Promise<LeaveTypeLean> {
    const doc = new this.leaveTypeModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as LeaveTypeLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<LeaveTypeLean | null> {
    const query = this.leaveTypeModel.findOne({
      _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<LeaveTypeLean>().exec();
  }

  async findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<LeaveTypeLean | null> {
    const query = this.leaveTypeModel.findOne({
      code: code.trim().toUpperCase(),
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<LeaveTypeLean>().exec();
  }

  async findAllActive(session?: ClientSession): Promise<LeaveTypeLean[]> {
    const query = this.leaveTypeModel
      .find({ isActive: true, deletedAt: null })
      .sort({ name: 1 });
    if (session) query.session(session);
    return query.lean<LeaveTypeLean[]>().exec();
  }

  async findList(
    filter: Record<string, unknown> = {},
    page: number = 1,
    limit: number = 20,
    sort: Record<string, 1 | -1> = { name: 1 },
  ): Promise<PaginatedResult<LeaveTypeLean>> {
    const cleanFilter = { ...filter, deletedAt: null };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.leaveTypeModel
        .find(cleanFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<LeaveTypeLean[]>()
        .exec(),
      this.leaveTypeModel.countDocuments(cleanFilter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId | string,
    data: Partial<LeaveType>,
    session?: ClientSession,
  ): Promise<LeaveTypeLean | null> {
    const query = this.leaveTypeModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      { $set: data },
      { new: true, session },
    );
    return query.lean<LeaveTypeLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId | string,
    deletedBy: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<LeaveTypeLean | null> {
    const query = this.leaveTypeModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
          isActive: false,
        },
      },
      { new: true, session },
    );
    return query.lean<LeaveTypeLean>().exec();
  }
}
