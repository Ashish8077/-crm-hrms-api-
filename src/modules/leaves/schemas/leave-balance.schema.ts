import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LeaveBalanceDocument = HydratedDocument<LeaveBalance>;

@Schema({
  collection: 'leave_balances',
  timestamps: true,
  versionKey: false,
})
export class LeaveBalance {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true, index: true })
  employeeId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'LeaveType', required: true, index: true })
  leaveTypeId!: Types.ObjectId;

  @Prop({ type: Number, required: true, index: true })
  year!: number; // Leave year (e.g. 2026)

  @Prop({ type: Number, default: 0, min: 0 })
  allocatedDays!: number; // Annual allocation grant

  @Prop({ type: Number, default: 0, min: 0 })
  carriedForwardDays!: number; // Carried over from prior year

  @Prop({ type: Number, default: 0, min: 0 })
  creditedDays!: number; // Comp-off conversions and manual credits

  @Prop({ type: Number, default: 0, min: 0 })
  debitedDays!: number; // Manual administrative debits

  @Prop({ type: Number, default: 0, min: 0 })
  pendingDays!: number; // Active unapproved reservations

  @Prop({ type: Number, default: 0, min: 0 })
  usedDays!: number; // Approved & consumed leaves

  @Prop({ type: Number, default: 0 })
  availableBalance!: number; // Calculated: (allocated + carriedForward + credited) - (debited + pending + used)

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const LeaveBalanceSchema = SchemaFactory.createForClass(LeaveBalance);

// Strict Compound Unique Index: Exactly one balance ledger per employee, leave type, and calendar year
LeaveBalanceSchema.index(
  { employeeId: 1, leaveTypeId: 1, year: 1 },
  {
    name: 'uq_leave_balances_emp_type_year',
    unique: true,
    partialFilterExpression: { deletedAt: null },
  },
);

LeaveBalanceSchema.index(
  { employeeId: 1, year: 1, deletedAt: 1 },
  { name: 'ix_leave_balances_emp_year_deleted' },
);
