import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../../users/constants/user-status.constant.js';

export class MeResponseDto {
  @ApiProperty({
    description: 'User ID',
    example: '60d5ecb8b392d7001f3e9a5a',
  })
  id!: string;

  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'User account status',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @ApiProperty({
    description: 'Array of associated role IDs',
    type: [String],
    example: ['60d5ecb8b392d7001f3e9a5b'],
  })
  roleIds!: string[];
}
