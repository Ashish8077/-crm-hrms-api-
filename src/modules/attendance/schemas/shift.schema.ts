import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ATTENDANCE_CONSTANTS } from '../constants/attendance.constant';

export type ShiftDocument = HydratedDocument<Shift>;

@Schema({
  collection: 'shifts',
  timestamps: true,
  versionKey: false,
})
export class Shift {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: ATTENDANCE_CONSTANTS.SHIFT_NAME_MIN_LENGTH,
    maxlength: ATTENDANCE_CONSTANTS.SHIFT_NAME_MAX_LENGTH,
    match: /^[a-zA-Z0-9][a-zA-Z0-9 ._()-]*$/,
  })
  name!: string;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    minlength: ATTENDANCE_CONSTANTS.SHIFT_CODE_MIN_LENGTH,
    maxlength: ATTENDANCE_CONSTANTS.SHIFT_CODE_MAX_LENGTH,
    match: /^[A-Z0-9_-]+$/,
  })
  code!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    match: /^([01]\d|2[0-3]):([0-5]\d)$/,
  })
  startTime!: string; // HH:mm

  @Prop({
    type: String,
    required: true,
    trim: true,
    match: /^([01]\d|2[0-3]):([0-5]\d)$/,
  })
  endTime!: string; // HH:mm

  @Prop({ type: Boolean, default: false })
  isOvernight!: boolean;

  @Prop({
    type: Number,
    default: ATTENDANCE_CONSTANTS.DEFAULT_GRACE_PERIOD_MINUTES,
    min: ATTENDANCE_CONSTANTS.MIN_GRACE_PERIOD_MINUTES,
    max: ATTENDANCE_CONSTANTS.MAX_GRACE_PERIOD_MINUTES,
  })
  gracePeriodMinutes!: number;

  @Prop({
    type: Number,
    default: ATTENDANCE_CONSTANTS.DEFAULT_BREAK_DURATION_MINUTES,
    min: ATTENDANCE_CONSTANTS.MIN_BREAK_DURATION_MINUTES,
    max: ATTENDANCE_CONSTANTS.MAX_BREAK_DURATION_MINUTES,
  })
  breakDurationMinutes!: number;

  @Prop({
    type: Number,
    default: ATTENDANCE_CONSTANTS.DEFAULT_FULL_DAY_MINUTES,
    min: ATTENDANCE_CONSTANTS.MIN_FULL_DAY_MINUTES,
    max: ATTENDANCE_CONSTANTS.MAX_FULL_DAY_MINUTES,
  })
  minWorkMinutesForFullDay!: number;

  @Prop({
    type: Number,
    default: ATTENDANCE_CONSTANTS.DEFAULT_HALF_DAY_MINUTES,
    min: ATTENDANCE_CONSTANTS.MIN_HALF_DAY_MINUTES,
    max: ATTENDANCE_CONSTANTS.MAX_HALF_DAY_MINUTES,
  })
  minWorkMinutesForHalfDay!: number;

  @Prop({
    type: Number,
    default: ATTENDANCE_CONSTANTS.DEFAULT_OVERTIME_THRESHOLD_MINUTES,
    min: ATTENDANCE_CONSTANTS.MIN_OVERTIME_THRESHOLD_MINUTES,
    max: ATTENDANCE_CONSTANTS.MAX_OVERTIME_THRESHOLD_MINUTES,
  })
  overtimeThresholdMinutes!: number;

  @Prop({ type: Boolean, default: false })
  isDefault!: boolean;

  @Prop({ type: Boolean, default: true, index: true })
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

export const ShiftSchema = SchemaFactory.createForClass(Shift);

ShiftSchema.index(
  { code: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    collation: { locale: 'en', strength: 2 },
    name: 'uq_shifts_code_active',
  },
);

// Enforce at most one active default shift at DB storage engine level
ShiftSchema.index(
  { isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true, deletedAt: null },
    name: 'uq_shifts_single_default_active',
  },
);

ShiftSchema.index(
  { isDefault: 1, isActive: 1, deletedAt: 1 },
  { name: 'ix_shifts_default_active_deleted' },
);

ShiftSchema.index(
  { isActive: 1, deletedAt: 1 },
  { name: 'ix_shifts_active_deleted' },
);
