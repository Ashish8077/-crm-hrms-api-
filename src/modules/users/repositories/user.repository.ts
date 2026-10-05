import { Injectable } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { InjectModel } from '@nestjs/mongoose';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { escapeRegExp } from '../../../common/utils/regex.util';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import { UserStatus } from '../constants/user-status.constant';

export type UserLean = User & { _id: Types.ObjectId };

@Injectable()
export class UserRepository {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async findByEmail(
    email: string,
    excludeId?: Types.ObjectId,
  ): Promise<UserLean | null> {
    const queryObj: Record<string, any> = { email, deletedAt: null };
    if (excludeId) {
      queryObj._id = { $ne: excludeId };
    }
    return this.userModel
      .findOne(queryObj)
      .select('+passwordHash')
      .lean()
      .exec();
  }

  async updateLastLoginAt(userId: Types.ObjectId): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } })
      .exec();
  }

  async findById(
    userId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<UserLean | null> {
    const query = this.userModel.findOne({ _id: userId, deletedAt: null });
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findByIdWithPassword(userId: Types.ObjectId): Promise<UserLean | null> {
    return this.userModel
      .findById(userId)
      .select('+passwordHash')
      .lean()
      .exec();
  }

  async updateRoles(
    userId: Types.ObjectId,
    roleIds: Types.ObjectId[],
    session: ClientSession,
  ): Promise<UserLean | null> {
    return this.userModel
      .findOneAndUpdate(
        { _id: userId, deletedAt: null },
        { $set: { roleIds } },
        {
          new: true,
          runValidators: true,
          session,
        },
      )
      .lean()
      .exec();
  }

  async create(
    data: Partial<User>,
    session?: ClientSession,
  ): Promise<UserDocument> {
    const user = new this.userModel(data);
    return user.save({ session });
  }

  async findList(
    queryDto: ListUsersQueryDto,
    excludedRoleIds?: Types.ObjectId[],
  ): Promise<PaginatedResult<UserLean>> {
    const { page = 1, limit = 20, search, status, roleId } = queryDto;

    const query: Record<string, any> = {
      deletedAt: null,
    };

    if (search) {
      const cleanSearch = escapeRegExp(search.trim());
      query.email = { $regex: cleanSearch, $options: 'i' };
    }

    if (status) {
      query.status = status;
    }

    if (excludedRoleIds && excludedRoleIds.length > 0) {
      query.roleIds = { $nin: excludedRoleIds };
    }

    if (roleId) {
      if (query.roleIds && (query.roleIds as Record<string, any>).$nin) {
        (query.roleIds as Record<string, any>).$in = [
          new Types.ObjectId(roleId),
        ];
      } else {
        query.roleIds = new Types.ObjectId(roleId);
      }
    }

    const [data, total] = await Promise.all([
      this.userModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.userModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    userId: Types.ObjectId,
    data: Partial<User>,
    session?: ClientSession,
  ): Promise<UserLean | null> {
    const query = this.userModel.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { $set: data },
      { new: true, runValidators: true },
    );

    if (session) {
      query.session(session);
    }

    return query.lean().exec();
  }

  async updateStatus(
    userId: Types.ObjectId,
    status: UserStatus,
    session?: ClientSession,
  ): Promise<UserLean | null> {
    const query = this.userModel.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { $set: { status } },
      { new: true, runValidators: true },
    );

    if (session) {
      query.session(session);
    }

    return query.lean().exec();
  }
}
