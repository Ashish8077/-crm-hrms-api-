/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollPeriodsService } from './services/payroll-periods.service';
import { PayrollPeriodResponse } from './mappers/payroll-period.mapper';
import { PayrollPeriodStatus } from './constants/payroll-period.constant';
import { PayrollFrequency } from '../payroll-configuration/constants/payroll-configuration.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('PayrollPeriodsController', () => {
  let controller: PayrollPeriodsController;
  let service: jest.Mocked<PayrollPeriodsService>;

  const actorId = new Types.ObjectId();
  const sessionId = new Types.ObjectId();
  const roleId = new Types.ObjectId();
  const periodId = new Types.ObjectId();

  const mockRequest = {
    user: {
      userId: actorId,
      sessionId,
      roleIds: [roleId],
    },
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'JestTestRunner/1.0',
    },
  } as unknown as AuthenticatedRequest;

  const mockResponse: PayrollPeriodResponse = {
    id: periodId.toHexString(),
    periodName: 'April 2026 Payroll',
    periodCode: 'PR-2026-04',
    payrollFrequency: PayrollFrequency.MONTHLY,
    startDate: '2026-04-01T00:00:00.000Z',
    endDate: '2026-04-30T23:59:59.999Z',
    paymentDate: '2026-05-01T00:00:00.000Z',
    month: 4,
    year: 2026,
    status: PayrollPeriodStatus.DRAFT,
    notes: 'Regular cycle',
    createdBy: actorId.toHexString(),
    updatedBy: actorId.toHexString(),
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    version: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollPeriodsController],
      providers: [
        {
          provide: PayrollPeriodsService,
          useValue: {
            create: jest.fn(),
            list: jest.fn(),
            getById: jest.fn(),
            update: jest.fn(),
            updateStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PayrollPeriodsController>(PayrollPeriodsController);
    service = module.get(PayrollPeriodsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should delegate to service with clientMetadata and return wrapped data', async () => {
      service.create.mockResolvedValue(mockResponse);

      const dto = {
        periodName: 'April 2026 Payroll',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        paymentDate: '2026-05-01',
        month: 4,
        year: 2026,
      };

      const result = await controller.create(dto, mockRequest);

      expect(result).toEqual({ success: true, data: mockResponse });
      expect(service.create).toHaveBeenCalledWith(
        dto,
        actorId,
        expect.objectContaining({
          ipAddress: '127.0.0.1',
          userAgent: 'JestTestRunner/1.0',
        }),
      );
    });
  });

  describe('list', () => {
    it('should delegate query parameters to service and return wrapped data and meta', async () => {
      const mockListResult = {
        data: [mockResponse],
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      service.list.mockResolvedValue(mockListResult);

      const query = { year: 2026, month: 4, page: 1, limit: 20 };
      const result = await controller.list(query);

      expect(result).toEqual({
        success: true,
        data: [mockResponse],
        meta: mockListResult.meta,
      });
      expect(service.list).toHaveBeenCalledWith(query);
    });
  });

  describe('getById', () => {
    it('should delegate to service and return wrapped data', async () => {
      service.getById.mockResolvedValue(mockResponse);

      const result = await controller.getById(periodId);

      expect(result).toEqual({ success: true, data: mockResponse });
      expect(service.getById).toHaveBeenCalledWith(periodId);
    });
  });

  describe('update', () => {
    it('should delegate update to service and return wrapped updated data', async () => {
      const updatedResponse = {
        ...mockResponse,
        periodName: 'Updated Period Name',
      };
      service.update.mockResolvedValue(updatedResponse);

      const dto = { periodName: 'Updated Period Name' };
      const result = await controller.update(periodId, dto, mockRequest);

      expect(result).toEqual({ success: true, data: updatedResponse });
      expect(service.update).toHaveBeenCalledWith(
        periodId,
        dto,
        actorId,
        expect.objectContaining({
          ipAddress: '127.0.0.1',
        }),
      );
    });
  });

  describe('updateStatus', () => {
    it('should delegate status update with roleIds to service and return wrapped data', async () => {
      const processingResponse = {
        ...mockResponse,
        status: PayrollPeriodStatus.PROCESSING,
      };
      service.updateStatus.mockResolvedValue(processingResponse);

      const dto = {
        status: PayrollPeriodStatus.PROCESSING,
        reason: 'Initiated run',
      };
      const result = await controller.updateStatus(periodId, dto, mockRequest);

      expect(result).toEqual({ success: true, data: processingResponse });
      expect(service.updateStatus).toHaveBeenCalledWith(
        periodId,
        dto,
        actorId,
        [roleId],
        expect.objectContaining({
          ipAddress: '127.0.0.1',
        }),
      );
    });
  });
});
