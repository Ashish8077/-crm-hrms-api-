/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: {
    status: jest.Mock;
    json: jest.Mock;
  };
  let mockRequest: {
    headers: Record<string, string>;
    method: string;
    originalUrl: string;
  };
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockRequest = {
      headers: {},
      method: 'POST',
      originalUrl: '/roles',
    };
    mockHost = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ArgumentsHost;
  });

  it('should handle MongoDB duplicate key error (code 11000) with 409 Conflict', () => {
    const mongoDuplicateError = {
      name: 'MongoServerError',
      code: 11000,
      keyPattern: { key: 1 },
      keyValue: { key: 'admin' },
      message:
        'E11000 duplicate key error collection: crm.roles index: key_1 dup key: { key: "admin" }',
    };

    filter.catch(mongoDuplicateError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_ALREADY_EXISTS,
          message: 'Resource already exists',
        },
      }),
    );
  });

  it('should handle single MongoDB ValidationError with 400 Bad Request and normalized details', () => {
    const mongoValidationError = {
      name: 'ValidationError',
      message: 'Validation failed',
      errors: {
        field: { path: 'field', message: 'Path `field` is required.' },
      },
    };

    filter.catch(mongoValidationError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Database validation failed',
          details: [{ field: 'field', message: 'Path `field` is required.' }],
        }),
      }),
    );
  });

  it('should handle multiple MongoDB ValidationErrors with normalized details array', () => {
    const mongoValidationError = {
      name: 'ValidationError',
      message: 'Validation failed',
      errors: {
        field1: { path: 'field1', message: 'Path `field1` is required.' },
        field2: { message: 'Invalid value for field2.' }, // Missing path falls back to key
      },
    };

    filter.catch(mongoValidationError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Database validation failed',
          details: [
            { field: 'field1', message: 'Path `field1` is required.' },
            { field: 'field2', message: 'Invalid value for field2.' },
          ],
        }),
      }),
    );
  });

  it('should handle AppError correctly', () => {
    const appError = new AppError(
      ErrorCode.RESOURCE_ALREADY_EXISTS,
      "Role with key 'manager' already exists",
      HttpStatus.CONFLICT,
    );

    filter.catch(appError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: {
          code: ErrorCode.RESOURCE_ALREADY_EXISTS,
          message: "Role with key 'manager' already exists",
        },
      }),
    );
  });
});
