import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CrmActivityDocument = HydratedDocument<CrmActivity>;

export enum ActivityEntityType {
  COMPANY = 'Company',
  CONTACT = 'Contact',
  DEAL = 'Deal',
}

export enum ActivityType {
  CALL = 'CALL',
  EMAIL = 'EMAIL',
  MEETING = 'MEETING',
  SMS = 'SMS',
  NOTE = 'NOTE',
  TASK = 'TASK',
}

export enum ActivityOutcome {
  CONNECTED = 'CONNECTED',
  BUSY = 'BUSY',
  LEFT_VOICEMAIL = 'LEFT_VOICEMAIL',
  NO_ANSWER = 'NO_ANSWER',
  INTERESTED = 'INTERESTED',
  NOT_INTERESTED = 'NOT_INTERESTED',
  SCHEDULED = 'SCHEDULED',
  SCHEDULED_MEETING = 'SCHEDULED_MEETING',
  COMPLETED = 'COMPLETED',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
  SUCCESS = 'SUCCESS',
  PENDING = 'PENDING',
  FOLLOW_UP = 'FOLLOW_UP',
  IN_PROGRESS = 'IN_PROGRESS',
  FAILED = 'FAILED',
  RESCHEDULED = 'RESCHEDULED',
  NO_SHOW = 'NO_SHOW',
  ATTENDED = 'ATTENDED',
  WRONG_NUMBER = 'WRONG_NUMBER',
  QUALIFIED = 'QUALIFIED',
  DISQUALIFIED = 'DISQUALIFIED',
  WON = 'WON',
  LOST = 'LOST',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

@Schema({
  collection: 'crm_activities',
  timestamps: true,
  versionKey: false,
})
export class CrmActivity {
  @Prop({
    type: String,
    enum: Object.values(ActivityEntityType),
    required: true,
    index: true,
  })
  entityType!: ActivityEntityType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  entityId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ActivityType),
    required: true,
    index: true,
  })
  type!: ActivityType;

  @Prop({ type: String, required: true, trim: true })
  subject!: string;

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  activityDate!: Date;

  @Prop({ type: Number, default: 0, min: 0 })
  durationMinutes?: number;

  @Prop({
    type: String,
    enum: Object.values(ActivityOutcome),
    default: null,
  })
  outcome?: ActivityOutcome | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  performedBy!: Types.ObjectId;

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CrmActivitySchema = SchemaFactory.createForClass(CrmActivity);

CrmActivitySchema.index(
  { entityType: 1, entityId: 1, activityDate: -1, deletedAt: 1 },
  { name: 'idx_activities_entity_timeline' },
);
