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
