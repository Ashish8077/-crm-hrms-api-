import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
  SALARY_STRUCTURE_CONSTANTS,
} from '../constants/salary-structure.constant';

@Schema({ _id: false })
export class SalaryStructureComponentItem {
  @Prop({ type: Types.ObjectId, ref: 'SalaryComponent', required: true })
  componentId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(StructureComponentCalculationType),
    required: true,
  })
  calculationType!: StructureComponentCalculationType;

  @Prop({ type: Number, default: null, min: 0 })
  amount?: number | null;

  @Prop({ type: Number, default: null, min: 0, max: 100 })
  percentage?: number | null;

  @Prop({
    type: String,
    enum: Object.values(StructureComponentPercentageBasis),
    default: null,
  })
  percentageOf?: StructureComponentPercentageBasis | null;
}

export const SalaryStructureComponentItemSchema = SchemaFactory.createForClass(
  SalaryStructureComponentItem,
);

export type SalaryStructureDocument = HydratedDocument<SalaryStructure>;

export type SalaryStructureLean = SalaryStructure & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};

@Schema({
  collection: 'salary_structures',
  timestamps: true,
  optimisticConcurrency: true,
  versionKey: '__v',
})
export class SalaryStructure {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: SALARY_STRUCTURE_CONSTANTS.NAME_MIN_LENGTH,
    maxlength: SALARY_STRUCTURE_CONSTANTS.NAME_MAX_LENGTH,
  })
  name!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    minlength: SALARY_STRUCTURE_CONSTANTS.CODE_MIN_LENGTH,
    maxlength: SALARY_STRUCTURE_CONSTANTS.CODE_MAX_LENGTH,
  })
  code!: string;

  @Prop({
    type: String,
    trim: true,
    maxlength: SALARY_STRUCTURE_CONSTANTS.DESCRIPTION_MAX_LENGTH,
    default: null,
  })
  description?: string | null;

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

  @Prop({
    type: Number,
    required: true,
    min: 0,
  })
  salaryAmount!: number;

  @Prop({
    type: [SalaryStructureComponentItemSchema],
    required: true,
    default: [],
  })
  components!: SalaryStructureComponentItem[];

  @Prop({
    type: Boolean,
    default: true,
    index: true,
  })
  isActive!: boolean;

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

export const SalaryStructureSchema =
  SchemaFactory.createForClass(SalaryStructure);

// Unique normalized code at the database level with case-insensitive collation
SalaryStructureSchema.index(
  { code: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'uq_salary_structures_code',
  },
);

// Listing & pagination sorted by creation
SalaryStructureSchema.index(
  { isActive: 1, createdAt: -1 },
  { name: 'idx_salary_structures_active_created' },
);

// Basis and status filtering
SalaryStructureSchema.index(
  { salaryBasis: 1, isActive: 1 },
  { name: 'idx_salary_structures_basis_active' },
);
