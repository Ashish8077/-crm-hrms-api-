import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoleDocument = HydratedDocument<Role>;

@Schema({
  collection: 'roles',
  timestamps: true,
  versionKey: false,
})
export class Role {
  @Prop({
    required: true,
    type: String,
    trim: true,
    maxlength: 100,
  })
  name!: string;

  @Prop({
    required: true,
    type: String,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 100,
  })
  key!: string;

  @Prop({
    type: String,
    trim: true,
    maxlength: 255,
  })
  description?: string;

  @Prop({
    type: [Types.ObjectId],
    ref: 'Permission',
    default: [],
  })
  permissionIds!: Types.ObjectId[];

  @Prop({
    type: Boolean,
    default: false,
  })
  isSystemRole!: boolean;

  @Prop({
    type: Boolean,
    default: true,
    index: true,
  })
  isActive!: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);

RoleSchema.index(
  { isSystemRole: 1, isActive: 1 },
  {
    name: 'idx_roles_system_active',
  },
);
