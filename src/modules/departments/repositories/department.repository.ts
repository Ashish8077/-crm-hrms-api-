import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Department } from '../schemas/department.schema';
import { ListDepartmentsQueryDto } from '../dto/list-departments-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { escapeRegExp } from '../../../common/utils/regex.util';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type DepartmentLean = Department & { _id: Types.ObjectId };

@Injectable()
export class DepartmentRepository {
  constructor(
    @InjectModel(Department.name)
    private readonly departmentModel: Model<Department>,
  ) {}

  async create(
    data: Partial<Department>,
    session?: ClientSession,
  ): Promise<DepartmentLean> {
    const created = new this.departmentModel(data);
    const saved = await created.save({ session });
    return saved.toObject();
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<DepartmentLean | null> {
    const query = this.departmentModel.findOne({ _id: id, deletedAt: null });
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findByName(
    name: string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DepartmentLean | null> {
    const cleanSearch = escapeRegExp(name.trim());
    const query: Record<string, any> = {
      name: { $regex: new RegExp(`^${cleanSearch}$`, 'i') },
      deletedAt: null,
    };

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const mongooseQuery = this.departmentModel.findOne(query);
    if (session) {
      mongooseQuery.session(session);
    }
    return mongooseQuery.lean().exec();
  }

  async findList(
    queryDto: ListDepartmentsQueryDto,
  ): Promise<PaginatedResult<DepartmentLean>> {
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
      this.departmentModel
        .find(query)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.departmentModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: Partial<Department>,
    session?: ClientSession,
  ): Promise<DepartmentLean | null> {
    const query = this.departmentModel.findOneAndUpdate(
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
  ): Promise<DepartmentLean | null> {
    const query = this.departmentModel.findOneAndUpdate(
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
  ): Promise<DepartmentLean | null> {
    const query = this.departmentModel.findOneAndUpdate(
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
