import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsEnum,
  IsBoolean,
  IsArray,
  IsMongoId,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DecisionRole } from '../constants/decision-role.constant';
import { ContactStatus } from '../constants/contact-status.constant';
import { AddressDto, SocialLinksDto } from '../../companies/dto/create-company.dto';

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

export class CreateContactDto {
  @ApiProperty({ example: 'Robert' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'Chen' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ example: 'robert.chen@acmeinnovations.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: '+1-512-555-0144' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiPropertyOptional({ example: '+1-512-555-0199' })
  @IsString()
  @IsOptional()
  mobilePhone?: string;

  @ApiPropertyOptional({ example: '+1-512-555-0100' })
  @IsString()
  @IsOptional()
  workPhone?: string;

  @ApiPropertyOptional({ type: [LabeledEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabeledEntryDto)
  @IsOptional()
  additionalPhones?: LabeledEntryDto[];

  @ApiPropertyOptional({ example: 'robert.personal@gmail.com' })
  @IsEmail()
  @IsOptional()
  alternateEmail?: string;

  @ApiPropertyOptional({ type: [LabeledEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabeledEntryDto)
  @IsOptional()
  additionalEmails?: LabeledEntryDto[];

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011', description: 'Linked company ID' })
  @IsMongoId()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ example: 'VP of Engineering' })
  @IsString()
  @IsOptional()
  jobTitle?: string;

  @ApiPropertyOptional({ example: 'Engineering' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: true, description: 'True if main POC for company' })
  @IsBoolean()
  @IsOptional()
  isPrimaryContact?: boolean;

  @ApiPropertyOptional({ enum: DecisionRole, default: DecisionRole.INFLUENCER })
  @IsEnum(DecisionRole)
  @IsOptional()
  decisionRole?: DecisionRole;

  @ApiPropertyOptional({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  address?: AddressDto;

  @ApiPropertyOptional({ type: SocialLinksDto })
  @ValidateNested()
  @Type(() => SocialLinksDto)
  @IsOptional()
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439012' })
  @IsMongoId()
  @IsOptional()
  ownerId?: string;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439013', description: 'Origin lead ID if converted' })
  @IsMongoId()
  @IsOptional()
  leadId?: string;

  @ApiPropertyOptional({ enum: ContactStatus, default: ContactStatus.ACTIVE })
  @IsEnum(ContactStatus)
  @IsOptional()
  status?: ContactStatus;

  @ApiPropertyOptional({ example: ['decision-maker', 'technical-buyer'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
