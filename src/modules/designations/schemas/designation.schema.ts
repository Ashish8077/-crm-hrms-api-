import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DesignationDocument = HydratedDocument<Designation>;

@Schema({
  collection: 'designations',
  timestamps: true,
  versionKey: false,
})
export class Designation {
  @Prop({
    type: String,
    required: true,
    trim: true,
  })
  name!: string;

  @Prop({
    type: String,
    required: false,
    trim: true,
  })
  description?: string;

  @Prop({
    type: Boolean,
    default: true,
    index: true,
  })
  isActive!: boolean;

  @Prop({
    type: Date,
    default: null,
    index: true,
  })
  deletedAt!: Date | null;

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

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  deletedBy!: Types.ObjectId | null;
}

export const DesignationSchema = SchemaFactory.createForClass(Designation);

// Partial unique index for active designations
DesignationSchema.index(
  { name: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    collation: { locale: 'en', strength: 2 },
    name: 'uq_designations_name_active',
  },
);
