import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListPayslipsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Search by employee code or employee name (case-insensitive)',
    example: 'EMP001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class PayslipResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  payrollPeriodId!: string;

  @ApiProperty()
  payrollRecordId!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty({ example: 'PR-2026-04' })
  periodCode!: string;

  @ApiProperty({ example: 'April 2026 Payroll' })
  periodName!: string;

  @ApiProperty({ example: 'EMP-001' })
  employeeCode!: string;

  @ApiProperty({ example: 'Jane Doe' })
  employeeName!: string;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty({ example: '50000.00' })
  grossEarnings!: string;

  @ApiProperty({ example: '2000.00' })
  totalDeductions!: string;

  @ApiProperty({ example: '48000.00' })
  netSalary!: string;

  @ApiProperty({ example: 1 })
  payrollCalculationVersion!: number;

  @ApiProperty({ example: '1.0.0' })
  templateVersion!: string;

  @ApiProperty({ example: 'payslip-PR-2026-04-EMP-001.pdf' })
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ example: 18420 })
  fileSize!: number;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty()
  generatedBy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ example: 0 })
  version!: number;
}

export class PayslipListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  payrollPeriodId!: string;

  @ApiProperty()
  payrollRecordId!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty({ example: 'EMP-001' })
  employeeCode!: string;

  @ApiProperty({ example: 'Jane Doe' })
  employeeName!: string;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty({ example: '50000.00' })
  grossEarnings!: string;

  @ApiProperty({ example: '2000.00' })
  totalDeductions!: string;

  @ApiProperty({ example: '48000.00' })
  netSalary!: string;

  @ApiProperty({ example: 1 })
  payrollCalculationVersion!: number;

  @ApiProperty({ example: '1.0.0' })
  templateVersion!: string;

  @ApiProperty({ example: 'payslip-PR-2026-04-EMP-001.pdf' })
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ example: 18420 })
  fileSize!: number;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty()
  generatedBy!: string;
}
