import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  SALARY_STRUCTURE_CONSTANTS,
} from '../constants/salary-structure.constant';
import { SalaryStructureComponentInputDto } from './salary-structure-component.dto';
import {
  HasAtMostOneBalanceComponentConstraint,
  IsUniqueComponentsListConstraint,
} from './create-salary-structure.dto';

export class UpdateSalaryStructureDto {
  @ApiPropertyOptional({
    description: 'Name of the salary structure',
    example: 'Updated Engineering CTC (L2)',
    minLength: SALARY_STRUCTURE_CONSTANTS.NAME_MIN_LENGTH,
    maxLength: SALARY_STRUCTURE_CONSTANTS.NAME_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(SALARY_STRUCTURE_CONSTANTS.NAME_MIN_LENGTH)
  @MaxLength(SALARY_STRUCTURE_CONSTANTS.NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description: 'Unique identifier code for the salary structure (uppercase)',
    example: 'ENG_L2_CTC',
    minLength: SALARY_STRUCTURE_CONSTANTS.CODE_MIN_LENGTH,
    maxLength: SALARY_STRUCTURE_CONSTANTS.CODE_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(SALARY_STRUCTURE_CONSTANTS.CODE_MIN_LENGTH)
  @MaxLength(SALARY_STRUCTURE_CONSTANTS.CODE_MAX_LENGTH)
  @Matches(/^[A-Z0-9_-]+$/, {
    message:
      'code must contain only uppercase alphanumeric characters, underscores, or hyphens',
  })
  code?: string;

  @ApiPropertyOptional({
    description: 'Optional description of the salary structure',
    example: 'Revised CTC based salary structure for L2',
    maxLength: SALARY_STRUCTURE_CONSTANTS.DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(SALARY_STRUCTURE_CONSTANTS.DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    description: 'Salary calculation basis (CTC or GROSS)',
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  @IsOptional()
  @IsEnum(SalaryStructureBasis)
  salaryBasis?: SalaryStructureBasis;

  @ApiPropertyOptional({
    description:
      'Frequency of the input salaryAmount (MONTHLY or ANNUAL). Note: All configured FIXED component amounts follow this same frequency (monthly amounts for MONTHLY frequency, annual amounts for ANNUAL frequency).',
    enum: SalaryStructureFrequency,
    example: SalaryStructureFrequency.ANNUAL,
  })
  @IsOptional()
  @IsEnum(SalaryStructureFrequency)
  salaryFrequency?: SalaryStructureFrequency;

  @ApiPropertyOptional({
    description:
      'Input salary amount representing the chosen salaryBasis in the chosen salaryFrequency (e.g. 650000 for ANNUAL CTC, or 50000 for MONTHLY CTC)',
    example: 650000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  salaryAmount?: number;

  @ApiPropertyOptional({
    description:
      'Array of configured salary components. All FIXED component amounts follow the selected salaryFrequency (MONTHLY or ANNUAL).',
    type: [SalaryStructureComponentInputDto],
    example: [
      {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 25000,
      },
      {
        componentId: '60d5ec49f1b2c82d8c8e4568',
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        percentage: 50,
        percentageOf: 'BASIC',
      },
      {
        componentId: '60d5ec49f1b2c82d8c8e4569',
        calculationType: StructureComponentCalculationType.BALANCE,
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SalaryStructureComponentInputDto)
  @Validate(IsUniqueComponentsListConstraint)
  @Validate(HasAtMostOneBalanceComponentConstraint)
  components?: SalaryStructureComponentInputDto[];

  @ApiPropertyOptional({
    description:
      'Expected document version (__v) for optimistic concurrency control to prevent conflicting overwrites',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  version?: number;
}
