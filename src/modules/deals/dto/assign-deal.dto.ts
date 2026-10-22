import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class AssignDealDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'New owner user ID',
  })
  @IsMongoId()
  @IsNotEmpty()
  ownerId!: string;
}
