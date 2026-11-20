/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ShiftController } from './shift.controller';
import { ShiftService } from './services/shift.service';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('ShiftController', () => {
  let controller: ShiftController;
  let shiftService: jest.Mocked<ShiftService>;

  const userId = new Types.ObjectId();
  const mockRequest = {
    user: { userId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'Jest' },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShiftController],
      providers: [
        {
          provide: ShiftService,
          useValue: {
            create: jest.fn(),
            list: jest.fn(),
            getById: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            assignShift: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ShiftController>(ShiftController);
    shiftService = module.get(ShiftService);
  });

  describe('createShift', () => {
    it('should call shiftService.create and wrap response', async () => {
      const mockResult = { id: '1', name: 'General' } as any;
      shiftService.create.mockResolvedValue(mockResult);

      const result = await controller.createShift(
        {
          name: 'General',
          code: 'GEN',
          startTime: '09:00',
          endTime: '18:00',
        },
        mockRequest,
      );

      expect(shiftService.create).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('listShifts', () => {
    it('should call shiftService.list and wrap response', async () => {
      const mockShifts = [{ id: '1', name: 'General', code: 'GEN' } as any];
      shiftService.list.mockResolvedValue(mockShifts);

      const result = await controller.listShifts({});

      expect(shiftService.list).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: true, data: mockShifts });
    });
  });

  describe('getShiftById', () => {
    it('should call shiftService.getById and wrap response', async () => {
      const mockShift = { id: '1', name: 'General' } as any;
      shiftService.getById.mockResolvedValue(mockShift);

      const id = new Types.ObjectId();
      const result = await controller.getShiftById(id);

      expect(shiftService.getById).toHaveBeenCalledWith(id);
      expect(result).toEqual({ success: true, data: mockShift });
    });
  });

  describe('updateShift', () => {
    it('should call shiftService.update and wrap response', async () => {
      const mockShift = { id: '1', name: 'General Updated' } as any;
      shiftService.update.mockResolvedValue(mockShift);

      const id = new Types.ObjectId();
      const result = await controller.updateShift(
        id,
        { name: 'General Updated' },
        mockRequest,
      );

      expect(shiftService.update).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: mockShift });
    });
  });

  describe('deleteShift', () => {
    it('should call shiftService.delete and return success message', async () => {
      shiftService.delete.mockResolvedValue(undefined);

      const id = new Types.ObjectId();
      const result = await controller.deleteShift(id, mockRequest);

      expect(shiftService.delete).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Shift successfully deleted',
      });
    });
  });

  describe('assignShift', () => {
    it('should assign shift to employee and return assignment message', async () => {
      shiftService.assignShift.mockResolvedValue(undefined);

      const result = await controller.assignShift(
        { employeeId: 'emp123', shiftId: 'shift123' },
        mockRequest,
      );

      expect(shiftService.assignShift).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Shift successfully assigned to employee',
      });
    });

    it('should unassign shift from employee when shiftId is null', async () => {
      shiftService.assignShift.mockResolvedValue(undefined);

      const result = await controller.assignShift(
        { employeeId: 'emp123', shiftId: null },
        mockRequest,
      );

      expect(shiftService.assignShift).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Shift successfully unassigned from employee',
      });
    });
  });
});
