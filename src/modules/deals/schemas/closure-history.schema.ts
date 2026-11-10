import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DealStage } from '../constants/deal-stage.constant';
import { DealStatus } from '../constants/deal-status.constant';

@Schema({ _id: true, timestamps: false })
export class ClosureHistory {
  _id!: Types.ObjectId;

  // Closure metadata — ALWAYS required when a deal is closed
  @Prop({ type: Date, required: true, default: Date.now })
  closedAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  closedBy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: [DealStatus.WON, DealStatus.LOST],
    required: true,
  })
  closedStatus!: DealStatus;

  @Prop({
    type: String,
    enum: [DealStage.CLOSED_WON, DealStage.CLOSED_LOST],
    required: true,
  })
  closedStage!: DealStage;

  @Prop({ type: String, trim: true, default: null })
  lostReason?: string | null;

  @Prop({ type: String, trim: true, default: null })
  lostCompetitor?: string | null;

  // Reopening metadata — NULLABLE upon closure; populated ONLY upon reopen
  @Prop({ type: Date, default: null })
  reopenedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reopenedBy?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  reopenReason?: string | null;
}

export const ClosureHistorySchema =
  SchemaFactory.createForClass(ClosureHistory);
