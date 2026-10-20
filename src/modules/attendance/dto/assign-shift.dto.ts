import { IsMongoId, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignShiftDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsNotEmpty()
  @IsMongoId()
  employeeId!: string;

  @ApiProperty({ description: 'Shift ID' })
  @IsNotEmpty()
  @IsMongoId()
  shiftId!: string;
}
