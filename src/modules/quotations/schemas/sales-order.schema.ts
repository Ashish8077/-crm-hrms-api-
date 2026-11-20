import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SalesOrderStatus } from '../constants/quotation-status.constant';
import { QuotationItem, QuotationItemSchema } from './quotation-item.schema';

export type SalesOrderDocument = HydratedDocument<SalesOrder>;

@Schema({ collection: 'sales_orders', timestamps: true, versionKey: false })
export class SalesOrder {
  _id?: Types.ObjectId;

  @Prop({ type: String, required: true, uppercase: true, index: true })
  orderNumber!: string;

  @Prop({ type: Types.ObjectId, ref: 'Quotation', required: true, unique: true, index: true })
  quotationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Deal', default: null, index: true })
  dealId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(SalesOrderStatus),
    default: SalesOrderStatus.CONFIRMED,
    index: true,
  })
  status!: string;

  @Prop({ type: [QuotationItemSchema], required: true })
  items!: QuotationItem[];

  @Prop({ type: Number, default: 0 })
  subtotalMinor?: number;

  @Prop({ type: Number, default: 0 })
  totalDiscountMinor?: number;

  @Prop({ type: Number, default: 0 })
  taxableAmountMinor?: number;

  @Prop({ type: Number, default: 0 })
  cgstAmountMinor?: number;

  @Prop({ type: Number, default: 0 })
  sgstAmountMinor?: number;

  @Prop({ type: Number, default: 0 })
  igstAmountMinor?: number;

  @Prop({ type: Number, default: 0 })
  totalTaxAmountMinor?: number;

  @Prop({ type: Number, required: true, min: 0 })
  grandTotalMinor!: number;

  @Prop({ type: String, required: true, default: 'INR', uppercase: true })
  currency!: string;

  @Prop({ type: Object, default: null })
  billingAddress?: any;

  @Prop({ type: Object, default: null })
  shippingAddress?: any;

  @Prop({ type: String, trim: true, default: null })
  notes?: string | null;

  @Prop({ type: Date, default: null })
  expectedDeliveryDate?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  orderNotes?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy?: Types.ObjectId | null;
}

export const SalesOrderSchema = SchemaFactory.createForClass(SalesOrder);
SalesOrderSchema.index({ companyId: 1, status: 1, deletedAt: 1 });
SalesOrderSchema.index({ companyId: 1, orderNumber: 1 }, { unique: true });
