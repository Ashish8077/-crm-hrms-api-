/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { SalaryComponentsService } from './salary-components.service';
import { SalaryComponentRepository } from '../repositories/salary-component.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
} from '../constants/salary-component.constant';
import { ErrorCode } from '../../../common/errors/error-codes';
import { SalaryComponentMapperInput } from '../mappers/salary-component.mapper';
import { ClientMetadata } from '../../../common/types/client-metadata.type';

describe('SalaryComponentsService', () => {
  let service: SalaryComponentsService;
  let repository: jest.Mocked<SalaryComponentRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const actorId = new Types.ObjectId();
  const componentId = new Types.ObjectId();
  const clientMetadata: ClientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'JestTestAgent/1.0',
  };

  const mockBasicSalaryComponent: SalaryComponentMapperInput = {
    _id: componentId,
    name: 'Basic Salary',
    code: 'BASIC',
    type: SalaryComponentType.EARNING,
    calculationType: SalaryComponentCalculationType.FIXED,
    percentageOf: null,
    isTaxable: true,
    isStatutory: false,
    description: 'Base salary component',
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const mockHraComponent: SalaryComponentMapperInput = {
    _id: new Types.ObjectId(),
    name: 'House Rent Allowance',
    code: 'HRA',
    type: SalaryComponentType.EARNING,
    calculationType: SalaryComponentCalculationType.PERCENTAGE,
    percentageOf: SalaryComponentPercentageBasis.BASIC,
    isTaxable: true,
    isStatutory: false,
    description: 'HRA component calculated on Basic',
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const mockGratuityComponent: SalaryComponentMapperInput = {
    _id: new Types.ObjectId(),
    name: 'Gratuity Provision',
    code: 'GRATUITY',
    type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
    calculationType: null,
    percentageOf: null,
    isTaxable: false,
    isStatutory: true,
    description: 'Estimated monthly employer gratuity provision',
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryComponentsService,
        {
          provide: SalaryComponentRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByCode: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
            updateStatus: jest.fn(),
            isDuplicateKeyError: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<SalaryComponentsService>(SalaryComponentsService);
    repository = module.get(SalaryComponentRepository);
    auditLogsService = module.get(AuditLogsService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('TC-SC-01: Successfully creates a valid FIXED earning component', async () => {
      repository.create.mockResolvedValue(mockBasicSalaryComponent);

      const result = await service.create(
        {
          name: 'Basic Salary',
          code: 'basic',
          type: SalaryComponentType.EARNING,
          calculationType: SalaryComponentCalculationType.FIXED,
          isTaxable: true,
        },
        actorId,
        clientMetadata,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(componentId.toString());
      expect(result.code).toBe('BASIC');
      expect(result.calculationType).toBe(SalaryComponentCalculationType.FIXED);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'BASIC',
          name: 'Basic Salary',
          createdBy: actorId,
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('TC-SC-02: Successfully creates a valid PERCENTAGE deduction component with valid percentageOf', async () => {
      const mockPf: SalaryComponentMapperInput = {
        _id: new Types.ObjectId(),
        name: 'Provident Fund',
        code: 'PF',
        type: SalaryComponentType.DEDUCTION,
        calculationType: SalaryComponentCalculationType.PERCENTAGE,
        percentageOf: SalaryComponentPercentageBasis.BASIC,
        isTaxable: false,
        isStatutory: true,
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      };

      repository.create.mockResolvedValue(mockPf);

      const result = await service.create(
        {
          name: 'Provident Fund',
          code: 'PF',
          type: SalaryComponentType.DEDUCTION,
          calculationType: SalaryComponentCalculationType.PERCENTAGE,
          percentageOf: SalaryComponentPercentageBasis.BASIC,
          isStatutory: true,
        },
        actorId,
        clientMetadata,
      );

      expect(result.code).toBe('PF');
      expect(result.percentageOf).toBe(SalaryComponentPercentageBasis.BASIC);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          percentageOf: SalaryComponentPercentageBasis.BASIC,
        }),
      );
    });

    it('TC-SC-03: Rejects creation of FIXED component when percentageOf is provided', async () => {
      await expect(
        service.create(
          {
            name: 'Special Allowance',
            code: 'SA',
            type: SalaryComponentType.EARNING,
            calculationType: SalaryComponentCalculationType.FIXED,
            percentageOf: SalaryComponentPercentageBasis.BASIC,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SC-04: Rejects creation of PERCENTAGE component when percentageOf is missing or invalid', async () => {
      await expect(
        service.create(
          {
            name: 'ESI',
            code: 'ESI',
            type: SalaryComponentType.DEDUCTION,
            calculationType: SalaryComponentCalculationType.PERCENTAGE,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SC-05: Safely catches MongoDB duplicate-key race (E11000) and throws HTTP 409 Conflict', async () => {
      const duplicateError = new Error('E11000 duplicate key error collection');
      repository.findByCode.mockResolvedValue(null);
      repository.create.mockRejectedValue(duplicateError);
      repository.isDuplicateKeyError.mockReturnValue(true);

      await expect(
        service.create(
          {
            name: 'Basic Salary',
            code: 'BASIC',
            type: SalaryComponentType.EARNING,
            calculationType: SalaryComponentCalculationType.FIXED,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('TC-SC-GRATUITY-01: Successfully creates valid GRATUITY employer contribution and forces isStatutory: true', async () => {
      repository.findByCode.mockResolvedValue(null);
      repository.create.mockResolvedValue(mockGratuityComponent);

      const result = await service.create(
        {
          name: 'Gratuity Provision',
          code: 'gratuity',
          type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        },
        actorId,
        clientMetadata,
      );

      expect(result.code).toBe('GRATUITY');
      expect(result.type).toBe(SalaryComponentType.EMPLOYER_CONTRIBUTION);
      expect(result.isStatutory).toBe(true);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'GRATUITY',
          type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
          isStatutory: true,
        }),
      );
    });

    it('TC-SC-GRATUITY-02: Rejects GRATUITY creation when classified as EARNING', async () => {
      await expect(
        service.create(
          {
            name: 'Gratuity Provision',
            code: 'GRATUITY',
            type: SalaryComponentType.EARNING,
            isStatutory: true,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SC-GRATUITY-03: Rejects GRATUITY creation when classified as EMPLOYEE_DEDUCTION', async () => {
      await expect(
        service.create(
          {
            name: 'Gratuity Provision',
            code: 'Gratuity',
            type: SalaryComponentType.EMPLOYEE_DEDUCTION,
            isStatutory: true,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SC-GRATUITY-04: Rejects GRATUITY creation when isStatutory is explicitly false', async () => {
      await expect(
        service.create(
          {
            name: 'Gratuity Provision',
            code: 'GRATUITY',
            type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
            isStatutory: false,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SC-GRATUITY-05: Throws 409 Conflict if component code already exists', async () => {
      repository.findByCode.mockResolvedValue(mockGratuityComponent);

      await expect(
        service.create(
          {
            name: 'Gratuity Provision',
            code: 'GRATUITY',
            type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
            isStatutory: true,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  describe('list', () => {
    it('TC-SC-06: Returns paginated salary components with meta', async () => {
      repository.findList.mockResolvedValue({
        data: [mockBasicSalaryComponent, mockHraComponent],
        meta: {
          total: 2,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.list({ page: 1, limit: 20 });

      expect(result.data.length).toBe(2);
      expect(result.data[0].id).toBe(componentId.toString());
      expect(result.meta.total).toBe(2);
      expect(repository.findList).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });
  });

  describe('getById', () => {
    it('TC-SC-07: Returns component details for existing ID', async () => {
      repository.findById.mockResolvedValue(mockBasicSalaryComponent);

      const result = await service.getById(componentId);

      expect(result).toBeDefined();
      expect(result.id).toBe(componentId.toString());
      expect(result.name).toBe('Basic Salary');
    });

    it('TC-SC-08: Throws RESOURCE_NOT_FOUND (404) for non-existing ID', async () => {
      repository.findById.mockResolvedValue(null);

      const nonExistentId = new Types.ObjectId();
      await expect(service.getById(nonExistentId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('update', () => {
    it('TC-SC-09: Successfully applies partial updates and creates audit log', async () => {
      repository.findById.mockResolvedValue(mockBasicSalaryComponent);

      const updatedComponent: SalaryComponentMapperInput = {
        ...mockBasicSalaryComponent,
        name: 'Updated Basic Salary',
        description: 'Updated description',
      };
      repository.updateById.mockResolvedValue(updatedComponent);

      const result = await service.update(
        componentId,
        {
          name: 'Updated Basic Salary',
          description: 'Updated description',
        },
        actorId,
        clientMetadata,
      );

      expect(result.name).toBe('Updated Basic Salary');
      expect(repository.updateById).toHaveBeenCalledWith(
        componentId,
        expect.objectContaining({
          name: 'Updated Basic Salary',
          updatedBy: actorId,
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('TC-SC-10: Catches duplicate key error on code update and throws HTTP 409 Conflict', async () => {
      repository.findById.mockResolvedValue(mockBasicSalaryComponent);
      const duplicateError = new Error('E11000 duplicate key');
      repository.updateById.mockRejectedValue(duplicateError);
      repository.isDuplicateKeyError.mockReturnValue(true);

      await expect(
        service.update(componentId, { code: 'HRA' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('TC-SC-11: Rejects updating calculationType to FIXED if percentageOf is provided', async () => {
      repository.findById.mockResolvedValue(mockHraComponent);

      await expect(
        service.update(
          componentId,
          {
            calculationType: SalaryComponentCalculationType.FIXED,
            percentageOf: SalaryComponentPercentageBasis.BASIC,
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('TC-SC-12: Throws 404 when updating non-existent salary component', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(new Types.ObjectId(), { name: 'Non Existent' }, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('TC-SC-GRATUITY-06: Prevents updating existing GRATUITY component to EARNING or EMPLOYEE_DEDUCTION', async () => {
      repository.findById.mockResolvedValue(mockGratuityComponent);

      await expect(
        service.update(
          mockGratuityComponent._id,
          { type: SalaryComponentType.EARNING },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      await expect(
        service.update(
          mockGratuityComponent._id,
          { type: SalaryComponentType.EMPLOYEE_DEDUCTION },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.updateById).not.toHaveBeenCalled();
    });

    it('TC-SC-GRATUITY-07: Prevents updating existing GRATUITY component isStatutory to false', async () => {
      repository.findById.mockResolvedValue(mockGratuityComponent);

      await expect(
        service.update(
          mockGratuityComponent._id,
          { isStatutory: false },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.updateById).not.toHaveBeenCalled();
    });

    it('TC-SC-GRATUITY-08: Prevents renaming another component to GRATUITY when its effective type is EARNING', async () => {
      repository.findById.mockResolvedValue(mockBasicSalaryComponent);

      await expect(
        service.update(
          mockBasicSalaryComponent._id,
          { code: 'gratuity' },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.updateById).not.toHaveBeenCalled();
    });

    it('TC-SC-GRATUITY-09: Successfully updates GRATUITY component name or description while preserving statutory compliance', async () => {
      repository.findById.mockResolvedValue(mockGratuityComponent);
      const updatedGratuity = {
        ...mockGratuityComponent,
        name: 'Updated Gratuity Provision',
      };
      repository.updateById.mockResolvedValue(updatedGratuity);

      const result = await service.update(
        mockGratuityComponent._id,
        { name: 'Updated Gratuity Provision' },
        actorId,
      );

      expect(result.name).toBe('Updated Gratuity Provision');
      expect(repository.updateById).toHaveBeenCalledWith(
        mockGratuityComponent._id,
        expect.objectContaining({
          name: 'Updated Gratuity Provision',
          isStatutory: true,
        }),
      );
    });
  });

  describe('ensureGratuityComponent', () => {
    it('TC-SC-GRATUITY-10: Returns existing GRATUITY component without duplicate creation', async () => {
      repository.findByCode.mockResolvedValue(mockGratuityComponent);

      const result = await service.ensureGratuityComponent(actorId);

      expect(result.code).toBe('GRATUITY');
      expect(result.type).toBe(SalaryComponentType.EMPLOYER_CONTRIBUTION);
      expect(result.isStatutory).toBe(true);
      expect(repository.findByCode).toHaveBeenCalledWith('GRATUITY');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SC-GRATUITY-11: Creates GRATUITY component with authoritative metadata if absent', async () => {
      repository.findByCode.mockResolvedValue(null);
      repository.create.mockResolvedValue(mockGratuityComponent);

      const result = await service.ensureGratuityComponent(actorId);

      expect(result.code).toBe('GRATUITY');
      expect(result.type).toBe(SalaryComponentType.EMPLOYER_CONTRIBUTION);
      expect(result.isStatutory).toBe(true);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'GRATUITY',
          type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
          isStatutory: true,
        }),
      );
    });
  });

  describe('updateStatus', () => {
    it('TC-SC-13: Successfully deactivates an active salary component', async () => {
      repository.findById.mockResolvedValue(mockBasicSalaryComponent);

      const deactivated: SalaryComponentMapperInput = {
        ...mockBasicSalaryComponent,
        isActive: false,
      };
      repository.updateStatus.mockResolvedValue(deactivated);

      const result = await service.updateStatus(
        componentId,
        { isActive: false },
        actorId,
        clientMetadata,
      );

      expect(result.isActive).toBe(false);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        componentId,
        false,
        actorId,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('TC-SC-14: Returns existing record idempotently without redundant update if status is unchanged', async () => {
      repository.findById.mockResolvedValue(mockBasicSalaryComponent);

      const result = await service.updateStatus(
        componentId,
        { isActive: true },
        actorId,
      );

      expect(result.isActive).toBe(true);
      expect(repository.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('TC-SC-15: Throws 404 when updating status of non-existent salary component', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          new Types.ObjectId(),
          { isActive: false },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });
  });
});
