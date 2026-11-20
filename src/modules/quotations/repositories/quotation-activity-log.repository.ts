import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  QuotationActivityLog,
  QuotationActivityLogDocument,
} from '../schemas/quotation-activity-log.schema';

export type QuotationActivityLogLean = QuotationActivityLog & { _id: Types.ObjectId };

@Injectable()
export class QuotationActivityLogRepository {
  constructor(
    @InjectModel(QuotationActivityLog.name)
    private readonly logModel: Model<QuotationActivityLogDocument>,
  ) {}

  async create(
    data: Partial<QuotationActivityLog>,
    session?: ClientSession,
  ): Promise<QuotationActivityLogLean> {
    const docs = await this.logModel.create([data], { session });
    return docs[0].toObject();
  }

  async logActivity(
    companyId: Types.ObjectId,
    quotationId: Types.ObjectId,
    action: string,
    description: string,
    performedBy?: Types.ObjectId | null,
    metadata?: Record<string, any>,
    session?: ClientSession,
  ): Promise<QuotationActivityLogLean> {
    return this.create(
      {
        companyId,
        quotationId,
        action,
        description,
        performedBy: performedBy || null,
        metadata,
      },
      session,
    );
  }

  async findByQuotationId(
    arg1: Types.ObjectId,
    arg2: Types.ObjectId,
  ): Promise<QuotationActivityLogLean[]> {
    return this.logModel
      .find({
        $or: [
          { quotationId: arg1, companyId: arg2 },
          { quotationId: arg2, companyId: arg1 },
        ],
      })
      .sort({ createdAt: -1 })
      .populate('performedBy', 'email firstName lastName')
      .lean<QuotationActivityLogLean[]>()
      .exec();
  }
}
