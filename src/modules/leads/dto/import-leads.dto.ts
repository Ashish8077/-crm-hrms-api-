import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CreateLeadDto } from './create-lead.dto';

export class ImportLeadsDto {
  @ApiProperty({
    description: 'Array of lead objects to import',
    type: [CreateLeadDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateLeadDto)
  leads!: CreateLeadDto[];
}
