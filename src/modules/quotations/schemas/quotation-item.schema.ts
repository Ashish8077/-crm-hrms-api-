import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: true, timestamps: false })
export class QuotationItem {
  _id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true, uppercase: true })
  sku!: string;

  @Prop({ type: String, trim: true, default: null })
  hsnSacCode?: string | null;

  @Prop({ type: String, required: true, enum: ['PRODUCT', 'SERVICE', 'BUNDLE'] })
  type!: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantityScaled!: number; // Scaled by 1000 (e.g. 2.500 = 2500)

  @Prop({ type: Number, required: true, min: 0 })
  unitPriceMinor!: number;

  @Prop({ type: Number, required: false, min: 0, default: 0 })
  costPriceMinor?: number;

  @Prop({ type: Number, required: true, min: 0, max: 10000, default: 0 })
  discountBasisPoints!: number; // 10.00% = 1000 bp

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  discountMinor!: number;

  @Prop({ type: Number, required: true, min: 0 })
  netLineTotalMinor!: number;

  @Prop({ type: Number, required: true, min: 0, max: 10000, default: 1800 })
  taxBasisPoints!: number; // 18.00% = 1800 bp

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  cgstMinor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  sgstMinor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  igstMinor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  totalTaxMinor!: number;

  @Prop({ type: Number, required: true, min: 0 })
  lineGrandTotalMinor!: number;
}

export const QuotationItemSchema = SchemaFactory.createForClass(QuotationItem);

