import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../constants/salary-structure.constant';

@ValidatorConstraint({ name: 'isValidStructureComponent', async: false })
export class IsValidStructureComponentConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args?: ValidationArguments): boolean {
    if (!args || !args.object || typeof args.object !== 'object') {
      return false;
    }
    const item = args.object as SalaryStructureComponentInputDto;

    if (item.calculationType === StructureComponentCalculationType.FIXED) {
      const hasValidAmount =
        typeof item.amount === 'number' &&
        !isNaN(item.amount) &&
        item.amount > 0 &&
        isFinite(item.amount);
      const hasNoPercentage =
        item.percentage === undefined || item.percentage === null;
      const hasNoPercentageOf =
        item.percentageOf === undefined || item.percentageOf === null;
      return hasValidAmount && hasNoPercentage && hasNoPercentageOf;
    }

    if (item.calculationType === StructureComponentCalculationType.PERCENTAGE) {
      const hasValidPercentage =
        typeof item.percentage === 'number' &&
        !isNaN(item.percentage) &&
        item.percentage > 0 &&
        item.percentage <= 100 &&
        isFinite(item.percentage);
      const hasValidPercentageOf =
        item.percentageOf === StructureComponentPercentageBasis.BASIC ||
        item.percentageOf === StructureComponentPercentageBasis.GROSS_SALARY;
      const hasNoAmount = item.amount === undefined || item.amount === null;
      return hasValidPercentage && hasValidPercentageOf && hasNoAmount;
    }

    if (item.calculationType === StructureComponentCalculationType.BALANCE) {
      const hasNoAmount = item.amount === undefined || item.amount === null;
      const hasNoPercentage =
        item.percentage === undefined || item.percentage === null;
      const hasNoPercentageOf =
        item.percentageOf === undefined || item.percentageOf === null;
      return hasNoAmount && hasNoPercentage && hasNoPercentageOf;
    }

    return false;
  }

  defaultMessage(args?: ValidationArguments): string {
    const item = args?.object as SalaryStructureComponentInputDto | undefined;
    if (item?.calculationType === StructureComponentCalculationType.FIXED) {
      return 'For FIXED calculationType, amount (> 0) is required, and percentage / percentageOf must be null or omitted.';
    }
    if (
      item?.calculationType === StructureComponentCalculationType.PERCENTAGE
    ) {
      return 'For PERCENTAGE calculationType, percentage (> 0 and <= 100) and percentageOf (BASIC or GROSS_SALARY) are required, and amount must be null or omitted.';
    }
    if (item?.calculationType === StructureComponentCalculationType.BALANCE) {
      return 'For BALANCE calculationType, amount, percentage, and percentageOf must all be null or omitted.';
    }
    return 'Invalid structure component configuration.';
  }
}

export class SalaryStructureComponentInputDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the referenced SalaryComponent master',
    example: '60d5ec49f1b2c82d8c8e4567',
  })
  @IsNotEmpty()
  @IsMongoId()
  componentId!: string;

  @ApiProperty({
    description: 'Formula type for this component in the structure',
    enum: StructureComponentCalculationType,
    example: StructureComponentCalculationType.FIXED,
  })
  @IsNotEmpty()
  @IsEnum(StructureComponentCalculationType)
  @Validate(IsValidStructureComponentConstraint)
  calculationType!: StructureComponentCalculationType;

  @ApiPropertyOptional({
    description:
      'Fixed amount in currency units matching the structure salaryFrequency (monthly amount for MONTHLY frequency, annual amount for ANNUAL frequency; required when calculationType is FIXED)',
    example: 25000,
  })
  @IsOptional()
  @IsNumber({
    allowNaN: false,
    allowInfinity: false,
  })
  @Min(0.01)
  amount?: number | null;

  @ApiPropertyOptional({
    description:
      'Percentage value between 0.01 and 100 (required when calculationType is PERCENTAGE)',
  })
  @IsOptional()
  @IsNumber({
    allowNaN: false,
    allowInfinity: false,
  })
  @Min(0.01)
  @Max(100)
  percentage?: number | null;

  @ApiPropertyOptional({
    description:
      'Calculation base for PERCENTAGE component (BASIC or GROSS_SALARY)',
    enum: StructureComponentPercentageBasis,
  })
  @IsOptional()
  @IsEnum(StructureComponentPercentageBasis)
  percentageOf?: StructureComponentPercentageBasis | null;
}
