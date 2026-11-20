import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { EmploymentStatus } from '../constants/employee.constant';

export type EmployeeStatusHistoryDocument =
  HydratedDocument<EmployeeStatusHistory>;

@Schema({
  collection: 'employee_status_histories',
  timestamps: true,
  versionKey: false,
})
export class EmployeeStatusHistory {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(EmploymentStatus), required: true })
  previousStatus!: EmploymentStatus;

  @Prop({ type: String, enum: Object.values(EmploymentStatus), required: true })
  newStatus!: EmploymentStatus;

  @Prop({ type: String, trim: true, default: null })
  reason?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  changedBy!: Types.ObjectId;

  @Prop({ type: Date, default: Date.now, required: true })
  changedAt!: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EmployeeStatusHistorySchema = SchemaFactory.createForClass(
  EmployeeStatusHistory,
);

EmployeeStatusHistorySchema.index(
  { employeeId: 1, changedAt: -1 },
  { name: 'ix_employee_status_histories_employee_changed_at' },
);
