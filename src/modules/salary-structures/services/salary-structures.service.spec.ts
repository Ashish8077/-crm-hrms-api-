/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SalaryStructuresService } from './salary-structures.service';
import { SalaryStructureRepository } from '../repositories/salary-structure.repository';
import { SalaryStructureCalculationService } from './salary-structure-calculation.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../constants/salary-structure.constant';
import { SalaryComponent } from '../../salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { ErrorCode } from '../../../common/errors/error-codes';
import { SalaryStructureLean } from '../schemas/salary-structure.schema';

describe('SalaryStructuresService', () => {
  let service: SalaryStructuresService;
  let repository: jest.Mocked<SalaryStructureRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let mockSalaryComponentModel: any;

  const actorId = new Types.ObjectId();
  const structureId = new Types.ObjectId();
  const basicId = new Types.ObjectId();

  const mockActiveBasicComponent = {
    _id: basicId,
    name: 'Basic Salary',
    code: 'BASIC',
    type: SalaryComponentType.EARNING,
    isActive: true,
  };

  const mockLeanStructure: SalaryStructureLean = {
    _id: structureId,
    name: 'Standard CTC L2',
    code: 'STD_CTC_L2',
    description: 'Template',
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 50000,
    components: [
      {
        componentId: basicId,
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 25000,
        percentage: null,
        percentageOf: null,
      },
    ],
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    __v: 0,
  };

  const mockBreakupResult: any = {
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    inputSalaryAmount: 50000,
    grossSalaryMonthly: 50000,
    grossSalaryAnnual: 600000,
    totalEmployerContributionsMonthly: 0,
    totalEmployerContributionsAnnual: 0,
    totalCtcMonthly: 50000,
    totalCtcAnnual: 600000,
    totalEmployeeDeductionsMonthly: 0,
    totalEmployeeDeductionsAnnual: 0,
    estimatedNetSalaryMonthly: 50000,
    estimatedNetSalaryAnnual: 600000,
    earnings: [],
    employeeDeductions: [],
    employerContributions: [],
  };

  beforeEach(async () => {
    mockSalaryComponentModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockActiveBasicComponent]),
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryStructuresService,
        {
          provide: SalaryStructureRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByCode: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
            updateStatus: jest.fn(),
            isDuplicateKeyError: jest.fn().mockReturnValue(false),
            isVersionError: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: SalaryStructureCalculationService,
          useValue: {
            calculate: jest.fn().mockReturnValue(mockBreakupResult),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: mockSalaryComponentModel,
        },
      ],
    }).compile();

    service = module.get<SalaryStructuresService>(SalaryStructuresService);
    repository = module.get(SalaryStructureRepository);
    auditLogsService = module.get(AuditLogsService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('TC-SVC-01: Successfully creates a new salary structure template with audit logging and concise response', async () => {
      repository.create.mockResolvedValue(mockLeanStructure);

      const result = await service.create(
        {
          name: 'Standard CTC L2',
          code: 'std_ctc_l2',
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 50000,
          components: [
            {
              componentId: basicId.toString(),
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 25000,
            },
          ],
        },
        actorId,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(structureId.toString());
      expect(result.code).toBe('STD_CTC_L2');
      expect(result.name).toBe('Standard CTC L2');
      expect(result.salaryBasis).toBe(SalaryStructureBasis.CTC);
      expect(result.salaryFrequency).toBe(SalaryStructureFrequency.MONTHLY);
      expect(result.salaryAmount).toBe(50000);
      expect(result.isActive).toBe(true);
      expect(result.version).toBe(0);
      expect(result.createdAt).toEqual(mockLeanStructure.createdAt);

      // Verify concise summary with explicit monthly and annual breakdowns
      expect(result.summary).toEqual({
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
      });

      // Verify components array and detailed breakup are NOT present in create response
      expect(
        (result as unknown as Record<string, unknown>).components,
      ).toBeUndefined();
      expect(
        (result as unknown as Record<string, unknown>).breakup,
      ).toBeUndefined();

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'STD_CTC_L2',
          name: 'Standard CTC L2',
          createdBy: actorId,
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('TC-SVC-01B: Correctly populates summary using ANNUAL frequency amounts when frequency is ANNUAL', async () => {
      const mockAnnualStructure: SalaryStructureLean = {
        ...mockLeanStructure,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
      };
      repository.create.mockResolvedValue(mockAnnualStructure);

      const result = await service.create(
        {
          name: 'Standard CTC L2 Annual',
          code: 'std_ctc_l2_annual',
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.ANNUAL,
          salaryAmount: 600000,
          components: [
            {
              componentId: basicId.toString(),
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 25000,
            },
          ],
        },
        actorId,
      );

      expect(result.summary).toEqual({
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
      });
      expect(
        (result as unknown as Record<string, unknown>).components,
      ).toBeUndefined();
    });

    it('TC-SVC-02: Rejects creation when referenced component does not exist in master catalog', async () => {
      mockSalaryComponentModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]), // Empty! Component not found
        }),
      });

      await expect(
        service.create(
          {
            name: 'Standard CTC L2',
            code: 'STD_CTC_L2',
            salaryBasis: SalaryStructureBasis.CTC,
            salaryFrequency: SalaryStructureFrequency.MONTHLY,
            salaryAmount: 50000,
            components: [
              {
                componentId: basicId.toString(),
                calculationType: StructureComponentCalculationType.FIXED,
                amount: 25000,
              },
            ],
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SVC-03: Rejects creation when referenced component is inactive', async () => {
      mockSalaryComponentModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue([
              { ...mockActiveBasicComponent, isActive: false },
            ]),
        }),
      });

      await expect(
        service.create(
          {
            name: 'Standard CTC L2',
            code: 'STD_CTC_L2',
            salaryBasis: SalaryStructureBasis.CTC,
            salaryFrequency: SalaryStructureFrequency.MONTHLY,
            salaryAmount: 50000,
            components: [
              {
                componentId: basicId.toString(),
                calculationType: StructureComponentCalculationType.FIXED,
                amount: 25000,
              },
            ],
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SVC-04: Catches duplicate key error and throws HTTP 409 Conflict', async () => {
      repository.create.mockRejectedValue(new Error('E11000'));
      repository.isDuplicateKeyError.mockReturnValue(true);

      await expect(
        service.create(
          {
            name: 'Standard CTC L2',
            code: 'STD_CTC_L2',
            salaryBasis: SalaryStructureBasis.CTC,
            salaryFrequency: SalaryStructureFrequency.MONTHLY,
            salaryAmount: 50000,
            components: [
              {
                componentId: basicId.toString(),
                calculationType: StructureComponentCalculationType.FIXED,
                amount: 25000,
              },
            ],
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  describe('calculatePreview', () => {
    it('TC-SVC-05: Returns preview breakup without saving to repository', async () => {
      const result = await service.calculatePreview({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
        ],
      });

      expect(result).toEqual(mockBreakupResult);
      expect(repository.create).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('TC-SVC-05-DIAG: Excludes diagnostics from response when includeDiagnostics is false', async () => {
      const result = await service.calculatePreview({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
        ],
        includeDiagnostics: false,
      });

      expect(result.diagnostics).toBeUndefined();
      expect(result.grossSalaryMonthly).toBe(
        mockBreakupResult.grossSalaryMonthly,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('TC-SVC-05-DIAG: Excludes diagnostics from response when includeDiagnostics is false', async () => {
      const result = await service.calculatePreview({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
        ],
        includeDiagnostics: false,
      });

      expect(result.diagnostics).toBeUndefined();
      expect(result.grossSalaryMonthly).toBe(
        mockBreakupResult.grossSalaryMonthly,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('TC-SVC-05B: Returns paginated list of lightweight structure responses', async () => {
      const mockPaginated = {
        data: [mockLeanStructure],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      repository.findList.mockResolvedValue(mockPaginated);

      const result = await service.list({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(structureId.toString());
      expect(result.data[0].grossSalary).toBe(50000);
      expect(result.data[0].totalCtc).toBe(50000);
      expect(result.data[0].componentsCount).toBe(
        mockLeanStructure.components.length,
      );
      expect(
        (result.data[0] as unknown as Record<string, unknown>).components,
      ).toBeUndefined();
      expect(result.meta).toEqual(mockPaginated.meta);
    });
  });

  describe('getById', () => {
    it('TC-SVC-06: Returns structure details with breakup for valid ID', async () => {
      repository.findById.mockResolvedValue(mockLeanStructure);

      const result = await service.getById(structureId);

      expect(result).toBeDefined();
      expect(result.id).toBe(structureId.toString());
      expect(result.summary).toBeDefined();
      expect(result.components).toHaveLength(
        mockLeanStructure.components.length,
      );
      expect(
        (result as unknown as Record<string, unknown>).breakup,
      ).toBeUndefined();
    });

    it('TC-SVC-07: Throws 404 when salary structure is not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById(new Types.ObjectId())).rejects.toMatchObject(
        {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          statusCode: HttpStatus.NOT_FOUND,
        },
      );
    });
  });

  describe('update', () => {
    it('TC-SVC-08: Successfully updates structure and recalculates breakup', async () => {
      repository.findById.mockResolvedValue(mockLeanStructure);

      const updatedStructure: SalaryStructureLean = {
        ...mockLeanStructure,
        salaryAmount: 60000,
        __v: 1,
      };
      repository.updateById.mockResolvedValue(updatedStructure);

      const result = await service.update(
        structureId,
        { salaryAmount: 60000, version: 0 },
        actorId,
      );

      expect(result.salaryAmount).toBe(60000);
      expect(result.version).toBe(1);
      expect(repository.updateById).toHaveBeenCalledWith(
        structureId,
        expect.objectContaining({
          salaryAmount: 60000,
          version: 0,
          updatedBy: actorId,
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('TC-SVC-09: Throws 409 Conflict when optimistic concurrency version mismatch occurs', async () => {
      repository.findById.mockResolvedValue(mockLeanStructure);
      repository.updateById.mockResolvedValue(null); // Failed due to version mismatch!

      await expect(
        service.update(
          structureId,
          { salaryAmount: 60000, version: 99 }, // Stale version!
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  describe('updateStatus', () => {
    it('TC-SVC-10: Deactivates an active salary structure template', async () => {
      repository.findById.mockResolvedValue(mockLeanStructure);

      const deactivated: SalaryStructureLean = {
        ...mockLeanStructure,
        isActive: false,
        __v: 1,
      };
      repository.updateStatus.mockResolvedValue(deactivated);

      const result = await service.updateStatus(
        structureId,
        { isActive: false },
        actorId,
      );

      expect(result.isActive).toBe(false);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        structureId,
        false,
        actorId,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('TC-SVC-11: Returns existing structure idempotently without update if status is unchanged', async () => {
      repository.findById.mockResolvedValue(mockLeanStructure);

      const result = await service.updateStatus(
        structureId,
        { isActive: true }, // Already true!
        actorId,
      );

      expect(result.isActive).toBe(true);
      expect(repository.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });
  });
});
