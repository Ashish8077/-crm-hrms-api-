import { IsMongoId, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkEmployeeDto {
  @ApiProperty({
    description: 'The ID of the user to link to this employee',
    example: '65b1c9e8d4a3e2f1a8b9c0d1',
  })
  @IsNotEmpty()
  @IsMongoId()
  userId!: string;
}
