import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Role, RoleDocument } from '../schemas/role.schema';
import {
  CreateCustomRoleData,
  RoleLean,
  UpdateCustomRoleData,
} from '../types/role.repository.types';

@Injectable()
export class RoleRepository {
  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
  ) {}

  async createCustomRole(
    data: CreateCustomRoleData,
    session?: ClientSession,
  ): Promise<RoleDocument> {
    const role = new this.roleModel(data);
    return role.save({ session });
  }

  async findById(id: Types.ObjectId | string): Promise<RoleLean | null> {
    return this.roleModel.findById(id).lean().exec();
  }

  async findByKey(key: string): Promise<RoleLean | null> {
    return this.roleModel.findOne({ key }).lean().exec();
  }

  async updateCustomRole(
    id: Types.ObjectId | string,
    data: UpdateCustomRoleData,
    session?: ClientSession,
  ): Promise<RoleDocument | null> {
    return this.roleModel
      .findByIdAndUpdate(
        id,
        { $set: data },
        {
          new: true,
          runValidators: true,
          session,
        },
      )
      .lean()
      .exec();
  }

  async updateStatus(
    id: Types.ObjectId | string,
    isActive: boolean,
    session?: ClientSession,
  ): Promise<RoleLean | null> {
    return this.roleModel
      .findByIdAndUpdate(
        id,
        { $set: { isActive } },
        {
          new: true,
          runValidators: true,
          session,
        },
      )
      .lean()
      .exec();
  }

  async findAll(filter: Record<string, unknown> = {}): Promise<RoleLean[]> {
    return this.roleModel.find(filter).sort({ name: 1 }).lean().exec();
  }

  async findPaginated(
    skip: number,
    limit: number,
    filter: Record<string, unknown> = {},
  ): Promise<{ roles: RoleLean[]; total: number }> {
    const [roles, total] = await Promise.all([
      this.roleModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.roleModel.countDocuments(filter).exec(),
    ]);

    return { roles, total };
  }

  async findActiveByIds(roleIds: Types.ObjectId[]): Promise<RoleLean[]> {
    return this.roleModel
      .find({
        _id: { $in: roleIds },
        isActive: true,
      })
      .lean()
      .exec();
  }
}
