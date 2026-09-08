import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { ACCESS_TOKEN_COOKIE } from '../constants/auth.constants.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { UserRepository } from '../../users/repositories/user.repository.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { UserStatus } from '../../users/constants/user-status.constant.js';
import { AuthenticatedRequest } from '../types/auth-request.type.js';

interface JwtPayload {
  sub: string;
  sid: string;
  type: 'access';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly sessionRepository: SessionRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublicRoute(context)) {
      return true;
    }

    const request = this.getRequest(context);
    const token = this.extractAccessToken(request);

    const payload = await this.verifyAccessToken(token);
    this.validatePayload(payload);

    const userId = this.toObjectId(payload.sub);
    const sessionId = this.toObjectId(payload.sid);

    await this.validateSession(sessionId, userId);
    await this.validateUser(userId);

    this.attachAuthenticatedUser(request, userId, sessionId);

    return true;
  }

  private isPublicRoute(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  private getRequest(context: ExecutionContext): Request {
    return context.switchToHttp().getRequest<Request>();
  }

  private extractAccessToken(request: Request): string {
    const cookies = (request.cookies || {}) as Record<
      string,
      string | undefined
    >;
    const accessToken = cookies[ACCESS_TOKEN_COOKIE];

    if (!accessToken || accessToken.trim() === '') {
      throw this.createUnauthorizedError('Access token is missing or empty');
    }

    return accessToken;
  }

  private async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      // Cryptographically verify token and strictly enforce HS256
      return await this.jwtService.verifyAsync<JwtPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      // JsonWebTokenError (invalid signature, malformed, expired, wrong algorithm)
      throw this.createUnauthorizedError('Invalid or expired access token');
    }
  }

  private validatePayload(payload: JwtPayload): void {
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw this.createUnauthorizedError('Invalid token payload: missing sub');
    }
    if (!payload.sid || typeof payload.sid !== 'string') {
      throw this.createUnauthorizedError('Invalid token payload: missing sid');
    }
    if (payload.type !== 'access') {
      throw this.createUnauthorizedError('Invalid token type');
    }
  }

  private toObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw this.createUnauthorizedError('Invalid identifier format');
    }
    return new Types.ObjectId(id);
  }

  private async validateSession(
    sessionId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<void> {
    // Note: DB errors here will intentionally bubble up as 5xx, failing closed
    const session = await this.sessionRepository.findActiveSessionByIdAndUserId(
      sessionId,
      userId,
    );

    if (!session) {
      this.logger.warn(
        `Auth failed: Active session not found for session ${sessionId.toString()} and user ${userId.toString()}`,
      );
      throw this.createUnauthorizedError('Invalid or expired access token');
    }
  }

  private async validateUser(userId: Types.ObjectId): Promise<void> {
    const user = await this.userRepository.findById(userId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      this.logger.warn(
        `Auth failed: User ${userId.toString()} is not active or not found`,
      );
      throw this.createUnauthorizedError('Invalid or expired access token');
    }
  }

  private attachAuthenticatedUser(
    request: Request,
    userId: Types.ObjectId,
    sessionId: Types.ObjectId,
  ): void {
    const authRequest = request as AuthenticatedRequest;
    authRequest.user = {
      userId,
      sessionId,
    };
  }

  private createUnauthorizedError(internalReason: string): AppError {
    // We log the internal reason for debugging but return a generic message to the client
    this.logger.debug(`Authentication rejected: ${internalReason}`);
    return new AppError(
      ErrorCode.UNAUTHORIZED,
      'Invalid or expired access token',
      401,
    );
  }
}
