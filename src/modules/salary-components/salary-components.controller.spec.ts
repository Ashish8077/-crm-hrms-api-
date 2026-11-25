/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { SalaryComponentsController } from './salary-components.controller';
import { SalaryComponentsService } from './services/salary-components.service';
import {
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
} from './constants/salary-component.constant';
import { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';

describe('SalaryComponentsController', () => {
  let controller: SalaryComponentsController;
  let reflector: Reflector;

  const mockService = {
    create: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
  };

  const actorId = new Types.ObjectId();
  const componentId = new Types.ObjectId();

  const mockRequest = {
    user: { userId: actorId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestClient/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockResponseData = {
    id: componentId.toString(),
    name: 'Basic Salary',
    code: 'BASIC',
    type: SalaryComponentType.EARNING,
    calculationType: SalaryComponentCalculationType.FIXED,
    percentageOf: null,
    isTaxable: true,
    isStatutory: false,
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalaryComponentsController],
      providers: [
        {
          provide: SalaryComponentsService,
          useValue: mockService,
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<SalaryComponentsController>(
      SalaryComponentsController,
    );
    reflector = module.get<Reflector>(Reflector);

    jest.clearAllMocks();
  });

  describe('Permissions Metadata Verification', () => {
    it('TC-SC-CTRL-01: Verifies correct permissions decorated on all route handlers', () => {
      const createPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.create,
      );
      expect(createPerms).toEqual([PermissionKeys.SALARY_COMPONENTS_CREATE]);

      const listPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.list,
      );
      expect(listPerms).toEqual([PermissionKeys.SALARY_COMPONENTS_VIEW]);

      const getByIdPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.getById,
      );
      expect(getByIdPerms).toEqual([PermissionKeys.SALARY_COMPONENTS_VIEW]);

      const updatePerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.update,
      );
      expect(updatePerms).toEqual([PermissionKeys.SALARY_COMPONENTS_EDIT]);

      const updateStatusPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.updateStatus,
      );
      expect(updateStatusPerms).toEqual([
        PermissionKeys.SALARY_COMPONENTS_EDIT,
      ]);
    });
  });

  describe('POST /salary-components', () => {
    it('TC-SC-CTRL-02: Delegates creation to service and returns wrapped response', async () => {
      const dto = {
        name: 'Basic Salary',
        code: 'BASIC',
        type: SalaryComponentType.EARNING,
        calculationType: SalaryComponentCalculationType.FIXED,
      };

      mockService.create.mockResolvedValue(mockResponseData);

      const result = await controller.create(dto, mockRequest);

      expect(mockService.create).toHaveBeenCalledWith(
        dto,
        actorId,
        expect.objectContaining({
          ipAddress: '127.0.0.1',
          userAgent: 'JestClient/1.0',
        }),
      );
      expect(result).toEqual({ success: true, data: mockResponseData });
    });
  });

  describe('GET /salary-components', () => {
    it('TC-SC-CTRL-03: Delegates listing query to service and returns data with pagination meta', async () => {
      const query = { page: 1, limit: 10, isActive: true };
      const paginatedResult = {
        data: [mockResponseData],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };

      mockService.list.mockResolvedValue(paginatedResult);

      const result = await controller.list(query);

      expect(mockService.list).toHaveBeenCalledWith(query);
      expect(result).toEqual({
        success: true,
        data: paginatedResult.data,
        meta: paginatedResult.meta,
      });
    });
  });

  describe('GET /salary-components/:id', () => {
    it('TC-SC-CTRL-04: Delegates getById to service and returns single component', async () => {
      mockService.getById.mockResolvedValue(mockResponseData);

      const result = await controller.getById(componentId);

      expect(mockService.getById).toHaveBeenCalledWith(componentId);
      expect(result).toEqual({ success: true, data: mockResponseData });
    });
  });

  describe('PATCH /salary-components/:id', () => {
    it('TC-SC-CTRL-05: Delegates update to service with actor and client metadata', async () => {
      const dto = {
        name: 'Updated Name',
        percentageOf: SalaryComponentPercentageBasis.BASIC,
      };
      mockService.update.mockResolvedValue(mockResponseData);

      const result = await controller.update(componentId, dto, mockRequest);

      expect(mockService.update).toHaveBeenCalledWith(
        componentId,
        dto,
        actorId,
        expect.objectContaining({
          ipAddress: '127.0.0.1',
          userAgent: 'JestClient/1.0',
        }),
      );
      expect(result).toEqual({ success: true, data: mockResponseData });
    });
  });

  describe('PATCH /salary-components/:id/status', () => {
    it('TC-SC-CTRL-06: Delegates status update to service', async () => {
      const dto = { isActive: false };
      mockService.updateStatus.mockResolvedValue({
        ...mockResponseData,
        isActive: false,
      });

      const result = await controller.updateStatus(
        componentId,
        dto,
        mockRequest,
      );

      expect(mockService.updateStatus).toHaveBeenCalledWith(
        componentId,
        dto,
        actorId,
        expect.objectContaining({
          ipAddress: '127.0.0.1',
          userAgent: 'JestClient/1.0',
        }),
      );
      expect(result).toEqual({
        success: true,
        data: { ...mockResponseData, isActive: false },
      });
    });
  });
});
