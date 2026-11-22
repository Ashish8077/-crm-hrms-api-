import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  WeeklyOffConfig,
  WeeklyOffConfigDocument,
} from '../schemas/weekly-off-config.schema';
import { WeeklyOffConfigLean } from '../mappers/weekly-off-config.mapper';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import {
  buildPaginationMeta,
  calculateSkip,
} from '../../../common/pagination/pagination.util';

export interface OverlapCheckParams {
  branchId: Types.ObjectId | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  excludeId?: Types.ObjectId | string;
  session?: ClientSession;
}

export interface ListWeeklyOffFilter {
  branchId?: Types.ObjectId | null | 'company';
  isActive?: boolean;
  page?: number;
  limit?: number;
}

@Injectable()
export class WeeklyOffConfigRepository {
  constructor(
    @InjectModel(WeeklyOffConfig.name)
    private readonly weeklyOffModel: Model<WeeklyOffConfigDocument>,
  ) {}

  async create(
    data: Partial<WeeklyOffConfig>,
    session?: ClientSession,
  ): Promise<WeeklyOffConfigLean> {
    const doc = new this.weeklyOffModel(data);
    const saved = await doc.save({ session });
    return saved.toObject();
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<WeeklyOffConfigLean | null> {
    const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
    const query = this.weeklyOffModel.findOne({
      _id: objectId,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<WeeklyOffConfigLean>().exec();
  }

  async findOverlappingConfig(
    params: OverlapCheckParams,
  ): Promise<WeeklyOffConfigLean | null> {
    const { branchId, effectiveFrom, effectiveTo, excludeId, session } = params;

    const filter: Record<string, unknown> = {
      branchId: branchId ?? null,
      isActive: true,
      deletedAt: null,
    };

    if (excludeId) {
      filter._id = {
        $ne:
          typeof excludeId === 'string'
            ? new Types.ObjectId(excludeId)
            : excludeId,
      };
    }

    if (effectiveTo) {
      filter.effectiveFrom = { $lte: effectiveTo };
      filter.$or = [
        { effectiveTo: null },
        { effectiveTo: { $gte: effectiveFrom } },
      ];
    } else {
      filter.$or = [
        { effectiveTo: null },
        { effectiveTo: { $gte: effectiveFrom } },
      ];
    }

    const query = this.weeklyOffModel.findOne(filter);
    if (session) {
      query.session(session);
    }
    return query.lean<WeeklyOffConfigLean>().exec();
  }

  async findEffectiveConfig(
    date: string,
    branchId?: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<WeeklyOffConfigLean | null> {
    const filter: Record<string, unknown> = {
      branchId: branchId ?? null,
      isActive: true,
      deletedAt: null,
      effectiveFrom: { $lte: date },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
    };

    const query = this.weeklyOffModel
      .findOne(filter)
      .sort({ effectiveFrom: -1, createdAt: -1 });

    if (session) {
      query.session(session);
    }
    return query.lean<WeeklyOffConfigLean>().exec();
  }

  async findPaginated(
    filter: ListWeeklyOffFilter,
  ): Promise<PaginatedResult<WeeklyOffConfigLean>> {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.max(1, Math.min(100, filter.limit ?? 20));
    const skip = calculateSkip(page, limit);

    const query: Record<string, unknown> = {
      deletedAt: null,
    };

    if (filter.branchId !== undefined) {
      if (filter.branchId === null || filter.branchId === 'company') {
        query.branchId = null;
      } else {
        query.branchId = filter.branchId;
      }
    }

    if (filter.isActive !== undefined) {
      query.isActive = filter.isActive;
    }

    const [data, total] = await Promise.all([
      this.weeklyOffModel
        .find(query)
        .sort({ effectiveFrom: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<WeeklyOffConfigLean[]>()
        .exec(),
      this.weeklyOffModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async update(
    id: Types.ObjectId | string,
    updateData: Partial<WeeklyOffConfig>,
    session?: ClientSession,
  ): Promise<WeeklyOffConfigLean | null> {
    const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
    const query = this.weeklyOffModel.findOneAndUpdate(
      { _id: objectId, deletedAt: null },
      { $set: updateData },
      { new: true, session },
    );
    return query.lean<WeeklyOffConfigLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId | string,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<WeeklyOffConfigLean | null> {
    const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
    const query = this.weeklyOffModel.findOneAndUpdate(
      { _id: objectId, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
          isActive: false,
        },
      },
      { new: true, session },
    );
    return query.lean<WeeklyOffConfigLean>().exec();
  }
}
