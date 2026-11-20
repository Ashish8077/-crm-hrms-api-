import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTeamStatusDto {
  @ApiProperty({
    description: 'The active status of the team',
    example: false,
  })
  @IsBoolean()
  @IsNotEmpty()
  isActive!: boolean;
}
