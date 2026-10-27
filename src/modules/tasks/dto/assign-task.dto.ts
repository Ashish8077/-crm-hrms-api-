import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class AssignTaskDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'User ID of the new assignee',
  })
  @IsMongoId()
  @IsNotEmpty()
  assignedTo!: string;
}
