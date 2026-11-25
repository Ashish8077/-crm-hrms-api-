import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  SALARY_STRUCTURE_CONSTANTS,
} from '../constants/salary-structure.constant';
import { SalaryStructureComponentInputDto } from './salary-structure-component.dto';

@ValidatorConstraint({ name: 'isUniqueComponentsList', async: false })
export class IsUniqueComponentsListConstraint implements ValidatorConstraintInterface {
  validate(items: unknown): boolean {
    if (!Array.isArray(items)) return true;
    const ids = new Set<string>();
    for (const item of items as SalaryStructureComponentInputDto[]) {
      if (typeof item?.componentId === 'string') {
        if (ids.has(item.componentId)) {
          return false; // Duplicate componentId found
        }
        ids.add(item.componentId);
      }
    }
    return true;
  }

  defaultMessage(): string {
    return 'Duplicate components are not allowed. Each component can only be referenced once per structure.';
  }
}

@ValidatorConstraint({ name: 'hasAtMostOneBalanceComponent', async: false })
export class HasAtMostOneBalanceComponentConstraint implements ValidatorConstraintInterface {
  validate(items: unknown): boolean {
    if (!Array.isArray(items)) return true;
    let balanceCount = 0;
    for (const item of items as SalaryStructureComponentInputDto[]) {
      if (item?.calculationType === StructureComponentCalculationType.BALANCE) {
        balanceCount++;
        if (balanceCount > 1) {
          return false;
        }
      }
    }
    return true;
  }

  defaultMessage(): string {
    return 'At most one component can be configured with BALANCE calculationType in a salary structure.';
  }
}

export class CreateSalaryStructureDto {
  @ApiProperty({
    description: 'Name of the salary structure',
    example: 'Standard Engineering CTC (L2)',
    minLength: SALARY_STRUCTURE_CONSTANTS.NAME_MIN_LENGTH,
    maxLength: SALARY_STRUCTURE_CONSTANTS.NAME_MAX_LENGTH,
  })
  @IsNotEmpty()
  @TrimString()
  @IsString()
  @MinLength(SALARY_STRUCTURE_CONSTANTS.NAME_MIN_LENGTH)
  @MaxLength(SALARY_STRUCTURE_CONSTANTS.NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    description: 'Unique identifier code for the salary structure (uppercase)',
    example: 'ENG_L2_CTC',
    minLength: SALARY_STRUCTURE_CONSTANTS.CODE_MIN_LENGTH,
    maxLength: SALARY_STRUCTURE_CONSTANTS.CODE_MAX_LENGTH,
  })
  @IsNotEmpty()
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
  code!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the salary structure',
    example: 'CTC based salary structure for Level 2 Software Engineers',
    maxLength: SALARY_STRUCTURE_CONSTANTS.DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(SALARY_STRUCTURE_CONSTANTS.DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiProperty({
    description: 'Salary calculation basis (CTC or GROSS)',
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  @IsNotEmpty()
  @IsEnum(SalaryStructureBasis)
  salaryBasis!: SalaryStructureBasis;

  @ApiProperty({
    description:
      'Frequency of the input salaryAmount (MONTHLY or ANNUAL). Note: All configured FIXED component amounts follow this selected frequency (monthly amounts for MONTHLY frequency, annual amounts for ANNUAL frequency).',
    enum: SalaryStructureFrequency,
    example: SalaryStructureFrequency.ANNUAL,
  })
  @IsNotEmpty()
  @IsEnum(SalaryStructureFrequency)
  salaryFrequency!: SalaryStructureFrequency;

  @ApiProperty({
    description:
      'Input salary amount representing the chosen salaryBasis in the chosen salaryFrequency (e.g. 600000 for ANNUAL CTC, or 50000 for MONTHLY CTC)',
    example: 600000,
  })
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  salaryAmount!: number;

  @ApiProperty({
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
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SalaryStructureComponentInputDto)
  @Validate(IsUniqueComponentsListConstraint)
  @Validate(HasAtMostOneBalanceComponentConstraint)
  components!: SalaryStructureComponentInputDto[];

  @ApiPropertyOptional({
    description: 'Initial active status of the salary structure',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
