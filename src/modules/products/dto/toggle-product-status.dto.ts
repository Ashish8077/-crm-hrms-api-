import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleProductStatusDto {
  @ApiProperty({ example: false, description: 'New active status' })
  @IsBoolean()
  isActive!: boolean;
}
