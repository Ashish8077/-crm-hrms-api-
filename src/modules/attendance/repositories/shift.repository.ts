import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Shift, ShiftDocument } from '../schemas/shift.schema';

export type ShiftLean = Shift & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export interface CreateShiftData {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  minWorkMinutesForFullDay: number;
  minWorkMinutesForHalfDay: number;
  overtimeThresholdMinutes: number;
  isDefault: boolean;
  isActive: boolean;
  createdBy: Types.ObjectId;
}

@Injectable()
export class ShiftRepository {
  constructor(
    @InjectModel(Shift.name)
    private readonly shiftModel: Model<ShiftDocument>,
  ) {}

  async create(
    data: CreateShiftData,
    session?: ClientSession,
  ): Promise<ShiftLean> {
    const shift = new this.shiftModel(data);
    const saved = await shift.save({ session });
    return saved.toObject() as ShiftLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<ShiftLean | null> {
    const query = this.shiftModel.findOne({
      _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<ShiftLean>().exec();
  }

  async findByCode(
    code: string,
    excludeId?: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<ShiftLean | null> {
    const filter: Record<string, unknown> = {
      code: code.trim().toUpperCase(),
      deletedAt: null,
    };
    if (excludeId) {
      filter._id = {
        $ne:
          typeof excludeId === 'string'
            ? new Types.ObjectId(excludeId)
            : excludeId,
      };
    }
    const query = this.shiftModel.findOne(filter);
    if (session) {
      query.session(session);
    }
    return query.lean<ShiftLean>().exec();
  }

  async findDefault(session?: ClientSession): Promise<ShiftLean | null> {
    const query = this.shiftModel.findOne({
      isDefault: true,
      isActive: true,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<ShiftLean>().exec();
  }

  async findAll(filter?: { isActive?: boolean }): Promise<ShiftLean[]> {
    const query: Record<string, unknown> = {
      deletedAt: null,
    };
    if (filter?.isActive !== undefined) {
      query.isActive = filter.isActive;
    }
    return this.shiftModel
      .find(query)
      .sort({ isDefault: -1, isActive: -1, name: 1 })
      .lean<ShiftLean[]>()
      .exec();
  }

  async findActive(): Promise<ShiftLean[]> {
    return this.findAll({ isActive: true });
  }

  async updateById(
    id: Types.ObjectId | string,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<ShiftLean | null> {
    const query = this.shiftModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<ShiftLean>().exec();
  }

  async clearDefault(
    excludeId?: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      isDefault: true,
      deletedAt: null,
    };
    if (excludeId) {
      filter._id = {
        $ne:
          typeof excludeId === 'string'
            ? new Types.ObjectId(excludeId)
            : excludeId,
      };
    }
    const query = this.shiftModel.updateMany(filter, {
      $set: { isDefault: false },
    });
    if (session) {
      query.session(session);
    }
    await query.exec();
  }

  async softDelete(
    id: Types.ObjectId | string,
    deletedBy: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<ShiftLean | null> {
    const query = this.shiftModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy:
            typeof deletedBy === 'string'
              ? new Types.ObjectId(deletedBy)
              : deletedBy,
          isActive: false,
          isDefault: false,
        },
      },
      { new: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<ShiftLean>().exec();
  }
}
