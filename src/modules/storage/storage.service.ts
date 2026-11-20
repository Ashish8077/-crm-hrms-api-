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

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.bucketName =
      this.configService.getOrThrow<string>('storage.bucketName');

    this.s3Client = new S3Client({
      region: this.configService.getOrThrow<string>('storage.region'),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>(
          'storage.accessKeyId',
        ),
        secretAccessKey: this.configService.getOrThrow<string>(
          'storage.secretAccessKey',
        ),
      },
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
    allowedMimeTypes?: string[],
    maxSizeBytes?: number,
    trustedExtension?: string,
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
    const key = `${folder}/${randomUUID()}${extension}`;

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
    } catch (error) {
      this.logger.error(`Failed to upload file to S3: ${error}`);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to upload file to storage',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(`Failed to delete file ${key} from S3: ${error}`);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to delete file from storage',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getSignedDownloadUrl(
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      this.logger.error(`Failed to generate signed URL for ${key}: ${error}`);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to generate signed download URL',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
