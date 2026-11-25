import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
  SALARY_COMPONENT_CONSTANTS,
} from '../constants/salary-component.constant';

export type SalaryComponentDocument = HydratedDocument<SalaryComponent>;

export type SalaryComponentLean = SalaryComponent & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

@Schema({
  collection: 'salary_components',
  timestamps: true,
  versionKey: false,
})
export class SalaryComponent {
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: SALARY_COMPONENT_CONSTANTS.NAME_MIN_LENGTH,
    maxlength: SALARY_COMPONENT_CONSTANTS.NAME_MAX_LENGTH,
  })
  name!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    minlength: SALARY_COMPONENT_CONSTANTS.CODE_MIN_LENGTH,
    maxlength: SALARY_COMPONENT_CONSTANTS.CODE_MAX_LENGTH,
  })
  code!: string;

  @Prop({
    type: String,
    enum: Object.values(SalaryComponentType),
    required: true,
  })
  type!: SalaryComponentType;

  @Prop({
    type: String,
    enum: Object.values(SalaryComponentCalculationType),
    required: false,
    default: null,
  })
  calculationType?: SalaryComponentCalculationType | null;

  @Prop({
    type: String,
    enum: Object.values(SalaryComponentPercentageBasis),
    required: false,
    default: null,
  })
  percentageOf?: SalaryComponentPercentageBasis | null;

  @Prop({
    type: Boolean,
    default: false,
  })
  isTaxable!: boolean;

  @Prop({
    type: Boolean,
    default: false,
  })
  isStatutory!: boolean;

  @Prop({
    type: Number,
    default: null,
    min: 0,
  })
  defaultValue?: number | null;

  @Prop({
    type: String,
    trim: true,
    maxlength: SALARY_COMPONENT_CONSTANTS.DESCRIPTION_MAX_LENGTH,
    default: null,
  })
  description?: string | null;

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
}

export const SalaryComponentSchema =
  SchemaFactory.createForClass(SalaryComponent);

// Enforce unique normalized code at the database level with case-insensitive collation
SalaryComponentSchema.index(
  { code: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'uq_salary_components_code',
  },
);

// Support filtered listing of active components by type
SalaryComponentSchema.index(
  { isActive: 1, type: 1, createdAt: -1 },
  { name: 'idx_salary_components_active_type_created' },
);
