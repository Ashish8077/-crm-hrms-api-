import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  EmployeeSalary,
  EmployeeSalaryDocument,
  EmployeeSalaryLean,
  SalarySnapshot,
} from '../schemas/employee-salary.schema';
import { EmployeeSalaryStatus } from '../constants/employee-salary.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
} from '../../salary-structures/constants/salary-structure.constant';
import { EmployeeSalaryHistoryQueryDto } from '../dto/employee-salary-history-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export interface CreateEmployeeSalaryInput {
  employeeId: Types.ObjectId;
  salaryStructureId: Types.ObjectId;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  salaryBasis: SalaryStructureBasis;
  salaryFrequency: SalaryStructureFrequency;
  salaryAmount: number;
  salaryStructureVersion: number;
  salarySnapshot: SalarySnapshot;
  status?: EmployeeSalaryStatus;
  createdBy: Types.ObjectId;
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
export class EmployeeSalaryRepository {
  constructor(
    @InjectModel(EmployeeSalary.name)
    private readonly employeeSalaryModel: Model<EmployeeSalaryDocument>,
  ) {}

  /**
   * Identifies MongoDB unique index duplicate key error (code 11000).
   */
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

  /**
   * Creates a new salary assignment record.
   */
  async create(
    input: CreateEmployeeSalaryInput,
    session?: ClientSession,
  ): Promise<EmployeeSalaryLean> {
    const docData = {
      employeeId: input.employeeId,
      salaryStructureId: input.salaryStructureId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      salaryBasis: input.salaryBasis,
      salaryFrequency: input.salaryFrequency,
      salaryAmount: input.salaryAmount,
      salaryStructureVersion: input.salaryStructureVersion,
      salarySnapshot: input.salarySnapshot,
      status: input.status ?? EmployeeSalaryStatus.ACTIVE,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
    };

    if (session) {
      const created = await this.employeeSalaryModel.create([docData], {
        session,
      });
      return created[0].toObject() as EmployeeSalaryLean;
    }

    const created = await this.employeeSalaryModel.create(docData);
    return created.toObject() as EmployeeSalaryLean;
  }

  /**
   * Finds an assignment by ID.
   */
  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<EmployeeSalaryLean | null> {
    const query = this.employeeSalaryModel.findById(id);
    if (session) query.session(session);
    return query.lean<EmployeeSalaryLean | null>().exec();
  }

  /**
   * Finds the latest assignment for an employee by effectiveFrom descending.
   */
  async findLatestByEmployeeId(
    employeeId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<EmployeeSalaryLean | null> {
    const query = this.employeeSalaryModel
      .findOne({ employeeId })
      .sort({ effectiveFrom: -1, createdAt: -1 });
    if (session) query.session(session);
    return query.lean<EmployeeSalaryLean | null>().exec();
  }

  /**
   * Finds the salary assignment effective as of a given business date.
   * Deliberately selects purely by half-open date interval [effectiveFrom, effectiveTo)
   * rather than status, so a closed/SUPERSEDED assignment remains active during its
   * interim window before a future-dated revision's effectiveFrom arrives.
   * Query conditions:
   * 1. employeeId matches
   * 2. effectiveFrom <= asOfDate
   * 3. effectiveTo is null OR effectiveTo > asOfDate
   * Sorted by effectiveFrom descending (latest effective assignment)
   */
  async findCurrentByEmployeeId(
    employeeId: Types.ObjectId,
    asOfDate: Date,
    session?: ClientSession,
  ): Promise<EmployeeSalaryLean | null> {
    const filter = {
      employeeId,
      effectiveFrom: { $lte: asOfDate },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gt: asOfDate } }],
    };

    const query = this.employeeSalaryModel
      .findOne(filter)
      .sort({ effectiveFrom: -1, createdAt: -1 });

    if (session) query.session(session);
    return query.lean<EmployeeSalaryLean | null>().exec();
  }

  /**
   * Closes a previous active assignment by setting effectiveTo and marking it SUPERSEDED.
   * Uses conditional atomic update for optimistic concurrency protection.
   */
  async closePreviousAssignment(
    id: Types.ObjectId,
    effectiveTo: Date,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<EmployeeSalaryLean | null> {
    const query = this.employeeSalaryModel.findOneAndUpdate(
      {
        _id: id,
        effectiveTo: null,
        status: EmployeeSalaryStatus.ACTIVE,
      },
      {
        $set: {
          effectiveTo,
          status: EmployeeSalaryStatus.SUPERSEDED,
          updatedBy: actorId,
        },
      },
      {
        returnDocument: 'after',
        session,
      },
    );

    return query.lean<EmployeeSalaryLean | null>().exec();
  }

  /**
   * Finds all assignments for an employee to detect interval overlap.
   */
  async findAllByEmployeeId(
    employeeId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<EmployeeSalaryLean[]> {
    const query = this.employeeSalaryModel
      .find({ employeeId })
      .sort({ effectiveFrom: -1 });
    if (session) query.session(session);
    return query.lean<EmployeeSalaryLean[]>().exec();
  }

  /**
   * Retrieves paginated salary history for an employee, supporting dynamic sorting.
   */
  async findPaginatedByEmployeeId(
    employeeId: Types.ObjectId,
    query: EmployeeSalaryHistoryQueryDto,
  ): Promise<PaginatedResult<EmployeeSalaryLean>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const sortBy = query.sortBy ?? 'effectiveFrom';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder, _id: -1 };

    const filter = { employeeId };

    const [data, total] = await Promise.all([
      this.employeeSalaryModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<EmployeeSalaryLean[]>()
        .exec(),
      this.employeeSalaryModel.countDocuments(filter).exec(),
    ]);

    const meta = buildPaginationMeta(total, page, limit);

    return {
      data,
      meta,
    };
  }
}
