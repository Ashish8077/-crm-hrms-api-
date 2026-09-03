import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { PasswordUtil } from '../../common/utils/password.util.js';
import { TokenUtil } from '../../common/utils/token.util.js';
import { UserStatus } from '../users/constants/user-status.constant.js';
import { UserRepository } from '../users/repositories/user.repository.js';
import { LoginDto } from './dto/login.dto.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { LoginSecurityService } from './services/login-security.service.js';
import { LoginClientMetadata, LoginResult } from './types/auth.types.js';
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
  ) {}

  private async handleLoginFailure(
    email: string,
    reason: AuditLogFailureReason,
    clientMetadata: LoginClientMetadata,
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
    clientMetadata: LoginClientMetadata,
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
}
