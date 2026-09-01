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
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email: string;

  @Prop({
    type: String,
    required: true,
    select: false,
  })
  passwordHash: string;

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
    required: true,
    index: true,
  })
  status: UserStatus;

  @Prop({
    type: Date,
    default: null,
  })
  lastLoginAt: Date | null;

  @Prop({
    type: Date,
    default: null,
    index: true,
  })
  deletedAt: Date | null;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    default: null,
  })
  createdBy: Types.ObjectId | null;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    default: null,
  })
  updatedBy: Types.ObjectId | null;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    default: null,
  })
  deletedBy: Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
