import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { EmployeeDocumentCategory } from '../constants/employee-document.constant';

export type EmployeeDocumentDocument = EmployeeDocument & Document;

@Schema({
  collection: 'employee_documents',
  timestamps: true,
  versionKey: false,
})
export class EmployeeDocument {
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  employeeId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(EmployeeDocumentCategory),
  })
  category!: EmployeeDocumentCategory;

  @Prop({ type: String, required: true })
  originalFileName!: string;

  @Prop({ type: String, required: true })
  storageKey!: string;

  @Prop({ type: String, required: true })
  mimeType!: string;

  @Prop({ type: Number, required: true })
  fileSize!: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy?: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const EmployeeDocumentSchema =
  SchemaFactory.createForClass(EmployeeDocument);

// Compound index covers employeeId prefix queries, non-deleted document listing,
// and sorting by createdAt descending. No separate single-field employeeId index needed.
EmployeeDocumentSchema.index(
  { employeeId: 1, deletedAt: 1, createdAt: -1 },
  { name: 'ix_employee_documents_emp_deleted_created' },
);
