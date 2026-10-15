import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';

export class AddLeadNoteDto {
  @ApiProperty({
    description: 'Note content/text',
    example: 'Client requested demo follow-up next Tuesday.',
  })
  @IsNotEmpty()
  @IsString()
  @TrimString()
  content!: string;
}
