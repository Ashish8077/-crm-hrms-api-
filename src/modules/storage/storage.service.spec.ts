/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
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
        'employees/docs',
        ['application/pdf'],
        10000,
        '.pdf',
      );

      expect(s3SendMock).toHaveBeenCalled();
      expect(result.key).toMatch(/^employees\/docs\/[a-f0-9-]+\.pdf$/);
    });
  });

  describe('deleteFile', () => {
    it('should send DeleteObjectCommand', async () => {
      await service.deleteFile('employees/docs/sample.pdf');
      expect(s3SendMock).toHaveBeenCalled();
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('should return signed URL', async () => {
      const url = await service.getSignedDownloadUrl(
        'employees/docs/sample.pdf',
        3600,
      );
      expect(url).toBe('https://s3.aws.com/signed-url');
    });
  });
});
