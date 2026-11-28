import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  PAYROLL_CONFIGURATION_DEFAULTS,
  PAYROLL_SETTINGS_CONSTANTS,
  PAYROLL_SETTINGS_SINGLETON_KEY,
  PayrollFrequency,
  SUPPORTED_PAYROLL_CURRENCIES,
  WorkingDaysPolicy,
} from '../constants/payroll-configuration.constant';

export type PayrollSettingsDocument = HydratedDocument<PayrollSettings>;

export type PayrollSettingsLean = PayrollSettings & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};

@Schema({
  collection: 'payroll_settings',
  timestamps: true,
  optimisticConcurrency: true,
  versionKey: '__v',
})
export class PayrollSettings {
  @Prop({
    type: String,
    required: true,
    default: PAYROLL_SETTINGS_SINGLETON_KEY,
    immutable: true,
  })
  singletonKey!: string;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    enum: SUPPORTED_PAYROLL_CURRENCIES,
    default: PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY,
  })
  currency!: string;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    max: 3,
    default: PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY_PRECISION,
  })
  currencyPrecision!: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PayrollFrequency),
    default: PAYROLL_CONFIGURATION_DEFAULTS.PAYROLL_FREQUENCY,
  })
  payrollFrequency!: PayrollFrequency;

  @Prop({
    type: Number,
    required: true,
    min: PAYROLL_SETTINGS_CONSTANTS.CUTOFF_DAY_MIN,
    max: PAYROLL_SETTINGS_CONSTANTS.CUTOFF_DAY_MAX,
    default: PAYROLL_CONFIGURATION_DEFAULTS.CUTOFF_DAY,
  })
  cutoffDay!: number;

  @Prop({
    type: Number,
    required: true,
    min: PAYROLL_SETTINGS_CONSTANTS.PAYMENT_DAY_MIN,
    max: PAYROLL_SETTINGS_CONSTANTS.PAYMENT_DAY_MAX,
    default: PAYROLL_CONFIGURATION_DEFAULTS.PAYMENT_DAY,
  })
  paymentDay!: number;

  @Prop({
    type: Number,
    required: true,
    min: PAYROLL_SETTINGS_CONSTANTS.FY_START_MONTH_MIN,
    max: PAYROLL_SETTINGS_CONSTANTS.FY_START_MONTH_MAX,
    default: PAYROLL_CONFIGURATION_DEFAULTS.FINANCIAL_YEAR_START_MONTH,
  })
  financialYearStartMonth!: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(WorkingDaysPolicy),
    default: PAYROLL_CONFIGURATION_DEFAULTS.WORKING_DAYS_POLICY,
  })
  workingDaysPolicy!: WorkingDaysPolicy;

  @Prop({
    type: Number,
    min: PAYROLL_SETTINGS_CONSTANTS.FIXED_WORKING_DAYS_MIN,
    max: PAYROLL_SETTINGS_CONSTANTS.FIXED_WORKING_DAYS_MAX,
    default: PAYROLL_CONFIGURATION_DEFAULTS.FIXED_WORKING_DAYS_PER_MONTH,
  })
  fixedWorkingDaysPerMonth?: number | null;

  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.IS_PAYROLL_PROCESSING_ENABLED,
  })
  isPayrollProcessingEnabled!: boolean;

  @Prop({
    type: Boolean,
    required: true,
    default: false,
  })
  hasProcessedPayroll!: boolean;

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

export const PayrollSettingsSchema =
  SchemaFactory.createForClass(PayrollSettings);

// Guarantees at most one active company-level payroll configuration document
PayrollSettingsSchema.index(
  { singletonKey: 1 },
  { unique: true, name: 'uq_payroll_settings_singleton' },
);
