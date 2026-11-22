import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { HolidayType } from '../constants/leaves.constant';

export type HolidayDocument = HydratedDocument<Holiday>;

@Schema({
  collection: 'holidays',
  timestamps: true,
  versionKey: false,
})
export class Holiday {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true })
  date!: string; // Canonical YYYY-MM-DD

  @Prop({ type: Number, required: true, index: true })
  year!: number; // Calendar year (e.g. 2026)

  @Prop({
    type: String,
    enum: Object.values(HolidayType),
    default: HolidayType.PUBLIC,
  })
  type!: HolidayType;

  @Prop({ type: Types.ObjectId, ref: 'Branch', default: null, index: true })
  branchId!: Types.ObjectId | null; // null represents all branches / organization-wide

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

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

export const HolidaySchema = SchemaFactory.createForClass(Holiday);

// Unique holiday per date and branch (null branchId applies organization-wide)
HolidaySchema.index(
  { date: 1, branchId: 1 },
  {
    name: 'uq_holidays_date_branch',
    unique: true,
    partialFilterExpression: { deletedAt: null },
  },
);

HolidaySchema.index(
  { year: 1, branchId: 1, deletedAt: 1 },
  { name: 'ix_holidays_year_branch_deleted' },
);
