import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class AssignContactDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Assigned sales rep user ID',
  })
  @IsMongoId()
  @IsNotEmpty()
  ownerId!: string;
}
