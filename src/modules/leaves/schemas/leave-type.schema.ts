import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { EmploymentStatus } from '../../employees/constants/employee.constant';

export type LeaveTypeDocument = HydratedDocument<LeaveType>;

@Schema({
  collection: 'leave_types',
  timestamps: true,
  versionKey: false,
})
export class LeaveType {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ type: Boolean, default: true })
  isPaid!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  annualAllocation!: number;

  @Prop({ type: Boolean, default: true })
  allowHalfDay!: boolean;

  @Prop({ type: Boolean, default: false })
  allowNegativeBalance!: boolean;

  @Prop({ type: Boolean, default: false })
  allowDuringNoticePeriod!: boolean;

  @Prop({
    type: [String],
    enum: Object.values(EmploymentStatus),
    default: [EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION],
  })
  applicableEmploymentStatuses!: EmploymentStatus[];

  @Prop({ type: Boolean, default: false })
  deductWeekends!: boolean;

  @Prop({ type: Boolean, default: false })
  deductHolidays!: boolean;

  @Prop({ type: Number, default: null, min: 1 })
  maxConsecutiveDays?: number | null;

  @Prop({ type: Boolean, default: false })
  requiresAttachment!: boolean;

  @Prop({ type: Boolean, default: false })
  isCarryForwardEnabled!: boolean;

  /**
   * Maximum unused leave days that can be carried over to the next calendar year.
   * - 0 represents unlimited carry-forward (capped only by available unused balance).
   * - Automatically normalized to 0 whenever isCarryForwardEnabled is false.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  maxCarryForwardDays!: number;

  @Prop({ type: Boolean, default: true })
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

export const LeaveTypeSchema = SchemaFactory.createForClass(LeaveType);

// Compound Unique Index: Code must be unique among non-deleted leave types
LeaveTypeSchema.index(
  { code: 1 },
  {
    name: 'uq_leave_types_code',
    unique: true,
    partialFilterExpression: { deletedAt: null },
  },
);

LeaveTypeSchema.index(
  { isActive: 1, deletedAt: 1 },
  { name: 'ix_leave_types_active_deleted' },
);
