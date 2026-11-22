import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { LeaveTransactionType } from '../constants/leaves.constant';

export class ListLeaveTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter transactions by leave type ID',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @IsMongoId()
  leaveTypeId?: string;

  @ApiPropertyOptional({
    description: 'Filter transactions by year',
    example: 2026,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    description: 'Filter by specific transaction type',
    enum: LeaveTransactionType,
  })
  @IsOptional()
  @IsEnum(LeaveTransactionType)
  transactionType?: LeaveTransactionType;
}
