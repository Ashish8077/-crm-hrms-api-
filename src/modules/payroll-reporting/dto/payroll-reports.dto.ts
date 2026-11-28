import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PAYROLL_PERIOD_CONSTANTS } from '../../payroll-periods/constants/payroll-period.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { PAYROLL_REPORTING_CONSTANTS } from '../constants/payroll-reporting.constant';

export class PayrollReportPeriodFilterDto {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.YEAR_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.YEAR_MAX)
  year?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.MONTH_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.MONTH_MAX)
  month?: number;
}

export class MonthlySummaryReportQueryDto extends PayrollReportPeriodFilterDto {
  @ApiPropertyOptional({ description: 'Filter by Branch ID' })
  @IsOptional()
  @IsMongoId()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Filter by Department ID' })
  @IsOptional()
  @IsMongoId()
  departmentId?: string;
}

export class DepartmentWiseReportQueryDto extends PayrollReportPeriodFilterDto {
  @ApiPropertyOptional({ description: 'Filter by Branch ID' })
  @IsOptional()
  @IsMongoId()
  branchId?: string;
}

export class BranchWiseReportQueryDto extends PayrollReportPeriodFilterDto {}

export class EmployeeWiseReportExportQueryDto extends PayrollReportPeriodFilterDto {
  @ApiPropertyOptional({ description: 'Filter by Department ID' })
  @IsOptional()
  @IsMongoId()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Filter by Branch ID' })
  @IsOptional()
  @IsMongoId()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Search by employee code or employee name (case-insensitive)',
    example: 'EMP-001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class EmployeeWiseReportQueryDto extends EmployeeWiseReportExportQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT)
  limit?: number;
}

export class ComponentReportQueryDto extends PayrollReportPeriodFilterDto {
  @ApiPropertyOptional({
    enum: SalaryComponentType,
    description:
      'Filter by component type: EARNING, EMPLOYEE_DEDUCTION, or EMPLOYER_CONTRIBUTION',
  })
  @IsOptional()
  @IsEnum(SalaryComponentType)
  componentType?: SalaryComponentType;
}

export class ReportPayrollPeriodMetaDto {
  @ApiProperty()
  periodId!: string;

  @ApiProperty()
  periodCode!: string;

  @ApiProperty()
  periodName!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  paymentDate!: string;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  year!: number;

  @ApiProperty()
  finalizedAt!: string;
}

export class MonthlySummaryCurrencyRowDto {
  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Distinct employees across matched periods' })
  totalEmployees!: number;

  @ApiProperty({ description: 'Approved employee-period records counted' })
  totalRecords!: number;

  @ApiProperty()
  totalGrossEarnings!: string;

  @ApiProperty()
  totalEmployeeDeductions!: string;

  @ApiProperty()
  totalNetSalary!: string;

  @ApiProperty()
  totalEmployerContributions!: string;

  @ApiProperty()
  totalEmployerCost!: string;

  @ApiProperty()
  totalLOPDays!: number;
}

export class MonthlySummaryReportResponseDto {
  @ApiProperty({ type: [ReportPayrollPeriodMetaDto] })
  payrollPeriods!: ReportPayrollPeriodMetaDto[];

  @ApiProperty({ type: [MonthlySummaryCurrencyRowDto] })
  summaries!: MonthlySummaryCurrencyRowDto[];
}

export class DepartmentWiseReportRowDto {
  @ApiProperty({ nullable: true })
  departmentId!: string | null;

  @ApiProperty({ example: 'Engineering' })
  departmentName!: string;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty()
  employeeCount!: number;

  @ApiProperty()
  recordCount!: number;

  @ApiProperty()
  grossEarnings!: string;

  @ApiProperty()
  employeeDeductions!: string;

  @ApiProperty()
  netSalary!: string;

  @ApiProperty()
  employerContributions!: string;

  @ApiProperty()
  employerCost!: string;
}

export class BranchWiseReportRowDto {
  @ApiProperty({ nullable: true })
  branchId!: string | null;

  @ApiProperty({ example: 'Headquarters' })
  branchName!: string;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty()
  employeeCount!: number;

  @ApiProperty()
  recordCount!: number;

  @ApiProperty()
  grossEarnings!: string;

  @ApiProperty()
  deductions!: string;

  @ApiProperty()
  netSalary!: string;

  @ApiProperty()
  employerContributions!: string;

  @ApiProperty()
  employerCost!: string;
}

export class EmployeeWiseReportRowDto {
  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  employeeCode!: string;

  @ApiProperty()
  employeeName!: string;

  @ApiProperty()
  department!: {
    id: string | null;
    name: string;
  };

  @ApiProperty()
  branch!: {
    id: string | null;
    name: string;
  };

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty()
  periodCount!: number;

  @ApiProperty()
  grossEarnings!: string;

  @ApiProperty()
  deductions!: string;

  @ApiProperty()
  netSalary!: string;

  @ApiProperty()
  employerContributions!: string;

  @ApiProperty()
  employerCost!: string;

  @ApiProperty()
  totalLOPDays!: number;
}

export class PayrollComponentReportRowDto {
  @ApiProperty()
  componentId!: string;

  @ApiProperty()
  componentName!: string;

  @ApiProperty()
  componentCode!: string;

  @ApiProperty({ enum: SalaryComponentType })
  componentType!: SalaryComponentType;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty()
  totalAmount!: string;

  @ApiProperty()
  employeeCount!: number;

  @ApiProperty()
  recordCount!: number;
}
