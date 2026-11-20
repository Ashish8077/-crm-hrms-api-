import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListShiftsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by active status. If omitted, returns all non-deleted shifts (both active and inactive).',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
