import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';

import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();

    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    let incomingRequestId = request.headers['x-request-id'];
    if (Array.isArray(incomingRequestId)) {
      incomingRequestId = incomingRequestId[0];
    }
    const requestId =
      typeof incomingRequestId === 'string' ? incomingRequestId : randomUUID();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

    let code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';

    let details: unknown;

    if (exception instanceof AppError) {
      statusCode = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();

      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const responseBody = exceptionResponse as Record<string, unknown>;

        message =
          typeof responseBody.message === 'string'
            ? responseBody.message
            : message;

        if (Array.isArray(responseBody.message)) {
          code = ErrorCode.VALIDATION_ERROR;
          message = 'Request validation failed';
          details = responseBody.message;
        }
      }

      if (statusCode === HttpStatus.BAD_REQUEST) {
        code = ErrorCode.VALIDATION_ERROR;
      }

      if (statusCode === HttpStatus.UNAUTHORIZED) {
        code = ErrorCode.UNAUTHORIZED;
      }

      if (statusCode === HttpStatus.FORBIDDEN) {
        code = ErrorCode.FORBIDDEN;
      }

      if (statusCode === HttpStatus.NOT_FOUND) {
        code = ErrorCode.RESOURCE_NOT_FOUND;
      }

      if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
        code = ErrorCode.TOO_MANY_REQUESTS;
        message = 'Too many requests. Please try again later.';
      }
    }

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          requestId,
          method: request.method,
          path: request.originalUrl,
          statusCode,
          exception,
        },
        'Unhandled application error',
      );
    }

    response.status(statusCode).json({
      success: false,

      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },

      requestId,
    });
  }
}
