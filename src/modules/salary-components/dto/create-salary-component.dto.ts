import {
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
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import {
  GRATUITY_COMPONENT_CODE,
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
  SALARY_COMPONENT_CONSTANTS,
} from '../constants/salary-component.constant';

@ValidatorConstraint({ name: 'isValidDefaultValue', async: false })
export class IsValidSalaryComponentDefaultValueConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return false;
    }
    const obj = args.object as {
      calculationType?: SalaryComponentCalculationType | null;
    };
    if (
      obj.calculationType === SalaryComponentCalculationType.PERCENTAGE &&
      value > 100
    ) {
      return false;
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as {
      calculationType?: SalaryComponentCalculationType | null;
    };
    if (obj.calculationType === SalaryComponentCalculationType.PERCENTAGE) {
      return 'defaultValue must be between 0 and 100 when calculationType is PERCENTAGE';
    }
    return 'defaultValue must be a non-negative number';
  }
}

@ValidatorConstraint({ name: 'isValidGratuityClassification', async: false })
export class IsValidGratuityClassificationConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const item = args.object as CreateSalaryComponentDto;
    if (!item.code) return true;
    const normalizedCode = item.code.trim().toUpperCase();
    if (normalizedCode === GRATUITY_COMPONENT_CODE) {
      if (item.type !== SalaryComponentType.EMPLOYER_CONTRIBUTION) {
        return false;
      }
      if (item.isStatutory === false) {
        return false;
      }
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const item = args.object as CreateSalaryComponentDto;
    if (
      item.code &&
      item.code.trim().toUpperCase() === GRATUITY_COMPONENT_CODE
    ) {
      if (item.type !== SalaryComponentType.EMPLOYER_CONTRIBUTION) {
        return 'Gratuity Provision must be classified as an EMPLOYER_CONTRIBUTION. It cannot be an EARNING or EMPLOYEE_DEDUCTION.';
      }
      if (item.isStatutory === false) {
        return 'Gratuity Provision must be marked as a statutory component (isStatutory: true)';
      }
    }
    return 'Invalid Gratuity Provision classification';
  }
}

@ValidatorConstraint({ name: 'isValidPercentageOf', async: false })
export class IsValidPercentageOfConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as {
      calculationType?: SalaryComponentCalculationType;
    };
    if (!obj.calculationType) {
      return true;
    }
    if (obj.calculationType === SalaryComponentCalculationType.FIXED) {
      return value === undefined || value === null;
    }
    if (obj.calculationType === SalaryComponentCalculationType.PERCENTAGE) {
      return (
        value !== undefined &&
        value !== null &&
        Object.values(SalaryComponentPercentageBasis).includes(
          value as SalaryComponentPercentageBasis,
        )
      );
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as {
      calculationType?: SalaryComponentCalculationType;
    };
    if (!obj.calculationType) {
      return 'Invalid percentageOf configuration';
    }
    if (obj.calculationType === SalaryComponentCalculationType.FIXED) {
      return 'percentageOf must not be provided when calculationType is FIXED';
    }
    if (obj.calculationType === SalaryComponentCalculationType.PERCENTAGE) {
      return `percentageOf is required when calculationType is PERCENTAGE and must be one of: ${Object.values(
        SalaryComponentPercentageBasis,
      ).join(', ')}`;
    }
    return 'Invalid percentageOf configuration';
  }
}

export class CreateSalaryComponentDto {
  @ApiProperty({
    description: 'Name of the salary component',
    example: 'Basic Salary',
    minLength: SALARY_COMPONENT_CONSTANTS.NAME_MIN_LENGTH,
    maxLength: SALARY_COMPONENT_CONSTANTS.NAME_MAX_LENGTH,
  })
  @IsNotEmpty()
  @TrimString()
  @IsString()
  @MinLength(SALARY_COMPONENT_CONSTANTS.NAME_MIN_LENGTH)
  @MaxLength(SALARY_COMPONENT_CONSTANTS.NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    description: 'Unique identifier code for the component (uppercase)',
    example: 'BASIC',
    minLength: SALARY_COMPONENT_CONSTANTS.CODE_MIN_LENGTH,
    maxLength: SALARY_COMPONENT_CONSTANTS.CODE_MAX_LENGTH,
  })
  @IsNotEmpty()
  @TrimString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(SALARY_COMPONENT_CONSTANTS.CODE_MIN_LENGTH)
  @MaxLength(SALARY_COMPONENT_CONSTANTS.CODE_MAX_LENGTH)
  @Matches(/^[A-Z0-9_-]+$/, {
    message:
      'code must contain only uppercase alphanumeric characters, underscores, or hyphens',
  })
  code!: string;

  @ApiProperty({
    description: 'Classification of salary component',
    enum: SalaryComponentType,
    example: SalaryComponentType.EARNING,
  })
  @IsNotEmpty()
  @IsEnum(SalaryComponentType)
  type!: SalaryComponentType;

  @ApiPropertyOptional({
    description:
      'Deprecated calculation formula mechanism (managed exclusively in SalaryStructure)',
    enum: SalaryComponentCalculationType,
    example: SalaryComponentCalculationType.FIXED,
  })
  @IsOptional()
  @IsEnum(SalaryComponentCalculationType)
  calculationType?: SalaryComponentCalculationType | null;

  @ApiPropertyOptional({
    description:
      'Deprecated calculation base for PERCENTAGE components (managed exclusively in SalaryStructure)',
    enum: SalaryComponentPercentageBasis,
    example: SalaryComponentPercentageBasis.BASIC,
  })
  @Validate(IsValidPercentageOfConstraint)
  percentageOf?: SalaryComponentPercentageBasis | null;

  @ApiPropertyOptional({
    description:
      'Default fixed monetary value or percentage rate (0-100 for PERCENTAGE)',
    example: 15000,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Validate(IsValidSalaryComponentDefaultValueConstraint)
  defaultValue?: number | null;

  @ApiPropertyOptional({
    description: 'Whether this component is subject to income tax',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean = false;

  @ApiPropertyOptional({
    description: 'Whether this component is a statutory compliance component',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isStatutory?: boolean;

  @ApiPropertyOptional({
    description: 'Optional description of the salary component',
    example: 'Core compensation component',
    maxLength: SALARY_COMPONENT_CONSTANTS.DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(SALARY_COMPONENT_CONSTANTS.DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    description: 'Initial active status',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;

  @ApiHideProperty()
  @Validate(IsValidGratuityClassificationConstraint)
  private readonly _gratuityValidationGuard?: unknown;
}
