import { Types } from 'mongoose';
import {
  EmployeeDocumentMapper,
  CreateEmployeeDocumentInput,
  UpdateEmployeeDocumentInput,
} from './employee-document.mapper';
import { EmployeeDocumentCategory } from '../constants/employee-document.constant';
import { EmployeeDocumentLean } from '../repositories/employee-document.repository';

describe('EmployeeDocumentMapper', () => {
  const employeeId = new Types.ObjectId();
  const uploadedBy = new Types.ObjectId();
  const documentId = new Types.ObjectId();
  const createdAt = new Date('2026-01-01T10:00:00.000Z');

  describe('toCreateData', () => {
    it('should map input with Types.ObjectId instances and trim originalFileName', () => {
      const input: CreateEmployeeDocumentInput = {
        employeeId,
        category: EmployeeDocumentCategory.RESUME,
        originalFileName: '  my-resume.pdf  ',
        storageKey: 'employees/123/documents/file.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        uploadedBy,
      };

      const result = EmployeeDocumentMapper.toCreateData(input);

      expect(result).toEqual({
        employeeId,
        category: EmployeeDocumentCategory.RESUME,
        originalFileName: 'my-resume.pdf',
        storageKey: 'employees/123/documents/file.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        uploadedBy,
      });

      // Verify system-managed fields are not present
      const record = result as unknown as Record<string, unknown>;
      expect(record._id).toBeUndefined();
      expect(record.createdAt).toBeUndefined();
      expect(record.updatedAt).toBeUndefined();
      expect(record.deletedAt).toBeUndefined();
      expect(record.deletedBy).toBeUndefined();
    });

    it('should safely convert string employeeId and uploadedBy to Types.ObjectId', () => {
      const input: CreateEmployeeDocumentInput = {
        employeeId: employeeId.toString(),
        category: EmployeeDocumentCategory.ID_PROOF,
        originalFileName: 'passport.jpg',
        storageKey: 'employees/123/documents/passport.jpg',
        mimeType: 'image/jpeg',
        fileSize: 2048,
        uploadedBy: uploadedBy.toString(),
      };

      const result = EmployeeDocumentMapper.toCreateData(input);

      expect(result.employeeId).toBeInstanceOf(Types.ObjectId);
      expect(result.employeeId?.toString()).toBe(employeeId.toString());
      expect(result.uploadedBy).toBeInstanceOf(Types.ObjectId);
      expect(result.uploadedBy?.toString()).toBe(uploadedBy.toString());
    });
  });

  describe('toUpdateData', () => {
    it('should map provided update fields and trim originalFileName', () => {
      const input: UpdateEmployeeDocumentInput = {
        category: EmployeeDocumentCategory.CERTIFICATE,
        originalFileName: '  certificate.png  ',
      };

      const result = EmployeeDocumentMapper.toUpdateData(input);

      expect(result).toEqual({
        category: EmployeeDocumentCategory.CERTIFICATE,
        originalFileName: 'certificate.png',
      });
    });

    it('should omit undefined fields', () => {
      const input: UpdateEmployeeDocumentInput = {
        category: EmployeeDocumentCategory.CONTRACT,
      };

      const result = EmployeeDocumentMapper.toUpdateData(input);

      expect(result).toEqual({
        category: EmployeeDocumentCategory.CONTRACT,
      });
      expect(result.originalFileName).toBeUndefined();
    });
  });

  describe('toResponse and toDocumentResponse', () => {
    const mockLeanDoc: EmployeeDocumentLean = {
      _id: documentId,
      employeeId,
      category: EmployeeDocumentCategory.RESUME,
      originalFileName: 'resume.pdf',
      storageKey: 'employees/123/documents/file.pdf',
      mimeType: 'application/pdf',
      fileSize: 5000,
      uploadedBy,
      createdAt,
      updatedAt: createdAt,
    };

    it('should map lean document to EmployeeDocumentResponse', () => {
      const response = EmployeeDocumentMapper.toResponse(mockLeanDoc);

      expect(response).toEqual({
        id: documentId.toString(),
        employeeId: employeeId.toString(),
        category: EmployeeDocumentCategory.RESUME,
        originalFileName: 'resume.pdf',
        mimeType: 'application/pdf',
        fileSize: 5000,
        uploadedBy: uploadedBy.toString(),
        createdAt,
      });
    });

    it('toDocumentResponse should be an alias producing the same result', () => {
      const response = EmployeeDocumentMapper.toDocumentResponse(mockLeanDoc);

      expect(response).toEqual(EmployeeDocumentMapper.toResponse(mockLeanDoc));
    });
  });
});
