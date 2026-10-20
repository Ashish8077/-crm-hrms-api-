import { IsEnum, IsOptional, IsString } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Optional break note or reason' })
  @IsOptional()
  @IsString()
  note?: string;
}
