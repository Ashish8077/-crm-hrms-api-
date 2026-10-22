import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: true, timestamps: false })
export class DealProduct {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true, default: null })
  sku?: string | null;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, required: true, min: 0 })
  unitPrice!: number;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  discount?: number;

  @Prop({ type: Number, required: true, min: 0 })
  total!: number;

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;
}

export const DealProductSchema = SchemaFactory.createForClass(DealProduct);
