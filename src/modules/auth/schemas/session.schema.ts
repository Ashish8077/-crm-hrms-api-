import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

@Schema({
  collection: 'sessions',
  timestamps: true,
  versionKey: false,
})
export class Session {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    unique: true,
    select: false,
  })
  refreshTokenHash: string;

  @Prop({
    type: Date,
    required: true,
  })
  expiresAt: Date;

  @Prop({
    type: Date,
    default: null,
  })
  revokedAt: Date | null;

  @Prop({
    type: String,
    default: null,
  })
  ipAddress: string | null;

  @Prop({
    type: String,
    default: null,
  })
  userAgent: string | null;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// TTL index: MongoDB periodically removes expired session documents
SessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'idx_sessions_expires_ttl' },
);

// Compound index for active session lookups and bulk user revocation
// Also serves as index prefix for single { userId: 1 } queries
SessionSchema.index(
  { userId: 1, revokedAt: 1 },
  { name: 'idx_sessions_user_revoked' },
);
