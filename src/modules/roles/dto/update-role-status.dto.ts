import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRoleStatusDto {
  @ApiProperty({
    description: 'Indicates whether the role is active or not',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  isActive!: boolean;
}
