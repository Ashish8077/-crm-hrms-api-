import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UploadCompanyDocumentDto {
  @ApiPropertyOptional({ example: 'Certificate of Incorporation' })
  @IsString()
  @IsOptional()
  fileName?: string;
}
