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
    index: true,
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
    index: true,
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
