import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  PayrollCalculationSnapshot,
  PayrollRecord,
  PayrollRecordDocument,
  PayrollRecordLean,
} from '../schemas/payroll-record.schema';
import { PayrollRecordStatus } from '../constants/payroll-calculation.constant';

export interface CreatePayrollRecordInput {
  payrollPeriodId: Types.ObjectId;
  employeeId: Types.ObjectId;
  salaryAssignmentId: Types.ObjectId;
  salaryStructureId: Types.ObjectId;
  calculationSnapshot: PayrollCalculationSnapshot;
  grossEarnings: Types.Decimal128;
  totalDeductions: Types.Decimal128;
  employerContributions: Types.Decimal128;
  netSalary: Types.Decimal128;
  status: PayrollRecordStatus;
  calculatedAt: Date;
  calculationVersion: number;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}

export interface RecalculatePayrollRecordInput {
  salaryAssignmentId: Types.ObjectId;
  salaryStructureId: Types.ObjectId;
  calculationSnapshot: PayrollCalculationSnapshot;
  grossEarnings: Types.Decimal128;
  totalDeductions: Types.Decimal128;
  employerContributions: Types.Decimal128;
  netSalary: Types.Decimal128;
  calculatedAt: Date;
  updatedBy: Types.ObjectId;
}

interface MongoErrorShape {
  code?: number;
  message?: string;
  name?: string;
  cause?: {
    code?: number;
    message?: string;
  };
}

@Injectable()
export class PayrollRecordRepository {
  constructor(
    @InjectModel(PayrollRecord.name)
    private readonly payrollRecordModel: Model<PayrollRecordDocument>,
  ) {}

  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as MongoErrorShape;
    if (err.code === 11000) return true;
    if (typeof err.message === 'string' && err.message.includes('E11000')) {
      return true;
    }
    if (err.name === 'MongoServerError' && err.code === 11000) return true;
    if (err.name === 'MongoBulkWriteError' && err.code === 11000) return true;
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

  async findByPeriodAndEmployee(
    payrollPeriodId: Types.ObjectId,
    employeeId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayrollRecordLean | null> {
    const query = this.payrollRecordModel.findOne({
      payrollPeriodId,
      employeeId,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollRecordLean>().exec();
  }

  async create(
    input: CreatePayrollRecordInput,
    session?: ClientSession,
  ): Promise<PayrollRecordLean> {
    const doc = new this.payrollRecordModel({
      ...input,
      deletedAt: null,
    });
    const saved = await doc.save({ session });
    return saved.toObject() as PayrollRecordLean;
  }

  async createMany(
    inputs: CreatePayrollRecordInput[],
    session?: ClientSession,
  ): Promise<PayrollRecordLean[]> {
    if (inputs.length === 0) return [];
    const docs = inputs.map((input) => ({
      ...input,
      deletedAt: null,
    }));
    const saved = await this.payrollRecordModel.insertMany(docs, { session });
    return saved.map((d) => d.toObject() as PayrollRecordLean);
  }

  async recalculateAtomically(
    id: Types.ObjectId,
    expectedVersion: number,
    input: RecalculatePayrollRecordInput,
    session?: ClientSession,
  ): Promise<PayrollRecordLean | null> {
    const query = this.payrollRecordModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        status: {
          $in: [
            PayrollRecordStatus.CALCULATED,
            PayrollRecordStatus.INVALIDATED,
          ],
        },
        __v: expectedVersion,
      },
      {
        $set: {
          salaryAssignmentId: input.salaryAssignmentId,
          salaryStructureId: input.salaryStructureId,
          calculationSnapshot: input.calculationSnapshot,
          grossEarnings: input.grossEarnings,
          totalDeductions: input.totalDeductions,
          employerContributions: input.employerContributions,
          netSalary: input.netSalary,
          status: PayrollRecordStatus.CALCULATED,
          invalidatedAt: null,
          invalidatedBy: null,
          invalidationReason: null,
          calculatedAt: input.calculatedAt,
          updatedBy: input.updatedBy,
        },
        $inc: {
          calculationVersion: 1,
          __v: 1,
        },
      },
      {
        returnDocument: 'after',
        runValidators: true,
        session,
      },
    );

    return query.lean<PayrollRecordLean>().exec();
  }

  async invalidateCalculatedByPeriodAndEmployees(
    params: {
      payrollPeriodId: Types.ObjectId;
      employeeIds: Types.ObjectId[];
      reason: string;
      actorId: Types.ObjectId;
      invalidatedAt: Date;
    },
    session?: ClientSession,
  ): Promise<number> {
    if (params.employeeIds.length === 0) return 0;
    const res = await this.payrollRecordModel
      .updateMany(
        {
          payrollPeriodId: params.payrollPeriodId,
          employeeId: { $in: params.employeeIds },
          deletedAt: null,
          status: PayrollRecordStatus.CALCULATED,
        },
        {
          $set: {
            status: PayrollRecordStatus.INVALIDATED,
            invalidatedAt: params.invalidatedAt,
            invalidatedBy: params.actorId,
            invalidationReason: params.reason,
            updatedBy: params.actorId,
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return res.modifiedCount;
  }

  /**
   * Batch fetches active PayrollRecords for a set of employees in a period using uq_payroll_records_period_employee.
   * Includes INVALIDATED records so reactivated employees can cleanly transition back to CALCULATED.
   */
  async findActiveByPeriodAndEmployees(
    payrollPeriodId: Types.ObjectId,
    employeeIds: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<PayrollRecordLean[]> {
    if (employeeIds.length === 0) return [];
    const query = this.payrollRecordModel
      .find({
        payrollPeriodId,
        employeeId: { $in: employeeIds },
        deletedAt: null,
      })
      .select(
        '_id payrollPeriodId employeeId salaryAssignmentId salaryStructureId status calculationVersion calculatedAt __v calculationSnapshot.inputFingerprint calculationSnapshot.engineVersion grossEarnings totalDeductions employerContributions netSalary invalidatedAt invalidatedBy invalidationReason',
      );
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollRecordLean[]>().exec();
  }

  /**
   * Fetches full PayrollRecord documents including complete calculationSnapshot for audit preservation
   * before invalidation or recalculation overwrites the active record.
   */
  async findFullByPeriodAndEmployees(
    payrollPeriodId: Types.ObjectId,
    employeeIds: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<PayrollRecordLean[]> {
    if (employeeIds.length === 0) return [];
    const query = this.payrollRecordModel.find({
      payrollPeriodId,
      employeeId: { $in: employeeIds },
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollRecordLean[]>().exec();
  }

  /**
   * Fetches compact status and fingerprint summaries for all non-invalidated PayrollRecords in a period.
   */
  async findActiveSummariesByPeriod(
    payrollPeriodId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<
    Array<{
      _id: Types.ObjectId;
      employeeId: Types.ObjectId;
      status: PayrollRecordStatus;
      calculationVersion: number;
      calculatedAt: Date;
      inputFingerprint: string | null;
    }>
  > {
    const query = this.payrollRecordModel
      .find({
        payrollPeriodId,
        deletedAt: null,
        status: { $ne: PayrollRecordStatus.INVALIDATED },
      })
      .select(
        '_id employeeId status calculationVersion calculatedAt calculationSnapshot.inputFingerprint',
      );
    if (session) {
      query.session(session);
    }
    const docs = await query
      .lean<
        Array<{
          _id: Types.ObjectId;
          employeeId: Types.ObjectId;
          status: PayrollRecordStatus;
          calculationVersion: number;
          calculatedAt: Date;
          calculationSnapshot?: { inputFingerprint?: string | null };
        }>
      >()
      .exec();

    return docs.map((d) => ({
      _id: d._id,
      employeeId: d.employeeId,
      status: d.status,
      calculationVersion: d.calculationVersion,
      calculatedAt: d.calculatedAt,
      inputFingerprint: d.calculationSnapshot?.inputFingerprint ?? null,
    }));
  }

  async findByIdAndPeriod(
    recordId: Types.ObjectId,
    payrollPeriodId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PayrollRecordLean | null> {
    const query = this.payrollRecordModel.findOne({
      _id: recordId,
      payrollPeriodId,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollRecordLean>().exec();
  }

  async approveCalculatedRecordsByIds(
    params: {
      payrollPeriodId: Types.ObjectId;
      recordIds: Types.ObjectId[];
      actorId: Types.ObjectId;
      approvedAt: Date;
    },
    session?: ClientSession,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    if (params.recordIds.length === 0) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    const res = await this.payrollRecordModel
      .updateMany(
        {
          _id: { $in: params.recordIds },
          payrollPeriodId: params.payrollPeriodId,
          deletedAt: null,
          status: PayrollRecordStatus.CALCULATED,
        },
        {
          $set: {
            status: PayrollRecordStatus.APPROVED,
            approvedAt: params.approvedAt,
            approvedBy: params.actorId,
            updatedBy: params.actorId,
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();

    return {
      matchedCount: res.matchedCount,
      modifiedCount: res.modifiedCount,
    };
  }

  async aggregateReviewSummary(
    payrollPeriodId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<{
    calculatedCount: number;
    approvedCount: number;
    invalidatedCount: number;
    totalGrossEarnings: string;
    totalDeductions: string;
    totalEmployerContributions: string;
    totalNetSalary: string;
    versionCounts: Record<string, number>;
  }> {
    const agg = this.payrollRecordModel.aggregate<{
      statusCounts: Array<{ _id: PayrollRecordStatus; count: number }>;
      activeTotals: Array<{
        totalGrossEarnings?: { toString(): string } | number | null;
        totalDeductions?: { toString(): string } | number | null;
        totalEmployerContributions?: { toString(): string } | number | null;
        totalNetSalary?: { toString(): string } | number | null;
      }>;
      versionCounts: Array<{ _id: number; count: number }>;
    }>([
      {
        $match: {
          payrollPeriodId,
          deletedAt: null,
        },
      },
      {
        $facet: {
          statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          activeTotals: [
            {
              $match: {
                status: {
                  $in: [
                    PayrollRecordStatus.CALCULATED,
                    PayrollRecordStatus.APPROVED,
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                totalGrossEarnings: { $sum: '$grossEarnings' },
                totalDeductions: { $sum: '$totalDeductions' },
                totalEmployerContributions: { $sum: '$employerContributions' },
                totalNetSalary: { $sum: '$netSalary' },
              },
            },
          ],
          versionCounts: [
            {
              $match: {
                status: {
                  $in: [
                    PayrollRecordStatus.CALCULATED,
                    PayrollRecordStatus.APPROVED,
                  ],
                },
              },
            },
            { $group: { _id: '$calculationVersion', count: { $sum: 1 } } },
          ],
        },
      },
    ]);

    if (session) {
      agg.session(session);
    }

    const [result] = await agg.exec();
    const byStatus = new Map<PayrollRecordStatus, number>(
      (result?.statusCounts ?? []).map((s) => [s._id, s.count]),
    );
    const totals = result?.activeTotals?.[0];
    const versionCounts: Record<string, number> = {};
    for (const v of result?.versionCounts ?? []) {
      versionCounts[String(v._id)] = v.count;
    }

    return {
      calculatedCount: byStatus.get(PayrollRecordStatus.CALCULATED) ?? 0,
      approvedCount: byStatus.get(PayrollRecordStatus.APPROVED) ?? 0,
      invalidatedCount: byStatus.get(PayrollRecordStatus.INVALIDATED) ?? 0,
      totalGrossEarnings: totals?.totalGrossEarnings?.toString() ?? '0',
      totalDeductions: totals?.totalDeductions?.toString() ?? '0',
      totalEmployerContributions:
        totals?.totalEmployerContributions?.toString() ?? '0',
      totalNetSalary: totals?.totalNetSalary?.toString() ?? '0',
      versionCounts,
    };
  }

  async findPaginatedForReview(
    payrollPeriodId: Types.ObjectId,
    query: {
      page: number;
      limit: number;
      search?: string;
      departmentId?: Types.ObjectId;
      branchId?: Types.ObjectId;
      status?: PayrollRecordStatus;
      hasAnomalies?: boolean;
    },
  ): Promise<{
    data: Array<{
      id: Types.ObjectId;
      employeeId: Types.ObjectId;
      employeeCode: string;
      employeeName: string;
      employmentStatus: string;
      departmentId: Types.ObjectId | null;
      branchId: Types.ObjectId | null;
      status: PayrollRecordStatus;
      grossEarnings: Types.Decimal128;
      totalDeductions: Types.Decimal128;
      employerContributions: Types.Decimal128;
      netSalary: Types.Decimal128;
      payableDays: number;
      totalLopDays: number;
      calculationVersion: number;
      calculatedAt: Date;
      approvedAt: Date | null;
      approvedBy: Types.ObjectId | null;
      invalidatedAt: Date | null;
      invalidationReason: string | null;
      warnings: string[];
      leaveAttendanceMismatchDates: string[];
    }>;
    total: number;
  }> {
    const safePage = Math.max(1, query.page);
    const safeLimit = Math.max(1, query.limit);
    const skip = (safePage - 1) * safeLimit;

    const matchStage: Record<string, unknown> = {
      payrollPeriodId,
      deletedAt: null,
    };
    if (query.status) {
      matchStage.status = query.status;
    }
    if (query.hasAnomalies === true) {
      matchStage.$expr = {
        $or: [
          {
            $gt: [
              {
                $size: {
                  $ifNull: ['$calculationSnapshot.attendanceLeaveWarnings', []],
                },
              },
              0,
            ],
          },
          {
            $gt: [
              {
                $size: {
                  $ifNull: [
                    '$calculationSnapshot.leaveAttendanceMismatchDates',
                    [],
                  ],
                },
              },
              0,
            ],
          },
        ],
      };
    } else if (query.hasAnomalies === false) {
      matchStage.$expr = {
        $and: [
          {
            $eq: [
              {
                $size: {
                  $ifNull: ['$calculationSnapshot.attendanceLeaveWarnings', []],
                },
              },
              0,
            ],
          },
          {
            $eq: [
              {
                $size: {
                  $ifNull: [
                    '$calculationSnapshot.leaveAttendanceMismatchDates',
                    [],
                  ],
                },
              },
              0,
            ],
          },
        ],
      };
    }

    const pipeline: Record<string, unknown>[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'employees',
          localField: 'employeeId',
          foreignField: '_id',
          pipeline: [
            {
              $project: {
                _id: 1,
                employeeCode: 1,
                firstName: 1,
                lastName: 1,
                departmentId: 1,
                branchId: 1,
                employmentStatus: 1,
              },
            },
          ],
          as: 'emp',
        },
      },
      {
        $unwind: {
          path: '$emp',
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    const postLookupMatch: Record<string, unknown> = {};
    if (query.departmentId) {
      postLookupMatch['emp.departmentId'] = query.departmentId;
    }
    if (query.branchId) {
      postLookupMatch['emp.branchId'] = query.branchId;
    }
    if (query.search && query.search.trim().length > 0) {
      const escaped = query.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      postLookupMatch.$or = [
        { 'calculationSnapshot.employeeCode': regex },
        { 'calculationSnapshot.employeeName': regex },
        { 'emp.employeeCode': regex },
        { 'emp.firstName': regex },
        { 'emp.lastName': regex },
      ];
    }
    if (Object.keys(postLookupMatch).length > 0) {
      pipeline.push({ $match: postLookupMatch });
    }

    pipeline.push(
      {
        $sort: {
          'calculationSnapshot.employeeCode': 1,
          _id: 1,
        },
      },
      {
        $facet: {
          total: [{ $count: 'count' }],
          data: [
            { $skip: skip },
            { $limit: safeLimit },
            {
              $project: {
                _id: 0,
                id: '$_id',
                employeeId: '$employeeId',
                employeeCode: {
                  $ifNull: [
                    '$emp.employeeCode',
                    '$calculationSnapshot.employeeCode',
                  ],
                },
                employeeName: {
                  $ifNull: [
                    '$calculationSnapshot.employeeName',
                    {
                      $trim: {
                        input: {
                          $concat: [
                            { $ifNull: ['$emp.firstName', ''] },
                            ' ',
                            { $ifNull: ['$emp.lastName', ''] },
                          ],
                        },
                      },
                    },
                  ],
                },
                employmentStatus: {
                  $ifNull: [
                    '$emp.employmentStatus',
                    '$calculationSnapshot.employmentStatus',
                  ],
                },
                departmentId: { $ifNull: ['$emp.departmentId', null] },
                branchId: { $ifNull: ['$emp.branchId', null] },
                status: '$status',
                grossEarnings: '$grossEarnings',
                totalDeductions: '$totalDeductions',
                employerContributions: '$employerContributions',
                netSalary: '$netSalary',
                payableDays: '$calculationSnapshot.payableDays',
                totalLopDays: '$calculationSnapshot.totalLopDays',
                calculationVersion: '$calculationVersion',
                calculatedAt: '$calculatedAt',
                approvedAt: { $ifNull: ['$approvedAt', null] },
                approvedBy: { $ifNull: ['$approvedBy', null] },
                invalidatedAt: { $ifNull: ['$invalidatedAt', null] },
                invalidationReason: { $ifNull: ['$invalidationReason', null] },
                warnings: {
                  $ifNull: ['$calculationSnapshot.attendanceLeaveWarnings', []],
                },
                leaveAttendanceMismatchDates: {
                  $ifNull: [
                    '$calculationSnapshot.leaveAttendanceMismatchDates',
                    [],
                  ],
                },
              },
            },
          ],
        },
      },
    );

    const [aggResult] = await this.payrollRecordModel
      .aggregate<{
        total: Array<{ count: number }>;
        data: Array<{
          id: Types.ObjectId;
          employeeId: Types.ObjectId;
          employeeCode: string;
          employeeName: string;
          employmentStatus: string;
          departmentId: Types.ObjectId | null;
          branchId: Types.ObjectId | null;
          status: PayrollRecordStatus;
          grossEarnings: Types.Decimal128;
          totalDeductions: Types.Decimal128;
          employerContributions: Types.Decimal128;
          netSalary: Types.Decimal128;
          payableDays: number;
          totalLopDays: number;
          calculationVersion: number;
          calculatedAt: Date;
          approvedAt: Date | null;
          approvedBy: Types.ObjectId | null;
          invalidatedAt: Date | null;
          invalidationReason: string | null;
          warnings: string[];
          leaveAttendanceMismatchDates: string[];
        }>;
      }>(pipeline as unknown as never[])
      .exec();

    return {
      data: aggResult?.data ?? [],
      total: aggResult?.total?.[0]?.count ?? 0,
    };
  }
}
