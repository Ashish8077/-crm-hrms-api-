import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class LeadDocument {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  fileName!: string;

  @Prop({ type: String, required: true, trim: true })
  fileUrl!: string;

  @Prop({ type: String, trim: true, default: null })
  fileType?: string | null;

  @Prop({ type: Number, default: 0 })
  fileSize?: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  uploadedAt!: Date;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const LeadDocumentSchema = SchemaFactory.createForClass(LeadDocument);
