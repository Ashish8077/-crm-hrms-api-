import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateProductCategoryDto {
  @ApiProperty({ example: 'SaaS Subscriptions' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'SAAS',
    description: 'Unique uppercase category code (3-10 chars)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9_-]{2,15}$/, {
    message: 'Code must be uppercase alphanumeric (2-15 chars)',
  })
  code!: string;

  @ApiPropertyOptional({
    example: 'Cloud software subscription licenses and add-ons',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: '6ae049328c03f23ab96ce05c',
    description: 'Optional parent category ID for nesting',
  })
  @IsMongoId()
  @IsOptional()
  parentCategoryId?: string;
}
