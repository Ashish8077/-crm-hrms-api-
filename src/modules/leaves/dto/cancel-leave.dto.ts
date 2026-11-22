import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CancelLeaveDto {
  @ApiProperty({
    description: 'Reason for cancellation of leave request',
    example: 'Client meeting postponed; reporting to office as usual.',
  })
  @IsNotEmpty({ message: 'Cancellation reason is required' })
  @IsString()
  @MinLength(5, { message: 'Reason must be at least 5 characters long' })
  @MaxLength(500, { message: 'Reason cannot exceed 500 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 500)
      : value,
  )
  reason!: string;
}
