import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'StrongPassword123!',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  password!: string;
}
