import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Holiday, HolidayDocument } from '../schemas/holiday.schema';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type HolidayLean = Holiday & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class HolidayRepository implements OnModuleInit {
  private readonly logger = new Logger(HolidayRepository.name);

  constructor(
    @InjectModel(Holiday.name)
    private readonly holidayModel: Model<HolidayDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.holidayModel.syncIndexes();
      this.logger.log('Holiday indexes synchronized with MongoDB WiredTiger');
    } catch (error) {
      this.logger.warn(
        `Failed to synchronize Holiday indexes: ${(error as Error).message}`,
      );
    }
  }

  async create(
    data: Partial<Holiday>,
    session?: ClientSession,
  ): Promise<HolidayLean> {
    const doc = new this.holidayModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as HolidayLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<HolidayLean | null> {
    const query = this.holidayModel.findOne({
      _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<HolidayLean>().exec();
  }

  async findByDateAndBranch(
    date: string,
    branchId: Types.ObjectId | string | null,
    session?: ClientSession,
  ): Promise<HolidayLean | null> {
    let branchObjectId: Types.ObjectId | null = null;
    if (branchId && Types.ObjectId.isValid(branchId.toString())) {
      branchObjectId =
        typeof branchId === 'string' ? new Types.ObjectId(branchId) : branchId;
    }
    const query = this.holidayModel.findOne({
      date,
      branchId: branchObjectId || null,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<HolidayLean>().exec();
  }

  /**
   * Retrieves active holidays within date span that apply either organization-wide (branchId is null)
   * or specifically to the provided branch.
   */
  async findApplicableHolidays(
    startDate: string,
    endDate: string,
    branchId?: Types.ObjectId | string | null,
    session?: ClientSession,
  ): Promise<HolidayLean[]> {
    let branchObjectId: Types.ObjectId | null = null;
    if (branchId && Types.ObjectId.isValid(branchId.toString())) {
      branchObjectId =
        typeof branchId === 'string' ? new Types.ObjectId(branchId) : branchId;
    }
    const branchFilter = branchObjectId
      ? { $in: [null, branchObjectId] }
      : null;

    const query = this.holidayModel
      .find({
        date: { $gte: startDate, $lte: endDate },
        branchId: branchFilter,
        isActive: true,
        deletedAt: null,
      })
      .sort({ date: 1 });

    if (session) query.session(session);
    return query.lean<HolidayLean[]>().exec();
  }

  async findList(
    filter: Record<string, unknown> = {},
    page: number = 1,
    limit: number = 20,
    sort: Record<string, 1 | -1> = { date: 1 },
  ): Promise<PaginatedResult<HolidayLean>> {
    const cleanFilter = { ...filter, deletedAt: null };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.holidayModel
        .find(cleanFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<HolidayLean[]>()
        .exec(),
      this.holidayModel.countDocuments(cleanFilter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId | string,
    data: Partial<Holiday>,
    session?: ClientSession,
  ): Promise<HolidayLean | null> {
    const query = this.holidayModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      { $set: data },
      { new: true, session },
    );
    return query.lean<HolidayLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId | string,
    deletedBy: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<HolidayLean | null> {
    const query = this.holidayModel.findOneAndUpdate(
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
    return query.lean<HolidayLean>().exec();
  }

  /**
   * Batch query returning all active holidays in [startDate, endDate] across all branches and global scope.
   */
  async findActiveInRange(
    startDate: string,
    endDate: string,
  ): Promise<HolidayLean[]> {
    return this.holidayModel
      .find({
        date: { $gte: startDate, $lte: endDate },
        isActive: true,
        deletedAt: null,
      })
      .select('_id name date type branchId')
      .sort({ date: 1 })
      .lean<HolidayLean[]>()
      .exec();
  }
}
