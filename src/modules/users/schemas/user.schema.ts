import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserStatus } from '../constants/user-status.constant';

export type UserDocument = HydratedDocument<User>;

@Schema({
  collection: 'users',
  timestamps: true,
  versionKey: false,
})
export class User {
  @Prop({
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  })
  email!: string;

  @Prop({
    type: String,
    required: true,
    select: false,
  })
  passwordHash!: string;

  @Prop({
    type: [Types.ObjectId],
    ref: 'Role',
    default: [],
    index: true,
  })
  roleIds!: Types.ObjectId[];

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
    required: true,
    index: true,
  })
  status!: UserStatus;

  @Prop({
    type: Date,
    default: null,
  })
  lastLoginAt!: Date | null;

  @Prop({
    type: Date,
    default: null,
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

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Partial unique index: ensures active users have unique emails,
// while allowing soft-deleted users' emails to be reused.
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    name: 'idx_users_email_active_unique',
  },
);

// Query-pattern index for the primary user list endpoint with reverse chronological sorting
// Also serves as the index prefix for single { deletedAt: 1 } queries
UserSchema.index(
  { deletedAt: 1, createdAt: -1 },
  { name: 'idx_users_deleted_created' },
);
