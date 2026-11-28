/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { S3Client } from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.aws.com/signed-url'),
}));

describe('StorageService', () => {
  let service: StorageService;
  let s3SendMock: jest.Mock;

  const validBuffer = Buffer.from('%PDF-1.4 test');
  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: validBuffer.length,
    buffer: validBuffer,
    destination: '',
    filename: '',
    path: '',
    stream: new Readable(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    s3SendMock = jest.fn().mockResolvedValue({});
    (S3Client as unknown as jest.Mock).mockImplementation(() => ({
      send: s3SendMock,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              if (key === 'storage.bucketName') return 'test-bucket';
              if (key === 'storage.region') return 'us-east-1';
              if (key === 'storage.accessKeyId') return 'test-key';
              if (key === 'storage.secretAccessKey') return 'test-secret';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  describe('uploadFile', () => {
    it('should throw VALIDATION_ERROR if file or buffer is missing', async () => {
      await expect(service.uploadFile(null as any, 'folder')).rejects.toThrow(
        AppError,
      );

      await expect(
        service.uploadFile({ ...mockFile, buffer: null as any }, 'folder'),
      ).rejects.toThrow(AppError);

      await expect(
        service.uploadFile({ ...mockFile, buffer: Buffer.from([]) }, 'folder'),
      ).rejects.toThrow(AppError);
    });

    it('should throw VALIDATION_ERROR if buffer exceeds maxSizeBytes', async () => {
      await expect(
        service.uploadFile(
          mockFile,
          'folder',
          undefined,
          validBuffer.length - 1,
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.VALIDATION_ERROR,
        }),
      );
    });

    it('should throw VALIDATION_ERROR if MIME type is not allowed', async () => {
      await expect(
        service.uploadFile(mockFile, 'folder', ['image/png']),
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.VALIDATION_ERROR,
        }),
      );
    });

    it('should upload with ContentLength and trusted extension', async () => {
      const result = await service.uploadFile(
        mockFile,
        'hrms/payroll/payslips/period1/emp1',
        ['application/pdf'],
        10000,
        '.pdf',
      );

      expect(s3SendMock).toHaveBeenCalled();
      expect(result.key).toMatch(
        /^hrms\/payroll\/payslips\/period1\/emp1\/[a-f0-9-]+\.pdf$/,
      );
    });

    it('should log AWS error code, httpStatusCode, awsRequestId, and correlation requestId cleanly without leaking secrets while keeping client error sanitized', async () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      s3SendMock.mockRejectedValueOnce({
        name: 'AccessDenied',
        Code: 'AccessDenied',
        message:
          'User AKIAIOSFODNN7EXAMPLE with secret test-secret denied on X-Amz-Signature=deadbeef',
        $metadata: {
          httpStatusCode: 403,
          requestId: 'AWS-REQ-12345',
          extendedRequestId: 'EXT-999',
        },
      });

      await expect(
        service.uploadFile(
          mockFile,
          'hrms/payroll/payslips/p1/e1',
          ['application/pdf'],
          10000,
          '.pdf',
          'e7f3b105-da92-4949-890b-cc4b3a2edf37',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: 'Failed to upload file to storage',
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'upload',
          bucketName: 'test-bucket',
          region: 'us-east-1',
          awsErrorCode: 'AccessDenied',
          httpStatusCode: 403,
          awsRequestId: 'AWS-REQ-12345',
          requestId: 'e7f3b105-da92-4949-890b-cc4b3a2edf37',
          message: expect.not.stringContaining('test-secret'),
        }),
        'S3 upload operation failed',
      );
      const loggedMeta = loggerSpy.mock.calls[0]?.[0] as { message: string };
      expect(loggedMeta.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(loggedMeta.message).not.toContain('deadbeef');
      loggerSpy.mockRestore();
    });
  });

  describe('deleteFile', () => {
    it('should send DeleteObjectCommand for both new HRMS and legacy keys', async () => {
      await service.deleteFile('hrms/payroll/payslips/p1/e1/sample.pdf');
      await service.deleteFile('employees/payslips/p1/e1/legacy.pdf');
      expect(s3SendMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('should return signed URL for both new HRMS and legacy keys', async () => {
      const url1 = await service.getSignedDownloadUrl(
        'hrms/employees/e1/documents/sample.pdf',
        3600,
      );
      const url2 = await service.getSignedDownloadUrl(
        'employees/e1/documents/legacy.pdf',
        3600,
      );
      expect(url1).toBe('https://s3.aws.com/signed-url');
      expect(url2).toBe('https://s3.aws.com/signed-url');
    });
  });

  describe('downloadFile', () => {
    it('should return file buffer when S3 object exists for new and legacy keys', async () => {
      s3SendMock.mockResolvedValue({
        Body: {
          transformToByteArray: jest
            .fn()
            .mockResolvedValue(new Uint8Array(validBuffer)),
        },
      });

      const buffer = await service.downloadFile(
        'hrms/payroll/payslips/p1/e1/sample.pdf',
      );
      const legacyBuffer = await service.downloadFile(
        'employees/payslips/p1/e1/legacy.pdf',
      );
      expect(buffer).toEqual(validBuffer);
      expect(legacyBuffer).toEqual(validBuffer);
    });

    it('should throw RESOURCE_NOT_FOUND when S3 object is missing (NoSuchKey)', async () => {
      s3SendMock.mockRejectedValueOnce({
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      });

      await expect(
        service.downloadFile('employees/payslips/missing.pdf'),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: 404,
      });
    });

    it('should throw INTERNAL_SERVER_ERROR on unexpected storage error', async () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      s3SendMock.mockRejectedValueOnce(new Error('S3 network timeout'));

      await expect(
        service.downloadFile('employees/payslips/sample.pdf'),
      ).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
      });
      loggerSpy.mockRestore();
    });
  });
});
