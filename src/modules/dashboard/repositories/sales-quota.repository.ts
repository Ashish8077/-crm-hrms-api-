import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SalesQuota, SalesQuotaDocument } from '../schemas/sales-quota.schema';

export type SalesQuotaLean = SalesQuota & { _id: Types.ObjectId };

@Injectable()
export class SalesQuotaRepository {
  constructor(
    @InjectModel(SalesQuota.name)
    private readonly quotaModel: Model<SalesQuotaDocument>,
  ) {}

  async findByUserAndPeriod(
    userId: Types.ObjectId,
    year: number,
    month?: number | null,
    currency?: string,
  ): Promise<SalesQuotaLean | null> {
    const filter: Record<string, unknown> = {
      userId,
      year,
      month: month !== undefined ? month : null,
      deletedAt: null,
    };
    if (currency) {
      filter.currency = currency.toUpperCase();
    }
    return this.quotaModel.findOne(filter).lean<SalesQuotaLean>().exec();
  }

  async findByUsersAndPeriod(
    userIds: Types.ObjectId[],
    year: number,
    month?: number | null,
    currency?: string,
  ): Promise<SalesQuotaLean[]> {
    const filter: Record<string, unknown> = {
      userId: { $in: userIds },
      year,
      deletedAt: null,
    };
    if (month !== undefined && month !== null) {
      filter.month = month;
    }
    if (currency) {
      filter.currency = currency.toUpperCase();
    }
    return this.quotaModel.find(filter).lean<SalesQuotaLean[]>().exec();
  }

  async upsertQuota(
    userId: Types.ObjectId,
    year: number,
    month: number | null,
    currency: string,
    quotaAmount: number,
    setBy: Types.ObjectId,
  ): Promise<SalesQuotaLean> {
    const normalizedCurrency = currency.toUpperCase();
    const updated = await this.quotaModel
      .findOneAndUpdate(
        {
          userId,
          year,
          month: month ?? null,
          currency: normalizedCurrency,
        },
        {
          $set: {
            quotaAmount,
            setBy,
            deletedAt: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<SalesQuotaLean>()
      .exec();

    return updated!;
  }
}
