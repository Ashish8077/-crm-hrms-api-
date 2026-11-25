import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  SalesOrderSequence,
  SalesOrderSequenceDocument,
} from '../schemas/sales-order-sequence.schema';

@Injectable()
export class SalesOrderSequenceRepository {
  constructor(
    @InjectModel(SalesOrderSequence.name)
    private readonly sequenceModel: Model<SalesOrderSequenceDocument>,
  ) {}

  async getNextOrderNumber(
    companyId: Types.ObjectId,
    year = new Date().getFullYear(),
    session?: ClientSession,
  ): Promise<string> {
    const key = `SO-${companyId.toString()}-${year}`;

    const query = this.sequenceModel.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (session) query.session(session);

    const doc = await query.exec();
    return `SO-${year}-${doc.seq}`;
  }

  async getNextSequence(
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<string> {
    return this.getNextOrderNumber(
      companyId,
      new Date().getFullYear(),
      session,
    );
  }
}
