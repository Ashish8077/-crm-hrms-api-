import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, Connection, ClientSession } from 'mongoose';
import 'multer';
import {
  EmployeeDocumentLean,
  EmployeeDocumentRepository,
} from './repositories/employee-document.repository';
import { EmployeeRepository } from './repositories/employee.repository';
import { StorageService } from '../storage/storage.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { UploadEmployeeDocumentDto } from './dto/upload-employee-document.dto';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import {
  ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_FILE_SIZE,
} from './constants/employee-document.constant';
import {
  validateFileContent,
  getTrustedExtension,
} from '../../common/utils/file-signature.util';
import {
  EmployeeDocumentMapper,
  EmployeeDocumentResponse,
} from './mappers/employee-document.mapper';

@Injectable()
export class EmployeeDocumentsService {
  private readonly logger = new Logger(EmployeeDocumentsService.name);

  constructor(
    private readonly employeeDocumentRepository: EmployeeDocumentRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly storageService: StorageService,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async uploadDocument(
    employeeId: Types.ObjectId,
    actorId: Types.ObjectId,
    file: Express.Multer.File,
    dto: UploadEmployeeDocumentDto,
    metadata: ClientMetadata,
  ): Promise<EmployeeDocumentResponse> {
    if (!file) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'File is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'File buffer is required and cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    const fileSize = file.buffer.length;

    if (fileSize > MAX_DOCUMENT_FILE_SIZE) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `File size exceeds maximum limit of ${MAX_DOCUMENT_FILE_SIZE / (1024 * 1024)}MB`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 1: Deep file content verification using magic bytes / file signature
    const contentValidation = validateFileContent(
      file.buffer,
      file.mimetype,
      ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES,
    );

    if (!contentValidation.isValid) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        contentValidation.error ?? 'File content verification failed',
        HttpStatus.BAD_REQUEST,
      );
    }

    const verifiedMimeType = contentValidation.detectedMime!;
    const trustedExtension = getTrustedExtension(verifiedMimeType);

    // Step 2: Validate Employee existence prior to any external storage operations
    const employee = await this.employeeRepository.findById(employeeId);
    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Step 3: Upload physical file to cloud storage (S3/R2) using trusted extension
    let key: string | undefined;
    try {
      const uploaded = await this.storageService.uploadFile(
        file,
        `employees/${employeeId.toString()}/documents`,
        [...ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES],
        MAX_DOCUMENT_FILE_SIZE,
        trustedExtension,
      );
      key = uploaded.key;
    } catch (storageError) {
      if (storageError instanceof AppError) {
        throw storageError;
      }
      this.logger.error(
        `Failed to upload document to storage: ${storageError}`,
      );
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to upload file to storage',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Step 4: Persist MongoDB document metadata and audit log in an atomic transaction
    const session = await this.connection.startSession();
    let savedDoc: EmployeeDocumentLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        const createData = EmployeeDocumentMapper.toCreateData({
          employeeId,
          category: dto.category,
          originalFileName: file.originalname,
          storageKey: key,
          mimeType: verifiedMimeType,
          fileSize,
          uploadedBy: actorId,
        });

        savedDoc = await this.employeeDocumentRepository.create(
          createData,
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DOCUMENT_UPLOADED,
            targetModel: AuditTargetModel.EMPLOYEE_DOCUMENT,
            targetId: savedDoc._id,
            details: {
              category: dto.category,
              originalFileName: file.originalname,
              fileSize,
              mimeType: verifiedMimeType,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } catch (error) {
      // Step 5: MongoDB transaction failed and was rolled back automatically by withTransaction.
      // Execute robust compensating action with retries and structured orphan reconciliation logging.
      if (key) {
        await this.cleanupStorageWithRetry(key, employeeId, actorId);
      }

      if (error instanceof AppError) {
        throw error;
      }

      this.logger.error(
        `Failed to save document metadata and audit log in transaction: ${error}`,
      );
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to save document',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await session.endSession();
    }

    // Response mapping kept outside transaction to prevent unnecessary aborts
    return EmployeeDocumentMapper.toDocumentResponse(savedDoc!);
  }

  async listDocuments(
    employeeId: Types.ObjectId,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<EmployeeDocumentResponse>> {
    const employee = await this.employeeRepository.findById(employeeId);
    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const result = await this.employeeDocumentRepository.findList(
      employeeId,
      query,
    );

    return {
      data: result.data.map((doc) =>
        EmployeeDocumentMapper.toDocumentResponse(doc),
      ),
      meta: result.meta,
    };
  }

  async getDocumentDownloadUrl(
    employeeId: Types.ObjectId,
    documentId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<{ url: string }> {
    const doc = await this.employeeDocumentRepository.findById(documentId);

    if (!doc || doc.employeeId.toString() !== employeeId.toString()) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Document not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const url = await this.storageService.getSignedDownloadUrl(doc.storageKey);

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.DOCUMENT_DOWNLOADED,
      targetModel: AuditTargetModel.EMPLOYEE_DOCUMENT,
      targetId: doc._id,
      details: {
        category: doc.category,
        originalFileName: doc.originalFileName,
      },
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });

    return { url };
  }

  async deleteDocument(
    employeeId: Types.ObjectId,
    documentId: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const doc = await this.employeeDocumentRepository.findById(documentId);

    if (!doc || doc.employeeId.toString() !== employeeId.toString()) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Document not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Atomic MongoDB transaction for soft deletion and audit logging
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async (session: ClientSession) => {
        await this.employeeDocumentRepository.softDelete(
          documentId,
          actorId,
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.DOCUMENT_DELETED,
            targetModel: AuditTargetModel.EMPLOYEE_DOCUMENT,
            targetId: doc._id,
            details: {
              category: doc.category,
              originalFileName: doc.originalFileName,
            },
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    // Physical storage deletion performed after database transaction commits with retry
    await this.cleanupStorageWithRetry(doc.storageKey, employeeId, actorId);
  }

  /**
   * Resilient storage cleanup retry mechanism.
   * If all retries fail, logs a structured critical event for automated orphan reconciliation.
   */
  private async cleanupStorageWithRetry(
    key: string,
    employeeId: Types.ObjectId,
    actorId: Types.ObjectId,
    maxRetries = 3,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.storageService.deleteFile(key);
        this.logger.log(
          `Compensating cleanup succeeded for storage key ${key} on attempt ${attempt}`,
        );
        return;
      } catch (cleanupError) {
        this.logger.warn(
          `Compensating cleanup attempt ${attempt}/${maxRetries} failed for storage key ${key}: ${cleanupError}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }
    }

    this.logger.error(
      `[CRITICAL_ORPHAN_STORAGE_KEY] Failed to delete storage object after ${maxRetries} attempts. ` +
        `Reconciliation required: {"key":"${key}","employeeId":"${employeeId.toString()}","actorId":"${actorId.toString()}","timestamp":"${new Date().toISOString()}"}`,
    );
  }
}
