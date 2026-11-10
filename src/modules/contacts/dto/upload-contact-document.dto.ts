import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UploadContactDocumentDto {
  @ApiPropertyOptional({ example: 'NDA or Identity Proof' })
  @IsString()
  @IsOptional()
  fileName?: string;
}
