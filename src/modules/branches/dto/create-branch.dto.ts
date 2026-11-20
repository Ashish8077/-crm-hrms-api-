import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator.js';

export class CreateBranchDto {
  @ApiProperty({
    description: 'Name of the branch or location',
    example: 'Headquarters',
  })
  @IsNotEmpty()
  @TrimString()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Physical address of the branch',
    example: '123 Main St, New York, NY 10001',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({
    description: 'Local IANA timezone of the branch (e.g. Asia/Kolkata)',
    example: 'Asia/Kolkata',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(50)
  timezone?: string;
}
