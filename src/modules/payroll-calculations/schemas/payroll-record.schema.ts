import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../../salary-structures/constants/salary-structure.constant';
import {
  NegativeNetPayPolicy,
  PAYROLL_CONFIGURATION_DEFAULTS,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../../payroll-configuration/constants/payroll-configuration.constant';
import { EmploymentStatus } from '../../employees/constants/employee.constant';
import { PayrollRecordStatus } from '../constants/payroll-calculation.constant';

export type PayrollRecordDocument = HydratedDocument<PayrollRecord>;

export type PayrollRecordLean = PayrollRecord & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};

@Schema({ _id: false })
export class PayrollSnapshotComponentItem {
  @Prop({ type: String, required: true })
  componentId!: string;

  @Prop({ type: String, required: true })
  componentCode!: string;

  @Prop({ type: String, required: true })
  componentName!: string;

  @Prop({
    type: String,
    enum: Object.values(SalaryComponentType),
    required: true,
  })
  classification!: SalaryComponentType;

  @Prop({
    type: String,
    enum: Object.values(StructureComponentCalculationType),
    required: true,
  })
  calculationMethod!: StructureComponentCalculationType;

  @Prop({ type: Number, default: null })
  percentage!: number | null;

  @Prop({ type: String, default: null })
  percentageOf!: string | null;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  monthlyBaseAmount!: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  monthlyCalculatedAmount!: Types.Decimal128;

  @Prop({ type: Boolean, required: true })
  prorationApplied!: boolean;

  @Prop({ type: Number, required: true })
  payableDays!: number;

  @Prop({ type: Number, required: true })
  calendarDays!: number;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  finalAmount!: Types.Decimal128;
}

export const PayrollSnapshotComponentItemSchema = SchemaFactory.createForClass(
  PayrollSnapshotComponentItem,
);

@Schema({ _id: false })
export class PayrollCalculationSnapshot {
  @Prop({ type: String, required: true })
  engineVersion!: string;

  @Prop({ type: String, default: null })
  inputFingerprint?: string | null;

  @Prop({ type: Date, required: true })
  calculatedAt!: Date;

  // ── Period Reference ───────────────────────────────────────────────────────
  @Prop({ type: String, required: true })
  payrollPeriodId!: string;

  @Prop({ type: String, required: true })
  periodCode!: string;

  @Prop({ type: String, required: true })
  periodName!: string;

  @Prop({
    type: String,
    enum: Object.values(PayrollFrequency),
    required: true,
  })
  payrollFrequency!: PayrollFrequency;

  @Prop({ type: String, required: true })
  startDate!: string;

  @Prop({ type: String, required: true })
  endDate!: string;

  @Prop({ type: Number, required: true })
  month!: number;

  @Prop({ type: Number, required: true })
  year!: number;

  // ── Employee Reference ─────────────────────────────────────────────────────
  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true })
  employeeCode!: string;

  @Prop({ type: String, required: true })
  employeeName!: string;

  @Prop({
    type: String,
    enum: Object.values(EmploymentStatus),
    required: true,
  })
  employmentStatus!: EmploymentStatus;

  // ── Salary Assignment & Structure Reference ────────────────────────────────
  @Prop({ type: String, required: true })
  salaryAssignmentId!: string;

  @Prop({ type: Number, required: true })
  salaryAssignmentVersion!: number;

  @Prop({ type: String, required: true })
  salaryAssignmentEffectiveFrom!: string;

  @Prop({ type: String, default: null })
  salaryAssignmentEffectiveTo!: string | null;

  @Prop({ type: String, required: true })
  salaryStructureId!: string;

  @Prop({ type: String, required: true })
  salaryStructureCode!: string;

  @Prop({ type: String, required: true })
  salaryStructureName!: string;

  @Prop({ type: Number, required: true })
  salaryStructureVersion!: number;

  @Prop({
    type: String,
    enum: Object.values(SalaryStructureBasis),
    required: true,
  })
  salaryBasis!: SalaryStructureBasis;

  @Prop({
    type: String,
    enum: Object.values(SalaryStructureFrequency),
    required: true,
  })
  salaryFrequency!: SalaryStructureFrequency;

  // ── Payroll Configuration & Rule Snapshot ──────────────────────────────────
  @Prop({ type: String, default: null })
  payrollSettingsId!: string | null;

  @Prop({ type: Number, default: null })
  payrollSettingsVersion!: number | null;

  @Prop({ type: String, default: null })
  payrollCalculationRuleId!: string | null;

  @Prop({ type: Number, default: null })
  payrollCalculationRuleVersion!: number | null;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({
    type: String,
    enum: Object.values(PayrollRoundingMode),
    required: true,
  })
  roundingMode!: PayrollRoundingMode;

  @Prop({ type: Number, required: true })
  roundingPrecision!: number;

  @Prop({
    type: String,
    enum: Object.values(PayrollProrationPolicy),
    required: true,
  })
  prorationPolicy!: PayrollProrationPolicy;

  @Prop({ type: Boolean, required: true })
  prorateFixedComponents!: boolean;

  @Prop({ type: Boolean, required: true })
  prorateDeductions!: boolean;

  @Prop({
    type: Boolean,
    required: true,
    default: PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_EMPLOYER_CONTRIBUTIONS,
  })
  prorateEmployerContributions!: boolean;

  @Prop({
    type: String,
    enum: Object.values(NegativeNetPayPolicy),
    required: true,
  })
  negativeNetPayPolicy!: NegativeNetPayPolicy;

  // ── Proration Details ──────────────────────────────────────────────────────
  @Prop({ type: Number, required: true })
  calendarDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  tenureCalendarDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  eligibleWorkingDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  weeklyOffDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  holidayDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  presentDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  halfDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  paidLeaveDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  unpaidLeaveDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  unpaidLeaveLopDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  attendanceAbsenceDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  attendanceAbsenceLopDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  halfDayDeductions!: number;

  @Prop({ type: Number, required: true, default: 0 })
  totalLopDays!: number;

  @Prop({ type: Number, required: true, default: 0 })
  pendingCancellationLeaveDays!: number;

  @Prop({ type: [String], default: [] })
  attendanceLeaveWarnings!: string[];

  @Prop({ type: [String], default: [] })
  leaveAttendanceMismatchDates!: string[];

  @Prop({ type: Number, required: true })
  prorationDenominatorDays!: number;

  @Prop({ type: Number, required: true })
  payableDays!: number;

  @Prop({ type: Boolean, required: true })
  prorationApplied!: boolean;

  @Prop({ type: String, required: true })
  prorationFactor!: string;

  // ── Component Breakdown & Execution Order ──────────────────────────────────
  @Prop({ type: [String], default: [] })
  executionOrder!: string[];

  @Prop({ type: [PayrollSnapshotComponentItemSchema], default: [] })
  earnings!: PayrollSnapshotComponentItem[];

  @Prop({ type: [PayrollSnapshotComponentItemSchema], default: [] })
  deductions!: PayrollSnapshotComponentItem[];

  @Prop({ type: [PayrollSnapshotComponentItemSchema], default: [] })
  employerContributions!: PayrollSnapshotComponentItem[];

  // ── Totals ─────────────────────────────────────────────────────────────────
  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  grossEarnings!: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  totalDeductions!: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  employerContributionsTotal!: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  netSalary!: Types.Decimal128;

  @Prop({ type: Boolean, required: true, default: false })
  netPayClamped!: boolean;
}

export const PayrollCalculationSnapshotSchema = SchemaFactory.createForClass(
  PayrollCalculationSnapshot,
);

@Schema({
  collection: 'payroll_records',
  timestamps: true,
  optimisticConcurrency: true,
  versionKey: '__v',
})
export class PayrollRecord {
  @Prop({
    type: Types.ObjectId,
    ref: 'PayrollPeriod',
    required: true,
  })
  payrollPeriodId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Employee',
    required: true,
  })
  employeeId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'EmployeeSalary',
    required: true,
  })
  salaryAssignmentId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'SalaryStructure',
    required: true,
  })
  salaryStructureId!: Types.ObjectId;

  @Prop({ type: PayrollCalculationSnapshotSchema, required: true })
  calculationSnapshot!: PayrollCalculationSnapshot;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  grossEarnings!: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  totalDeductions!: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  employerContributions!: Types.Decimal128;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  netSalary!: Types.Decimal128;

  @Prop({
    type: String,
    enum: Object.values(PayrollRecordStatus),
    default: PayrollRecordStatus.CALCULATED,
    required: true,
  })
  status!: PayrollRecordStatus;

  @Prop({ type: Date, required: true })
  calculatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1, min: 1 })
  calculationVersion!: number;

  @Prop({ type: Date, default: null })
  approvedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  approvedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  invalidatedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  invalidatedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 500 })
  invalidationReason?: string | null;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
}

export const PayrollRecordSchema = SchemaFactory.createForClass(PayrollRecord);

// 1. Unique compound constraint: one active payroll record per employee per period (soft-delete safe)
PayrollRecordSchema.index(
  { payrollPeriodId: 1, employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    name: 'uq_payroll_records_period_employee',
  },
);

// 2. Period listing & status query index
PayrollRecordSchema.index(
  { payrollPeriodId: 1, status: 1, deletedAt: 1 },
  { name: 'idx_payroll_records_period_status' },
);

// 3. Employee payroll history query index
PayrollRecordSchema.index(
  { employeeId: 1, calculatedAt: -1, deletedAt: 1 },
  { name: 'idx_payroll_records_employee_history' },
);

// 4. Employee finalized & approved payroll lookup index
PayrollRecordSchema.index(
  { employeeId: 1, status: 1, payrollPeriodId: 1, deletedAt: 1 },
  { name: 'idx_payroll_records_emp_status_period' },
);
