import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  AuditLogAction,
  AuditLogFailureReason,
} from '../constants/auth.constants.js';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({
  collection: 'audit_logs',
  timestamps: true,
  versionKey: false,
})
export class AuditLog {
  @Prop({
    type: String,
    enum: Object.values(AuditLogAction),
    required: true,
    index: true,
  })
  action!: AuditLogAction;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  userId!: Types.ObjectId | null;

  @Prop({
    type: String,
    required: true,
  })
  email!: string;

  @Prop({
    type: String,
    default: null,
  })
  ipAddress!: string | null;

  @Prop({
    type: String,
    default: null,
  })
  userAgent!: string | null;

  @Prop({
    type: String,
    enum: Object.values(AuditLogFailureReason),
    default: null,
  })
  reason!: AuditLogFailureReason | null;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
