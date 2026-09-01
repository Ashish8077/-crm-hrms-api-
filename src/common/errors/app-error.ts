import { HttpStatus } from '@nestjs/common';

import { ErrorCode } from './error-codes';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    public readonly details?: unknown,
  ) {
    super(message);

    this.name = 'AppError';

    Error.captureStackTrace(this, AppError);
  }
}
