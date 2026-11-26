import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  NegativeNetPayPolicy,
  PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
  PAYROLL_CONFIGURATION_DEFAULTS,
  PAYROLL_SETTINGS_CONSTANTS,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../constants/payroll-configuration.constant';

@Schema({ _id: false })
export class StatutoryCalculationFlags {
  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG.pfEnabled,
  })
  pfEnabled!: boolean;

  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG.esiEnabled,
  })
  esiEnabled!: boolean;

  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG.ptEnabled,
  })
  ptEnabled!: boolean;

  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG.tdsEnabled,
  })
  tdsEnabled!: boolean;
}

export const StatutoryCalculationFlagsSchema = SchemaFactory.createForClass(
  StatutoryCalculationFlags,
);

export type PayrollCalculationRuleDocument =
  HydratedDocument<PayrollCalculationRule>;

export type PayrollCalculationRuleLean = PayrollCalculationRule & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};

@Schema({
  collection: 'payroll_calculation_rules',
  timestamps: true,
  optimisticConcurrency: true,
  versionKey: '__v',
})
export class PayrollCalculationRule {
  @Prop({
    type: String,
    required: true,
    default: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
    immutable: true,
  })
  singletonKey!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PayrollRoundingMode),
    default: PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_MODE,
  })
  roundingMode!: PayrollRoundingMode;

  @Prop({
    type: Number,
    required: true,
    min: PAYROLL_SETTINGS_CONSTANTS.ROUNDING_PRECISION_MIN,
    max: PAYROLL_SETTINGS_CONSTANTS.ROUNDING_PRECISION_MAX,
    default: PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION,
  })
  roundingPrecision!: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PayrollProrationPolicy),
    default: PAYROLL_CONFIGURATION_DEFAULTS.PRORATION_POLICY,
  })
  prorationPolicy!: PayrollProrationPolicy;

  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_FIXED_COMPONENTS,
  })
  prorateFixedComponents!: boolean;

  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_DEDUCTIONS,
  })
  prorateDeductions!: boolean;

  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_EMPLOYER_CONTRIBUTIONS,
  })
  prorateEmployerContributions!: boolean;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(NegativeNetPayPolicy),
    default: PAYROLL_CONFIGURATION_DEFAULTS.NEGATIVE_NET_PAY_POLICY,
  })
  negativeNetPayPolicy!: NegativeNetPayPolicy;

  @Prop({
    type: StatutoryCalculationFlagsSchema,
    required: true,
    default: () => ({ ...PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG }),
  })
  statutoryConfig!: StatutoryCalculationFlags;

  @Prop({
    type: [String],
    default: [],
  })
  componentExecutionOrder!: string[];

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

export const PayrollCalculationRuleSchema = SchemaFactory.createForClass(
  PayrollCalculationRule,
);

PayrollCalculationRuleSchema.index(
  { singletonKey: 1 },
  { unique: true, name: 'uq_payroll_calculation_rules_singleton' },
);
