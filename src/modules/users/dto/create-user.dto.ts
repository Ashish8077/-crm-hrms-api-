import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator.js';
import { TrimString } from '../../../common/decorators/trim-string.decorator.js';

export class CreateUserDto {
  @ApiProperty({
    description: 'Email address of the user',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  @TrimString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'Password for the user',
    example: 'StrongP@ssw0rd!',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  password!: string;
}
