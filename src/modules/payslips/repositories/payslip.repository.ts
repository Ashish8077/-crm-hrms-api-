import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  Payslip,
  PayslipDocument,
  PayslipLean,
} from '../schemas/payslip.schema';

export interface CreatePayslipInput {
  payrollPeriodId: Types.ObjectId;
  payrollRecordId: Types.ObjectId;
  employeeId: Types.ObjectId;
  payrollCalculationVersion: number;
  templateVersion: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksumSha256: string;
  generatedAt: Date;
  generatedBy: Types.ObjectId;
}

interface MongoErrorShape {
  code?: number;
  message?: string;
  cause?: { code?: number; message?: string };
}

@Injectable()
export class PayslipRepository {
  constructor(
    @InjectModel(Payslip.name)
    private readonly payslipModel: Model<PayslipDocument>,
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
    input: CreatePayslipInput,
    session?: ClientSession,
  ): Promise<PayslipLean> {
    const doc = new this.payslipModel(input);
    const saved = await doc.save({ session });
    return saved.toObject() as PayslipLean;
  }

  async findByPeriodAndEmployee(
    payrollPeriodId: Types.ObjectId,
    employeeId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayslipLean | null> {
    const query = this.payslipModel.findOne({
      payrollPeriodId,
      employeeId,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<PayslipLean>().exec();
  }

  async updateRegeneratedAtomically(
    id: Types.ObjectId,
    expectedVersion: number,
    update: {
      payrollRecordId: Types.ObjectId;
      payrollCalculationVersion: number;
      templateVersion: string;
      fileKey: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      checksumSha256: string;
      generatedAt: Date;
      generatedBy: Types.ObjectId;
    },
    session?: ClientSession,
  ): Promise<PayslipLean | null> {
    const query = this.payslipModel.findOneAndUpdate(
      {
        _id: id,
        __v: expectedVersion,
      },
      {
        $set: update,
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', runValidators: true, session },
    );

    return query.lean<PayslipLean>().exec();
  }

  async findPaginatedByPeriod(
    payrollPeriodId: Types.ObjectId,
    query: {
      page: number;
      limit: number;
      search?: string;
    },
  ): Promise<{
    data: Array<{
      id: Types.ObjectId;
      payrollPeriodId: Types.ObjectId;
      payrollRecordId: Types.ObjectId;
      employeeId: Types.ObjectId;
      employeeCode: string;
      employeeName: string;
      currency: string;
      grossEarnings: Types.Decimal128;
      totalDeductions: Types.Decimal128;
      netSalary: Types.Decimal128;
      payrollCalculationVersion: number;
      templateVersion: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      generatedAt: Date;
      generatedBy: Types.ObjectId;
    }>;
    total: number;
  }> {
    const safePage = Math.max(1, query.page);
    const safeLimit = Math.max(1, query.limit);
    const skip = (safePage - 1) * safeLimit;

    const pipeline: Record<string, unknown>[] = [
      { $match: { payrollPeriodId } },
      {
        $lookup: {
          from: 'payroll_records',
          localField: 'payrollRecordId',
          foreignField: '_id',
          pipeline: [
            {
              $project: {
                _id: 1,
                grossEarnings: 1,
                totalDeductions: 1,
                netSalary: 1,
                'calculationSnapshot.employeeCode': 1,
                'calculationSnapshot.employeeName': 1,
                'calculationSnapshot.currency': 1,
              },
            },
          ],
          as: 'record',
        },
      },
      {
        $unwind: {
          path: '$record',
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    if (query.search && query.search.trim().length > 0) {
      const escaped = query.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      pipeline.push({
        $match: {
          $or: [
            { 'record.calculationSnapshot.employeeCode': regex },
            { 'record.calculationSnapshot.employeeName': regex },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        items: [
          { $sort: { generatedAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: safeLimit },
          {
            $project: {
              _id: 0,
              id: '$_id',
              payrollPeriodId: 1,
              payrollRecordId: 1,
              employeeId: 1,
              employeeCode: {
                $ifNull: ['$record.calculationSnapshot.employeeCode', ''],
              },
              employeeName: {
                $ifNull: ['$record.calculationSnapshot.employeeName', ''],
              },
              currency: {
                $ifNull: ['$record.calculationSnapshot.currency', 'INR'],
              },
              grossEarnings: { $ifNull: ['$record.grossEarnings', 0] },
              totalDeductions: { $ifNull: ['$record.totalDeductions', 0] },
              netSalary: { $ifNull: ['$record.netSalary', 0] },
              payrollCalculationVersion: 1,
              templateVersion: 1,
              fileName: 1,
              mimeType: 1,
              fileSize: 1,
              generatedAt: 1,
              generatedBy: 1,
            },
          },
        ],
        totalCount: [{ $count: 'count' }],
      },
    });

    const [result] = await this.payslipModel
      .aggregate<{
        items: Array<{
          id: Types.ObjectId;
          payrollPeriodId: Types.ObjectId;
          payrollRecordId: Types.ObjectId;
          employeeId: Types.ObjectId;
          employeeCode: string;
          employeeName: string;
          currency: string;
          grossEarnings: Types.Decimal128;
          totalDeductions: Types.Decimal128;
          netSalary: Types.Decimal128;
          payrollCalculationVersion: number;
          templateVersion: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          generatedAt: Date;
          generatedBy: Types.ObjectId;
        }>;
        totalCount: Array<{ count: number }>;
      }>(
        pipeline as unknown as Parameters<
          Model<PayslipDocument>['aggregate']
        >[0],
      )
      .exec();

    return {
      data: result?.items ?? [],
      total: result?.totalCount?.[0]?.count ?? 0,
    };
  }
}
