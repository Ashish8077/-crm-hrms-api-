import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddCompanyNoteDto {
  @ApiProperty({ example: 'Reviewed pricing tier with VP of Finance.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
}
