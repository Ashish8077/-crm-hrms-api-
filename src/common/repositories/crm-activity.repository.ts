import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import {
  CrmActivity,
  CrmActivityDocument,
  ActivityEntityType,
  ActivityType,
} from '../schemas/crm-activity.schema';
import { PaginatedResult } from '../pagination/types/pagination.types';
import {
  calculateSkip,
  buildPaginationMeta,
} from '../pagination/pagination.util';
import { PaginationQueryDto } from '../pagination/dto/pagination-query.dto';

export type CrmActivityLean = CrmActivity & { _id: Types.ObjectId };

@Injectable()
export class CrmActivityRepository {
  constructor(
    @InjectModel(CrmActivity.name)
    private readonly activityModel: Model<CrmActivityDocument>,
  ) {}

  async create(
    data: Partial<CrmActivity>,
    session?: ClientSession,
  ): Promise<CrmActivityLean> {
    const docs = await this.activityModel.create([data], { session });
    return docs[0].toObject();
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CrmActivityLean | null> {
    const query = this.activityModel.findOne({ _id: id, deletedAt: null });
    if (session) query.session(session);
    return query.lean<CrmActivityLean>().exec();
  }

  async findTimeline(
    entityType: ActivityEntityType,
    entityId: Types.ObjectId,
    queryDto: PaginationQueryDto,
  ): Promise<PaginatedResult<CrmActivityLean>> {
    const { page = 1, limit = 20 } = queryDto;
    const query = {
      entityType,
      entityId,
      deletedAt: null,
    };

    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      this.activityModel
        .find(query)
        .sort({ activityDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<CrmActivityLean[]>()
        .exec(),
      this.activityModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: Partial<CrmActivity>,
    session?: ClientSession,
  ): Promise<CrmActivityLean | null> {
    const query = this.activityModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<CrmActivityLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CrmActivityLean | null> {
    const query = this.activityModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<CrmActivityLean>().exec();
  }

  async findAll(
    filter: Record<string, unknown>,
    queryDto: PaginationQueryDto,
    sortField = 'activityDate',
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Promise<PaginatedResult<CrmActivityLean>> {
    const { page = 1, limit = 20 } = queryDto;
    const query = {
      deletedAt: null,
      ...filter,
    };
    const skip = calculateSkip(page, limit);
    const sort: Record<string, 1 | -1> = {
      [sortField]: sortOrder === 'asc' ? 1 : -1,
    };

    const [data, total] = await Promise.all([
      this.activityModel
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<CrmActivityLean[]>()
        .exec(),
      this.activityModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findCalendar(
    callerFilter: Record<string, unknown>,
    startDate: Date,
    endDate: Date,
  ): Promise<CrmActivityLean[]> {
    return this.activityModel
      .find({
        deletedAt: null,
        ...callerFilter,
        type: { $in: [ActivityType.CALL, ActivityType.MEETING] },
        activityDate: { $gte: startDate, $lte: endDate },
      })
      .sort({ activityDate: 1 })
      .lean<CrmActivityLean[]>()
      .exec();
  }

  async getSummary(callerFilter?: Record<string, unknown>): Promise<{
    total: number;
    byType: Record<string, number>;
    byOutcome: Record<string, number>;
  }> {
    const baseMatch = {
      deletedAt: null,
      ...callerFilter,
    };

    interface ActivityAggResult {
      _id: string | null;
      count: number;
    }

    const [typeAgg, outcomeAgg] = await Promise.all([
      this.activityModel
        .aggregate<ActivityAggResult>([
          { $match: baseMatch },
          { $group: { _id: '$type', count: { $sum: 1 } } },
        ])
        .exec(),
      this.activityModel
        .aggregate<ActivityAggResult>([
          { $match: baseMatch },
          { $group: { _id: '$outcome', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);

    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of typeAgg) {
      if (row._id) {
        byType[row._id] = row.count;
        total += row.count;
      }
    }

    const byOutcome: Record<string, number> = {};
    for (const row of outcomeAgg) {
      if (row._id) {
        byOutcome[row._id] = row.count;
      }
    }

    return { total, byType, byOutcome };
  }
}
