import { IsInt, IsNotEmpty, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateLeadScoreDto {
  @ApiProperty({
    description: 'Updated lead score (0 to 100)',
    minimum: 0,
    maximum: 100,
    example: 85,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  score!: number;
}
