import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsEnum,
  IsNumber,
  Min,
  IsArray,
  IsMongoId,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CompanyIndustry } from '../constants/company-industry.constant';
import { CompanyType } from '../constants/company-type.constant';
import { CompanyTier } from '../constants/company-tier.constant';
import { CompanyStatus } from '../constants/company-status.constant';

export class LabeledEntryDto {
  @ApiProperty({ example: 'Mobile' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ example: '+1-555-0199' })
  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class AddressDto {
  @ApiPropertyOptional({ example: '100 Innovation Way' })
  @IsString()
  @IsOptional()
  street?: string;

  @ApiPropertyOptional({ example: 'Austin' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Texas' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: '78701' })
  @IsString()
  @IsOptional()
  postalCode?: string;

  @ApiPropertyOptional({ example: 'USA' })
  @IsString()
  @IsOptional()
  country?: string;
}

export class SocialLinksDto {
  @ApiPropertyOptional({ example: 'https://linkedin.com/company/acme' })
  @IsString()
  @IsOptional()
  linkedin?: string;

  @ApiPropertyOptional({ example: 'https://twitter.com/acme' })
  @IsString()
  @IsOptional()
  twitter?: string;

  @ApiPropertyOptional({ example: 'https://facebook.com/acme' })
  @IsString()
  @IsOptional()
  facebook?: string;

  @ApiPropertyOptional({ example: 'https://github.com/acme' })
  @IsString()
  @IsOptional()
  github?: string;
}

export class CreateCompanyDto {
  @ApiProperty({ example: 'Acme Innovations Ltd' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Acme Innovations Private Limited' })
  @IsString()
  @IsOptional()
  legalName?: string;

  @ApiPropertyOptional({ example: 'CIN-U72200DL2026PTC123456' })
  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @ApiPropertyOptional({ example: 'TX-998877', description: 'Tax ID or registration number' })
  @IsString()
  @IsOptional()
  taxId?: string;

  @ApiPropertyOptional({ enum: CompanyStatus, default: CompanyStatus.ACTIVE })
  @IsEnum(CompanyStatus)
  @IsOptional()
  status?: CompanyStatus;

  @ApiPropertyOptional({ enum: CompanyIndustry, default: CompanyIndustry.OTHER })
  @IsEnum(CompanyIndustry)
  @IsOptional()
  industry?: CompanyIndustry;

  @ApiPropertyOptional({ enum: CompanyType, default: CompanyType.PROSPECT })
  @IsEnum(CompanyType)
  @IsOptional()
  type?: CompanyType;

  @ApiPropertyOptional({ enum: CompanyTier, default: CompanyTier.STANDARD })
  @IsEnum(CompanyTier)
  @IsOptional()
  tier?: CompanyTier;

  @ApiPropertyOptional({ example: 'acmeinnovations.com' })
  @IsString()
  @IsOptional()
  domain?: string;

  @ApiPropertyOptional({ example: 'https://www.acmeinnovations.com' })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({ example: 'contact@acmeinnovations.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+1-800-555-0199' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    type: [LabeledEntryDto],
    description: 'Additional contact phone numbers with labels',
    example: [{ label: 'Sales Support', value: '+1-800-555-0199' }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabeledEntryDto)
  @IsOptional()
  additionalPhones?: LabeledEntryDto[];

  @ApiPropertyOptional({
    type: [LabeledEntryDto],
    description: 'Additional departmental email addresses with labels',
    example: [{ label: 'Billing', value: 'billing@acmeinnovations.com' }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabeledEntryDto)
  @IsOptional()
  additionalEmails?: LabeledEntryDto[];

  @ApiPropertyOptional({ type: AddressDto, description: 'Headquarters / Primary office address' })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  address?: AddressDto;

  @ApiPropertyOptional({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  billingAddress?: AddressDto;

  @ApiPropertyOptional({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  shippingAddress?: AddressDto;

  @ApiPropertyOptional({ type: SocialLinksDto })
  @ValidateNested()
  @Type(() => SocialLinksDto)
  @IsOptional()
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional({ example: 5000000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  annualRevenue?: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ example: 150, description: 'Total number of employees' })
  @IsOptional()
  employeeCount?: number | string;

  @ApiPropertyOptional({ example: '51-200' })
  @IsString()
  @IsOptional()
  employeeCountRange?: string;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId()
  @IsOptional()
  ownerId?: string;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439012' })
  @IsMongoId()
  @IsOptional()
  parentCompanyId?: string;

  @ApiPropertyOptional({ example: ['saas', 'enterprise'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
