import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  EmploymentType,
  EmploymentStatus,
} from '../constants/employee.constant';

export type EmployeeDocument = HydratedDocument<Employee>;

@Schema({ _id: false })
export class BankDetails {
  @Prop({ type: String, trim: true })
  bankName?: string;

  @Prop({ type: String, trim: true })
  accountNumber?: string;

  @Prop({ type: String, trim: true })
  ifscCode?: string;

  @Prop({ type: String, trim: true })
  branchName?: string;
}

@Schema({ _id: false })
export class EmergencyContact {
  @Prop({ type: String, trim: true })
  name?: string;

  @Prop({ type: String, trim: true })
  relationship?: string;

  @Prop({ type: String, trim: true })
  phoneNumber?: string;
}

@Schema({
  collection: 'employees',
  timestamps: true,
  versionKey: false,
})
export class Employee {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId!: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true })
  employeeCode!: string;

  @Prop({ type: String, required: true, trim: true })
  firstName!: string;

  @Prop({ type: String, required: true, trim: true })
  lastName!: string;

  @Prop({ type: String, required: true, lowercase: true, trim: true })
  workEmail!: string;

  @Prop({ type: String, trim: true })
  phoneNumber?: string;

  @Prop({ type: Date })
  dateOfBirth?: Date;

  @Prop({ type: Date, required: true })
  dateOfJoining!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Department', required: true })
  departmentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Designation', required: true })
  designationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch', required: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Team', default: null })
  teamId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Employee', default: null })
  reportingManagerId!: Types.ObjectId | null;

  @Prop({ type: String, enum: Object.values(EmploymentType), required: true })
  employmentType!: EmploymentType;

  @Prop({ type: String, enum: Object.values(EmploymentStatus), required: true })
  employmentStatus!: EmploymentStatus;

  @Prop({ type: BankDetails, default: null })
  bankDetails!: BankDetails | null;

  @Prop({ type: EmergencyContact, default: null })
  emergencyContact!: EmergencyContact | null;

  @Prop({ type: [String], default: [] })
  skills!: string[];

  @Prop({ type: [String], default: [] })
  certifications!: string[];

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

export const EmployeeSchema = SchemaFactory.createForClass(Employee);

// Employee code - immutable and unique forever
EmployeeSchema.index(
  { employeeCode: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'uq_employees_code',
  },
);

// User ↔ Employee (1:1 active mapping)
EmployeeSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: { $type: 'objectId' },
      deletedAt: null,
    },
    name: 'uq_employees_user_active',
  },
);

// Work email uniqueness
EmployeeSchema.index(
  { workEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    collation: { locale: 'en', strength: 2 },
    name: 'uq_employees_work_email_active',
  },
);

// Organization queries
EmployeeSchema.index(
  { departmentId: 1, employmentStatus: 1, deletedAt: 1 },
  { name: 'ix_employees_department_status_deleted' },
);

EmployeeSchema.index(
  { teamId: 1, employmentStatus: 1, deletedAt: 1 },
  { name: 'ix_employees_team_status_deleted' },
);

EmployeeSchema.index(
  { designationId: 1, employmentStatus: 1, deletedAt: 1 },
  { name: 'ix_employees_designation_status_deleted' },
);

EmployeeSchema.index(
  { branchId: 1, employmentStatus: 1, deletedAt: 1 },
  { name: 'ix_employees_branch_status_deleted' },
);

// Reporting hierarchy
EmployeeSchema.index(
  { reportingManagerId: 1, employmentStatus: 1, deletedAt: 1 },
  { name: 'ix_employees_manager_status_deleted' },
);
