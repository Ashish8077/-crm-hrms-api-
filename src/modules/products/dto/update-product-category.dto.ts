import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsOptional, IsString } from 'class-validator';

export class UpdateProductCategoryDto {
  @ApiPropertyOptional({ example: 'Cloud & SaaS Subscriptions' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated category description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: '6ae049328c03f23ab96ce05c',
    nullable: true,
  })
  @IsMongoId()
  @IsOptional()
  parentCategoryId?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
