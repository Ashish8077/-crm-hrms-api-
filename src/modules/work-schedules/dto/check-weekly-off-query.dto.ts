import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsValidCalendarDate } from '../../../common/validation/decorators/is-valid-calendar-date.decorator';

export class CheckWeeklyOffQueryDto {
  @ApiProperty({
    description: 'Calendar date to check in YYYY-MM-DD format',
    example: '2026-10-24',
  })
  @IsString()
  @IsNotEmpty()
  @IsValidCalendarDate()
  date!: string;

  @ApiPropertyOptional({
    description: 'Branch ID for branch-specific override evaluation',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @IsMongoId()
  branchId?: string;
}
