/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { SalaryStructuresController } from './salary-structures.controller';
import { SalaryStructuresService } from './services/salary-structures.service';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from './constants/salary-structure.constant';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  SalaryStructureCreateResponseDto,
  SalaryStructureDetailResponseDto,
  SalaryStructureListItemResponseDto,
} from './dto/salary-structure-response.dto';

describe('SalaryStructuresController', () => {
  let controller: SalaryStructuresController;
  let reflector: Reflector;

  const mockService = {
    create: jest.fn(),
    calculatePreview: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
  };

  const actorId = new Types.ObjectId();
  const structureId = new Types.ObjectId();
  const componentId = new Types.ObjectId();

  const mockRequest = {
    user: { userId: actorId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestClient/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockCreateResponseData: SalaryStructureCreateResponseDto = {
    id: structureId.toString(),
    name: 'Standard CTC L2',
    code: 'STD_CTC_L2',
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 50000,
    isActive: true,
    version: 0,
    summary: {
      monthly: {
        grossSalary: 50000,
        employerContributions: 0,
        totalCtc: 50000,
        employeeDeductions: 0,
        estimatedNetSalary: 50000,
      },
      annual: {
        grossSalary: 600000,
        employerContributions: 0,
        totalCtc: 600000,
        employeeDeductions: 0,
        estimatedNetSalary: 600000,
      },
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const mockDetailResponseData: SalaryStructureDetailResponseDto = {
    id: structureId.toString(),
    name: 'Standard CTC L2',
    code: 'STD_CTC_L2',
    description: 'Standard compensation template',
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 50000,
    components: [
      {
        componentId: componentId.toString(),
        name: 'Basic Salary',
        code: 'BASIC',
        type: SalaryComponentType.EARNING,
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 50000,
        monthlyAmount: 50000,
        annualAmount: 600000,
      },
    ],
    summary: {
      monthly: {
        grossSalary: 50000,
        totalEmployeeDeductions: 0,
        totalEmployerContributions: 0,
        totalCtc: 50000,
        estimatedNetSalary: 50000,
      },
      annual: {
        grossSalary: 600000,
        totalEmployeeDeductions: 0,
        totalEmployerContributions: 0,
        totalCtc: 600000,
        estimatedNetSalary: 600000,
      },
    },
    isActive: true,
    version: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const mockListItemData: SalaryStructureListItemResponseDto = {
    id: structureId.toString(),
    name: 'Standard CTC L2',
    code: 'STD_CTC_L2',
    description: 'Standard compensation template',
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 50000,
    grossSalary: 50000,
    totalCtc: 50000,
    componentsCount: 1,
    isActive: true,
    version: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalaryStructuresController],
      providers: [
        {
          provide: SalaryStructuresService,
          useValue: mockService,
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<SalaryStructuresController>(
      SalaryStructuresController,
    );
    reflector = module.get<Reflector>(Reflector);

    jest.clearAllMocks();
  });

  describe('Permissions Metadata Verification', () => {
    it('TC-CTRL-01: Verifies correct permissions decorated on all route handlers', () => {
      const createPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.create,
      );
      expect(createPerms).toEqual([PermissionKeys.SALARY_STRUCTURES_CREATE]);

      const calculatePerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.calculatePreview,
      );
      expect(calculatePerms).toEqual([PermissionKeys.SALARY_STRUCTURES_VIEW]);

      const listPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.list,
      );
      expect(listPerms).toEqual([PermissionKeys.SALARY_STRUCTURES_VIEW]);

      const getByIdPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.getById,
      );
      expect(getByIdPerms).toEqual([PermissionKeys.SALARY_STRUCTURES_VIEW]);

      const updatePerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.update,
      );
      expect(updatePerms).toEqual([PermissionKeys.SALARY_STRUCTURES_EDIT]);

      const updateStatusPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.updateStatus,
      );
      expect(updateStatusPerms).toEqual([
        PermissionKeys.SALARY_STRUCTURES_EDIT,
      ]);
    });
  });

  describe('POST /salary-structures', () => {
    it('TC-CTRL-02: Delegates creation to service and returns concise wrapped response', async () => {
      const dto = {
        name: 'Standard CTC L2',
        code: 'STD_CTC_L2',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: componentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
        ],
      };

      mockService.create.mockResolvedValue(mockCreateResponseData);

      const result = await controller.create(dto, mockRequest);

      expect(mockService.create).toHaveBeenCalledWith(
        dto,
        actorId,
        expect.objectContaining({
          ipAddress: '127.0.0.1',
          userAgent: 'JestClient/1.0',
        }),
      );
      expect(result).toEqual({ success: true, data: mockCreateResponseData });
      expect(
        (result.data as unknown as Record<string, unknown>).components,
      ).toBeUndefined();
      expect(result.data.summary).toBeDefined();
      expect(result.data.summary.monthly.grossSalary).toBe(50000);
      expect(result.data.summary.annual.grossSalary).toBe(600000);
    });
  });

  describe('POST /salary-structures/calculate', () => {
    it('TC-CTRL-03: Delegates preview calculation to service and returns breakup', async () => {
      const dto = {
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [],
      };

      const mockBreakup = { grossSalaryMonthly: 50000 } as any;
      mockService.calculatePreview.mockResolvedValue(mockBreakup);

      const result = await controller.calculatePreview(dto);

      expect(mockService.calculatePreview).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ success: true, data: mockBreakup });
    });
  });

  describe('GET /salary-structures', () => {
    it('TC-CTRL-04: Delegates listing query to service and returns paginated data', async () => {
      const query = { page: 1, limit: 10 };
      const paginatedResult = {
        data: [mockListItemData],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as any;

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

  describe('GET /salary-structures/:id', () => {
    it('TC-CTRL-05: Delegates getById to service and returns details', async () => {
      mockService.getById.mockResolvedValue(mockDetailResponseData);

      const result = await controller.getById(structureId);

      expect(mockService.getById).toHaveBeenCalledWith(structureId);
      expect(result).toEqual({ success: true, data: mockDetailResponseData });
      expect(result.data.components).toHaveLength(1);
      expect(result.data.summary.monthly.grossSalary).toBe(50000);
    });
  });

  describe('PATCH /salary-structures/:id', () => {
    it('TC-CTRL-06: Delegates update to service with audit metadata', async () => {
      const updateDto = { salaryAmount: 55000, version: 0 };
      const updatedMock = { ...mockDetailResponseData, salaryAmount: 55000 };
      mockService.update.mockResolvedValue(updatedMock);

      const result = await controller.update(
        structureId,
        updateDto,
        mockRequest,
      );

      expect(mockService.update).toHaveBeenCalledWith(
        structureId,
        updateDto,
        actorId,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
      expect(result).toEqual({ success: true, data: updatedMock });
    });
  });

  describe('PATCH /salary-structures/:id/status', () => {
    it('TC-CTRL-07: Delegates status update to service with audit metadata', async () => {
      const statusDto = { isActive: false };
      const statusMock = { ...mockDetailResponseData, isActive: false };
      mockService.updateStatus.mockResolvedValue(statusMock);

      const result = await controller.updateStatus(
        structureId,
        statusDto,
        mockRequest,
      );

      expect(mockService.updateStatus).toHaveBeenCalledWith(
        structureId,
        statusDto,
        actorId,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
      expect(result).toEqual({ success: true, data: statusMock });
    });
  });
});
