import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../../salary-structures/constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { EmployeeSalaryStatus } from '../constants/employee-salary.constant';

export type EmployeeSalaryDocument = HydratedDocument<EmployeeSalary>;

export type EmployeeSalaryLean = EmployeeSalary & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  __v?: number;
};

@Schema({ _id: false })
export class SalarySnapshotComponentItem {
  @Prop({ type: String, required: true })
  componentId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  code!: string;

  @Prop({
    type: String,
    enum: Object.values(SalaryComponentType),
    required: true,
  })
  type!: SalaryComponentType;

  @Prop({
    type: String,
    enum: Object.values(StructureComponentCalculationType),
    required: true,
  })
  calculationType!: StructureComponentCalculationType;

  @Prop({ type: Number, default: null })
  amount!: number | null;

  @Prop({ type: Number, default: null })
  percentage!: number | null;

  @Prop({ type: String, default: null })
  percentageOf!: string | null;

  @Prop({ type: Number, required: true })
  monthlyAmount!: number;

  @Prop({ type: Number, required: true })
  annualAmount!: number;
}

@Schema({ _id: false })
export class SalarySnapshotSummaryPeriod {
  @Prop({ type: Number, required: true })
  grossSalary!: number;

  @Prop({ type: Number, required: true })
  employerContributions!: number;

  @Prop({ type: Number, required: true })
  totalCtc!: number;

  @Prop({ type: Number, required: true })
  employeeDeductions!: number;

  @Prop({ type: Number, required: true })
  estimatedNetSalary!: number;
}

@Schema({ _id: false })
export class SalarySnapshotSummary {
  @Prop({ type: SalarySnapshotSummaryPeriod, required: true, _id: false })
  monthly!: SalarySnapshotSummaryPeriod;

  @Prop({ type: SalarySnapshotSummaryPeriod, required: true, _id: false })
  annual!: SalarySnapshotSummaryPeriod;
}

@Schema({ _id: false })
export class SalarySnapshot {
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

  @Prop({ type: Number, required: true })
  inputSalaryAmount!: number;

  @Prop({ type: Number, required: true })
  grossSalaryMonthly!: number;

  @Prop({ type: Number, required: true })
  grossSalaryAnnual!: number;

  @Prop({ type: Number, required: true })
  totalEmployerContributionsMonthly!: number;

  @Prop({ type: Number, required: true })
  totalEmployerContributionsAnnual!: number;

  @Prop({ type: Number, required: true })
  totalCtcMonthly!: number;

  @Prop({ type: Number, required: true })
  totalCtcAnnual!: number;

  @Prop({ type: Number, required: true })
  totalEmployeeDeductionsMonthly!: number;

  @Prop({ type: Number, required: true })
  totalEmployeeDeductionsAnnual!: number;

  @Prop({ type: Number, required: true })
  estimatedNetSalaryMonthly!: number;

  @Prop({ type: Number, required: true })
  estimatedNetSalaryAnnual!: number;

  @Prop({ type: SalarySnapshotSummary, required: true, _id: false })
  summary!: SalarySnapshotSummary;

  @Prop({ type: [SalarySnapshotComponentItem], default: [], _id: false })
  earnings!: SalarySnapshotComponentItem[];

  @Prop({ type: [SalarySnapshotComponentItem], default: [], _id: false })
  employeeDeductions!: SalarySnapshotComponentItem[];

  @Prop({ type: [SalarySnapshotComponentItem], default: [], _id: false })
  employerContributions!: SalarySnapshotComponentItem[];
}

@Schema({
  collection: 'employee_salaries',
  timestamps: true,
  versionKey: '__v',
})
export class EmployeeSalary {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'SalaryStructure',
    required: true,
  })
  salaryStructureId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  effectiveFrom!: Date;

  @Prop({ type: Date, default: null })
  effectiveTo!: Date | null;

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

  @Prop({ type: Number, required: true })
  salaryAmount!: number;

  @Prop({ type: Number, required: true })
  salaryStructureVersion!: number;

  @Prop({ type: SalarySnapshot, required: true, _id: false })
  salarySnapshot!: SalarySnapshot;

  @Prop({
    type: String,
    enum: Object.values(EmployeeSalaryStatus),
    default: EmployeeSalaryStatus.ACTIVE,
    required: true,
  })
  status!: EmployeeSalaryStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EmployeeSalarySchema =
  SchemaFactory.createForClass(EmployeeSalary);

// 1. Employee salary history query: newest effective date first
EmployeeSalarySchema.index(
  { employeeId: 1, effectiveFrom: -1 },
  { name: 'ix_employee_salary_history' },
);

// 2. Current salary lookup index
EmployeeSalarySchema.index(
  { employeeId: 1, effectiveFrom: -1, effectiveTo: 1 },
  { name: 'ix_employee_salary_current' },
);

// 3. Salary structure reference lookup
EmployeeSalarySchema.index(
  { salaryStructureId: 1 },
  { name: 'ix_employee_salary_structure' },
);

// 4. Database-level partial unique constraint: at most ONE open-ended active assignment per employee
EmployeeSalarySchema.index(
  { employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      effectiveTo: null,
      status: EmployeeSalaryStatus.ACTIVE,
    },
    name: 'uq_employee_single_open_ended_active',
  },
);
