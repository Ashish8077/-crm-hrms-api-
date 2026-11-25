import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SalesQuotaDocument = HydratedDocument<SalesQuota>;

@Schema({
  collection: 'sales_quotas',
  timestamps: true,
  versionKey: false,
})
export class SalesQuota {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 2020, max: 2100, index: true })
  year!: number;

  @Prop({ type: Number, default: null, min: 1, max: 12, index: true })
  month?: number | null; // null = annual quota, 1-12 = monthly quota

  @Prop({ type: Number, required: true, min: 0 })
  quotaAmount!: number;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'USD',
  })
  currency!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  setBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SalesQuotaSchema = SchemaFactory.createForClass(SalesQuota);

SalesQuotaSchema.index(
  { userId: 1, year: 1, month: 1, currency: 1 },
  { unique: true, name: 'idx_quotas_user_period_currency' },
);

SalesQuotaSchema.index(
  { year: 1, month: 1, deletedAt: 1 },
  { name: 'idx_quotas_period_lookup' },
);
