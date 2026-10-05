import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Branch } from '../schemas/branch.schema';
import { ListBranchesQueryDto } from '../dto/list-branches-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { escapeRegExp } from '../../../common/utils/regex.util';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

@Injectable()
export class BranchRepository {
  constructor(
    @InjectModel(Branch.name)
    private readonly branchModel: Model<Branch>,
  ) {}

  async create(
    data: Partial<Branch>,
    session?: ClientSession,
  ): Promise<Branch & { _id: Types.ObjectId }> {
    const created = new this.branchModel(data);
    const saved = await created.save({ session });
    return saved.toObject();
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<Branch | null> {
    const query = this.branchModel.findOne({ _id: id, deletedAt: null });
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findByName(
    name: string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<(Branch & { _id: Types.ObjectId }) | null> {
    const queryObj: Record<string, any> = {
      name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, 'i') },
      deletedAt: null,
    };
    if (excludeId) {
      queryObj._id = { $ne: excludeId };
    }
    const query = this.branchModel.findOne(queryObj);
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findList(
    queryDto: ListBranchesQueryDto,
  ): Promise<PaginatedResult<Branch>> {
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
      this.branchModel
        .find(query)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.branchModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: Partial<Branch>,
    session?: ClientSession,
  ): Promise<Branch | null> {
    const query = this.branchModel.findOneAndUpdate(
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
  ): Promise<Branch | null> {
    const query = this.branchModel.findOneAndUpdate(
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
  ): Promise<Branch | null> {
    const query = this.branchModel.findOneAndUpdate(
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
