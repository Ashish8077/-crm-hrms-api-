import { IsMongoId, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignSalaryDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the active SalaryStructure template',
    example: '60d5ec49f1b2c82d8c8e4567',
  })
  @IsNotEmpty({ message: 'salaryStructureId is required' })
  @IsMongoId({ message: 'salaryStructureId must be a valid MongoDB ObjectId' })
  salaryStructureId!: string;

  @ApiProperty({
    description:
      'Effective start date of this salary assignment in YYYY-MM-DD format (inclusive). Date-only interpretation normalized to UTC midnight.',
    example: '2026-07-01',
  })
  @IsNotEmpty({ message: 'effectiveFrom date is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'effectiveFrom must be in YYYY-MM-DD format (e.g. 2026-07-01)',
  })
  effectiveFrom!: string;
}
