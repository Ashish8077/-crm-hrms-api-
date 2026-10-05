import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDepartmentStatusDto {
  @ApiProperty({
    description: 'Active status of the department',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  isActive!: boolean;
}
