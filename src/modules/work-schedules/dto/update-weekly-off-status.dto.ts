import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateWeeklyOffStatusDto {
  @ApiProperty({
    description: 'Active status of the weekly off configuration',
    example: true,
  })
  @IsBoolean()
  isActive!: boolean;
}
