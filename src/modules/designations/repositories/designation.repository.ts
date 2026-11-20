import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Designation } from '../schemas/designation.schema';
import { ListDesignationsQueryDto } from '../dto/list-designations-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { escapeRegExp } from '../../../common/utils/regex.util';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

@Injectable()
export class DesignationRepository {
  constructor(
    @InjectModel(Designation.name)
    private readonly designationModel: Model<Designation>,
  ) {}

  async create(
    data: Partial<Designation>,
    session?: ClientSession,
  ): Promise<Designation & { _id: Types.ObjectId }> {
    const created = new this.designationModel(data);
    const saved = await created.save({ session });
    return saved.toObject();
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<Designation | null> {
    const query = this.designationModel.findOne({ _id: id, deletedAt: null });
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findByName(
    name: string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<(Designation & { _id: Types.ObjectId }) | null> {
    const queryObj: Record<string, any> = {
      name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, 'i') },
      deletedAt: null,
    };

    if (excludeId) {
      queryObj._id = { $ne: excludeId };
    }

    const query = this.designationModel.findOne(queryObj);
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findList(
    queryDto: ListDesignationsQueryDto,
  ): Promise<PaginatedResult<Designation>> {
    const { page = 1, limit = 20, search, isActive } = queryDto;

    const query: Record<string, any> = {
      deletedAt: null,
    };

    if (search) {
      const cleanSearch = escapeRegExp(search.trim());
      query.name = { $regex: cleanSearch, $options: 'i' };
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.designationModel
        .find(query)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.designationModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: Partial<Designation>,
    session?: ClientSession,
  ): Promise<Designation | null> {
    const query = this.designationModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async updateStatus(
    id: Types.ObjectId,
    isActive: boolean,
    session?: ClientSession,
  ): Promise<Designation | null> {
    const query = this.designationModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { isActive } },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async softDelete(
    id: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<Designation | null> {
    const query = this.designationModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
          isActive: false,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }
}
