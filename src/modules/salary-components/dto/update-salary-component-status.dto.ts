import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSalaryComponentStatusDto {
  @ApiProperty({
    description: 'Active status of the salary component',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  isActive!: boolean;
}
