import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();

    const request = httpContext.getRequest<Request>();

    const response = httpContext.getResponse<Response>();

    const startedAt = Date.now();

    const requestId = request.headers['x-request-id']?.toString();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startedAt;

          this.logger.log(
            `${request.method} ${request.originalUrl} ${response.statusCode} ${duration}ms requestId=${requestId}`,
          );
        },

        error: () => {
          const duration = Date.now() - startedAt;

          this.logger.error(
            `${request.method} ${request.originalUrl} ${response.statusCode} ${duration}ms requestId=${requestId}`,
          );
        },
      }),
    );
  }
}
