import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import {
  CrmActivity,
  CrmActivityDocument,
  ActivityEntityType,
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
    return docs[0].toObject() as CrmActivityLean;
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
}
