import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  Validate,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../constants/salary-structure.constant';
import { SalaryStructureComponentInputDto } from './salary-structure-component.dto';
import {
  HasAtMostOneBalanceComponentConstraint,
  IsUniqueComponentsListConstraint,
} from './create-salary-structure.dto';

export class CalculateSalaryStructureDto {
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
      'Frequency of the input salaryAmount (MONTHLY or ANNUAL). Note: All configured FIXED component amounts follow this same frequency (monthly amounts for MONTHLY frequency, annual amounts for ANNUAL frequency).',
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
    description:
      'Whether to include detailed component calculation diagnostics in the response. If false, internal diagnostics are excluded from the output. Defaults to true for admin salary configuration.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeDiagnostics?: boolean;
}
