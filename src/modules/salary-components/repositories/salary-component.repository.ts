import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, UpdateQuery } from 'mongoose';
import {
  SalaryComponent,
  SalaryComponentDocument,
  SalaryComponentLean,
} from '../schemas/salary-component.schema';
import { ListSalaryComponentsQueryDto } from '../dto/list-salary-components-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { escapeRegExp } from '../../../common/utils/regex.util';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import {
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
  SALARY_COMPONENT_SORTABLE_FIELDS,
} from '../constants/salary-component.constant';

export interface SalaryComponentQueryFilter {
  _id?: { $ne: Types.ObjectId };
  code?: string;
  type?: SalaryComponentType;
  calculationType?: SalaryComponentCalculationType;
  isActive?: boolean;
  isStatutory?: boolean;
  $or?: Array<
    | { name: { $regex: string; $options: string } }
    | { code: { $regex: string; $options: string } }
  >;
}

export type SalaryComponentSortableField =
  (typeof SALARY_COMPONENT_SORTABLE_FIELDS)[number];

export interface CreateSalaryComponentInput {
  name: string;
  code: string;
  type: SalaryComponentType;
  calculationType?: SalaryComponentCalculationType | null;
  percentageOf?: SalaryComponentPercentageBasis | null;
  defaultValue?: number | null;
  isTaxable?: boolean;
  isStatutory?: boolean;
  description?: string | null;
  isActive?: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}

export interface UpdateSalaryComponentInput {
  name?: string;
  code?: string;
  type?: SalaryComponentType;
  calculationType?: SalaryComponentCalculationType;
  percentageOf?: SalaryComponentPercentageBasis | null;
  defaultValue?: number | null;
  isTaxable?: boolean;
  isStatutory?: boolean;
  description?: string | null;
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
export class SalaryComponentRepository {
  constructor(
    @InjectModel(SalaryComponent.name)
    private readonly salaryComponentModel: Model<SalaryComponentDocument>,
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

  async create(
    data: CreateSalaryComponentInput,
    session?: ClientSession,
  ): Promise<SalaryComponentLean> {
    const component = new this.salaryComponentModel(data);
    const saved = await component.save({ session });
    return saved.toObject() as SalaryComponentLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<SalaryComponentLean | null> {
    const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
    const query = this.salaryComponentModel.findById(objectId);
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryComponentLean>().exec();
  }

  async findByCode(
    code: string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<SalaryComponentLean | null> {
    const normalizedCode = code.trim().toUpperCase();
    const filter: SalaryComponentQueryFilter = {
      code: normalizedCode,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    const query = this.salaryComponentModel.findOne(filter);
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryComponentLean>().exec();
  }

  async findList(
    queryDto: ListSalaryComponentsQueryDto,
  ): Promise<PaginatedResult<SalaryComponentLean>> {
    const {
      page = 1,
      limit = 20,
      search,
      type,
      calculationType,
      isActive,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = queryDto;

    const filter: SalaryComponentQueryFilter = {};

    if (search) {
      const cleanSearch = escapeRegExp(search.trim());
      filter.$or = [
        { name: { $regex: cleanSearch, $options: 'i' } },
        { code: { $regex: cleanSearch, $options: 'i' } },
      ];
    }

    if (type) {
      filter.type = type;
    }

    if (calculationType) {
      filter.calculationType = calculationType;
    }

    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    if (queryDto.isStatutory !== undefined) {
      filter.isStatutory = queryDto.isStatutory;
    }

    const sortField: SalaryComponentSortableField =
      sortBy &&
      (SALARY_COMPONENT_SORTABLE_FIELDS as readonly string[]).includes(sortBy)
        ? (sortBy as SalaryComponentSortableField)
        : 'createdAt';
    const sortDirection: 1 | -1 = sortOrder === 'asc' ? 1 : -1;
    const sortOptions: { [K in SalaryComponentSortableField]?: 1 | -1 } = {
      [sortField]: sortDirection,
    };

    const [data, total] = await Promise.all([
      this.salaryComponentModel
        .find(filter)
        .sort(sortOptions)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<SalaryComponentLean[]>()
        .exec(),
      this.salaryComponentModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: UpdateSalaryComponentInput,
    session?: ClientSession,
  ): Promise<SalaryComponentLean | null> {
    // Strip undefined properties to ensure strict PATCH semantics and avoid overwriting existing fields
    const sanitizedUpdate: Partial<UpdateSalaryComponentInput> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        (sanitizedUpdate as Record<string, unknown>)[key] = value;
      }
    }

    const updatePayload: UpdateQuery<SalaryComponentDocument> = {
      $set: sanitizedUpdate,
    };

    const query = this.salaryComponentModel.findByIdAndUpdate(
      id,
      updatePayload,
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryComponentLean>().exec();
  }

  async updateStatus(
    id: Types.ObjectId,
    isActive: boolean,
    updatedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<SalaryComponentLean | null> {
    const query = this.salaryComponentModel.findByIdAndUpdate(
      id,
      { $set: { isActive, updatedBy } },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryComponentLean>().exec();
  }

  async deleteById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<SalaryComponentLean | null> {
    const query = this.salaryComponentModel.findByIdAndDelete(id);
    if (session) {
      query.session(session);
    }
    return query.lean<SalaryComponentLean>().exec();
  }
}
