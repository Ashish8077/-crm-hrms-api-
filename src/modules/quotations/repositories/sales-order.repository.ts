import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  SalesOrder,
  SalesOrderDocument,
} from '../schemas/sales-order.schema';

export type SalesOrderLean = SalesOrder & { _id: Types.ObjectId };

@Injectable()
export class SalesOrderRepository {
  constructor(
    @InjectModel(SalesOrder.name)
    private readonly orderModel: Model<SalesOrderDocument>,
  ) {}

  async create(
    data: Partial<SalesOrder>,
    session?: ClientSession,
  ): Promise<SalesOrderLean> {
    const docs = await this.orderModel.create([data], { session });
    return docs[0].toObject();
  }

  async createSalesOrder(
    data: Partial<SalesOrder>,
    session?: ClientSession,
  ): Promise<SalesOrderLean> {
    return this.create(data, session);
  }

  async findScopedById(
    id: Types.ObjectId,
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<SalesOrderLean | null> {
    const query = this.orderModel.findOne({
      _id: id,
      companyId,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<SalesOrderLean>().exec();
  }

  async findByQuotationId(
    quotationId: Types.ObjectId,
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<SalesOrderLean | null> {
    const query = this.orderModel.findOne({
      quotationId,
      companyId,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<SalesOrderLean>().exec();
  }
}
