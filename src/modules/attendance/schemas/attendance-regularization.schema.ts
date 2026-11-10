import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  RegularizationStatus,
  RegularizationType,
} from '../constants/attendance.constant';

export type AttendanceRegularizationDocument =
  HydratedDocument<AttendanceRegularization>;

@Schema({
  collection: 'attendance_regularizations',
  timestamps: true,
  versionKey: false,
})
export class AttendanceRegularization {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
  employeeId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Attendance',
    default: null,
  })
  attendanceId!: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true })
  attendanceDate!: string; // YYYY-MM-DD

  @Prop({
    type: String,
    enum: Object.values(RegularizationType),
    default: RegularizationType.TIME_CORRECTION,
    index: true,
  })
  type!: RegularizationType;

  @Prop({ type: Date, default: null })
  originalCheckInTime!: Date | null;

  @Prop({ type: Date, default: null })
  originalCheckOutTime!: Date | null;

  @Prop({ type: Date, default: null })
  requestedCheckInTime!: Date | null;

  @Prop({ type: Date, default: null })
  requestedCheckOutTime!: Date | null;

  @Prop({ type: String, required: true, trim: true })
  reason!: string;

  @Prop({
    type: String,
    enum: Object.values(RegularizationStatus),
    default: RegularizationStatus.PENDING,
    index: true,
  })
  status!: RegularizationStatus;

  @Prop({ type: Date, default: Date.now })
  appliedAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt!: Date | null;

  @Prop({ type: String, trim: true })
  reviewRemarks?: string;

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AttendanceRegularizationSchema = SchemaFactory.createForClass(
  AttendanceRegularization,
);

// Only one active PENDING regularization per employee per date
AttendanceRegularizationSchema.index(
  { employeeId: 1, attendanceDate: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: RegularizationStatus.PENDING,
      deletedAt: null,
    },
    name: 'uq_pending_regularization_emp_date',
  },
);

// Index for manager review queues
AttendanceRegularizationSchema.index(
  { status: 1, createdAt: -1, deletedAt: 1 },
  { name: 'ix_regularization_status_created_deleted' },
);

// Index for employee regularization history
AttendanceRegularizationSchema.index(
  { employeeId: 1, createdAt: -1, deletedAt: 1 },
  { name: 'ix_regularization_emp_created_deleted' },
);

// Index for attendance link
AttendanceRegularizationSchema.index(
  { attendanceId: 1 },
  { sparse: true, name: 'ix_regularization_attendance_id' },
);
