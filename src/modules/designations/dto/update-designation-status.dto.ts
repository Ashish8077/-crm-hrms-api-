import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDesignationStatusDto {
  @ApiProperty({
    description: 'Active status of the designation',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  isActive!: boolean;
}
