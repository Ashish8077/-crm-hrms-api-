import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TrimString } from '../../../common/decorators/trim-string.decorator';

export class AddLeadDocumentDto {
  @ApiProperty({
    description: 'Document file name',
    example: 'requirements_spec.pdf',
  })
  @IsNotEmpty()
  @IsString()
  @TrimString()
  fileName!: string;

  @ApiProperty({
    description: 'Storage URL or signed URL reference',
    example: 'https://storage.example.com/leads/docs/requirements_spec.pdf',
  })
  @IsNotEmpty()
  @IsString()
  @TrimString()
  fileUrl!: string;

  @ApiPropertyOptional({
    description: 'MIME type of document',
    example: 'application/pdf',
  })
  @IsOptional()
  @IsString()
  @TrimString()
  fileType?: string;

  @ApiPropertyOptional({
    description: 'File size in bytes',
    example: 1048576,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fileSize?: number;
}
