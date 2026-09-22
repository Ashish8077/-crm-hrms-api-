import { Injectable, Logger } from '@nestjs/common';
import { Types, ClientSession } from 'mongoose';
import { AuditLogRepository } from './repositories/audit-log.repository';
import {
  AuditAction,
  AuditLogFailureReason,
  AuditTargetModel,
} from './constants/audit-log.constant';

export interface CreateAuditLogParams {
  actorId: Types.ObjectId | null;
  action: AuditAction;
  targetId: Types.ObjectId | null;
  targetModel: AuditTargetModel | null;
  details?: Record<string, any>;
  ipAddress: string | null;
  userAgent: string | null;
  email?: string | null;
  reason?: string | null;
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly auditLogRepository: AuditLogRepository) {}

  /**
   * Fire-and-forget logging. In a real system, you might offload this to a queue.
   * If a session is provided, it participates in the transaction and must be awaited.
   */
  async createAuditLog(
    data: CreateAuditLogParams,
    session?: ClientSession,
  ): Promise<void> {
    try {
      await this.auditLogRepository.create(data, session);
    } catch (error) {
      this.logger.error(
        `Failed to create audit log: ${(error as Error).message}`,
        (error as Error).stack,
      );
      if (session) {
        throw error;
      }
    }
  }

  async recordLoginSuccess(
    userId: Types.ObjectId,
    email: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    await this.createAuditLog({
      actorId: userId,
      action: AuditAction.LOGIN_SUCCESS,
      targetId: userId,
      targetModel: AuditTargetModel.USER,
      email,
      ipAddress,
      userAgent,
    });
  }

  async recordLoginFailure(
    email: string,
    reason: AuditLogFailureReason,
    ipAddress: string | null,
    userAgent: string | null,
    userId?: Types.ObjectId | null,
  ): Promise<void> {
    await this.createAuditLog({
      actorId: userId ?? null,
      action: AuditAction.LOGIN_FAILURE,
      targetId: userId ?? null,
      targetModel: userId ? AuditTargetModel.USER : null,
      email,
      reason,
      ipAddress,
      userAgent,
    });
  }

  async recordRefreshSuccess(
    userId: Types.ObjectId,
    email: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    await this.createAuditLog({
      actorId: userId,
      action: AuditAction.REFRESH_SUCCESS,
      targetId: userId,
      targetModel: AuditTargetModel.USER,
      email,
      ipAddress,
      userAgent,
    });
  }

  async recordRefreshFailure(
    reason: AuditLogFailureReason,
    ipAddress: string | null,
    userAgent: string | null,
    userId?: Types.ObjectId | null,
  ): Promise<void> {
    await this.createAuditLog({
      actorId: userId ?? null,
      action: AuditAction.REFRESH_FAILURE,
      targetId: userId ?? null,
      targetModel: userId ? AuditTargetModel.USER : null,
      reason,
      ipAddress,
      userAgent,
    });
  }

  async recordLogoutSuccess(
    userId: Types.ObjectId,
    email: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    await this.createAuditLog({
      actorId: userId,
      action: AuditAction.LOGOUT_SUCCESS,
      targetId: userId,
      targetModel: AuditTargetModel.USER,
      email,
      ipAddress,
      userAgent,
    });
  }
}
