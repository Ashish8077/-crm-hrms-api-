import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { PermissionAction } from '../constants/permission.constant';

export type PermissionDocument = HydratedDocument<Permission>;

@Schema({
  collection: 'permissions',
  timestamps: true,
  versionKey: false,
})
export class Permission {
  @Prop({
    required: true,
    type: String,
    trim: true,
    lowercase: true,
  })
  module!: string;

  @Prop({
    required: true,
    type: String,
    enum: Object.values(PermissionAction),
    trim: true,
    lowercase: true,
  })
  action!: PermissionAction;

  @Prop({
    required: true,
    type: String,
    unique: true,
    trim: true,
    lowercase: true,
  })
  key!: string;

  @Prop({
    type: String,
    trim: true,
    maxlength: 255,
  })
  description?: string;

  @Prop({
    type: Boolean,
    default: true,
  })
  isActive!: boolean;
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);

PermissionSchema.index(
  { module: 1, isActive: 1 },
  {
    name: 'idx_permissions_module_active',
  },
);
