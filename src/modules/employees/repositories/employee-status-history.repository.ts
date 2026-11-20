import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import {
  EmployeeStatusHistory,
  EmployeeStatusHistoryDocument,
} from '../schemas/employee-status-history.schema';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';

@Injectable()
export class EmployeeStatusHistoryRepository {
  constructor(
    @InjectModel(EmployeeStatusHistory.name)
    private readonly statusHistoryModel: Model<EmployeeStatusHistoryDocument>,
  ) {}

  async create(
    data: Partial<EmployeeStatusHistory>,
    session?: ClientSession,
  ): Promise<EmployeeStatusHistoryDocument> {
    const doc = new this.statusHistoryModel(data);
    return doc.save({ session });
  }

  async findByEmployeeId(
    employeeId: Types.ObjectId,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<EmployeeStatusHistoryDocument>> {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const filter = { employeeId };

    const [data, total] = await Promise.all([
      this.statusHistoryModel
        .find(filter)
        .sort({ changedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.statusHistoryModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }
}
