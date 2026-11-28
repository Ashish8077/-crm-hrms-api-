import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsNotEmpty, IsOptional } from 'class-validator';

export class CalculatePayrollPreviewInputDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the Payroll Period',
    example: '6745a1b2c3d4e5f678901234',
  })
  @IsNotEmpty({ message: 'payrollPeriodId is required' })
  @IsMongoId({ message: 'payrollPeriodId must be a valid MongoDB ObjectId' })
  payrollPeriodId!: string;

  @ApiProperty({
    description: 'MongoDB ObjectId of the Employee',
    example: '6745a1b2c3d4e5f678905678',
  })
  @IsNotEmpty({ message: 'employeeId is required' })
  @IsMongoId({ message: 'employeeId must be a valid MongoDB ObjectId' })
  employeeId!: string;
}

export class CalculateEmployeePayrollDto extends CalculatePayrollPreviewInputDto {
  @ApiPropertyOptional({
    description:
      'If true, recalculates and atomically replaces an existing CALCULATED payroll record for this employee and period. Defaults to false (rejects duplicate calculation with 409 Conflict).',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'recalculate must be a boolean' })
  recalculate?: boolean;
}
