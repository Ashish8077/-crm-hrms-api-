import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ExtendValidityDto {
  @ApiProperty({
    description: 'New expiration date (must be in the future)',
    example: '2027-01-31T23:59:59.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  newExpiryDate!: string;

  @ApiProperty({
    description: 'Justification for validity extension (minimum 3 characters)',
    example: 'Client procurement board meeting delayed',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  reason!: string;
}
