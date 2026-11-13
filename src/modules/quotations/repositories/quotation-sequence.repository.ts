import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  QuotationSequence,
  QuotationSequenceDocument,
} from '../schemas/quotation-sequence.schema';

@Injectable()
export class QuotationSequenceRepository {
  constructor(
    @InjectModel(QuotationSequence.name)
    private readonly sequenceModel: Model<QuotationSequenceDocument>,
  ) {}

  async getNextQuoteNumber(
    companyId: Types.ObjectId,
    year = new Date().getFullYear(),
    session?: ClientSession,
  ): Promise<string> {
    const key = `QT-${companyId.toString()}-${year}`;

    const query = this.sequenceModel.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (session) query.session(session);

    const doc = await query.exec();
    return `QT-${year}-${doc.seq}`;
  }

  async getNextSequence(
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<string> {
    return this.getNextQuoteNumber(companyId, new Date().getFullYear(), session);
  }
}
