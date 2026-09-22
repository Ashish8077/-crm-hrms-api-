import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  AuditAction,
  AuditTargetModel,
  AuditLogFailureReason,
} from '../constants/audit-log.constant';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({
  collection: 'audit_logs',
  timestamps: true,
  versionKey: false,
})
export class AuditLog {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: false,
    index: true,
    default: null,
  })
  actorId!: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: Object.values(AuditAction),
    required: true,
    index: true,
  })
  action!: AuditAction;

  @Prop({ type: Types.ObjectId, required: false, index: true, default: null })
  targetId!: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: Object.values(AuditTargetModel),
    required: false,
    default: null,
  })
  targetModel!: AuditTargetModel | null;

  @Prop({ type: Object })
  details?: Record<string, any>;

  @Prop({ type: String, default: null })
  ipAddress?: string | null;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  @Prop({ type: String, default: null })
  email?: string | null;

  @Prop({
    type: String,
    enum: Object.values(AuditLogFailureReason),
    default: null,
  })
  reason?: AuditLogFailureReason | null;

  // createdAt and updatedAt are automatically managed
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Compound index for querying a specific target's history
AuditLogSchema.index({ targetModel: 1, targetId: 1, createdAt: -1 });
