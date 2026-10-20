import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';

export class TransferLeadDto {
  @ApiProperty({
    description: 'Target User ID to transfer ownership to',
    example: '507f1f77bcf86cd799439011',
  })
  @IsNotEmpty()
  @IsMongoId()
  newOwnerId!: string;

  @ApiPropertyOptional({
    description: 'Reason for ownership transfer',
    example: 'Reassigned due to territory shift',
  })
  @IsOptional()
  @IsString()
  @TrimString()
  reason?: string;
}
