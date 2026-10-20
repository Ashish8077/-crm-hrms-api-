import { Types } from 'mongoose';
import { CreateShiftData, ShiftLean } from '../repositories/shift.repository';
import { CreateShiftDto } from '../dto/create-shift.dto';
import { UpdateShiftDto } from '../dto/update-shift.dto';
import { ATTENDANCE_CONSTANTS } from '../constants/attendance.constant';

export interface ShiftResponse {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  minWorkMinutesForFullDay: number;
  minWorkMinutesForHalfDay: number;
  overtimeThresholdMinutes: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class ShiftMapper {
  /**
   * Maps shift creation DTO to persistence input.
   */
  static toCreateData(
    dto: CreateShiftDto,
    actorId: Types.ObjectId,
  ): CreateShiftData {
    return {
      name: dto.name.trim(),
      code: dto.code.trim().toUpperCase(),
      startTime: dto.startTime.trim(),
      endTime: dto.endTime.trim(),
      isOvernight: dto.isOvernight ?? false,
      gracePeriodMinutes:
        dto.gracePeriodMinutes ??
        ATTENDANCE_CONSTANTS.DEFAULT_GRACE_PERIOD_MINUTES,
      breakDurationMinutes:
        dto.breakDurationMinutes ??
        ATTENDANCE_CONSTANTS.DEFAULT_BREAK_DURATION_MINUTES,
      minWorkMinutesForFullDay:
        dto.minWorkMinutesForFullDay ??
        ATTENDANCE_CONSTANTS.DEFAULT_FULL_DAY_MINUTES,
      minWorkMinutesForHalfDay:
        dto.minWorkMinutesForHalfDay ??
        ATTENDANCE_CONSTANTS.DEFAULT_HALF_DAY_MINUTES,
      overtimeThresholdMinutes:
        dto.overtimeThresholdMinutes ??
        ATTENDANCE_CONSTANTS.DEFAULT_OVERTIME_THRESHOLD_MINUTES,
      isDefault: dto.isDefault ?? false,
      isActive: dto.isActive ?? true,
      createdBy: actorId,
    };
  }

  /**
   * Maps shift update DTO to persistence update dictionary.
   */
  static toUpdateData(
    dto: UpdateShiftDto,
    actorId: Types.ObjectId,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      updatedBy: actorId,
    };

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase();
    if (dto.startTime !== undefined) data.startTime = dto.startTime.trim();
    if (dto.endTime !== undefined) data.endTime = dto.endTime.trim();
    if (dto.isOvernight !== undefined) data.isOvernight = dto.isOvernight;
    if (dto.gracePeriodMinutes !== undefined)
      data.gracePeriodMinutes = dto.gracePeriodMinutes;
    if (dto.breakDurationMinutes !== undefined)
      data.breakDurationMinutes = dto.breakDurationMinutes;
    if (dto.minWorkMinutesForFullDay !== undefined)
      data.minWorkMinutesForFullDay = dto.minWorkMinutesForFullDay;
    if (dto.minWorkMinutesForHalfDay !== undefined)
      data.minWorkMinutesForHalfDay = dto.minWorkMinutesForHalfDay;
    if (dto.overtimeThresholdMinutes !== undefined)
      data.overtimeThresholdMinutes = dto.overtimeThresholdMinutes;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return data;
  }

  /**
   * Maps a Shift entity/lean document to an API response DTO.
   */
  static toResponse(shift: ShiftLean): ShiftResponse {
    return {
      id: shift._id.toString(),
      name: shift.name,
      code: shift.code,
      startTime: shift.startTime,
      endTime: shift.endTime,
      isOvernight: shift.isOvernight,
      gracePeriodMinutes: shift.gracePeriodMinutes,
      breakDurationMinutes: shift.breakDurationMinutes,
      minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
      minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
      overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
      isDefault: shift.isDefault,
      isActive: shift.isActive,
      createdAt: shift.createdAt,
      updatedAt: shift.updatedAt,
    };
  }

  static toResponseList(shifts: ShiftLean[]): ShiftResponse[] {
    return shifts.map((s) => ShiftMapper.toResponse(s));
  }
}
