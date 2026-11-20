import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Team } from '../schemas/team.schema';
import { ListTeamsQueryDto } from '../dto/list-teams-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { escapeRegExp } from '../../../common/utils/regex.util';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type TeamLean = Team & { _id: Types.ObjectId };

@Injectable()
export class TeamRepository {
  constructor(
    @InjectModel(Team.name)
    private readonly teamModel: Model<Team>,
  ) {}

  async create(
    data: Partial<Team>,
    session?: ClientSession,
  ): Promise<TeamLean> {
    const created = new this.teamModel(data);
    const saved = await created.save({ session });
    return saved.toObject();
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<TeamLean | null> {
    const query = this.teamModel.findOne({ _id: id, deletedAt: null });
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findByNameAndDepartment(
    name: string,
    departmentId: Types.ObjectId | string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<TeamLean | null> {
    const queryObj: Record<string, any> = {
      name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, 'i') },
      departmentId: new Types.ObjectId(departmentId),
      deletedAt: null,
    };
    if (excludeId) {
      queryObj._id = { $ne: excludeId };
    }
    const query = this.teamModel.findOne(queryObj);
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findList(
    queryDto: ListTeamsQueryDto,
  ): Promise<PaginatedResult<TeamLean>> {
    const { page = 1, limit = 20, search, isActive, departmentId } = queryDto;

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

    if (departmentId) {
      query.departmentId = new Types.ObjectId(departmentId);
    }

    const [data, total] = await Promise.all([
      this.teamModel
        .find(query)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.teamModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: Partial<Team>,
    session?: ClientSession,
  ): Promise<TeamLean | null> {
    const query = this.teamModel.findOneAndUpdate(
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
  ): Promise<TeamLean | null> {
    const query = this.teamModel.findOneAndUpdate(
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
  ): Promise<TeamLean | null> {
    const query = this.teamModel.findOneAndUpdate(
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
