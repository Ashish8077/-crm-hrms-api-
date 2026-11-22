/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { WeeklyOffController } from './weekly-off.controller';
import { WeeklyOffService } from './services/weekly-off.service';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('WeeklyOffController', () => {
  let controller: WeeklyOffController;
  let weeklyOffService: jest.Mocked<WeeklyOffService>;

  const userId = new Types.ObjectId();
  const mockRequest = {
    user: { userId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'Jest' },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WeeklyOffController],
      providers: [
        {
          provide: WeeklyOffService,
          useValue: {
            create: jest.fn(),
            list: jest.fn(),
            getById: jest.fn(),
            update: jest.fn(),
            updateStatus: jest.fn(),
            delete: jest.fn(),
            getEffectiveConfig: jest.fn(),
            isWeeklyOff: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<WeeklyOffController>(WeeklyOffController);
    weeklyOffService = module.get(WeeklyOffService);
  });

  describe('createConfig', () => {
    it('should call weeklyOffService.create and wrap response', async () => {
      const mockResult = {
        id: new Types.ObjectId().toString(),
        name: 'Standard Sunday Off',
        days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      } as any;
      weeklyOffService.create.mockResolvedValue(mockResult);

      const result = await controller.createConfig(
        {
          name: 'Standard Sunday Off',
          days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
          effectiveFrom: '2026-01-01',
        },
        mockRequest,
      );

      expect(weeklyOffService.create).toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('listConfigs', () => {
    it('should call weeklyOffService.list and return data and meta', async () => {
      const mockResult = {
        data: [{ id: '1', name: 'Standard Sunday Off' }] as any,
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      weeklyOffService.list.mockResolvedValue(mockResult);

      const result = await controller.listConfigs({ page: 1, limit: 20 });

      expect(weeklyOffService.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
      });
      expect(result).toEqual({
        success: true,
        data: mockResult.data,
        meta: mockResult.meta,
      });
    });
  });

  describe('getEffectiveConfig', () => {
    it('should call weeklyOffService.getEffectiveConfig and wrap response', async () => {
      const mockResult = {
        isWeeklyOff: true,
        date: '2026-10-25',
        source: 'COMPANY_DEFAULT',
        configuration: null,
      } as any;
      weeklyOffService.getEffectiveConfig.mockResolvedValue(mockResult);

      const result = await controller.getEffectiveConfig({
        date: '2026-10-25',
      });

      expect(weeklyOffService.getEffectiveConfig).toHaveBeenCalledWith(
        '2026-10-25',
        undefined,
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('getConfigById', () => {
    it('should call weeklyOffService.getById and wrap response', async () => {
      const id = new Types.ObjectId();
      const mockResult = { id: id.toString(), name: 'Config' } as any;
      weeklyOffService.getById.mockResolvedValue(mockResult);

      const result = await controller.getConfigById(id);

      expect(weeklyOffService.getById).toHaveBeenCalledWith(id);
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('updateConfig', () => {
    it('should call weeklyOffService.update and wrap response', async () => {
      const id = new Types.ObjectId();
      const mockResult = { id: id.toString(), name: 'Updated Config' } as any;
      weeklyOffService.update.mockResolvedValue(mockResult);

      const result = await controller.updateConfig(
        id,
        { name: 'Updated Config' },
        mockRequest,
      );

      expect(weeklyOffService.update).toHaveBeenCalledWith(
        id,
        { name: 'Updated Config' },
        userId,
        { ipAddress: '127.0.0.1', userAgent: 'Jest' },
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('updateStatus', () => {
    it('should call weeklyOffService.updateStatus and wrap response', async () => {
      const id = new Types.ObjectId();
      const mockResult = { id: id.toString(), isActive: false } as any;
      weeklyOffService.updateStatus.mockResolvedValue(mockResult);

      const result = await controller.updateStatus(
        id,
        { isActive: false },
        mockRequest,
      );

      expect(weeklyOffService.updateStatus).toHaveBeenCalledWith(
        id,
        false,
        userId,
        { ipAddress: '127.0.0.1', userAgent: 'Jest' },
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });
  });

  describe('deleteConfig', () => {
    it('should call weeklyOffService.delete and return success message', async () => {
      const id = new Types.ObjectId();
      weeklyOffService.delete.mockResolvedValue(undefined);

      const result = await controller.deleteConfig(id, mockRequest);

      expect(weeklyOffService.delete).toHaveBeenCalledWith(id, userId, {
        ipAddress: '127.0.0.1',
        userAgent: 'Jest',
      });
      expect(result).toEqual({
        success: true,
        message: 'Weekly off configuration successfully deleted',
      });
    });
  });
});
