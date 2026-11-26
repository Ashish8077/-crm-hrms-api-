import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import {
  PAYROLL_PERIOD_CONSTANTS,
  PayrollPeriodStatus,
} from '../constants/payroll-period.constant';

export type PayrollPeriodDocument = HydratedDocument<PayrollPeriod>;

export type PayrollPeriodLean = PayrollPeriod & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};

@Schema({
  collection: 'payroll_periods',
  timestamps: true,
  optimisticConcurrency: true,
  versionKey: '__v',
})
export class PayrollPeriod {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: PAYROLL_PERIOD_CONSTANTS.NAME_MIN_LENGTH,
    maxlength: PAYROLL_PERIOD_CONSTANTS.NAME_MAX_LENGTH,
  })
  periodName!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    set: (val: string) =>
      typeof val === 'string' ? val.trim().toUpperCase() : val,
    minlength: PAYROLL_PERIOD_CONSTANTS.CODE_MIN_LENGTH,
    maxlength: PAYROLL_PERIOD_CONSTANTS.CODE_MAX_LENGTH,
  })
  periodCode!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PayrollFrequency),
  })
  payrollFrequency!: PayrollFrequency;

  @Prop({
    type: Date,
    required: true,
  })
  startDate!: Date;

  @Prop({
    type: Date,
    required: true,
  })
  endDate!: Date;

  @Prop({
    type: Date,
    required: true,
  })
  paymentDate!: Date;

  @Prop({
    type: Number,
    required: true,
    min: PAYROLL_PERIOD_CONSTANTS.MONTH_MIN,
    max: PAYROLL_PERIOD_CONSTANTS.MONTH_MAX,
  })
  month!: number;

  @Prop({
    type: Number,
    required: true,
    min: PAYROLL_PERIOD_CONSTANTS.YEAR_MIN,
    max: PAYROLL_PERIOD_CONSTANTS.YEAR_MAX,
  })
  year!: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PayrollPeriodStatus),
    default: PayrollPeriodStatus.DRAFT,
  })
  status!: PayrollPeriodStatus;

  @Prop({
    type: String,
    trim: true,
    maxlength: PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH,
    default: null,
  })
  notes?: string | null;

  @Prop({
    type: Date,
    default: null,
    index: true,
  })
  deletedAt?: Date | null;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  createdBy!: Types.ObjectId | null;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  updatedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
}

export const PayrollPeriodSchema = SchemaFactory.createForClass(PayrollPeriod);

// ── Document & Query Middleware for Guaranteed Uppercase Normalization ──────

PayrollPeriodSchema.pre('validate', function () {
  if (this.periodCode && typeof this.periodCode === 'string') {
    this.periodCode = this.periodCode.trim().toUpperCase();
  }
});

PayrollPeriodSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function () {
    const update = this.getUpdate() as Record<string, unknown> | null;
    if (update) {
      if (typeof update.periodCode === 'string') {
        update.periodCode = update.periodCode.trim().toUpperCase();
      }
      const setObj = update.$set as Record<string, unknown> | undefined;
      if (setObj && typeof setObj.periodCode === 'string') {
        setObj.periodCode = setObj.periodCode.trim().toUpperCase();
      }
    }
  },
);

// ── Indexes ──────────────────────────────────────────────────────────────────

// Unique code across active periods (enforced with case-insensitive collation)
PayrollPeriodSchema.index(
  { periodCode: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    partialFilterExpression: { deletedAt: null },
    name: 'uq_payroll_periods_code',
  },
);

// Prevent duplicate cycle (year + month + frequency) for non-deleted periods
PayrollPeriodSchema.index(
  { year: 1, month: 1, payrollFrequency: 1, deletedAt: 1 },
  {
    unique: true,
    name: 'uq_payroll_periods_cycle',
  },
);

// Fast range lookup for overlap validation
PayrollPeriodSchema.index(
  { startDate: 1, endDate: 1, deletedAt: 1 },
  { name: 'idx_payroll_periods_dates' },
);

// Fast listing by status, year, month
PayrollPeriodSchema.index(
  { status: 1, year: -1, month: -1, deletedAt: 1 },
  { name: 'idx_payroll_periods_status_cycle' },
);
