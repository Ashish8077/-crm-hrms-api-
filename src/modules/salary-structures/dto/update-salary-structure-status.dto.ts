import { IsBoolean, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSalaryStructureStatusDto {
  @ApiProperty({
    description: 'Active status for the salary structure',
    example: false,
  })
  @IsNotEmpty()
  @IsBoolean()
  isActive!: boolean;

  @ApiPropertyOptional({
    description:
      'Expected document version (__v) for optimistic concurrency control to prevent conflicting overwrites',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  version?: number;
}
