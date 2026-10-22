import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddDealNoteDto {
  @ApiProperty({
    example:
      'Client requested commercial discount of 5% on annual contract value.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
}
