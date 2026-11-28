import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PAYSLIP_CONSTANTS } from '../constants/payslip.constant';

export type PayslipDocument = HydratedDocument<Payslip>;

export type PayslipLean = Payslip & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};

@Schema({
  collection: 'payslips',
  timestamps: true,
  optimisticConcurrency: true,
  versionKey: '__v',
})
export class Payslip {
  @Prop({
    type: Types.ObjectId,
    ref: 'PayrollPeriod',
    required: true,
  })
  payrollPeriodId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'PayrollRecord',
    required: true,
  })
  payrollRecordId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Employee',
    required: true,
  })
  employeeId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  payrollCalculationVersion!: number;

  @Prop({ type: String, required: true, trim: true })
  templateVersion!: string;

  @Prop({ type: String, required: true, trim: true })
  fileKey!: string;

  @Prop({ type: String, required: true, trim: true })
  fileName!: string;

  @Prop({
    type: String,
    required: true,
    default: PAYSLIP_CONSTANTS.MIME_TYPE,
  })
  mimeType!: string;

  @Prop({ type: Number, required: true, min: 1 })
  fileSize!: number;

  @Prop({ type: String, required: true, trim: true })
  checksumSha256!: string;

  @Prop({ type: Date, required: true })
  generatedAt!: Date;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  generatedBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
}

export const PayslipSchema = SchemaFactory.createForClass(Payslip);

// 1. Authoritative uniqueness guard: at most one payslip per employee per payroll period
PayslipSchema.index(
  { payrollPeriodId: 1, employeeId: 1 },
  {
    unique: true,
    name: 'uq_payslips_period_employee',
  },
);

// 2. Employee payslip history lookup index
PayslipSchema.index(
  { employeeId: 1, generatedAt: -1 },
  { name: 'idx_payslips_employee_history' },
);

// 3. Period-level payslip listing index (newest generated first)
PayslipSchema.index(
  { payrollPeriodId: 1, generatedAt: -1 },
  { name: 'idx_payslips_period_generated' },
);
