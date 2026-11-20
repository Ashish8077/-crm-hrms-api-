import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TaskStatus } from '../constants/task-status.constant';

export class ChangeTaskStatusDto {
  @ApiProperty({ enum: TaskStatus, example: TaskStatus.IN_PROGRESS })
  @IsEnum(TaskStatus)
  @IsNotEmpty()
  status!: TaskStatus;

  @ApiPropertyOptional({
    description: 'Mandatory when reopening a completed task (min 5 characters)',
    example: 'Client requested additional revisions to the proposal.',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}
