import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EmploymentStatus } from '../constants/employee.constant';

export class UpdateEmploymentStatusDto {
  @ApiProperty({
    description: 'Employment status of the employee',
    enum: EmploymentStatus,
  })
  @IsNotEmpty()
  @IsEnum(EmploymentStatus)
  employmentStatus!: EmploymentStatus;
}
