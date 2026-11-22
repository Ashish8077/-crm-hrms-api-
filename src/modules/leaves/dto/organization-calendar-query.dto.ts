import { IsMongoId, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CalendarQueryDto } from './calendar-query.dto';

export class OrganizationCalendarQueryDto extends CalendarQueryDto {
  @ApiPropertyOptional({
    description: 'Filter calendar by branch ID',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @IsMongoId({ message: 'branchId must be a valid MongoId' })
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Filter calendar by department ID',
    example: '60d5ecb8b5c9c32b8c8d4e22',
  })
  @IsOptional()
  @IsMongoId({ message: 'departmentId must be a valid MongoId' })
  departmentId?: string;
}
