import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import {
  GRATUITY_COMPONENT_CODE,
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
  SALARY_COMPONENT_CONSTANTS,
} from '../constants/salary-component.constant';

@ValidatorConstraint({
  name: 'isValidGratuityUpdateClassification',
  async: false,
})
export class IsValidGratuityUpdateClassificationConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const item = args.object as UpdateSalaryComponentDto;
    if (item.code) {
      const normalizedCode = item.code.trim().toUpperCase();
      if (normalizedCode === GRATUITY_COMPONENT_CODE) {
        if (
          item.type !== undefined &&
          item.type !== SalaryComponentType.EMPLOYER_CONTRIBUTION
        ) {
          return false;
        }
        if (item.isStatutory === false) {
          return false;
        }
      }
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const item = args.object as UpdateSalaryComponentDto;
    if (
      item.code &&
      item.code.trim().toUpperCase() === GRATUITY_COMPONENT_CODE
    ) {
      if (
        item.type !== undefined &&
        item.type !== SalaryComponentType.EMPLOYER_CONTRIBUTION
      ) {
        return 'Gratuity Provision must be classified as an EMPLOYER_CONTRIBUTION. It cannot be an EARNING or EMPLOYEE_DEDUCTION.';
      }
      if (item.isStatutory === false) {
        return 'Gratuity Provision must be marked as a statutory component (isStatutory: true)';
      }
    }
    return 'Invalid Gratuity Provision classification';
  }
}

export class UpdateSalaryComponentDto {
  @ApiPropertyOptional({
    description: 'Name of the salary component',
    example: 'Basic Salary',
    minLength: SALARY_COMPONENT_CONSTANTS.NAME_MIN_LENGTH,
    maxLength: SALARY_COMPONENT_CONSTANTS.NAME_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(SALARY_COMPONENT_CONSTANTS.NAME_MIN_LENGTH)
  @MaxLength(SALARY_COMPONENT_CONSTANTS.NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description: 'Unique identifier code for the component (uppercase)',
    example: 'BASIC',
    minLength: SALARY_COMPONENT_CONSTANTS.CODE_MIN_LENGTH,
    maxLength: SALARY_COMPONENT_CONSTANTS.CODE_MAX_LENGTH,
  })
  @IsOptional()
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
  code?: string;

  @ApiPropertyOptional({
    description: 'Classification of salary component',
    enum: SalaryComponentType,
    example: SalaryComponentType.EARNING,
  })
  @IsOptional()
  @IsEnum(SalaryComponentType)
  type?: SalaryComponentType;

  @ApiPropertyOptional({
    description: 'Calculation formula mechanism',
    enum: SalaryComponentCalculationType,
    example: SalaryComponentCalculationType.FIXED,
  })
  @IsOptional()
  @IsEnum(SalaryComponentCalculationType)
  calculationType?: SalaryComponentCalculationType;

  @ApiPropertyOptional({
    description:
      'Calculation base for PERCENTAGE components (required for PERCENTAGE, null/absent for FIXED)',
    enum: SalaryComponentPercentageBasis,
    example: SalaryComponentPercentageBasis.BASIC,
  })
  @IsOptional()
  @IsEnum(SalaryComponentPercentageBasis)
  percentageOf?: SalaryComponentPercentageBasis | null;

  @ApiPropertyOptional({
    description: 'Whether this component is subject to income tax',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({
    description: 'Whether this component is a statutory compliance component',
    example: false,
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

  @ApiHideProperty()
  @Validate(IsValidGratuityUpdateClassificationConstraint)
  private readonly _gratuityValidationGuard?: unknown;
}
