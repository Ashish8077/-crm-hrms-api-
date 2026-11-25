import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, UpdateQuery } from 'mongoose';
import {
  SalaryStructure,
  SalaryStructureComponentItem,
  SalaryStructureDocument,
  SalaryStructureLean,
} from '../schemas/salary-structure.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  SALARY_STRUCTURE_SORTABLE_FIELDS,
} from '../constants/salary-structure.constant';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { escapeRegExp } from '../../../common/utils/regex.util';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type SalaryStructureSortableField =
  (typeof SALARY_STRUCTURE_SORTABLE_FIELDS)[number];

export interface CreateSalaryStructureInput {
  name: string;
  code: string;
  description?: string | null;
  salaryBasis: SalaryStructureBasis;
  salaryFrequency: SalaryStructureFrequency;
  salaryAmount: number;
  components: SalaryStructureComponentItem[];
  isActive?: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}

export interface UpdateSalaryStructureInput {
  name?: string;
  code?: string;
  description?: string | null;
  salaryBasis?: SalaryStructureBasis;
  salaryFrequency?: SalaryStructureFrequency;
  salaryAmount?: number;
  components?: SalaryStructureComponentItem[];
  updatedBy: Types.ObjectId;
  version?: number;
}

export interface SalaryStructureQueryFilter {
  _id?: { $ne: Types.ObjectId };
  code?: string;
  salaryBasis?: SalaryStructureBasis;
  isActive?: boolean;
  $or?: Array<
    | { name: { $regex: string; $options: string } }
    | { code: { $regex: string; $options: string } }
  >;
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
export class SalaryStructureRepository {
  constructor(
    @InjectModel(SalaryStructure.name)
    private readonly salaryStructureModel: Model<SalaryStructureDocument>,
  ) {}

  /**
   * Identifies MongoDB unique index duplicate key error (code 11000).
   */
  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as MongoErrorShape;
    if (err.code === 11000) return true;
    if (typeof err.message === 'string' && err.message.includes('E11000'))
      return true;
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
   * Identifies Mongoose VersionError (concurrency conflict).
   */
  isVersionError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as { name?: string; message?: string };
    return (
      err.name === 'VersionError' ||
      (typeof err.message === 'string' &&
        err.message.includes('No matching document found for id'))
    );
  }

  async create(
    data: CreateSalaryStructureInput,
    session?: ClientSession,
  ): Promise<SalaryStructureLean> {
    const structure = new this.salaryStructureModel(data);
    const saved = await structure.save({ session });
    return saved.toObject() as SalaryStructureLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<SalaryStructureLean | null> {
    const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
    const query = this.salaryStructureModel.findById(objectId);
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryStructureLean>().exec();
  }

  async findByCode(
    code: string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<SalaryStructureLean | null> {
    const normalizedCode = code.trim().toUpperCase();
    const filter: SalaryStructureQueryFilter = {
      code: normalizedCode,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    const query = this.salaryStructureModel
      .findOne(filter)
      .collation({ locale: 'en', strength: 2 });
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryStructureLean>().exec();
  }

  async findList(queryDto: {
    page?: number;
    limit?: number;
    search?: string;
    salaryBasis?: SalaryStructureBasis;
    isActive?: boolean;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<PaginatedResult<SalaryStructureLean>> {
    const {
      page = 1,
      limit = 20,
      search,
      salaryBasis,
      isActive,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = queryDto;

    const filter: SalaryStructureQueryFilter = {};

    if (search && search.trim().length > 0) {
      const cleanSearch = escapeRegExp(search.trim());
      filter.$or = [
        { name: { $regex: cleanSearch, $options: 'i' } },
        { code: { $regex: cleanSearch, $options: 'i' } },
      ];
    }

    if (salaryBasis) {
      filter.salaryBasis = salaryBasis;
    }

    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const sortField: SalaryStructureSortableField =
      sortBy &&
      (SALARY_STRUCTURE_SORTABLE_FIELDS as readonly string[]).includes(sortBy)
        ? (sortBy as SalaryStructureSortableField)
        : 'createdAt';
    const sortDirection: 1 | -1 = sortOrder === 'asc' ? 1 : -1;
    const sortOptions: { [K in SalaryStructureSortableField]?: 1 | -1 } = {
      [sortField]: sortDirection,
    };

    const [data, total] = await Promise.all([
      this.salaryStructureModel
        .find(filter)
        .sort(sortOptions)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<SalaryStructureLean[]>()
        .exec(),
      this.salaryStructureModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: UpdateSalaryComponentUpdatePayload,
    session?: ClientSession,
  ): Promise<SalaryStructureLean | null> {
    const { version, ...fieldsToUpdate } = data;

    // Filter out undefined fields to enforce strict PATCH semantics
    const sanitizedUpdate: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fieldsToUpdate)) {
      if (value !== undefined) {
        sanitizedUpdate[key] = value;
      }
    }

    const updateFilter: Record<string, unknown> = { _id: id };
    if (typeof version === 'number') {
      updateFilter.__v = version;
    }

    const updatePayload: UpdateQuery<SalaryStructureDocument> = {
      $set: sanitizedUpdate,
      $inc: { __v: 1 },
    };

    const query = this.salaryStructureModel.findOneAndUpdate(
      updateFilter,
      updatePayload,
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryStructureLean>().exec();
  }

  async updateStatus(
    id: Types.ObjectId,
    isActive: boolean,
    updatedBy: Types.ObjectId,
    version?: number,
    session?: ClientSession,
  ): Promise<SalaryStructureLean | null> {
    const updateFilter: Record<string, unknown> = { _id: id };
    if (typeof version === 'number') {
      updateFilter.__v = version;
    }

    const query = this.salaryStructureModel.findOneAndUpdate(
      updateFilter,
      { $set: { isActive, updatedBy }, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryStructureLean>().exec();
  }
}

export type UpdateSalaryComponentUpdatePayload = UpdateSalaryStructureInput;
