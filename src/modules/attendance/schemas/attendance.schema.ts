import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
  BreakType,
} from '../constants/attendance.constant';

export type AttendanceDocument = HydratedDocument<Attendance>;

@Schema({ _id: false })
export class BreakSession {
  @Prop({ type: Date, required: true })
  startTime!: Date;

  @Prop({ type: Date, default: null })
  endTime!: Date | null;

  @Prop({ type: Number, default: null })
  durationMinutes!: number | null;

  @Prop({
    type: String,
    enum: Object.values(BreakType),
    default: BreakType.OTHER,
  })
  type!: BreakType;

  @Prop({ type: String, trim: true })
  note?: string;
}

@Schema({ _id: false })
export class ShiftSnapshot {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  code!: string;

  @Prop({ type: String, required: true })
  startTime!: string;

  @Prop({ type: String, required: true })
  endTime!: string;

  @Prop({ type: Boolean, default: false })
  isOvernight!: boolean;

  @Prop({ type: Number, required: true })
  gracePeriodMinutes!: number;

  @Prop({ type: Number, required: true })
  minWorkMinutesForFullDay!: number;

  @Prop({ type: Number, required: true })
  minWorkMinutesForHalfDay!: number;

  @Prop({ type: Number, required: true })
  overtimeThresholdMinutes!: number;
}

@Schema({ _id: false })
export class GeoLocation {
  @Prop({ type: Number })
  latitude?: number;

  @Prop({ type: Number })
  longitude?: number;

  @Prop({ type: String, trim: true })
  address?: string;
}

@Schema({
  collection: 'attendances',
  timestamps: true,
  versionKey: false,
})
export class Attendance {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  attendanceDate!: string; // YYYY-MM-DD in configured timezone

  @Prop({ type: Date, required: true })
  date!: Date; // Normalized date (midnight UTC)

  @Prop({ type: Types.ObjectId, ref: 'Shift', required: true })
  shiftId!: Types.ObjectId;

  @Prop({ type: ShiftSnapshot, required: true })
  shiftSnapshot!: ShiftSnapshot;

  @Prop({ type: Date, default: null })
  checkInTime!: Date | null;

  @Prop({ type: Date, default: null })
  checkOutTime!: Date | null;

  @Prop({
    type: String,
    enum: Object.values(AttendanceStatus),
    required: true,
    default: AttendanceStatus.CHECKED_IN,
  })
  status!: AttendanceStatus;

  @Prop({
    type: String,
    enum: Object.values(AttendanceType),
    required: true,
    default: AttendanceType.REGULAR,
  })
  attendanceType!: AttendanceType;

  @Prop({ type: [BreakSession], default: [] })
  breaks!: BreakSession[];

  @Prop({ type: Number, default: 0, min: 0 })
  totalBreakMinutes!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalWorkMinutes!: number;

  @Prop({ type: Boolean, default: false })
  isLate!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  lateMinutes!: number;

  @Prop({ type: Boolean, default: false })
  isEarlyDeparture!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  earlyDepartureMinutes!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  overtimeMinutes!: number;

  @Prop({
    type: String,
    enum: Object.values(AttendanceSource),
    default: AttendanceSource.WEB,
  })
  checkInSource!: AttendanceSource;

  @Prop({
    type: String,
    enum: Object.values(AttendanceSource),
  })
  checkOutSource?: AttendanceSource;

  @Prop({ type: String, trim: true })
  checkInIp?: string;

  @Prop({ type: String, trim: true })
  checkOutIp?: string;

  @Prop({ type: GeoLocation })
  checkInLocation?: GeoLocation;

  @Prop({ type: GeoLocation })
  checkOutLocation?: GeoLocation;

  @Prop({ type: String, trim: true })
  checkInNotes?: string;

  @Prop({ type: String, trim: true })
  checkOutNotes?: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'AttendanceRegularization',
    default: null,
  })
  regularizationId!: Types.ObjectId | null;

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);

// 1) Enforce uniqueness: Only 1 attendance record per employee per attendance date
AttendanceSchema.index(
  { employeeId: 1, attendanceDate: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    name: 'uq_attendance_emp_date',
  },
);

// 2) Index for employee attendance history and calendar queries
AttendanceSchema.index(
  { employeeId: 1, attendanceDate: -1, deletedAt: 1 },
  { name: 'ix_attendance_emp_date_desc' },
);

// 3) Index for date range, status, and reporting queries
AttendanceSchema.index(
  { attendanceDate: 1, status: 1, deletedAt: 1 },
  { name: 'ix_attendance_date_status' },
);

// 4) Index for detecting unclosed/incomplete sessions
AttendanceSchema.index(
  { status: 1, checkOutTime: 1, deletedAt: 1 },
  { name: 'ix_attendance_status_checkout' },
);
