import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BreakType } from '../constants/attendance.constant';

export class StartBreakDto {
  @ApiPropertyOptional({
    description: 'Break type (LUNCH, TEA, PERSONAL, OTHER)',
    enum: BreakType,
    default: BreakType.LUNCH,
  })
  @IsOptional()
  @IsEnum(BreakType)
  type?: BreakType = BreakType.LUNCH;

  @ApiPropertyOptional({
    description:
      'Optional break note or reason (sanitized, max 200 characters)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }): string | undefined =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 200)
      : undefined,
  )
  note?: string;
}
