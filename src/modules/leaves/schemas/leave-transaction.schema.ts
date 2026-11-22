import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LeaveTransactionType } from '../constants/leaves.constant';

export type LeaveTransactionDocument = HydratedDocument<LeaveTransaction>;

@Schema({
  collection: 'leave_transactions',
  timestamps: { createdAt: true, updatedAt: false }, // Immutable append-only ledger
  versionKey: false,
})
export class LeaveTransaction {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
  employeeId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'LeaveType', required: true, index: true })
  leaveTypeId!: Types.ObjectId;

  @Prop({ type: Number, required: true, index: true })
  year!: number;

  @Prop({
    type: String,
    enum: Object.values(LeaveTransactionType),
    required: true,
  })
  transactionType!: LeaveTransactionType;

  @Prop({ type: Number, required: true })
  days!: number; // Quantity changed (e.g. +1, -1, +0.5)

  @Prop({ type: Number, required: true })
  previousAvailable!: number; // Balance before transaction

  @Prop({ type: Number, required: true })
  newAvailable!: number; // Balance after transaction

  @Prop({ type: Types.ObjectId, default: null, index: true })
  referenceId!: Types.ObjectId | null; // e.g. LeaveRequest._id or CompOffRecord._id

  @Prop({ type: String, trim: true })
  referenceType?: string; // 'LeaveRequest' | 'CompOffRecord' | 'ManualAdjustment'

  @Prop({ type: String, trim: true })
  remarks?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorId!: Types.ObjectId;

  createdAt?: Date;
}

export const LeaveTransactionSchema =
  SchemaFactory.createForClass(LeaveTransaction);

// Compound index for employee transaction history
LeaveTransactionSchema.index(
  { employeeId: 1, leaveTypeId: 1, year: 1, createdAt: -1 },
  { name: 'ix_leave_transactions_emp_type_year_created' },
);

// Idempotency check index: prevents duplicate transactions for same reference and type
LeaveTransactionSchema.index(
  { referenceId: 1, transactionType: 1 },
  { name: 'ix_leave_transactions_reference_type' },
);

// Compound index for reference type and reference ID queries
LeaveTransactionSchema.index(
  { referenceType: 1, referenceId: 1 },
  { name: 'ix_leave_transactions_ref_type_id', sparse: true },
);
