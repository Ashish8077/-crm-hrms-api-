import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
  PayrollPeriodLean,
} from '../schemas/payroll-period.schema';
import {
  PayrollPeriodSortableField,
  PayrollPeriodStatus,
} from '../constants/payroll-period.constant';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';

export interface PayrollPeriodQueryFilter {
  year?: number;
  month?: number;
  status?: PayrollPeriodStatus;
  payrollFrequency?: PayrollFrequency;
  search?: string;
}

export interface PayrollPeriodPaginationOptions {
  page: number;
  limit: number;
  sortBy?: PayrollPeriodSortableField;
  sortOrder?: 'asc' | 'desc';
}

interface MongoErrorShape {
  code?: number;
  message?: string;
  cause?: { code?: number; message?: string };
}

@Injectable()
export class PayrollPeriodRepository {
  constructor(
    @InjectModel(PayrollPeriod.name)
    private readonly periodModel: Model<PayrollPeriodDocument>,
  ) {}

  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as MongoErrorShape;
    if (err.code === 11000) return true;
    if (typeof err.message === 'string' && err.message.includes('E11000')) {
      return true;
    }
    if (err.cause && typeof err.cause === 'object') {
      if (
        err.cause.code === 11000 ||
        (typeof err.cause.message === 'string' &&
          err.cause.message.includes('E11000'))
      ) {
        return true;
      }
    }
    return false;
  }

  async create(
    data: Partial<PayrollPeriod>,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean> {
    const doc = new this.periodModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as PayrollPeriodLean;
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const query = this.periodModel.findOne({
      _id: id,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollPeriodLean>().exec();
  }

  async findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const query = this.periodModel
      .findOne({
        periodCode: code.trim().toUpperCase(),
        deletedAt: null,
      })
      .collation({ locale: 'en', strength: 2 });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollPeriodLean>().exec();
  }

  async findOverlapping(
    startDate: Date,
    endDate: Date,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const query = this.periodModel.findOne(filter);
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollPeriodLean>().exec();
  }

  async findDuplicateCycle(
    year: number,
    month: number,
    frequency: PayrollFrequency,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      year,
      month,
      payrollFrequency: frequency,
    };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const query = this.periodModel.findOne(filter);
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollPeriodLean>().exec();
  }

  async findList(
    filter: PayrollPeriodQueryFilter,
    pagination: PayrollPeriodPaginationOptions,
  ): Promise<PaginatedResult<PayrollPeriodLean>> {
    const queryFilter: Record<string, unknown> = {
      deletedAt: null,
    };

    if (filter.year !== undefined) {
      queryFilter.year = filter.year;
    }
    if (filter.month !== undefined) {
      queryFilter.month = filter.month;
    }
    if (filter.status !== undefined) {
      queryFilter.status = filter.status;
    }
    if (filter.payrollFrequency !== undefined) {
      queryFilter.payrollFrequency = filter.payrollFrequency;
    }
    if (filter.search) {
      const sanitized = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      queryFilter.$or = [
        { periodName: { $regex: sanitized, $options: 'i' } },
        { periodCode: { $regex: sanitized, $options: 'i' } },
      ];
    }

    const page = Math.max(1, pagination.page);
    const limit = Math.max(1, pagination.limit);
    const skip = (page - 1) * limit;

    const sortBy = pagination.sortBy ?? 'startDate';
    const sortOrder = pagination.sortOrder === 'asc' ? 1 : -1;

    const [data, total] = await Promise.all([
      this.periodModel
        .find(queryFilter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean<PayrollPeriodLean[]>()
        .exec(),
      this.periodModel.countDocuments(queryFilter).exec(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async updateById(
    id: Types.ObjectId,
    updateData: Partial<PayrollPeriod>,
    expectedVersion?: number,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const sanitizedSet: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined) {
        sanitizedSet[key] = value;
      }
    }

    const queryFilter: Record<string, unknown> = {
      _id: id,
      deletedAt: null,
    };
    if (typeof expectedVersion === 'number') {
      queryFilter.__v = expectedVersion;
    }

    const query = this.periodModel.findOneAndUpdate(
      queryFilter,
      { $set: sanitizedSet, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true, session },
    );

    return query.lean<PayrollPeriodLean>().exec();
  }

  async updateStatus(
    id: Types.ObjectId,
    newStatus: PayrollPeriodStatus,
    actorId: Types.ObjectId,
    expectedVersion?: number,
    session?: ClientSession,
  ): Promise<PayrollPeriodLean | null> {
    const queryFilter: Record<string, unknown> = {
      _id: id,
      deletedAt: null,
    };
    if (typeof expectedVersion === 'number') {
      queryFilter.__v = expectedVersion;
    }

    const query = this.periodModel.findOneAndUpdate(
      queryFilter,
      {
        $set: {
          status: newStatus,
          updatedBy: actorId,
        },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', runValidators: true, session },
    );

    return query.lean<PayrollPeriodLean>().exec();
  }
}
