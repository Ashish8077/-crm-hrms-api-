import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog } from '../schemas/audit-log.schema.js';
import {
  AuditLogAction,
  AuditLogFailureReason,
} from '../constants/auth.constants.js';

@Injectable()
export class AuditLogRepository {
  private readonly logger = new Logger(AuditLogRepository.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
  ) {}

  async recordLoginSuccess(
    userId: Types.ObjectId,
    email: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    try {
      const log = new this.auditLogModel({
        action: AuditLogAction.LOGIN_SUCCESS,
        userId,
        email,
        ipAddress,
        userAgent,
      });
      await log.save();
    } catch (error) {
      this.logger.error(
        `Failed to record login success audit log for user ${userId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async recordLoginFailure(
    email: string,
    reason: AuditLogFailureReason,
    ipAddress: string | null,
    userAgent: string | null,
    userId?: Types.ObjectId | null,
  ): Promise<void> {
    try {
      const log = new this.auditLogModel({
        action: AuditLogAction.LOGIN_FAILURE,
        userId: userId ?? null,
        email,
        ipAddress,
        userAgent,
        reason,
      });
      await log.save();
    } catch (error) {
      this.logger.error(
        `Failed to record login failure audit log for email ${email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
