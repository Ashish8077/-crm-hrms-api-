import { Types } from 'mongoose';
import { EmployeeDocumentCategory } from '../constants/employee-document.constant';
import {
  CreateEmployeeDocumentData,
  EmployeeDocumentLean,
} from '../repositories/employee-document.repository';

export type EmployeeDocumentMapperInput = EmployeeDocumentLean;

export interface CreateEmployeeDocumentInput {
  employeeId: Types.ObjectId | string;
  category: EmployeeDocumentCategory;
  originalFileName: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: Types.ObjectId | string;
}

export interface UpdateEmployeeDocumentInput {
  category?: EmployeeDocumentCategory;
  originalFileName?: string;
}

export interface EmployeeDocumentResponse {
  id: string;
  employeeId: string;
  category: EmployeeDocumentCategory;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: Date;
}

export class EmployeeDocumentMapper {
  /**
   * Maps verified document metadata to persistence input.
   * Only includes fields explicitly required for persistence and never overwrites system-managed fields.
   */
  static toCreateData(
    input: CreateEmployeeDocumentInput,
  ): CreateEmployeeDocumentData {
    return {
      employeeId:
        input.employeeId instanceof Types.ObjectId
          ? input.employeeId
          : new Types.ObjectId(input.employeeId),
      category: input.category,
      originalFileName: input.originalFileName.trim(),
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      uploadedBy:
        input.uploadedBy instanceof Types.ObjectId
          ? input.uploadedBy
          : new Types.ObjectId(input.uploadedBy),
    };
  }

  /**
   * Maps update inputs to persistence data (if applicable).
   * Restricts updates strictly to mutable user fields, ignoring system/immutable fields.
   */
  static toUpdateData(
    input: UpdateEmployeeDocumentInput,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    if (input.category !== undefined) {
      data.category = input.category;
    }

    if (input.originalFileName !== undefined) {
      data.originalFileName = input.originalFileName.trim();
    }

    return data;
  }

  /**
   * Maps an EmployeeDocument entity/lean document to an API response DTO.
   */
  static toResponse(
    document: EmployeeDocumentMapperInput,
  ): EmployeeDocumentResponse {
    return {
      id: document._id.toString(),
      employeeId: document.employeeId.toString(),
      category: document.category,
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      uploadedBy: document.uploadedBy.toString(),
      createdAt: document.createdAt,
    };
  }

  /**
   * Alias for toResponse to maintain backwards compatibility.
   */
  static toDocumentResponse(
    document: EmployeeDocumentMapperInput,
  ): EmployeeDocumentResponse {
    return EmployeeDocumentMapper.toResponse(document);
  }
}
