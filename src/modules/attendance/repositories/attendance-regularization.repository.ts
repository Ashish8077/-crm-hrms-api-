import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  AttendanceRegularization,
  AttendanceRegularizationDocument,
} from '../schemas/attendance-regularization.schema';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import { RegularizationStatus } from '../constants/attendance.constant';

export type AttendanceRegularizationLean = AttendanceRegularization & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AttendanceRegularizationRepository {
  constructor(
    @InjectModel(AttendanceRegularization.name)
    private readonly regularizationModel: Model<AttendanceRegularizationDocument>,
  ) {}

  async create(
    data: Partial<AttendanceRegularization>,
    session?: ClientSession,
  ): Promise<AttendanceRegularizationLean> {
    const doc = new this.regularizationModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as AttendanceRegularizationLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<AttendanceRegularizationLean | null> {
    const query = this.regularizationModel.findOne({
      _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceRegularizationLean>().exec();
  }

  async findPendingByEmployeeAndDate(
    employeeId: Types.ObjectId | string,
    attendanceDate: string,
    session?: ClientSession,
  ): Promise<AttendanceRegularizationLean | null> {
    const query = this.regularizationModel.findOne({
      employeeId:
        typeof employeeId === 'string'
          ? new Types.ObjectId(employeeId)
          : employeeId,
      attendanceDate,
      status: RegularizationStatus.PENDING,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceRegularizationLean>().exec();
  }

  async findList(
    filter: Record<string, unknown>,
    page: number = 1,
    limit: number = 20,
    sort: Record<string, 1 | -1> = { createdAt: -1 },
  ): Promise<PaginatedResult<AttendanceRegularizationLean>> {
    const cleanFilter = { ...filter, deletedAt: null };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.regularizationModel
        .find(cleanFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<AttendanceRegularizationLean[]>()
        .exec(),
      this.regularizationModel.countDocuments(cleanFilter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateStatus(
    id: Types.ObjectId | string,
    status: RegularizationStatus,
    reviewedBy: Types.ObjectId | string,
    reviewedAt: Date,
    reviewRemarks?: string,
    session?: ClientSession,
  ): Promise<AttendanceRegularizationLean | null> {
    const updateData: Record<string, unknown> = {
      status,
      reviewedBy:
        typeof reviewedBy === 'string'
          ? new Types.ObjectId(reviewedBy)
          : reviewedBy,
      reviewedAt,
    };
    if (reviewRemarks !== undefined) {
      updateData.reviewRemarks = reviewRemarks.trim();
    }

    const query = this.regularizationModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      { $set: updateData },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceRegularizationLean>().exec();
  }
}
