import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission, PermissionDocument } from '../schemas/permission.schema';

@Injectable()
export class PermissionRepository {
  constructor(
    @InjectModel(Permission.name)
    private readonly permissionModel: Model<PermissionDocument>,
  ) {}

  /**
   * Find active permissions by their IDs.
   * Uses lean() for performance since these are read-only validation queries.
   */
  async findActiveByIds(
    permissionIds: Types.ObjectId[],
  ): Promise<(Permission & { _id: Types.ObjectId })[]> {
    return this.permissionModel
      .find({
        _id: { $in: permissionIds },
        isActive: true,
      })
      .lean()
      .exec();
  }

  /**
   * Find an active permission by its key (e.g. 'users.create').
   */
  async findActiveByKey(
    key: string,
  ): Promise<(Permission & { _id: Types.ObjectId }) | null> {
    return this.permissionModel
      .findOne({
        key,
        isActive: true,
      })
      .lean()
      .exec();
  }

  /**
   * Find all active permissions in the system.
   */
  async findAllActive(): Promise<(Permission & { _id: Types.ObjectId })[]> {
    return this.permissionModel.find({ isActive: true }).lean().exec();
  }
}
