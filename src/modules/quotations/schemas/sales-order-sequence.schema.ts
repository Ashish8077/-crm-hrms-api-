import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SalesOrderSequenceDocument = HydratedDocument<SalesOrderSequence>;

@Schema({ collection: 'sales_order_sequences', timestamps: false, versionKey: false })
export class SalesOrderSequence {
  @Prop({ type: String, required: true, unique: true })
  key!: string; // Format: 'SO-{companyId}-{YYYY}'

  @Prop({ type: Number, required: true, default: 1000 })
  seq!: number;
}

export const SalesOrderSequenceSchema = SchemaFactory.createForClass(SalesOrderSequence);

