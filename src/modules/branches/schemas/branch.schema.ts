import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BranchDocument = HydratedDocument<Branch>;

@Schema({
  collection: 'branches',
  timestamps: true,
  versionKey: false,
})
export class Branch {
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
  address?: string;

  @Prop({
    type: Number,
    required: false,
  })
  latitude?: number;

  @Prop({
    type: Number,
    required: false,
  })
  longitude?: number;

  @Prop({
    type: Number,
    default: 150,
  })
  radiusMeters?: number;

  @Prop({
    type: [String],
    default: [],
  })
  allowedIps?: string[];

  @Prop({
    type: Boolean,
    default: true,
  })
  enforceIpCheck?: boolean;

  @Prop({
    type: String,
    default: 'Asia/Kolkata',
    trim: true,
  })
  timezone?: string;

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

export const BranchSchema = SchemaFactory.createForClass(Branch);

// Partial unique index for active branches
BranchSchema.index(
  { name: 1 },
  {
    unique: true,
    collation: {
      locale: 'en',
      strength: 2,
    },
    partialFilterExpression: {
      deletedAt: null,
    },
    name: 'uq_branches_name_active',
  },
);
