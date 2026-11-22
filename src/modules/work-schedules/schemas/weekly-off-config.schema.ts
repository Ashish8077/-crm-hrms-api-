import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { WEEKLY_OFF_CONSTANTS } from '../constants/weekly-off.constant';

export type WeeklyOffConfigDocument = HydratedDocument<WeeklyOffConfig>;

@Schema({ _id: false })
export class WeeklyOffDay {
  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: 6,
  })
  dayOfWeek!: number;

  @Prop({
    type: [Number],
    default: [1, 2, 3, 4, 5],
  })
  occurrences!: number[];
}

export const WeeklyOffDaySchema = SchemaFactory.createForClass(WeeklyOffDay);

@Schema({
  collection: 'weekly_off_configs',
  timestamps: true,
  versionKey: false,
})
export class WeeklyOffConfig {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: WEEKLY_OFF_CONSTANTS.NAME_MIN_LENGTH,
    maxlength: WEEKLY_OFF_CONSTANTS.NAME_MAX_LENGTH,
  })
  name!: string;

  @Prop({
    type: String,
    trim: true,
    maxlength: WEEKLY_OFF_CONSTANTS.DESCRIPTION_MAX_LENGTH,
    default: null,
  })
  description!: string | null;

  @Prop({
    type: Types.ObjectId,
    ref: 'Branch',
    default: null,
    index: true,
  })
  branchId!: Types.ObjectId | null;

  @Prop({
    type: [WeeklyOffDaySchema],
    required: true,
  })
  days!: WeeklyOffDay[];

  @Prop({
    type: String,
    required: true,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
    index: true,
  })
  effectiveFrom!: string;

  @Prop({
    type: String,
    trim: true,
    default: null,
    match: /^\d{4}-\d{2}-\d{2}$/,
  })
  effectiveTo!: string | null;

  @Prop({
    type: Boolean,
    default: true,
    index: true,
  })
  isActive!: boolean;

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WeeklyOffConfigSchema =
  SchemaFactory.createForClass(WeeklyOffConfig);

WeeklyOffConfigSchema.index(
  { branchId: 1, isActive: 1, deletedAt: 1, effectiveFrom: 1 },
  { name: 'ix_weekly_off_scope_effective' },
);

WeeklyOffConfigSchema.index(
  { deletedAt: 1, createdAt: -1 },
  { name: 'ix_weekly_off_deleted_created' },
);

WeeklyOffConfigSchema.index(
  { isActive: 1, deletedAt: 1 },
  { name: 'ix_weekly_off_active_deleted' },
);
