export enum EmployeeDocumentCategory {
  ID_PROOF = 'ID_PROOF',
  RESUME = 'RESUME',
  OFFER_LETTER = 'OFFER_LETTER',
  CERTIFICATE = 'CERTIFICATE',
  CONTRACT = 'CONTRACT',
  SALARY_SLIP = 'SALARY_SLIP',
  TAX_DOCUMENT = 'TAX_DOCUMENT',
  OTHER = 'OTHER',
}

export const ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedEmployeeDocumentMimeType =
  (typeof ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES)[number];

export const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024; // 10MB
