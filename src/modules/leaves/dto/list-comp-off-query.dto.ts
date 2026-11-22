import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { CompOffStatus } from '../constants/leaves.constant';

export class ListCompOffQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by specific employee ID (Manager/HR)',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @IsMongoId()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by comp-off claim status',
    enum: CompOffStatus,
  })
  @IsOptional()
  @IsEnum(CompOffStatus)
  status?: CompOffStatus;
}
