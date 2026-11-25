import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';

/**
 * Period breakdown summary for a specific frequency (monthly or annual).
 */
export class SalaryStructurePeriodSummaryDto {
  @ApiProperty({ description: 'Gross salary amount', example: 50000 })
  grossSalary: number;

  @ApiProperty({
    description: 'Total employer contributions amount',
    example: 3000,
  })
  employerContributions: number;

  @ApiProperty({
    description: 'Total Cost to Company (CTC) amount',
    example: 53000,
  })
  totalCtc: number;

  @ApiProperty({
    description: 'Total employee deductions amount',
    example: 2500,
  })
  employeeDeductions: number;

  @ApiProperty({
    description: 'Estimated net take-home salary amount',
    example: 47500,
  })
  estimatedNetSalary: number;
}

/**
 * Financial summary returned in the Create Salary Structure response.
 * Provides explicit monthly and annual breakdowns without duplicating root values.
 */
export class SalaryStructureCreateSummaryDto {
  @ApiProperty({
    type: SalaryStructurePeriodSummaryDto,
    description: 'Monthly salary breakdown summary',
  })
  monthly: SalaryStructurePeriodSummaryDto;

  @ApiProperty({
    type: SalaryStructurePeriodSummaryDto,
    description: 'Annual salary breakdown summary',
  })
  annual: SalaryStructurePeriodSummaryDto;
}

/**
 * Response DTO returned after creating a salary structure.
 * Returns only essential resource fields and summary amounts, omitting heavy component arrays.
 */
export class SalaryStructureCreateResponseDto {
  @ApiProperty({
    description: 'Unique salary structure ID',
    example: '60d5ec49f1b2c82d8c8e4567',
  })
  id: string;

  @ApiProperty({
    description: 'Salary structure template name',
    example: 'Standard Engineering CTC',
  })
  name: string;

  @ApiProperty({
    description: 'Unique uppercase salary structure code',
    example: 'ENG_STD_CTC',
  })
  code: string;

  @ApiProperty({
    description: 'Salary calculation basis',
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  salaryBasis: SalaryStructureBasis;

  @ApiProperty({
    description: 'Salary frequency period',
    enum: SalaryStructureFrequency,
    example: SalaryStructureFrequency.MONTHLY,
  })
  salaryFrequency: SalaryStructureFrequency;

  @ApiProperty({
    description: 'Configured salary amount in frequency units',
    example: 50000,
  })
  salaryAmount: number;

  @ApiProperty({
    description: 'Whether the structure is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Version number for optimistic concurrency',
    example: 0,
  })
  version: number;

  @ApiProperty({
    type: SalaryStructureCreateSummaryDto,
    description: 'Calculated financial summary following selected frequency',
  })
  summary: SalaryStructureCreateSummaryDto;

  @ApiProperty({ description: 'Timestamp when structure was created' })
  createdAt: Date;
}

/**
 * Single enriched salary structure component item.
 * Combines component master information, structure calculation rule, and calculated amounts.
 * Omit conditional null fields (FIXED has amount only; PERCENTAGE has percentage and percentageOf; BALANCE has none).
 */
export class SalaryStructureEnrichedComponentDto {
  @ApiProperty({
    description: 'Referenced SalaryComponent master ID',
    example: '6b0441e6e2d518e7f63cb091',
  })
  componentId: string;

  @ApiProperty({
    description: 'Component display name from master',
    example: 'Basic Salary',
  })
  name: string;

  @ApiProperty({
    description: 'Component unique code from master',
    example: 'BASIC',
  })
  code: string;

  @ApiProperty({
    description: 'Component category classification from master',
    enum: SalaryComponentType,
    example: SalaryComponentType.EARNING,
  })
  type: SalaryComponentType;

  @ApiProperty({
    description: 'Structure-specific calculation rule',
    enum: StructureComponentCalculationType,
    example: StructureComponentCalculationType.FIXED,
  })
  calculationType: StructureComponentCalculationType;

  @ApiPropertyOptional({
    description:
      'Fixed amount (in frequency units). Present only for FIXED components.',
    example: 25000,
  })
  amount?: number;

  @ApiPropertyOptional({
    description:
      'Percentage rate (0-100). Present only for PERCENTAGE components.',
    example: 50,
  })
  percentage?: number;

  @ApiPropertyOptional({
    description:
      'Base component for percentage calculation. Present only for PERCENTAGE components.',
    enum: StructureComponentPercentageBasis,
    example: StructureComponentPercentageBasis.BASIC,
  })
  percentageOf?: StructureComponentPercentageBasis;

  @ApiProperty({
    description: 'Calculated monthly monetary amount',
    example: 25000,
  })
  monthlyAmount: number;

  @ApiProperty({
    description: 'Calculated annual monetary amount',
    example: 300000,
  })
  annualAmount: number;
}

/**
 * Grouped period summary with gross salary, deductions, contributions, CTC, and net salary.
 * Note: grossSalary already represents total earnings.
 */
export class SalaryStructureGroupedPeriodSummaryDto {
  @ApiProperty({
    description: 'Gross salary for the period (represents total earnings)',
    example: 46096.25,
  })
  grossSalary: number;

  @ApiProperty({
    description: 'Total employee deductions for the period',
    example: 3000,
  })
  totalEmployeeDeductions: number;

  @ApiProperty({
    description: 'Total employer contributions for the period',
    example: 3903.75,
  })
  totalEmployerContributions: number;

  @ApiProperty({ description: 'Total CTC for the period', example: 50000 })
  totalCtc: number;

  @ApiProperty({
    description: 'Estimated net take-home salary for the period',
    example: 43096.25,
  })
  estimatedNetSalary: number;
}

/**
 * Authoritative financial summary grouped by monthly and annual periods.
 * Eliminates duplicate summary fields and establishes a single source of truth.
 */
export class SalaryStructureFinancialGroupSummaryDto {
  @ApiProperty({
    type: SalaryStructureGroupedPeriodSummaryDto,
    description: 'Monthly financial summary',
  })
  monthly: SalaryStructureGroupedPeriodSummaryDto;

  @ApiProperty({
    type: SalaryStructureGroupedPeriodSummaryDto,
    description: 'Annual financial summary',
  })
  annual: SalaryStructureGroupedPeriodSummaryDto;
}

/**
 * Detailed Response DTO for GET /salary-structures/:id and update endpoints.
 * Returns complete structure information, single enriched components array, and grouped financial summary.
 */
export class SalaryStructureDetailResponseDto {
  @ApiProperty({
    description: 'Unique salary structure ID',
    example: '60d5ec49f1b2c82d8c8e4567',
  })
  id: string;

  @ApiProperty({
    description: 'Salary structure template name',
    example: 'Standard Engineering CTC',
  })
  name: string;

  @ApiProperty({
    description: 'Unique uppercase salary structure code',
    example: 'ENG_STD_CTC',
  })
  code: string;

  @ApiPropertyOptional({
    description: 'Template description',
    example: 'Engineering staff package',
    nullable: true,
  })
  description?: string | null;

  @ApiProperty({
    description: 'Salary calculation basis',
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  salaryBasis: SalaryStructureBasis;

  @ApiProperty({
    description: 'Salary frequency period',
    enum: SalaryStructureFrequency,
    example: SalaryStructureFrequency.MONTHLY,
  })
  salaryFrequency: SalaryStructureFrequency;

  @ApiProperty({
    description: 'Configured salary amount in frequency units',
    example: 50000,
  })
  salaryAmount: number;

  @ApiProperty({
    type: [SalaryStructureEnrichedComponentDto],
    description:
      'Single enriched components array with master identity, configuration, and calculated amounts',
  })
  components: SalaryStructureEnrichedComponentDto[];

  @ApiProperty({
    type: SalaryStructureFinancialGroupSummaryDto,
    description: 'Authoritative grouped financial summary',
  })
  summary: SalaryStructureFinancialGroupSummaryDto;

  @ApiProperty({
    description: 'Whether the structure is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Version number for optimistic concurrency',
    example: 0,
  })
  version: number;

  @ApiProperty({ description: 'Timestamp when structure was created' })
  createdAt: Date;

  @ApiProperty({ description: 'Timestamp when structure was last updated' })
  updatedAt: Date;
}

/**
 * Lightweight Response DTO for each item in the paginated GET /salary-structures list.
 * Does not return complete component breakdowns for every record, keeping list payloads optimal.
 */
export class SalaryStructureListItemResponseDto {
  @ApiProperty({
    description: 'Unique salary structure ID',
    example: '60d5ec49f1b2c82d8c8e4567',
  })
  id: string;

  @ApiProperty({
    description: 'Salary structure template name',
    example: 'Standard Engineering CTC',
  })
  name: string;

  @ApiProperty({
    description: 'Unique uppercase salary structure code',
    example: 'ENG_STD_CTC',
  })
  code: string;

  @ApiPropertyOptional({
    description: 'Template description',
    example: 'Engineering staff package',
    nullable: true,
  })
  description?: string | null;

  @ApiProperty({
    description: 'Salary calculation basis',
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  salaryBasis: SalaryStructureBasis;

  @ApiProperty({
    description: 'Salary frequency period',
    enum: SalaryStructureFrequency,
    example: SalaryStructureFrequency.MONTHLY,
  })
  salaryFrequency: SalaryStructureFrequency;

  @ApiProperty({
    description: 'Configured salary amount in frequency units',
    example: 50000,
  })
  salaryAmount: number;

  @ApiProperty({
    description: 'Gross salary amount in frequency units',
    example: 46096.25,
  })
  grossSalary: number;

  @ApiProperty({
    description: 'Total CTC amount in frequency units',
    example: 50000,
  })
  totalCtc: number;

  @ApiProperty({
    description: 'Total number of components configured in this structure',
    example: 6,
  })
  componentsCount: number;

  @ApiProperty({
    description: 'Whether the structure is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Version number for optimistic concurrency',
    example: 0,
  })
  version: number;

  @ApiProperty({ description: 'Timestamp when structure was created' })
  createdAt: Date;

  @ApiProperty({ description: 'Timestamp when structure was last updated' })
  updatedAt: Date;
}
