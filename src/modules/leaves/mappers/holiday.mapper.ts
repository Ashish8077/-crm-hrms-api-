import { HolidayLean } from '../repositories/holiday.repository';

export interface HolidayResponse {
  id: string;
  name: string;
  date: string;
  year: number;
  type: string;
  branchId: string | null;
  description?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export class HolidayMapper {
  static toResponse(doc: HolidayLean): HolidayResponse {
    return {
      id: doc._id.toString(),
      name: doc.name,
      date: doc.date,
      year: doc.year,
      type: doc.type,
      branchId: doc.branchId ? doc.branchId.toString() : null,
      description: doc.description,
      isActive: doc.isActive,
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }

  static toResponseList(docs: HolidayLean[]): HolidayResponse[] {
    return docs.map((d) => this.toResponse(d));
  }
}
