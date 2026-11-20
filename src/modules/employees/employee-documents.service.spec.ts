/* eslint-disable @typescript-eslint/unbound-method */
import { Readable } from 'stream';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { EmployeeDocumentsService } from './employee-documents.service';
import {
  EmployeeDocumentLean,
  EmployeeDocumentRepository,
} from './repositories/employee-document.repository';
import {
  EmployeeLean,
  EmployeeRepository,
} from './repositories/employee.repository';
import { StorageService } from '../storage/storage.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import {
  ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES,
  EmployeeDocumentCategory,
  MAX_DOCUMENT_FILE_SIZE,
} from './constants/employee-document.constant';

describe('EmployeeDocumentsService', () => {
  let service: EmployeeDocumentsService;
  let employeeDocumentRepo: jest.Mocked<EmployeeDocumentRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let storageService: jest.Mocked<StorageService>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation((cb: (session: unknown) => unknown) =>
        cb(mockSession),
      ),
    endSession: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const employeeId = new Types.ObjectId();
  const actorId = new Types.ObjectId();
  const documentId = new Types.ObjectId();
  const clientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'JestTestRunner/1.0',
  };

  const validPdfContent = Buffer.from('%PDF-1.7 sample mock content');

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'resume.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: validPdfContent.length,
    buffer: validPdfContent,
    destination: '',
    filename: '',
    path: '',
    stream: new Readable(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    employeeDocumentRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findList: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<EmployeeDocumentRepository>;

    employeeRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<EmployeeRepository>;

    storageService = {
      uploadFile: jest.fn(),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    auditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeDocumentsService,
        {
          provide: EmployeeDocumentRepository,
          useValue: employeeDocumentRepo,
        },
        {
          provide: EmployeeRepository,
          useValue: employeeRepo,
        },
        {
          provide: StorageService,
          useValue: storageService,
        },
        {
          provide: AuditLogsService,
          useValue: auditLogsService,
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<EmployeeDocumentsService>(EmployeeDocumentsService);
  });

  describe('uploadDocument', () => {
    it('should throw VALIDATION_ERROR if file is missing', async () => {
      await expect(
        service.uploadDocument(
          employeeId,
          actorId,
          null as unknown as Express.Multer.File,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);

      try {
        await service.uploadDocument(
          employeeId,
          actorId,
          null as unknown as Express.Multer.File,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        );
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
          expect(e.message).toBe('File is required');
        }
      }
    });

    it('should throw VALIDATION_ERROR if file buffer is empty', async () => {
      const emptyBufferFile: Express.Multer.File = {
        ...mockFile,
        buffer: Buffer.from([]),
      };

      await expect(
        service.uploadDocument(
          employeeId,
          actorId,
          emptyBufferFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);

      try {
        await service.uploadDocument(
          employeeId,
          actorId,
          emptyBufferFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        );
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
        }
      }
    });

    it('should throw VALIDATION_ERROR if file size exceeds MAX_DOCUMENT_FILE_SIZE', async () => {
      const oversizedBuffer = Buffer.alloc(MAX_DOCUMENT_FILE_SIZE + 10);
      oversizedBuffer.write('%PDF-1.4');

      const oversizedFile: Express.Multer.File = {
        ...mockFile,
        buffer: oversizedBuffer,
        size: oversizedBuffer.length,
      };

      await expect(
        service.uploadDocument(
          employeeId,
          actorId,
          oversizedFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);

      try {
        await service.uploadDocument(
          employeeId,
          actorId,
          oversizedFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        );
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
        }
      }
    });

    it('should throw VALIDATION_ERROR if file content signature is invalid (spoofed MIME type)', async () => {
      const spoofedFile: Express.Multer.File = {
        ...mockFile,
        mimetype: 'application/pdf',
        buffer: Buffer.from('this is an executable disguised as pdf'),
      };

      await expect(
        service.uploadDocument(
          employeeId,
          actorId,
          spoofedFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);

      try {
        await service.uploadDocument(
          employeeId,
          actorId,
          spoofedFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        );
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
          expect(e.message).toContain('File signature could not be verified');
        }
      }
    });

    it('should throw RESOURCE_NOT_FOUND if employee does not exist', async () => {
      employeeRepo.findById.mockResolvedValue(null);

      await expect(
        service.uploadDocument(
          employeeId,
          actorId,
          mockFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);

      try {
        await service.uploadDocument(
          employeeId,
          actorId,
          mockFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        );
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
          expect(e.message).toBe('Employee not found');
        }
      }

      expect(storageService.uploadFile).not.toHaveBeenCalled();
    });

    it('should upload to S3 using trusted extension, persist metadata and audit in transaction, and return response', async () => {
      employeeRepo.findById.mockResolvedValue({
        _id: employeeId,
      } as unknown as EmployeeLean);
      storageService.uploadFile.mockResolvedValue({
        key: `employees/${employeeId.toString()}/documents/file.pdf`,
      });

      const createdDoc: EmployeeDocumentLean = {
        _id: documentId,
        employeeId,
        category: EmployeeDocumentCategory.RESUME,
        originalFileName: 'resume.pdf',
        storageKey: `employees/${employeeId.toString()}/documents/file.pdf`,
        mimeType: 'application/pdf',
        fileSize: validPdfContent.length,
        uploadedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      employeeDocumentRepo.create.mockResolvedValue(createdDoc);

      const result = await service.uploadDocument(
        employeeId,
        actorId,
        mockFile,
        { category: EmployeeDocumentCategory.RESUME },
        clientMetadata,
      );

      expect(storageService.uploadFile).toHaveBeenCalledWith(
        mockFile,
        `employees/${employeeId.toString()}/documents`,
        [...ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES],
        MAX_DOCUMENT_FILE_SIZE,
        '.pdf',
      );
      expect(mockConnection.startSession).toHaveBeenCalled();
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(employeeDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId,
          category: EmployeeDocumentCategory.RESUME,
          storageKey: `employees/${employeeId.toString()}/documents/file.pdf`,
          uploadedBy: actorId,
          fileSize: validPdfContent.length,
          mimeType: 'application/pdf',
        }),
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId,
          action: AuditAction.DOCUMENT_UPLOADED,
          targetModel: AuditTargetModel.EMPLOYEE_DOCUMENT,
          targetId: documentId,
          ipAddress: clientMetadata.ipAddress,
          userAgent: clientMetadata.userAgent,
        }),
        mockSession,
      );
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(result.id).toBe(documentId.toString());
      expect(storageService.deleteFile).not.toHaveBeenCalled();
    });

    it('should trigger S3 cleanup compensation with retries when Mongo transaction fails', async () => {
      employeeRepo.findById.mockResolvedValue({
        _id: employeeId,
      } as unknown as EmployeeLean);
      const storageKey = `employees/${employeeId.toString()}/documents/file.pdf`;
      storageService.uploadFile.mockResolvedValue({ key: storageKey });

      mockSession.withTransaction.mockRejectedValueOnce(
        new Error('Mongo network error or audit failure'),
      );

      await expect(
        service.uploadDocument(
          employeeId,
          actorId,
          mockFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);

      try {
        await service.uploadDocument(
          employeeId,
          actorId,
          mockFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        );
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
          expect(e.message).toBe('Failed to save document');
        }
      }

      expect(storageService.deleteFile).toHaveBeenCalledWith(storageKey);
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('should handle and retry compensating cleanup if deleteFile fails initially', async () => {
      employeeRepo.findById.mockResolvedValue({
        _id: employeeId,
      } as unknown as EmployeeLean);
      const storageKey = `employees/${employeeId.toString()}/documents/file.pdf`;
      storageService.uploadFile.mockResolvedValue({ key: storageKey });

      mockSession.withTransaction.mockRejectedValueOnce(
        new Error('Mongo failure'),
      );

      // Fail first delete, succeed on second attempt
      storageService.deleteFile
        .mockRejectedValueOnce(new Error('S3 503 Service Unavailable'))
        .mockResolvedValueOnce(undefined);

      await expect(
        service.uploadDocument(
          employeeId,
          actorId,
          mockFile,
          { category: EmployeeDocumentCategory.RESUME },
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);

      expect(storageService.deleteFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('listDocuments', () => {
    it('should throw RESOURCE_NOT_FOUND if employee is not found', async () => {
      employeeRepo.findById.mockResolvedValue(null);

      await expect(
        service.listDocuments(employeeId, { page: 1, limit: 10 }),
      ).rejects.toThrow(AppError);
    });

    it('should return paginated documents list', async () => {
      employeeRepo.findById.mockResolvedValue({
        _id: employeeId,
      } as unknown as EmployeeLean);
      const mockDocList: EmployeeDocumentLean[] = [
        {
          _id: documentId,
          employeeId,
          category: EmployeeDocumentCategory.ID_PROOF,
          originalFileName: 'passport.jpg',
          storageKey: 'key.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1234,
          uploadedBy: actorId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      employeeDocumentRepo.findList.mockResolvedValue({
        data: mockDocList,
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.listDocuments(employeeId, {
        page: 1,
        limit: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(documentId.toString());
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getDocumentDownloadUrl', () => {
    it('should throw RESOURCE_NOT_FOUND if document does not exist', async () => {
      employeeDocumentRepo.findById.mockResolvedValue(null);

      await expect(
        service.getDocumentDownloadUrl(
          employeeId,
          documentId,
          actorId,
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should throw RESOURCE_NOT_FOUND if document belongs to different employee', async () => {
      const otherEmployeeId = new Types.ObjectId();
      employeeDocumentRepo.findById.mockResolvedValue({
        _id: documentId,
        employeeId: otherEmployeeId,
      } as unknown as EmployeeDocumentLean);

      await expect(
        service.getDocumentDownloadUrl(
          employeeId,
          documentId,
          actorId,
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should return signed URL and create audit log', async () => {
      employeeDocumentRepo.findById.mockResolvedValue({
        _id: documentId,
        employeeId,
        category: EmployeeDocumentCategory.RESUME,
        originalFileName: 'resume.pdf',
        storageKey: 'employees/docs/resume.pdf',
      } as unknown as EmployeeDocumentLean);
      storageService.getSignedDownloadUrl.mockResolvedValue(
        'https://s3.aws.com/signed-url',
      );

      const result = await service.getDocumentDownloadUrl(
        employeeId,
        documentId,
        actorId,
        clientMetadata,
      );

      expect(result.url).toBe('https://s3.aws.com/signed-url');
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId,
          action: AuditAction.DOCUMENT_DOWNLOADED,
          targetModel: AuditTargetModel.EMPLOYEE_DOCUMENT,
          targetId: documentId,
          ipAddress: clientMetadata.ipAddress,
          userAgent: clientMetadata.userAgent,
        }),
      );
    });
  });

  describe('deleteDocument', () => {
    it('should throw RESOURCE_NOT_FOUND if document does not exist', async () => {
      employeeDocumentRepo.findById.mockResolvedValue(null);

      await expect(
        service.deleteDocument(employeeId, documentId, actorId, clientMetadata),
      ).rejects.toThrow(AppError);
    });

    it('should execute transaction for soft delete + audit log, then delete from storage', async () => {
      const storageKey = 'employees/docs/resume.pdf';
      employeeDocumentRepo.findById.mockResolvedValue({
        _id: documentId,
        employeeId,
        category: EmployeeDocumentCategory.RESUME,
        originalFileName: 'resume.pdf',
        storageKey,
      } as unknown as EmployeeDocumentLean);

      await service.deleteDocument(
        employeeId,
        documentId,
        actorId,
        clientMetadata,
      );

      expect(mockConnection.startSession).toHaveBeenCalled();
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(employeeDocumentRepo.softDelete).toHaveBeenCalledWith(
        documentId,
        actorId,
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId,
          action: AuditAction.DOCUMENT_DELETED,
          targetModel: AuditTargetModel.EMPLOYEE_DOCUMENT,
          targetId: documentId,
          ipAddress: clientMetadata.ipAddress,
          userAgent: clientMetadata.userAgent,
        }),
        mockSession,
      );
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(storageService.deleteFile).toHaveBeenCalledWith(storageKey);
    });
  });
});
