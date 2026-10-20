import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { ShiftLean, ShiftRepository } from '../repositories/shift.repository';
import { EmployeeRepository } from '../../employees/repositories/employee.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { CreateShiftDto } from '../dto/create-shift.dto';
import { UpdateShiftDto } from '../dto/update-shift.dto';
import { AssignShiftDto } from '../dto/assign-shift.dto';
import { ShiftMapper, ShiftResponse } from '../mappers/shift.mapper';
import { ATTENDANCE_CONSTANTS } from '../constants/attendance.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';

@Injectable()
export class ShiftService {
  private readonly logger = new Logger(ShiftService.name);

  constructor(
    private readonly shiftRepository: ShiftRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private validateShiftConfiguration(shift: {
    startTime: string;
    endTime: string;
    isOvernight: boolean;
    breakDurationMinutes: number;
    minWorkMinutesForFullDay: number;
    minWorkMinutesForHalfDay: number;
    overtimeThresholdMinutes: number;
    isDefault?: boolean;
    isActive?: boolean;
  }): void {
    // 1. Organization default must be active
    if (shift.isDefault && shift.isActive === false) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'The default organization shift must remain active',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2. Start time vs end time
    if (shift.startTime === shift.endTime) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Shift startTime and endTime cannot be identical',
        HttpStatus.BAD_REQUEST,
      );
    }

    const startMinutes = this.parseTimeToMinutes(shift.startTime);
    const endMinutes = this.parseTimeToMinutes(shift.endTime);

    if (!shift.isOvernight && startMinutes >= endMinutes) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Shift startTime must be earlier than endTime for non-overnight shifts. Enable isOvernight if the shift crosses midnight.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (shift.isOvernight && startMinutes <= endMinutes) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'For overnight shifts crossing midnight, startTime must be later in the day than endTime (e.g. 22:00 to 06:00)',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Shift duration vs break and required net work minutes
    const shiftDurationMinutes = !shift.isOvernight
      ? endMinutes - startMinutes
      : 1440 - startMinutes + endMinutes;

    if (shift.breakDurationMinutes >= shiftDurationMinutes) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Break duration (${shift.breakDurationMinutes}m) cannot equal or exceed total shift duration (${shiftDurationMinutes}m)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const netWorkDurationMinutes =
      shiftDurationMinutes - shift.breakDurationMinutes;

    if (shift.minWorkMinutesForFullDay > netWorkDurationMinutes) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Full-day required work minutes (${shift.minWorkMinutesForFullDay}m) cannot exceed scheduled net work duration (${netWorkDurationMinutes}m, after deducting ${shift.breakDurationMinutes}m break)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. Half day < Full day
    if (shift.minWorkMinutesForHalfDay >= shift.minWorkMinutesForFullDay) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Half-day work minutes (${shift.minWorkMinutesForHalfDay}m) must be strictly less than full-day work minutes (${shift.minWorkMinutesForFullDay}m)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 5. Overtime threshold >= Full day
    if (shift.overtimeThresholdMinutes < shift.minWorkMinutesForFullDay) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Overtime threshold minutes (${shift.overtimeThresholdMinutes}m) cannot be less than full-day work minutes (${shift.minWorkMinutesForFullDay}m)`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async create(
    dto: CreateShiftDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ShiftResponse> {
    this.validateShiftConfiguration({
      startTime: dto.startTime,
      endTime: dto.endTime,
      isOvernight: dto.isOvernight ?? false,
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
    });

    const existingCode = await this.shiftRepository.findByCode(dto.code);
    if (existingCode) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Shift with code '${dto.code}' already exists`,
        HttpStatus.CONFLICT,
      );
    }

    const session = await this.connection.startSession();
    let createdShift: ShiftLean;

    try {
      await session.withTransaction(async (session: ClientSession) => {
        if (dto.isDefault) {
          await this.shiftRepository.clearDefault(undefined, session);
        }

        const createData = ShiftMapper.toCreateData(dto, actorId);
        createdShift = await this.shiftRepository.create(createData, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.SHIFT_CREATED,
            targetId: createdShift._id,
            targetModel: AuditTargetModel.SHIFT,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: { code: createdShift.code, name: createdShift.name },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    return ShiftMapper.toResponse(createdShift!);
  }

  async list(filter?: { isActive?: boolean }): Promise<ShiftResponse[]> {
    const shifts = await this.shiftRepository.findAll(filter);
    return ShiftMapper.toResponseList(shifts);
  }

  async getById(id: Types.ObjectId): Promise<ShiftResponse> {
    const shift = await this.shiftRepository.findById(id);
    if (!shift) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Shift not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return ShiftMapper.toResponse(shift);
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateShiftDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<ShiftResponse> {
    const existing = await this.shiftRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Shift not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const mergedConfig = {
      startTime: dto.startTime ?? existing.startTime,
      endTime: dto.endTime ?? existing.endTime,
      isOvernight: dto.isOvernight ?? existing.isOvernight,
      breakDurationMinutes:
        dto.breakDurationMinutes ?? existing.breakDurationMinutes,
      minWorkMinutesForFullDay:
        dto.minWorkMinutesForFullDay ?? existing.minWorkMinutesForFullDay,
      minWorkMinutesForHalfDay:
        dto.minWorkMinutesForHalfDay ?? existing.minWorkMinutesForHalfDay,
      overtimeThresholdMinutes:
        dto.overtimeThresholdMinutes ?? existing.overtimeThresholdMinutes,
      isDefault: dto.isDefault ?? existing.isDefault,
      isActive: dto.isActive ?? existing.isActive,
    };
    this.validateShiftConfiguration(mergedConfig);

    if (dto.code && dto.code.trim().toUpperCase() !== existing.code) {
      const codeDuplicate = await this.shiftRepository.findByCode(dto.code, id);
      if (codeDuplicate) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Shift with code '${dto.code}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const session = await this.connection.startSession();
    let updatedShift: ShiftLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        if (dto.isDefault) {
          await this.shiftRepository.clearDefault(id, s);
        }

        const updateData = ShiftMapper.toUpdateData(dto, actorId);
        updatedShift = await this.shiftRepository.updateById(id, updateData, s);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.SHIFT_UPDATED,
            targetId: id,
            targetModel: AuditTargetModel.SHIFT,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: { updatedFields: Object.keys(dto) },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    if (!updatedShift) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Shift not found or already deleted',
        HttpStatus.NOT_FOUND,
      );
    }

    return ShiftMapper.toResponse(updatedShift);
  }

  async delete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const existing = await this.shiftRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Shift not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.isDefault) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot delete the default organization shift. Please designate another shift as default first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async (session: ClientSession) => {
        await this.shiftRepository.softDelete(id, actorId, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.SHIFT_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.SHIFT,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: { code: existing.code },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  async assignShift(
    dto: AssignShiftDto,
    actorId: Types.ObjectId,
    metadata: ClientMetadata,
  ): Promise<void> {
    const employeeId = new Types.ObjectId(dto.employeeId);
    const shiftId = new Types.ObjectId(dto.shiftId);

    const [employee, shift] = await Promise.all([
      this.employeeRepository.findById(employeeId),
      this.shiftRepository.findById(shiftId),
    ]);

    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!shift || !shift.isActive) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Shift not found or inactive',
        HttpStatus.NOT_FOUND,
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async (session: ClientSession) => {
        const updatedEmployee = await this.employeeRepository.updateById(
          employeeId,
          { shiftId, updatedBy: actorId },
          session,
        );

        if (!updatedEmployee) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Employee not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.SHIFT_ASSIGNED,
            targetId: employeeId,
            targetModel: AuditTargetModel.EMPLOYEE,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: { shiftId: dto.shiftId, shiftCode: shift.code },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Resolves the active shift for an employee (explicit > employee assigned > organization default).
   */
  async resolveShift(
    employeeShiftId?: Types.ObjectId | null,
    explicitShiftId?: Types.ObjectId | null,
  ): Promise<ShiftLean> {
    if (explicitShiftId) {
      const explicit = await this.shiftRepository.findById(explicitShiftId);
      if (explicit && explicit.isActive) {
        return explicit;
      }
    }

    if (employeeShiftId) {
      const assigned = await this.shiftRepository.findById(employeeShiftId);
      if (assigned && assigned.isActive) {
        return assigned;
      }
    }

    const defaultShift = await this.shiftRepository.findDefault();
    if (defaultShift) {
      return defaultShift;
    }

    // Fallback: any active shift
    const anyActive = await this.shiftRepository.findActive();
    if (anyActive.length > 0) {
      return anyActive[0];
    }

    throw new AppError(
      ErrorCode.RESOURCE_NOT_FOUND,
      'No active shift found. Please configure a default shift.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
