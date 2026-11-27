import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';

export class PayrollAttendanceSummaryQueryDto {
  @ApiPropertyOptional({
    description: 'Optional filter by branch ID',
    example: '65f1a2b3c4d5e6f7a8b9c0d1',
  })
  @IsOptional()
  @IsMongoId({ message: 'branchId must be a valid MongoDB ObjectId' })
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Optional filter by department ID',
    example: '65f1a2b3c4d5e6f7a8b9c0d2',
  })
  @IsOptional()
  @IsMongoId({ message: 'departmentId must be a valid MongoDB ObjectId' })
  departmentId?: string;

  @ApiPropertyOptional({
    description: 'Optional filter by single employee ID',
    example: '65f1a2b3c4d5e6f7a8b9c0d3',
  })
  @IsOptional()
  @IsMongoId({ message: 'employeeId must be a valid MongoDB ObjectId' })
  employeeId?: string;

  @ApiPropertyOptional({
    description:
      'When true, returns only employees with unresolved gaps, pending leave cancellations, or data anomalies in the employees array while retaining period-level summary and finalization metrics',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean({ message: 'anomaliesOnly must be a boolean' })
  anomaliesOnly?: boolean;
}
