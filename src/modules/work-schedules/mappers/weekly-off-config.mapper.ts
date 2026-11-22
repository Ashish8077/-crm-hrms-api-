import { Types } from 'mongoose';
import {
  WeeklyOffConfig,
  WeeklyOffDay,
} from '../schemas/weekly-off-config.schema';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';

export type WeeklyOffConfigLean = WeeklyOffConfig & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export interface WeeklyOffDayResponse {
  dayOfWeek: number;
  occurrences: number[];
}

export interface WeeklyOffConfigResponse {
  id: string;
  name: string;
  description: string | null;
  branchId: string | null;
  days: WeeklyOffDayResponse[];
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export class WeeklyOffConfigMapper {
  static toResponse(
    doc: WeeklyOffConfigLean | (WeeklyOffConfig & { _id: Types.ObjectId }),
  ): WeeklyOffConfigResponse {
    return {
      id: doc._id.toString(),
      name: doc.name,
      description: doc.description ?? null,
      branchId: doc.branchId ? doc.branchId.toString() : null,
      days: (doc.days || []).map((day: WeeklyOffDay) => ({
        dayOfWeek: day.dayOfWeek,
        occurrences: day.occurrences || [1, 2, 3, 4, 5],
      })),
      effectiveFrom: doc.effectiveFrom,
      effectiveTo: doc.effectiveTo ?? null,
      isActive: doc.isActive,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  static toResponseList(
    docs: (WeeklyOffConfigLean | (WeeklyOffConfig & { _id: Types.ObjectId }))[],
  ): WeeklyOffConfigResponse[] {
    return docs.map((doc) => this.toResponse(doc));
  }

  static toPaginatedResponse(
    paginated: PaginatedResult<WeeklyOffConfigLean>,
  ): PaginatedResult<WeeklyOffConfigResponse> {
    return {
      data: this.toResponseList(paginated.data),
      meta: paginated.meta,
    };
  }
}
