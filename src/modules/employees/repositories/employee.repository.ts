import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Employee } from '../schemas/employee.schema';
import { ListEmployeesQueryDto } from '../dto/list-employees-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { escapeRegExp } from '../../../common/utils/regex.util';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type EmployeeLean = Employee & { _id: Types.ObjectId };

@Injectable()
export class EmployeeRepository {
  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<Employee>,
  ) {}

  async create(
    data: Partial<Employee>,
    session?: ClientSession,
  ): Promise<EmployeeLean> {
    const created = new this.employeeModel(data);
    const saved = await created.save({ session });
    return saved.toObject();
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<EmployeeLean | null> {
    const query = this.employeeModel.findOne({ _id: id, deletedAt: null });
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findByWorkEmail(
    workEmail: string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<EmployeeLean | null> {
    const query: Record<string, any> = {
      workEmail: workEmail.toLowerCase(),
      deletedAt: null,
    };

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const mongooseQuery = this.employeeModel.findOne(query);
    if (session) {
      mongooseQuery.session(session);
    }
    return mongooseQuery.lean().exec();
  }

  async findByCode(
    employeeCode: string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<EmployeeLean | null> {
    const query: Record<string, any> = {
      employeeCode,
      deletedAt: null,
    };

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const mongooseQuery = this.employeeModel.findOne(query);
    if (session) {
      mongooseQuery.session(session);
    }
    return mongooseQuery.lean().exec();
  }

  async findList(
    queryDto: ListEmployeesQueryDto,
  ): Promise<PaginatedResult<EmployeeLean>> {
    const {
      page = 1,
      limit = 20,
      search,
      departmentId,
      teamId,
      branchId,
      employmentStatus,
    } = queryDto;

    const query: Record<string, any> = {
      deletedAt: null,
    };

    if (search) {
      const cleanSearch = escapeRegExp(search.trim());
      const searchRegex = { $regex: cleanSearch, $options: 'i' };
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { workEmail: searchRegex },
        { employeeCode: searchRegex },
      ];
    }

    if (departmentId) {
      query.departmentId = new Types.ObjectId(departmentId);
    }

    if (teamId) {
      query.teamId = new Types.ObjectId(teamId);
    }

    if (branchId) {
      query.branchId = new Types.ObjectId(branchId);
    }

    if (employmentStatus) {
      query.employmentStatus = employmentStatus;
    }

    const [data, total] = await Promise.all([
      this.employeeModel
        .find(query)
        .sort({ firstName: 1, lastName: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.employeeModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<EmployeeLean | null> {
    const query = this.employeeModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: data },
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
  ): Promise<EmployeeLean | null> {
    const query = this.employeeModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async getNextEmployeeCode(): Promise<string> {
    const collection = this.employeeModel.db.collection<{
      _id: string;
      seq: number;
    }>('counters');
    const result = await collection.findOneAndUpdate(
      { _id: 'employeeCode' },
      { $inc: { seq: 1 } },
      { returnDocument: 'after', upsert: true },
    );

    let seq = 1;
    if (result) {
      if (
        'value' in result &&
        result.value &&
        typeof (result.value as { seq: number }).seq === 'number'
      ) {
        seq = (result.value as { seq: number }).seq;
      } else if (
        'seq' in result &&
        typeof (result as { seq: number }).seq === 'number'
      ) {
        seq = (result as { seq: number }).seq;
      }
    }

    return `EMP-${String(seq).padStart(4, '0')}`;
  }
}
