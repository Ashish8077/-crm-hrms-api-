import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLeaveTypeStatusDto {
  @ApiPropertyOptional({
    description:
      'Target active status of the leave type. If omitted, toggles the current active status.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
