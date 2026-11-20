import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { TASK_CANCEL_MIN_REASON_LEN } from '../constants/task.constant';

export class CancelTaskDto {
  @ApiProperty({
    example: 'Client cancelled contract negotiation',
    description: `Cancellation reason (minimum ${TASK_CANCEL_MIN_REASON_LEN} characters)`,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(TASK_CANCEL_MIN_REASON_LEN)
  reason!: string;
}
