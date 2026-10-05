import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateBranchStatusDto {
  @ApiProperty({
    description: 'Active status of the branch',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  isActive!: boolean;
}
