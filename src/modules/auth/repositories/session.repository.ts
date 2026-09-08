import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Session, SessionDocument } from '../schemas/session.schema.js';

interface CreateSessionData {
  userId: Types.ObjectId;
  refreshTokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class SessionRepository {
  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<Session>,
  ) {}

  async createSession(
    data: CreateSessionData,
    session?: ClientSession,
  ): Promise<SessionDocument> {
    const sessionDoc = new this.sessionModel({
      userId: data.userId,
      refreshTokenHash: data.refreshTokenHash,
      expiresAt: data.expiresAt,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    });
    return sessionDoc.save({ session });
  }

  async findValidSessionByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({
      refreshTokenHash,
      expiresAt: { $gt: new Date() },
      revokedAt: null,
    });
  }

  async findActiveSessionByIdAndUserId(
    sessionId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({
      _id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
  }

  async revokeSessionById(sessionId: Types.ObjectId): Promise<boolean> {
    const result = await this.sessionModel.deleteOne({ _id: sessionId });
    return result.deletedCount === 1;
  }

  async revokeSessionAtomically(
    sessionId: Types.ObjectId,
    now: Date,
    session: ClientSession,
  ): Promise<boolean> {
    const result = await this.sessionModel.updateOne(
      {
        _id: sessionId,
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          revokedAt: now,
        },
      },
      { session },
    );
    return result.modifiedCount === 1;
  }

  async revokeSession(
    sessionId: Types.ObjectId,
    userId: Types.ObjectId,
    now: Date,
  ): Promise<boolean> {
    const result = await this.sessionModel.updateOne(
      {
        _id: sessionId,
        userId,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: now,
        },
      },
    );

    return result.modifiedCount === 1;
  }
}
