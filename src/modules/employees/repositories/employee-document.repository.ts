import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import {
  EmployeeDocument,
  EmployeeDocumentDocument,
} from '../schemas/employee-document.schema';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

import { EmployeeDocumentCategory } from '../constants/employee-document.constant';

export interface CreateEmployeeDocumentData {
  employeeId: Types.ObjectId;
  category: EmployeeDocumentCategory;
  originalFileName: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: Types.ObjectId;
}

export type EmployeeDocumentLean = EmployeeDocument & {
  _id: Types.ObjectId;
  createdAt: Date;
};

@Injectable()
export class EmployeeDocumentRepository {
  constructor(
    @InjectModel(EmployeeDocument.name)
    private readonly documentModel: Model<EmployeeDocumentDocument>,
  ) {}

  async create(
    data: CreateEmployeeDocumentData,
    session?: ClientSession,
  ): Promise<EmployeeDocumentLean> {
    const doc = new this.documentModel(data);
    const saved = await doc.save({ session });
    return saved.toObject();
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<EmployeeDocumentLean | null> {
    const query = this.documentModel.findOne({ _id: id, deletedAt: null });
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  async findList(
    employeeId: Types.ObjectId | string,
    queryDto: PaginationQueryDto,
  ): Promise<PaginatedResult<EmployeeDocumentLean>> {
    const { page = 1, limit = 20 } = queryDto;

    const filter = {
      employeeId: new Types.ObjectId(employeeId),
      deletedAt: null,
    };

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.documentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.documentModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async softDelete(
    id: Types.ObjectId | string,
    deletedBy: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<EmployeeDocumentLean | null> {
    const query = this.documentModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy: new Types.ObjectId(deletedBy),
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
