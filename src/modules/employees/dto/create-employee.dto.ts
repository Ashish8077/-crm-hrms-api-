import {
  IsDate,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import { IsBefore } from '../../../common/validation/decorators/is-before.decorator';
import { IsPastDate } from '../../../common/validation/decorators/is-past-date.decorator';
import {
  EmploymentType,
  EmploymentStatus,
} from '../constants/employee.constant';

class BankDetailsDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @TrimString()
  bankName!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(/^[0-9]{9,18}$/, {
    message: 'Account number must be between 9 and 18 digits',
  })
  @TrimString()
  accountNumber!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: 'Invalid IFSC code format',
  })
  @TrimString()
  ifscCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @TrimString()
  branchName?: string;
}

class EmergencyContactDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @TrimString()
  name!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @TrimString()
  relationship!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, {
    message: 'Phone number must be a valid contact number',
  })
  @TrimString()
  phoneNumber!: string;
}

export class CreateEmployeeDto {
  @ApiProperty({ description: 'First Name', example: 'John' })
  @IsNotEmpty()
  @IsString()
  @TrimString()
  firstName!: string;

  @ApiProperty({ description: 'Last Name', example: 'Doe' })
  @IsNotEmpty()
  @IsString()
  @TrimString()
  lastName!: string;

  @ApiProperty({
    description: 'Work email address',
    example: 'john.doe@company.com',
  })
  @IsNotEmpty()
  @IsEmail()
  @TrimString()
  workEmail!: string;

  @ApiPropertyOptional({ description: 'Phone number', example: '+1234567890' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, {
    message: 'Phone number must be a valid contact number',
  })
  @TrimString()
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Date of birth' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @IsPastDate({ message: 'Date of birth cannot be in the future' })
  @IsBefore('dateOfJoining', {
    message: 'Date of birth must be before date of joining',
  })
  dateOfBirth?: Date;

  @ApiProperty({ description: 'Date of joining' })
  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  dateOfJoining!: Date;

  @ApiProperty({ description: 'Department ID' })
  @IsNotEmpty()
  @IsMongoId()
  departmentId!: string;

  @ApiProperty({ description: 'Designation ID' })
  @IsNotEmpty()
  @IsMongoId()
  designationId!: string;

  @ApiProperty({ description: 'Branch ID' })
  @IsNotEmpty()
  @IsMongoId()
  branchId!: string;

  @ApiPropertyOptional({ description: 'Team ID' })
  @IsOptional()
  @IsMongoId()
  teamId?: string;

  @ApiPropertyOptional({ description: 'Reporting Manager (Employee ID)' })
  @IsOptional()
  @IsMongoId()
  reportingManagerId?: string;

  @ApiProperty({ enum: EmploymentType, description: 'Employment Type' })
  @IsNotEmpty()
  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @ApiProperty({ enum: EmploymentStatus, description: 'Employment Status' })
  @IsNotEmpty()
  @IsEnum(EmploymentStatus)
  employmentStatus!: EmploymentStatus;

  @ApiPropertyOptional({ type: BankDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails?: BankDetailsDto;

  @ApiPropertyOptional({ type: EmergencyContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact?: EmergencyContactDto;

  @ApiPropertyOptional({ type: [String], description: 'Skills' })
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? Array.from(new Set(value as string[]))
      : (value as unknown),
  )
  skills?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Certifications' })
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? Array.from(new Set(value as string[]))
      : (value as unknown),
  )
  certifications?: string[];
}
