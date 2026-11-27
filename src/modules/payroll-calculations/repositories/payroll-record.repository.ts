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
}
