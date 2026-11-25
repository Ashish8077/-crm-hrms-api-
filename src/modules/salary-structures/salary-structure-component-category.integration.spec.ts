/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus, ValidationPipe, ValidationError } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SalaryStructuresController } from './salary-structures.controller';
import { SalaryStructuresService } from './services/salary-structures.service';
import {
  CreateSalaryStructureInput,
  SalaryStructureRepository,
} from './repositories/salary-structure.repository';
import { SalaryStructureCalculationService } from './services/salary-structure-calculation.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from './constants/salary-structure.constant';
import {
  SalaryComponent,
  SalaryComponentLean,
} from '../salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { SalaryStructureComponentInputDto } from './dto/salary-structure-component.dto';
import { SalaryStructureLean } from './schemas/salary-structure.schema';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

/**
 * In-memory stateful repository simulating MongoDB SalaryStructure collection
 */
class InMemorySalaryStructureRepository {
  private readonly store = new Map<string, SalaryStructureLean>();

  create(data: CreateSalaryStructureInput): Promise<SalaryStructureLean> {
    const id = new Types.ObjectId();
    const now = new Date();
    const doc: SalaryStructureLean = {
      _id: id,
      name: data.name,
      code: data.code,
      description: data.description ?? null,
      salaryBasis: data.salaryBasis,
      salaryFrequency: data.salaryFrequency,
      salaryAmount: data.salaryAmount,
      components: data.components.map((c) => ({
        componentId: c.componentId,
        calculationType: c.calculationType,
        amount: c.amount ?? null,
        percentage: c.percentage ?? null,
        percentageOf: c.percentageOf ?? null,
      })),
      isActive: data.isActive ?? true,
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    };
    this.store.set(id.toString(), doc);
    return Promise.resolve(doc);
  }

  isDuplicateKeyError(): boolean {
    return false;
  }

  isVersionError(): boolean {
    return false;
  }

  getStore(): Map<string, SalaryStructureLean> {
    return this.store;
  }

  clear(): void {
    this.store.clear();
  }
}

describe('Salary Structure Component Category Handling Integration', () => {
  let controller: SalaryStructuresController;
  let service: SalaryStructuresService;
  let calculationService: SalaryStructureCalculationService;
  let inMemoryRepo: InMemorySalaryStructureRepository;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let validationPipe: ValidationPipe;

  const actorId = new Types.ObjectId();

  const mockRequest = {
    user: { userId: actorId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestIntegrationAgent/1.0' },
  } as unknown as AuthenticatedRequest;

  // 1. Specified Employee PF fixture ID: 6b0441e6e2d518e7f63cb094
  const employeePfComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb094');
  const basicComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb091');

  // Master documents stored in MongoDB SalaryComponent collection
  const mockMasterComponents = new Map<string, SalaryComponentLean>([
    [
      basicComponentId.toString(),
      {
        _id: basicComponentId,
        name: 'Basic Salary',
        code: 'BASIC',
        type: SalaryComponentType.EARNING,
        calculationType: null,
        percentageOf: null,
        isTaxable: true,
        isStatutory: false,
        description: 'Core basic earning',
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    [
      employeePfComponentId.toString(),
      {
        _id: employeePfComponentId,
        name: 'Employee Provident Fund',
        code: 'EMP_PF',
        type: SalaryComponentType.EMPLOYEE_DEDUCTION, // Master is authoritative EMPLOYEE_DEDUCTION
        calculationType: null,
        percentageOf: null,
        isTaxable: false,
        isStatutory: true,
        description: 'Statutory employee PF deduction',
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
  ]);

  let mockSalaryComponentModel: {
    find: jest.Mock;
  };

  beforeAll(async () => {
    inMemoryRepo = new InMemorySalaryStructureRepository();
    calculationService = new SalaryStructureCalculationService(); // Real calculation engine

    mockSalaryComponentModel = {
      find: jest
        .fn()
        .mockImplementation((filter: { _id?: { $in?: Types.ObjectId[] } }) => {
          const ids = filter._id?.$in ?? [];
          const matchingDocs: SalaryComponentLean[] = [];
          for (const id of ids) {
            const doc = mockMasterComponents.get(id.toString());
            if (doc) {
              matchingDocs.push(doc);
            }
          }
          return {
            lean: () => ({
              exec: () => Promise.resolve(matchingDocs),
            }),
          };
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalaryStructuresController],
      providers: [
        SalaryStructuresService,
        {
          provide: SalaryStructureRepository,
          useValue: inMemoryRepo,
        },
        {
          provide: SalaryStructureCalculationService,
          useValue: calculationService,
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

    controller = module.get<SalaryStructuresController>(
      SalaryStructuresController,
    );
    service = module.get<SalaryStructuresService>(SalaryStructuresService);
    auditLogsService = module.get(AuditLogsService);

    // Global ValidationPipe identical to src/main.ts
    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = mapValidationErrors(errors);
        return new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          HttpStatus.BAD_REQUEST,
          details,
        );
      },
    });
  });

  beforeEach(() => {
    inMemoryRepo.clear();
    jest.clearAllMocks();
  });

  describe('Authoritative Master Category Resolution', () => {
    it('TC-INT-CAT-01: Successfully creates Salary Structure and resolves Employee PF category strictly from database master', async () => {
      // Valid creation payload conforming strictly to CreateSalaryStructureDto
      const validPayload = {
        name: 'Engineering Staff Structure',
        code: 'ENG_STAFF_2026',
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 50000,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 5000, // Employee PF Fixed: 5,000
          },
        ],
      };

      // 1. Pass through Global ValidationPipe
      const validatedDto = (await validationPipe.transform(validPayload, {
        type: 'body',
        metatype: CreateSalaryStructureDto,
      })) as CreateSalaryStructureDto;

      // 2. Execute Controller endpoint
      const response = await controller.create(validatedDto, mockRequest);

      // Assertion 1: The Salary Structure creation succeeds when the component exists and is active
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.data.id).toBeDefined();
      expect(response.data.code).toBe('ENG_STAFF_2026');
      expect(response.data.name).toBe('Engineering Staff Structure');
      expect(response.data.isActive).toBe(true);

      // Assertion 2: The component category is resolved from the database master document
      expect(mockSalaryComponentModel.find).toHaveBeenCalledWith({
        _id: { $in: [basicComponentId, employeePfComponentId] },
      });

      // Assertion 3 & 4: Employee PF is treated as EMPLOYEE_DEDUCTION, not as an earning; included in summary.monthly/annual.employeeDeductions
      expect(response.data.summary.monthly.employeeDeductions).toBe(5000);
      expect(response.data.summary.annual.employeeDeductions).toBe(60000);

      // Assertion 5: Employee PF amount is excluded from grossSalary (Gross is strictly Basic 50,000)
      expect(response.data.summary.monthly.grossSalary).toBe(50000);
      expect(response.data.summary.annual.grossSalary).toBe(600000);

      // Assertion 6: Employee PF does not increase totalCtc as an employer contribution
      expect(response.data.summary.monthly.employerContributions).toBe(0);
      expect(response.data.summary.annual.employerContributions).toBe(0);
      expect(response.data.summary.monthly.totalCtc).toBe(50000); // CTC remains 50,000; not 55,000
      expect(response.data.summary.annual.totalCtc).toBe(600000);

      // Estimated net salary correctly reflects Gross (50,000) - Deductions (5,000) = 45,000
      expect(response.data.summary.monthly.estimatedNetSalary).toBe(45000);
      expect(response.data.summary.annual.estimatedNetSalary).toBe(540000);

      // Verify no duplicate fields at summary root
      const rawSummary = response.data.summary as unknown as Record<
        string,
        unknown
      >;
      expect(rawSummary.grossSalary).toBeUndefined();
      expect(rawSummary.totalCtc).toBeUndefined();
      expect(rawSummary.employeeDeductions).toBeUndefined();

      // Assertion 7: The persisted Salary Structure references the correct component ID and calculation configuration
      const persistedStructures = Array.from(inMemoryRepo.getStore().values());
      expect(persistedStructures).toHaveLength(1);

      const persisted = persistedStructures[0];
      expect(persisted.code).toBe('ENG_STAFF_2026');
      expect(persisted.components).toHaveLength(2);

      const persistedPfComponent = persisted.components.find(
        (c) => c.componentId.toString() === employeePfComponentId.toString(),
      );
      expect(persistedPfComponent).toBeDefined();
      expect(persistedPfComponent?.calculationType).toBe(
        StructureComponentCalculationType.FIXED,
      );
      expect(persistedPfComponent?.amount).toBe(5000);
      expect(persistedPfComponent?.percentage).toBeNull();
      expect(persistedPfComponent?.percentageOf).toBeNull();
      // Ensure no category field is persisted on the structure component subdocument
      expect(
        (persistedPfComponent as unknown as Record<string, unknown>).category,
      ).toBeUndefined();
    });
  });

  describe('Security & Validation Check: Whitelist Enforcement', () => {
    it('TC-INT-CAT-02: Rejects client request with HTTP 400 when unexpected "category" field is sent, persisting no document', async () => {
      // Malicious or misconfigured payload where client attempts to inject "category: EARNING"
      const maliciousPayload = {
        name: 'Malicious Category Override Structure',
        code: 'MAL_OVERRIDE_01',
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 50000,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 5000,
            category: 'EARNING', // Client attempts to override category to EARNING
          },
        ],
      };

      // ValidationPipe must reject non-whitelisted property "category"
      await expect(
        validationPipe.transform(maliciousPayload, {
          type: 'body',
          metatype: CreateSalaryStructureDto,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      // Verify no Salary Structure document was created
      expect(inMemoryRepo.getStore().size).toBe(0);
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('TC-INT-CAT-03: Rejects client request with HTTP 400 when unexpected "type" field is sent, persisting no document', async () => {
      // Malicious or misconfigured payload where client attempts to inject "type: EARNING"
      const maliciousPayload = {
        name: 'Malicious Type Override Structure',
        code: 'MAL_OVERRIDE_02',
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 50000,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 5000,
            type: 'EARNING', // Client attempts to override type to EARNING
          },
        ],
      };

      // ValidationPipe must reject non-whitelisted property "type"
      await expect(
        validationPipe.transform(maliciousPayload, {
          type: 'body',
          metatype: CreateSalaryStructureDto,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      // Verify no Salary Structure document was created
      expect(inMemoryRepo.getStore().size).toBe(0);
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('TC-INT-CAT-04: Defense-in-depth: Backend service ignores client category if bypassed, always resolving from master', async () => {
      // Simulate raw DTO that somehow bypassed HTTP validation
      const bypassedDto = {
        name: 'Direct Bypassed DTO Structure',
        code: 'BYPASS_DIRECT_01',
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 50000,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 5000,
            category: 'EARNING', // Client attempted override
          } as unknown as SalaryStructureComponentInputDto,
        ],
      };

      const result = await service.create(bypassedDto, actorId);

      // Backend derives category strictly from database master, completely ignoring client's "category: EARNING"
      expect(result.summary.monthly.employeeDeductions).toBe(5000);
      expect(result.summary.monthly.grossSalary).toBe(50000);
      expect(result.summary.monthly.employerContributions).toBe(0);
      expect(result.summary.monthly.totalCtc).toBe(50000);
      expect(result.summary.monthly.estimatedNetSalary).toBe(45000);
      expect(result.summary.annual.employeeDeductions).toBe(60000);
      expect(result.summary.annual.grossSalary).toBe(600000);
    });
  });
});
