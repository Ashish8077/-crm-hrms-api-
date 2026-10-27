import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsMongoId,
  IsNotEmpty,
} from 'class-validator';
import { TASK_MAX_BULK_ASSIGN } from '../constants/task.constant';

export class BulkAssignTasksDto {
  @ApiProperty({
    example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
    description: `Array of task IDs to reassign (maximum ${TASK_MAX_BULK_ASSIGN})`,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(TASK_MAX_BULK_ASSIGN)
  @IsMongoId({ each: true })
  taskIds!: string[];

  @ApiProperty({
    example: '507f1f77bcf86cd799439013',
    description: 'User ID of the new assignee',
  })
  @IsMongoId()
  @IsNotEmpty()
  assignedTo!: string;
}
