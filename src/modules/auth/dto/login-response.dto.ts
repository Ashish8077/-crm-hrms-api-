import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
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
}

export class LoginResponseDto {
  @ApiProperty({
    description: 'Authenticated user details',
    type: LoginUserDto,
  })
  user!: LoginUserDto;

  @ApiProperty({
    description: 'Access token expiration time in seconds',
    example: 900,
  })
  expiresIn!: number;
}
