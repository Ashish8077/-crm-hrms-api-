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
        status: PayrollRecordStatus.CALCULATED,
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
}
