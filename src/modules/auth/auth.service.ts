import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { PasswordUtil } from '../../common/utils/password.util.js';
import { TokenUtil } from '../../common/utils/crypto/token.util.js';
import { UserStatus } from '../users/constants/user-status.constant.js';
import { UserDocument } from '../users/schemas/user.schema.js';
import { UserRepository } from '../users/repositories/user.repository.js';
import { LoginDto } from './dto/login.dto.js';
import { MeResponseDto } from './dto/me-response.dto.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { LoginSecurityService } from './services/login-security.service.js';
import {
  ClientMetadata,
  LoginResult,
  LogoutData,
  RefreshResult,
} from './types/auth.types.js';
import { AuditLogFailureReason } from './constants/auth.constants.js';
import { TimeUtil } from '../../common/utils/time.util.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly loginSecurityService: LoginSecurityService,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private async handleLoginFailure(
    email: string,
    reason: AuditLogFailureReason,
    clientMetadata: ClientMetadata,
    userId?: Types.ObjectId,
  ): Promise<never> {
    await this.auditLogRepository.recordLoginFailure(
      email,
      reason,
      clientMetadata.ipAddress,
      clientMetadata.userAgent,
      userId,
    );
    throw new AppError(
      ErrorCode.INVALID_CREDENTIALS,
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }

  async login(
    loginData: LoginDto,
    clientMetadata: ClientMetadata,
  ): Promise<LoginResult> {
    const email = loginData.email.trim().toLowerCase();
    const { ipAddress, userAgent } = clientMetadata;

    // 1. Check lockout via LoginSecurityService
    const isLocked = await this.loginSecurityService.isLockedOut(email);
    if (isLocked) {
      return this.handleLoginFailure(
        email,
        AuditLogFailureReason.ACCOUNT_LOCKED_OUT,
        clientMetadata,
      );
    }

    // 2. Find user via UserRepository
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      await this.loginSecurityService.incrementFailedAttempts(email);
      return this.handleLoginFailure(
        email,
        AuditLogFailureReason.INVALID_CREDENTIALS,
        clientMetadata,
      );
    }

    // 3. Check user.status
    if (user.status !== UserStatus.ACTIVE) {
      return this.handleLoginFailure(
        email,
        AuditLogFailureReason.ACCOUNT_INACTIVE,
        clientMetadata,
        user._id,
      );
    }

    // 4. Verify password
    const isPasswordValid = await PasswordUtil.verify(
      user.passwordHash,
      loginData.password,
    );
    if (!isPasswordValid) {
      await this.loginSecurityService.incrementFailedAttempts(email);
      return this.handleLoginFailure(
        email,
        AuditLogFailureReason.INVALID_CREDENTIALS,
        clientMetadata,
        user._id,
      );
    }

    // 5. Reset failed attempts
    await this.loginSecurityService.resetAttempts(email);

    // 6. Generate refresh token
    const refreshToken = TokenUtil.generateRefreshToken();
    const refreshTokenHash = TokenUtil.hashToken(refreshToken);

    // 7. Calculate refresh token expiry
    const refreshExpiresInStr = this.configService.getOrThrow<string>(
      'jwt.refreshTokenExpiresIn',
    );

    const expiresInMs =
      TimeUtil.parseDurationToMilliseconds(refreshExpiresInStr);
    const expiresAt = new Date(Date.now() + expiresInMs);

    // 8. Create session
    const session = await this.sessionRepository.createSession({
      userId: user._id,
      refreshTokenHash,
      expiresAt,
      ipAddress,
      userAgent,
    });

    // 9. Generate access token
    const accessTokenExpiresInStr = this.configService.getOrThrow<string>(
      'jwt.accessTokenExpiresIn',
    );

    const expiresInSecs = TimeUtil.parseDurationToSeconds(
      accessTokenExpiresInStr,
    );

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user._id.toString(),
        sid: session._id.toString(),
        type: 'access',
      },
      {
        expiresIn: expiresInSecs,
      },
    );

    // 10. Update lastLoginAt (non-critical)
    await this.userRepository
      .updateLastLoginAt(user._id)
      .catch((error: Error) => {
        this.logger.warn(
          `Failed to update lastLoginAt for user ${user._id.toString()}: ${error.message}`,
        );
      });

    // 11. Audit success (reliable, doesn't fail login)
    await this.auditLogRepository.recordLoginSuccess(
      user._id,
      email,
      ipAddress,
      userAgent,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: expiresInSecs,
      user: {
        id: user._id.toString(),
        email: user.email,
      },
    };
  }

  async refresh(
    refreshToken: string | undefined,
    clientMetadata: ClientMetadata,
  ): Promise<RefreshResult> {
    if (!refreshToken) {
      this.logger.warn('Refresh rejected: refresh token missing');
      await this.auditLogRepository.recordRefreshFailure(
        AuditLogFailureReason.INVALID_REFRESH_TOKEN,
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
      );
      throw new AppError(
        ErrorCode.INVALID_REFRESH_TOKEN,
        'Invalid or expired refresh token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const refreshTokenHash = TokenUtil.hashToken(refreshToken);
    const session =
      await this.sessionRepository.findValidSessionByRefreshTokenHash(
        refreshTokenHash,
      );

    if (!session) {
      this.logger.warn('Refresh rejected: valid session not found');
      await this.auditLogRepository.recordRefreshFailure(
        AuditLogFailureReason.INVALID_REFRESH_TOKEN,
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
      );
      throw new AppError(
        ErrorCode.INVALID_REFRESH_TOKEN,
        'Invalid or expired refresh token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const userId = session.userId;
    const user = await this.userRepository.findById(userId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      this.logger.warn(`Refresh rejected: account inactive or not found`);
      // Inactive/deleted user using valid token -> delete session and reject
      await this.sessionRepository.revokeSessionById(session._id);
      await this.auditLogRepository.recordRefreshFailure(
        AuditLogFailureReason.ACCOUNT_INACTIVE,
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
        userId,
      );
      throw new AppError(
        ErrorCode.INVALID_REFRESH_TOKEN,
        'Invalid or expired refresh token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Start transaction for atomic session rotation
    const dbSession = await this.connection.startSession();
    dbSession.startTransaction();

    try {
      const now = new Date();

      // Atomic revoke
      const isRevoked = await this.sessionRepository.revokeSessionAtomically(
        session._id,
        now,
        dbSession,
      );

      if (!isRevoked) {
        this.logger.warn('Refresh rejected: token rotation conflict');
        await dbSession.abortTransaction();

        // Token was already consumed or concurrent attempt
        await this.auditLogRepository.recordRefreshFailure(
          AuditLogFailureReason.REFRESH_TOKEN_REUSE,
          clientMetadata.ipAddress,
          clientMetadata.userAgent,
          userId,
        );
        throw new AppError(
          ErrorCode.INVALID_REFRESH_TOKEN,
          'Invalid or expired refresh token',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Generate new tokens
      const newRefreshToken = TokenUtil.generateRefreshToken();
      const newRefreshTokenHash = TokenUtil.hashToken(newRefreshToken);

      const refreshExpiresInStr = this.configService.getOrThrow<string>(
        'jwt.refreshTokenExpiresIn',
      );
      const expiresInMs =
        TimeUtil.parseDurationToMilliseconds(refreshExpiresInStr);
      const expiresAt = new Date(now.getTime() + expiresInMs);

      const newSession = await this.sessionRepository.createSession(
        {
          userId,
          refreshTokenHash: newRefreshTokenHash,
          expiresAt,
          ipAddress: clientMetadata.ipAddress,
          userAgent: clientMetadata.userAgent,
        },
        dbSession,
      );

      // Generate JWT Access Token
      const accessTokenExpiresInStr = this.configService.getOrThrow<string>(
        'jwt.accessTokenExpiresIn',
      );
      const expiresInSecs = TimeUtil.parseDurationToSeconds(
        accessTokenExpiresInStr,
      );
      const accessToken = await this.jwtService.signAsync(
        {
          sub: userId.toString(),
          sid: newSession._id.toString(),
          type: 'access',
        },
        { expiresIn: expiresInSecs },
      );

      // Commit transaction
      await dbSession.commitTransaction();

      // Audit success
      await this.auditLogRepository.recordRefreshSuccess(
        userId,
        user.email,
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
      );

      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: expiresInSecs,
        user: {
          id: userId.toString(),
          email: user.email,
        },
      };
    } catch (error) {
      if (dbSession.inTransaction()) {
        await dbSession.abortTransaction();
      }
      throw error;
    } finally {
      await dbSession.endSession();
    }
  }

  async logout(logoutData: LogoutData): Promise<void> {
    const { userId, sessionId, ipAddress, userAgent } = logoutData;

    const revoked = await this.sessionRepository.revokeSession(
      sessionId,
      userId,
      new Date(),
    );

    if (!revoked) {
      // Idempotent logout: already revoked/missing is still success.
      return;
    }

    const user = await this.userRepository.findById(userId);

    if (!user) {
      return;
    }

    try {
      await this.auditLogRepository.recordLogoutSuccess(
        userId,
        user.email,
        ipAddress,
        userAgent,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to record logout audit for user ${userId.toString()}: ${String(error)}`,
      );
    }
  }

  async me(userId: Types.ObjectId): Promise<MeResponseDto> {
    const user = await this.userRepository.findById(userId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AppError(
        ErrorCode.UNAUTHORIZED,
        'User not found or inactive',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return {
      id: (user as UserDocument)._id.toString(),
      email: user.email,
      status: user.status,
      roleIds: user.roleIds.map((id) => id.toString()),
    };
  }
}
