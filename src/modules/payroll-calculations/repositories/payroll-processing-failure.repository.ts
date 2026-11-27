import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import { PAYROLL_PROCESSING_CONSTANTS } from '../constants/payroll-calculation.constant';
import {
  PayrollProcessingFailure,
  PayrollProcessingFailureDocument,
  PayrollProcessingFailureLean,
} from '../schemas/payroll-processing-failure.schema';

export interface UpsertPayrollProcessingFailureItem {
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  errorCode: string;
  errorMessage: string;
  attemptNumber: number;
  lastAttemptAt: Date;
}

export function sanitizeProcessingErrorMessage(message: string): string {
  const cleaned = message
    .replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, '[REDACTED_URI]')
    .replace(/\s+/g, ' ')
    .trim();
  const maxLen = PAYROLL_PROCESSING_CONSTANTS.MAX_ERROR_MESSAGE_LENGTH;
  return cleaned.length > maxLen
    ? `${cleaned.slice(0, maxLen - 3)}...`
    : cleaned;
}

@Injectable()
export class PayrollProcessingFailureRepository {
  constructor(
    @InjectModel(PayrollProcessingFailure.name)
    private readonly failureModel: Model<PayrollProcessingFailureDocument>,
  ) {}

  async upsertFailuresBulk(
    payrollPeriodId: Types.ObjectId,
    items: UpsertPayrollProcessingFailureItem[],
    session?: ClientSession,
  ): Promise<void> {
    if (items.length === 0) return;

    await this.failureModel.bulkWrite(
      items.map((item) => ({
        updateOne: {
          filter: { payrollPeriodId, employeeId: item.employeeId },
          update: {
            $set: {
              employeeCode: item.employeeCode,
              employeeName: item.employeeName,
              errorCode: item.errorCode,
              errorMessage: sanitizeProcessingErrorMessage(item.errorMessage),
              attemptNumber: item.attemptNumber,
              lastAttemptAt: item.lastAttemptAt,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false, session },
    );
  }

  async deleteByPeriodAndEmployees(
    payrollPeriodId: Types.ObjectId,
    employeeIds: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<void> {
    if (employeeIds.length === 0) return;
    await this.failureModel
      .deleteMany(
        { payrollPeriodId, employeeId: { $in: employeeIds } },
        { session },
      )
      .exec();
  }

  async deleteByPeriodExcludingEmployees(
    payrollPeriodId: Types.ObjectId,
    eligibleEmployeeIds: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<void> {
    const filter =
      eligibleEmployeeIds.length > 0
        ? { payrollPeriodId, employeeId: { $nin: eligibleEmployeeIds } }
        : { payrollPeriodId };
    await this.failureModel.deleteMany(filter, { session }).exec();
  }

  async deleteByPeriod(
    payrollPeriodId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    await this.failureModel.deleteMany({ payrollPeriodId }, { session }).exec();
  }

  async countByPeriod(
    payrollPeriodId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const query = this.failureModel.countDocuments({ payrollPeriodId });
    if (session) {
      query.session(session);
    }
    return query.exec();
  }

  async findEmployeeIdsByPeriod(
    payrollPeriodId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<Types.ObjectId[]> {
    const query = this.failureModel
      .find({ payrollPeriodId })
      .select('employeeId');
    if (session) {
      query.session(session);
    }
    const docs = await query
      .lean<Array<{ employeeId: Types.ObjectId }>>()
      .exec();
    return docs.map((d) => d.employeeId);
  }

  async findPaginatedByPeriod(
    payrollPeriodId: Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<PayrollProcessingFailureLean>> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const skip = (safePage - 1) * safeLimit;
    const filter = { payrollPeriodId };

    const [data, total] = await Promise.all([
      this.failureModel
        .find(filter)
        .sort({ lastAttemptAt: -1, employeeCode: 1, _id: 1 })
        .skip(skip)
        .limit(safeLimit)
        .lean<PayrollProcessingFailureLean[]>()
        .exec(),
      this.failureModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, safePage, safeLimit),
    };
  }
}
