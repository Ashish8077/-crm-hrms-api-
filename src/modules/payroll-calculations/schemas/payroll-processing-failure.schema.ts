import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PayrollProcessingFailureDocument =
  HydratedDocument<PayrollProcessingFailure>;

export type PayrollProcessingFailureLean = PayrollProcessingFailure & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

@Schema({
  collection: 'payroll_processing_failures',
  timestamps: true,
  versionKey: false,
})
export class PayrollProcessingFailure {
  @Prop({ type: Types.ObjectId, ref: 'PayrollPeriod', required: true })
  payrollPeriodId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  employeeCode!: string;

  @Prop({ type: String, required: true, trim: true })
  employeeName!: string;

  @Prop({ type: String, required: true, trim: true })
  errorCode!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 300 })
  errorMessage!: string;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  attemptNumber!: number;

  @Prop({ type: Date, required: true })
  lastAttemptAt!: Date;
}

export const PayrollProcessingFailureSchema = SchemaFactory.createForClass(
  PayrollProcessingFailure,
);

PayrollProcessingFailureSchema.index(
  { payrollPeriodId: 1, employeeId: 1 },
  { unique: true, name: 'uq_payroll_processing_failures_period_employee' },
);

PayrollProcessingFailureSchema.index(
  { payrollPeriodId: 1, lastAttemptAt: -1, _id: 1 },
  { name: 'idx_payroll_processing_failures_period_attempt' },
);
