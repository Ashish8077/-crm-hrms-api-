import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QuotationSequenceDocument = HydratedDocument<QuotationSequence>;

@Schema({ collection: 'quotation_sequences', timestamps: false, versionKey: false })
export class QuotationSequence {
  @Prop({ type: String, required: true, unique: true })
  key!: string; // Format: 'QT-{companyId}-{YYYY}'

  @Prop({ type: Number, required: true, default: 1000 })
  seq!: number;
}

export const QuotationSequenceSchema = SchemaFactory.createForClass(QuotationSequence);

