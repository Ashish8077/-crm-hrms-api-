import { ArrayMinSize, IsArray, IsMongoId, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BulkAssignLeadsDto {
  @ApiProperty({
    description: 'Array of Lead IDs to assign',
    example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
    type: [String],
  })
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  leadIds!: string[];

  @ApiProperty({
    description: 'Target User ID to assign these leads to',
    example: '507f1f77bcf86cd799439011',
  })
  @IsNotEmpty()
  @IsMongoId()
  ownerId!: string;
}
