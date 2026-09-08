import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { MeResponseDto } from './dto/me-response.dto.js';
import {
  ACCESS_TOKEN_COOKIE,
  MILLISECONDS_PER_SECOND,
  REFRESH_TOKEN_COOKIE,
} from './constants/auth.constants.js';
import { TimeUtil } from '../../common/utils/time.util.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthenticatedRequest } from './types/auth-request.type.js';

@ApiTags('Authentication')
@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute per IP
  @ApiOperation({ summary: 'Login to the application' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successful login',
    type: LoginResponseDto,
  })
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: boolean; data: LoginResponseDto }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const loginResult = await this.authService.login(loginDto, {
      ipAddress,
      userAgent,
    });

    const secure = this.configService.get<boolean>('cookie.secure');
    const domain = this.configService.get<string | undefined>('cookie.domain');

    // Access token cookie (SameSite=Lax for top-level navigation, Path=/api)
    response.cookie(ACCESS_TOKEN_COOKIE, loginResult.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/api',
      domain,
      maxAge: loginResult.expiresIn * MILLISECONDS_PER_SECOND,
    });

    // Refresh token cookie (SameSite=Strict, scoped to /refresh)
    const refreshExpiresInStr = this.configService.getOrThrow<string>(
      'jwt.refreshTokenExpiresIn',
    );

    const expiresInMs =
      TimeUtil.parseDurationToMilliseconds(refreshExpiresInStr);

    response.cookie(REFRESH_TOKEN_COOKIE, loginResult.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/v1/auth/refresh',
      domain,
      maxAge: expiresInMs,
    });

    return {
      success: true,
      data: {
        user: loginResult.user,
        expiresIn: loginResult.expiresIn,
      },
    };
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully refreshed access token',
    type: LoginResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  async refreshToken(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookies = (request.cookies || {}) as Record<
      string,
      string | undefined
    >;
    const refreshToken = cookies[REFRESH_TOKEN_COOKIE];

    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;

    const refreshResult = await this.authService.refresh(refreshToken, {
      ipAddress,
      userAgent,
    });

    const secure = this.configService.get<boolean>('cookie.secure');
    const domain = this.configService.get<string | undefined>('cookie.domain');

    // Access token cookie
    response.cookie(ACCESS_TOKEN_COOKIE, refreshResult.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/api',
      domain,
      maxAge: refreshResult.expiresIn * MILLISECONDS_PER_SECOND,
    });

    // Refresh token cookie
    const refreshExpiresInStr = this.configService.getOrThrow<string>(
      'jwt.refreshTokenExpiresIn',
    );
    const expiresInMs =
      TimeUtil.parseDurationToMilliseconds(refreshExpiresInStr);

    response.cookie(REFRESH_TOKEN_COOKIE, refreshResult.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/v1/auth/refresh',
      domain,
      maxAge: expiresInMs,
    });

    return {
      success: true,
      data: {
        user: refreshResult.user,
        expiresIn: refreshResult.expiresIn,
      },
    };
  }

  @Get('me')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current user profile retrieved successfully',
    type: MeResponseDto,
  })
  async me(@Req() request: AuthenticatedRequest): Promise<MeResponseDto> {
    const { userId } = request.user;
    return this.authService.me(userId);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Logout and revoke session' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully logged out',
  })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { userId, sessionId } = request.user;

    await this.authService.logout({
      userId,
      sessionId,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });

    const secure = this.configService.getOrThrow<boolean>('cookie.secure');
    const domain = this.configService.get<string | undefined>('cookie.domain');

    // Clear access token cookie
    response.clearCookie(ACCESS_TOKEN_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/api',
      domain,
    });

    // Clear refresh token cookie
    response.clearCookie(REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/v1/auth/refresh',
      domain,
    });

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }
}
