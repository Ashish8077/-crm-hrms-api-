import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  HalfDaySession,
  LeaveRequestStatus,
} from '../constants/leaves.constant';

export type LeaveRequestDocument = HydratedDocument<LeaveRequest>;

@Schema({ _id: false })
export class LeaveTypeSnapshot {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  code!: string;

  @Prop({ type: Boolean, required: true })
  isPaid!: boolean;

  @Prop({ type: Boolean, required: true })
  allowHalfDay!: boolean;

  @Prop({ type: Boolean, required: true })
  deductWeekends!: boolean;

  @Prop({ type: Boolean, required: true })
  deductHolidays!: boolean;
}

@Schema({ _id: false })
export class YearSplit {
  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, min: 0.5 })
  days!: number;
}

@Schema({ _id: false })
export class ApprovalTimelineEntry {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  approverId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(LeaveRequestStatus),
    required: true,
  })
  fromStatus!: LeaveRequestStatus;

  @Prop({
    type: String,
    enum: Object.values(LeaveRequestStatus),
    required: true,
  })
  toStatus!: LeaveRequestStatus;

  @Prop({ type: String, trim: true })
  remarks?: string;

  @Prop({ type: Date, required: true, default: Date.now })
  timestamp!: Date;

  @Prop({ type: Boolean, default: false })
  isOverride!: boolean;
}

@Schema({
  collection: 'leave_requests',
  timestamps: true,
  versionKey: false,
})
export class LeaveRequest {
  _id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
  employeeId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'LeaveType', required: true, index: true })
  leaveTypeId!: Types.ObjectId;

  @Prop({ type: LeaveTypeSnapshot, required: true })
  leaveTypeSnapshot!: LeaveTypeSnapshot;

  @Prop({ type: String, required: true, trim: true })
  startDate!: string; // YYYY-MM-DD

  @Prop({ type: String, required: true, trim: true })
  endDate!: string; // YYYY-MM-DD

  @Prop({ type: Number, required: true, min: 0.5 })
  totalDays!: number; // e.g. 0.5, 1, 2.5

  @Prop({ type: Boolean, default: false })
  isHalfDay!: boolean;

  @Prop({
    type: String,
    enum: Object.values(HalfDaySession),
    default: null,
  })
  halfDaySession!: HalfDaySession | null;

  @Prop({ type: [YearSplit], default: [] })
  yearBreakdown!: YearSplit[]; // User Decision #3: exact split by calendar year

  @Prop({ type: [String], default: [] })
  excludedDates?: string[]; // Non-deductible weekly off and holiday dates preserved at time of application

  @Prop({ type: String, required: true, trim: true })
  reason!: string;

  @Prop({ type: String, trim: true })
  attachmentUrl?: string;

  @Prop({ type: Types.ObjectId, ref: 'Employee', default: null, index: true })
  reportingManagerId!: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: Object.values(LeaveRequestStatus),
    default: LeaveRequestStatus.PENDING,
    index: true,
  })
  status!: LeaveRequestStatus;

  @Prop({ type: String, trim: true })
  rejectionReason?: string;

  @Prop({ type: String, trim: true })
  cancellationReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  cancellationReviewedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  cancellationReviewedAt?: Date | null;

  @Prop({ type: String, trim: true })
  reconciliationNotes?: string;

  @Prop({ type: [ApprovalTimelineEntry], default: [] })
  approvalTimeline!: ApprovalTimelineEntry[];

  @Prop({ type: Date, default: Date.now })
  appliedAt!: Date;

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

export const LeaveRequestSchema = SchemaFactory.createForClass(LeaveRequest);

// Index for active leave overlap detection
LeaveRequestSchema.index(
  { employeeId: 1, startDate: 1, endDate: 1, status: 1 },
  { name: 'ix_leave_requests_overlap' },
);

// Index for Manager Approval Queue
LeaveRequestSchema.index(
  { reportingManagerId: 1, status: 1, createdAt: -1 },
  { name: 'ix_leave_requests_manager_status_created' },
);

// Index for Employee History Queries
LeaveRequestSchema.index(
  { employeeId: 1, createdAt: -1, deletedAt: 1 },
  { name: 'ix_leave_requests_emp_created_deleted' },
);

// Index for Attendance Synchronization
LeaveRequestSchema.index(
  { status: 1, startDate: 1, endDate: 1, deletedAt: 1 },
  { name: 'ix_leave_requests_status_dates' },
);
