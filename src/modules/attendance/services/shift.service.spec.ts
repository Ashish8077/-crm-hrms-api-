/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { ShiftService } from './shift.service';
import { ShiftLean, ShiftRepository } from '../repositories/shift.repository';
import {
  EmployeeLean,
  EmployeeRepository,
} from '../../employees/repositories/employee.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { CreateShiftDto } from '../dto/create-shift.dto';

describe('ShiftService', () => {
  let service: ShiftService;
  let shiftRepo: jest.Mocked<ShiftRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation((cb: (session: unknown) => unknown) =>
        cb(mockSession),
      ),
    endSession: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const actorId = new Types.ObjectId();
  const shiftId = new Types.ObjectId();
  const clientMetadata = { ipAddress: '127.0.0.1', userAgent: 'Jest/1.0' };

  const mockShift: ShiftLean = {
    _id: shiftId,
    name: 'General Shift',
    code: 'GEN',
    startTime: '09:00',
    endTime: '18:00',
    isOvernight: false,
    gracePeriodMinutes: 15,
    breakDurationMinutes: 60,
    minWorkMinutesForFullDay: 480,
    minWorkMinutesForHalfDay: 240,
    overtimeThresholdMinutes: 480,
    isDefault: true,
    isActive: true,
    deletedAt: null,
    createdBy: actorId,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftService,
        {
          provide: ShiftRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByCode: jest.fn(),
            findDefault: jest.fn(),
            findActive: jest.fn(),
            findAll: jest.fn(),
            updateById: jest.fn(),
            clearDefault: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: EmployeeRepository,
          useValue: {
            findById: jest.fn(),
            updateById: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<ShiftService>(ShiftService);
    shiftRepo = module.get(ShiftRepository);
    employeeRepo = module.get(EmployeeRepository);
    auditLogsService = module.get(AuditLogsService);
  });

  describe('create', () => {
    const dto: CreateShiftDto = {
      name: 'General Shift',
      code: 'GEN',
      startTime: '09:00',
      endTime: '18:00',
      isOvernight: false,
      gracePeriodMinutes: 15,
      breakDurationMinutes: 60,
      minWorkMinutesForFullDay: 480,
      minWorkMinutesForHalfDay: 240,
      overtimeThresholdMinutes: 480,
      isDefault: true,
      isActive: true,
    };

    it('should throw RESOURCE_ALREADY_EXISTS if shift code already exists', async () => {
      shiftRepo.findByCode.mockResolvedValue(mockShift);

      await expect(
        service.create(dto, actorId, clientMetadata),
      ).rejects.toThrow(AppError);

      try {
        await service.create(dto, actorId, clientMetadata);
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.RESOURCE_ALREADY_EXISTS);
        }
      }
    });

    it('should throw VALIDATION_ERROR if startTime and endTime are identical', async () => {
      await expect(
        service.create(
          { ...dto, startTime: '09:00', endTime: '09:00' },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw VALIDATION_ERROR if non-overnight shift has startTime >= endTime', async () => {
      await expect(
        service.create(
          { ...dto, startTime: '18:00', endTime: '09:00', isOvernight: false },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw VALIDATION_ERROR if overnight shift has startTime <= endTime', async () => {
      await expect(
        service.create(
          { ...dto, startTime: '09:00', endTime: '18:00', isOvernight: true },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw VALIDATION_ERROR if half-day minutes >= full-day minutes', async () => {
      await expect(
        service.create(
          {
            ...dto,
            minWorkMinutesForHalfDay: 480,
            minWorkMinutesForFullDay: 480,
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw VALIDATION_ERROR if overtime threshold < full-day minutes', async () => {
      await expect(
        service.create(
          {
            ...dto,
            minWorkMinutesForFullDay: 480,
            overtimeThresholdMinutes: 300,
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw VALIDATION_ERROR if full-day minutes exceed shift duration', async () => {
      await expect(
        service.create(
          {
            ...dto,
            startTime: '09:00',
            endTime: '13:00', // 4 hours = 240 mins
            minWorkMinutesForFullDay: 480, // 8 hours
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw VALIDATION_ERROR if full-day minutes exceed net work duration after break', async () => {
      // Overnight shift: 22:00 -> 06:00 = 480 mins. Break = 60 mins -> Net work = 420 mins.
      // fullDay = 480 mins > 420 mins -> Must throw VALIDATION_ERROR.
      await expect(
        service.create(
          {
            ...dto,
            startTime: '22:00',
            endTime: '06:00',
            isOvernight: true,
            breakDurationMinutes: 60,
            minWorkMinutesForFullDay: 480,
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should accept overnight shift full-day minutes when equal to net work duration', async () => {
      // Overnight shift: 22:00 -> 06:00 = 480 mins. Break = 0 mins -> Net work = 480 mins.
      shiftRepo.findByCode.mockResolvedValue(null);
      shiftRepo.create.mockResolvedValue({
        ...mockShift,
        startTime: '22:00',
        endTime: '06:00',
        isOvernight: true,
        breakDurationMinutes: 0,
        minWorkMinutesForFullDay: 480,
      });

      const result = await service.create(
        {
          ...dto,
          startTime: '22:00',
          endTime: '06:00',
          isOvernight: true,
          breakDurationMinutes: 0,
          minWorkMinutesForFullDay: 480,
          minWorkMinutesForHalfDay: 240,
          overtimeThresholdMinutes: 480,
        },
        actorId,
        clientMetadata,
      );

      expect(result).toBeDefined();
    });

    it('should throw VALIDATION_ERROR if break duration equals or exceeds shift duration', async () => {
      await expect(
        service.create(
          {
            ...dto,
            startTime: '09:00',
            endTime: '10:00', // 60 mins
            breakDurationMinutes: 60, // 60 mins break >= 60 mins shift
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw VALIDATION_ERROR if default shift is configured as inactive', async () => {
      await expect(
        service.create(
          {
            ...dto,
            isDefault: true,
            isActive: false,
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should successfully create shift and clear other default shifts if isDefault is true', async () => {
      shiftRepo.findByCode.mockResolvedValue(null);
      shiftRepo.create.mockResolvedValue(mockShift);

      const result = await service.create(dto, actorId, clientMetadata);

      expect(shiftRepo.clearDefault).toHaveBeenCalled();
      expect(shiftRepo.create).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.code).toBe('GEN');
    });
  });

  describe('update', () => {
    it('should throw RESOURCE_NOT_FOUND if shift to update does not exist', async () => {
      shiftRepo.findById.mockResolvedValue(null);

      await expect(
        service.update(shiftId, { name: 'New Name' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('should throw VALIDATION_ERROR if update causes half-day >= full-day', async () => {
      shiftRepo.findById.mockResolvedValue(mockShift);

      await expect(
        service.update(
          shiftId,
          { minWorkMinutesForHalfDay: 500 }, // existing full-day is 480
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw RESOURCE_ALREADY_EXISTS if updated code already exists on another shift', async () => {
      shiftRepo.findById.mockResolvedValue(mockShift);
      shiftRepo.findByCode.mockResolvedValue({
        ...mockShift,
        _id: new Types.ObjectId(),
        code: 'EVENING',
      });

      await expect(
        service.update(shiftId, { code: 'EVENING' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('should successfully update shift and create audit log', async () => {
      shiftRepo.findById.mockResolvedValue(mockShift);
      shiftRepo.findByCode.mockResolvedValue(null);
      shiftRepo.updateById.mockResolvedValue({
        ...mockShift,
        name: 'Updated Shift',
      });

      const result = await service.update(
        shiftId,
        { name: 'Updated Shift' },
        actorId,
        clientMetadata,
      );

      expect(shiftRepo.updateById).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.name).toBe('Updated Shift');
    });
  });

  describe('list', () => {
    it('should return all non-deleted shifts including inactive ones when no filter is provided', async () => {
      const activeShift = {
        ...mockShift,
        _id: new Types.ObjectId(),
        isActive: true,
      };
      const inactiveShift = {
        ...mockShift,
        _id: new Types.ObjectId(),
        code: 'INACT',
        name: 'Inactive Shift',
        isActive: false,
        deletedAt: null,
      };

      shiftRepo.findAll.mockResolvedValue([activeShift, inactiveShift]);

      const result = await service.list();

      expect(shiftRepo.findAll).toHaveBeenCalledWith(undefined);
      expect(result).toHaveLength(2);
      expect(result.some((s) => s.isActive === false)).toBe(true);
    });

    it('should pass isActive filter to repository when provided', async () => {
      const inactiveShift = {
        ...mockShift,
        _id: new Types.ObjectId(),
        code: 'INACT',
        name: 'Inactive Shift',
        isActive: false,
        deletedAt: null,
      };

      shiftRepo.findAll.mockResolvedValue([inactiveShift]);

      const result = await service.list({ isActive: false });

      expect(shiftRepo.findAll).toHaveBeenCalledWith({ isActive: false });
      expect(result).toHaveLength(1);
      expect(result[0].isActive).toBe(false);
    });
  });

  describe('delete', () => {
    it('should throw RESOURCE_NOT_FOUND if shift does not exist', async () => {
      shiftRepo.findById.mockResolvedValue(null);

      await expect(
        service.delete(shiftId, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('should throw VALIDATION_ERROR if attempting to delete default shift', async () => {
      shiftRepo.findById.mockResolvedValue({
        ...mockShift,
        isDefault: true,
      });

      await expect(
        service.delete(shiftId, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should successfully soft-delete non-default shift and create audit log', async () => {
      shiftRepo.findById.mockResolvedValue({
        ...mockShift,
        isDefault: false,
      });
      shiftRepo.softDelete.mockResolvedValue({
        ...mockShift,
        isDefault: false,
        deletedAt: new Date(),
      });

      await service.delete(shiftId, actorId, clientMetadata);

      expect(shiftRepo.softDelete).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('assignShift', () => {
    const employeeId = new Types.ObjectId();

    it('should throw RESOURCE_NOT_FOUND if employee not found', async () => {
      employeeRepo.findById.mockResolvedValue(null);

      await expect(
        service.assignShift(
          { employeeId: employeeId.toString(), shiftId: shiftId.toString() },
          actorId,
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should throw RESOURCE_NOT_FOUND if shift not found or inactive', async () => {
      employeeRepo.findById.mockResolvedValue({
        _id: employeeId,
      } as unknown as EmployeeLean);
      shiftRepo.findById.mockResolvedValue(null);

      await expect(
        service.assignShift(
          { employeeId: employeeId.toString(), shiftId: shiftId.toString() },
          actorId,
          clientMetadata,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should successfully update employee shiftId and create audit log', async () => {
      const mockEmp = {
        _id: employeeId,
      } as unknown as EmployeeLean;
      employeeRepo.findById.mockResolvedValue(mockEmp);
      employeeRepo.updateById.mockResolvedValue(mockEmp);
      shiftRepo.findById.mockResolvedValue(mockShift);

      await service.assignShift(
        { employeeId: employeeId.toString(), shiftId: shiftId.toString() },
        actorId,
        clientMetadata,
      );

      expect(employeeRepo.updateById).toHaveBeenCalledWith(
        employeeId,
        expect.objectContaining({ shiftId }),
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('resolveShift', () => {
    it('should prioritize explicit shift ID', async () => {
      const explicitId = new Types.ObjectId();
      const explicitShift = { ...mockShift, _id: explicitId, code: 'NIGHT' };
      shiftRepo.findById.mockResolvedValue(explicitShift);

      const resolved = await service.resolveShift(null, explicitId);
      expect(resolved.code).toBe('NIGHT');
    });

    it('should fall back to employee assigned shift ID', async () => {
      const empShiftId = new Types.ObjectId();
      shiftRepo.findById.mockResolvedValue({
        ...mockShift,
        _id: empShiftId,
        code: 'ASSIGNED',
      });

      const resolved = await service.resolveShift(empShiftId, null);
      expect(resolved.code).toBe('ASSIGNED');
    });

    it('should fall back to organization default shift', async () => {
      shiftRepo.findDefault.mockResolvedValue(mockShift);

      const resolved = await service.resolveShift(null, null);
      expect(resolved.code).toBe('GEN');
    });

    it('should throw RESOURCE_NOT_FOUND if no shifts exist', async () => {
      shiftRepo.findDefault.mockResolvedValue(null);
      shiftRepo.findActive.mockResolvedValue([]);

      await expect(service.resolveShift(null, null)).rejects.toThrow(AppError);
    });
  });
});
