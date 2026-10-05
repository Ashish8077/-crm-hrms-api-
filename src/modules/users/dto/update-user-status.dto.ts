import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../constants/user-status.constant';

export class UpdateUserStatusDto {
  @ApiProperty({
    description: 'New status for the user',
    enum: UserStatus,
    example: UserStatus.INACTIVE,
  })
  @IsEnum(UserStatus)
  @IsNotEmpty()
  status!: UserStatus;
}
