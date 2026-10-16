import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddContactNoteDto {
  @ApiProperty({ example: 'Discussed onboarding timeline and technical requirements.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
}
