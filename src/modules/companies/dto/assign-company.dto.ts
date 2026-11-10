import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class AssignCompanyDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Assigned account manager user ID',
  })
  @IsMongoId()
  @IsNotEmpty()
  ownerId!: string;
}
