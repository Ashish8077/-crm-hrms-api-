import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { EmployeeDocumentCategory } from '../constants/employee-document.constant';

export class UploadEmployeeDocumentDto {
  @ApiProperty({
    enum: EmployeeDocumentCategory,
    description:
      'Category of the document (e.g., ID_PROOF, RESUME, OFFER_LETTER, CERTIFICATE)',
    example: EmployeeDocumentCategory.ID_PROOF,
  })
  @IsEnum(EmployeeDocumentCategory, {
    message: `category must be one of: ${Object.values(EmployeeDocumentCategory).join(', ')}`,
  })
  @IsNotEmpty()
  category!: EmployeeDocumentCategory;
}
