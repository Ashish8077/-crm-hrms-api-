import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { randomUUID } from 'crypto';
import { getTrustedExtension } from '../../common/utils/file-signature.util';

interface S3ErrorShape {
  name?: string;
  Code?: string;
  code?: string;
  message?: string;
  $metadata?: {
    httpStatusCode?: number;
    requestId?: string;
    extendedRequestId?: string;
  };
}

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly secretValues: string[];
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.bucketName =
      this.configService.getOrThrow<string>('storage.bucketName');
    this.region = this.configService.getOrThrow<string>('storage.region');
    const accessKeyId = this.configService.getOrThrow<string>(
      'storage.accessKeyId',
    );
    const secretAccessKey = this.configService.getOrThrow<string>(
      'storage.secretAccessKey',
    );
    this.secretValues = [accessKeyId, secretAccessKey].filter(
      (v) => typeof v === 'string' && v.length > 0,
    );

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
    allowedMimeTypes?: string[],
    maxSizeBytes?: number,
    trustedExtension?: string,
    requestId?: string | null,
  ): Promise<{ key: string }> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'File buffer is empty or missing',
        HttpStatus.BAD_REQUEST,
      );
    }

    const actualSize = file.buffer.length;

    if (maxSizeBytes !== undefined && actualSize > maxSizeBytes) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `File size exceeds maximum limit of ${maxSizeBytes} bytes`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (allowedMimeTypes && !allowedMimeTypes.includes(file.mimetype)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid file type. Allowed: ${allowedMimeTypes.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const extension =
      trustedExtension !== undefined
        ? trustedExtension
        : getTrustedExtension(file.mimetype);
    const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
    const key = `${normalizedFolder}/${randomUUID()}${extension}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentLength: actualSize,
      });

      await this.s3Client.send(command);
      return { key };
    } catch (error: unknown) {
      this.logSanitizedS3Error('upload', key, error, requestId);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to upload file to storage',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteFile(key: string, requestId?: string | null): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error: unknown) {
      this.logSanitizedS3Error('delete', key, error, requestId);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to delete file from storage',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async downloadFile(key: string, requestId?: string | null): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      if (!response.Body) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Stored file body is empty or missing',
          HttpStatus.NOT_FOUND,
        );
      }

      if (typeof response.Body.transformToByteArray === 'function') {
        const bytes = await response.Body.transformToByteArray();
        return Buffer.from(bytes);
      }

      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }

      const s3Err = error as S3ErrorShape;
      if (
        s3Err?.name === 'NoSuchKey' ||
        s3Err?.Code === 'NoSuchKey' ||
        s3Err?.$metadata?.httpStatusCode === 404
      ) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Stored file not found in storage',
          HttpStatus.NOT_FOUND,
        );
      }

      this.logSanitizedS3Error('download', key, error, requestId);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to download file from storage',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getSignedDownloadUrl(
    key: string,
    expiresIn: number = 3600,
    requestId?: string | null,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error: unknown) {
      this.logSanitizedS3Error('sign_url', key, error, requestId);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to generate signed download URL',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private logSanitizedS3Error(
    operation: string,
    key: string,
    error: unknown,
    requestId?: string | null,
  ): void {
    const s3Err =
      typeof error === 'object' && error !== null
        ? (error as S3ErrorShape)
        : undefined;
    const rawMessage =
      error instanceof Error
        ? error.message
        : typeof s3Err?.message === 'string'
          ? s3Err.message
          : 'Unknown S3 error';

    this.logger.error(
      {
        operation,
        bucketName: this.bucketName,
        region: this.region,
        key,
        errorName: s3Err?.name ?? 'UnknownError',
        awsErrorCode: s3Err?.Code ?? s3Err?.code ?? null,
        httpStatusCode: s3Err?.$metadata?.httpStatusCode ?? null,
        awsRequestId: s3Err?.$metadata?.requestId ?? null,
        extendedRequestId: s3Err?.$metadata?.extendedRequestId ?? null,
        requestId: requestId ?? null,
        message: this.sanitizeErrorMessage(rawMessage),
      },
      `S3 ${operation} operation failed`,
    );
  }

  private sanitizeErrorMessage(message: string): string {
    let sanitized = message
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_KEY]')
      .replace(
        /(X-Amz-(?:Credential|Signature|Security-Token)=)[^&\s]+/gi,
        '$1[REDACTED]',
      );

    for (const secret of this.secretValues) {
      if (secret.length >= 4 && sanitized.includes(secret)) {
        sanitized = sanitized.split(secret).join('[REDACTED]');
      }
    }

    return sanitized.slice(0, 500);
  }
}
