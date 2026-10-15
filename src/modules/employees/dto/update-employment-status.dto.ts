import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmploymentStatus } from '../constants/employee.constant';
import { TrimString } from '../../../common/decorators/trim-string.decorator';

export class UpdateEmploymentStatusDto {
  @ApiProperty({
    description: 'Employment status of the employee',
    enum: EmploymentStatus,
  })
  @IsNotEmpty()
  @IsEnum(EmploymentStatus)
  employmentStatus!: EmploymentStatus;

  @ApiPropertyOptional({
    description: 'Optional reason for the status change',
  })
  @IsOptional()
  @IsString()
  @TrimString()
  reason?: string;
}
