import { IsMongoId, IsNotEmpty, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignShiftDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsNotEmpty()
  @IsMongoId()
  employeeId!: string;

  @ApiProperty({
    description:
      'Shift ID (pass valid Mongo ID to assign, or null to unassign and inherit organization default shift)',
    nullable: true,
    type: String,
    example: null,
  })
  @ValidateIf((_, val) => val !== null)
  @IsNotEmpty()
  @IsMongoId()
  shiftId!: string | null;
}
