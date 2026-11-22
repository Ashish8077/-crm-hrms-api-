import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CompOffStatus } from '../constants/leaves.constant';

export type CompOffRecordDocument = HydratedDocument<CompOffRecord>;

@Schema({
  collection: 'comp_off_records',
  timestamps: true,
  versionKey: false,
})
export class CompOffRecord {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
  employeeId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  attendanceDate!: string; // YYYY-MM-DD of working day/overtime

  @Prop({ type: Number, required: true, min: 0 })
  overtimeMinutes!: number; // Duration of qualifying work

  @Prop({ type: Number, required: true, default: 1, min: 0.5 })
  earnedDays!: number; // Compensatory credit earned (e.g. 0.5 or 1)

  @Prop({
    type: String,
    enum: Object.values(CompOffStatus),
    default: CompOffStatus.PENDING,
    index: true,
  })
  status!: CompOffStatus;

  @Prop({ type: String, required: true, trim: true })
  expiryDate!: string; // YYYY-MM-DD (typically attendanceDate + 90 days)

  @Prop({ type: Date, default: null })
  redeemedAt?: Date | null;

  @Prop({
    type: Types.ObjectId,
    ref: 'LeaveRequest',
    default: null,
    index: true,
  })
  redeemedLeaveRequestId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true })
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt?: Date | null;

  @Prop({ type: String, trim: true })
  reviewRemarks?: string;

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

export const CompOffRecordSchema = SchemaFactory.createForClass(CompOffRecord);

// Unique Comp-Off claim per employee and attendance date
CompOffRecordSchema.index(
  { employeeId: 1, attendanceDate: 1 },
  {
    name: 'uq_comp_off_emp_attendance_date',
    unique: true,
    partialFilterExpression: { deletedAt: null },
  },
);

// Compound index for active, unexpired comp-offs
CompOffRecordSchema.index(
  { employeeId: 1, status: 1, expiryDate: 1 },
  { name: 'ix_comp_off_emp_status_expiry' },
);
