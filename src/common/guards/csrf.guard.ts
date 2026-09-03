import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // Skip CSRF validation for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const allowedOrigin =
      this.configService.getOrThrow<string>('app.corsOrigin');
    const origin = request.headers.origin;
    const referer = request.headers.referer;

    let sourceOrigin: string | undefined;

    if (origin) {
      sourceOrigin = origin;
    } else if (referer) {
      try {
        const refererUrl = new URL(referer);
        sourceOrigin = refererUrl.origin;
      } catch {
        throw new ForbiddenException('CSRF validation failed');
      }
    }

    if (!sourceOrigin) {
      throw new ForbiddenException('CSRF validation failed');
    }

    if (sourceOrigin !== allowedOrigin) {
      throw new ForbiddenException('CSRF validation failed');
    }

    return true;
  }
}
