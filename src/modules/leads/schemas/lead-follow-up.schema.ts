import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FollowUpStatus } from '../constants/lead.constant';

@Schema({ timestamps: true })
export class LeadFollowUp {
  _id!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  scheduledAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  assignedTo!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FollowUpStatus),
    default: FollowUpStatus.PENDING,
  })
  status!: FollowUpStatus;

  @Prop({ type: String, trim: true, default: null })
  notes?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const LeadFollowUpSchema = SchemaFactory.createForClass(LeadFollowUp);
