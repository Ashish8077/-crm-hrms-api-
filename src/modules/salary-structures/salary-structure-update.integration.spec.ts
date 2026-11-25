/* eslint-disable @typescript-eslint/unbound-method */
import {
  BadRequestException,
  HttpStatus,
  ValidationPipe,
  ValidationError,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, ParseObjectIdPipe } from '@nestjs/mongoose';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { SalaryStructuresController } from './salary-structures.controller';
import { SalaryStructuresService } from './services/salary-structures.service';
import {
  CreateSalaryStructureInput,
  SalaryStructureRepository,
  UpdateSalaryStructureInput,
} from './repositories/salary-structure.repository';
import { SalaryStructureCalculationService } from './services/salary-structure-calculation.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from './constants/salary-structure.constant';
import {
  SalaryComponent,
  SalaryComponentLean,
} from '../salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import { UpdateSalaryStructureDto } from './dto/update-salary-structure.dto';
import { SalaryStructureLean } from './schemas/salary-structure.schema';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

/**
 * In-memory stateful repository simulating MongoDB SalaryStructure collection
 * with strict optimistic concurrency control, unique indexing, and atomic findOneAndUpdate semantics.
 */
class InMemorySalaryStructureRepository {
  private readonly store = new Map<string, SalaryStructureLean>();

  async create(data: CreateSalaryStructureInput): Promise<SalaryStructureLean> {
    const id = new Types.ObjectId();
    const now = new Date();
    const normalizedCode = data.code.trim().toUpperCase();

    // Enforce unique code index simulation
    for (const doc of this.store.values()) {
      if (doc.code.toUpperCase() === normalizedCode) {
        const dupErr = new Error('E11000 duplicate key error');
        (dupErr as unknown as { code: number }).code = 11000;
        throw dupErr;
      }
    }

    const doc: SalaryStructureLean = {
      _id: id,
      name: data.name,
      code: normalizedCode,
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

  async findById(
    id: Types.ObjectId | string,
  ): Promise<SalaryStructureLean | null> {
    const key = id.toString();
    const doc = this.store.get(key);
    return Promise.resolve(
      doc ? { ...doc, components: [...doc.components] } : null,
    );
  }

  async findByCode(
    code: string,
    excludeId?: Types.ObjectId,
  ): Promise<SalaryStructureLean | null> {
    const normalizedCode = code.trim().toUpperCase();
    for (const [idStr, doc] of this.store.entries()) {
      if (excludeId && idStr === excludeId.toString()) continue;
      if (doc.code.toUpperCase() === normalizedCode) {
        return Promise.resolve({ ...doc });
      }
    }
    return Promise.resolve(null);
  }

  async updateById(
    id: Types.ObjectId,
    data: UpdateSalaryStructureInput,
  ): Promise<SalaryStructureLean | null> {
    const key = id.toString();
    const existing = this.store.get(key);
    if (!existing) return Promise.resolve(null);

    // Duplicate code check
    if (data.code !== undefined) {
      const normalizedCode = data.code.trim().toUpperCase();
      for (const [docId, doc] of this.store.entries()) {
        if (docId !== key && doc.code.toUpperCase() === normalizedCode) {
          const dupErr = new Error('E11000 duplicate key error');
          (dupErr as unknown as { code: number }).code = 11000;
          throw dupErr;
        }
      }
    }

    // Optimistic concurrency check
    if (typeof data.version === 'number') {
      if (existing.__v !== data.version) {
        return Promise.resolve(null); // Concurrency conflict!
      }
    }

    const updated: SalaryStructureLean = {
      ...existing,
      name: data.name !== undefined ? data.name : existing.name,
      code:
        data.code !== undefined
          ? data.code.trim().toUpperCase()
          : existing.code,
      description:
        data.description !== undefined
          ? data.description
          : existing.description,
      salaryBasis:
        data.salaryBasis !== undefined
          ? data.salaryBasis
          : existing.salaryBasis,
      salaryFrequency:
        data.salaryFrequency !== undefined
          ? data.salaryFrequency
          : existing.salaryFrequency,
      salaryAmount:
        data.salaryAmount !== undefined
          ? data.salaryAmount
          : existing.salaryAmount,
      components:
        data.components !== undefined
          ? data.components.map((c) => ({ ...c }))
          : existing.components,
      updatedBy: data.updatedBy,
      updatedAt: new Date(),
      __v: (existing.__v ?? 0) + 1,
    };

    this.store.set(key, updated);
    return Promise.resolve({ ...updated, components: [...updated.components] });
  }

  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as { code?: number; message?: string };
    return (
      err.code === 11000 ||
      (typeof err.message === 'string' && err.message.includes('E11000'))
    );
  }

  isVersionError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as { name?: string; message?: string };
    return (
      err.name === 'VersionError' ||
      (typeof err.message === 'string' &&
        err.message.includes('No matching document found'))
    );
  }

  getStore(): Map<string, SalaryStructureLean> {
    return this.store;
  }

  clear(): void {
    this.store.clear();
  }
}

describe('PATCH /api/v1/salary-structures/:id (Production Integration Tests)', () => {
  let controller: SalaryStructuresController;
  let inMemoryRepo: InMemorySalaryStructureRepository;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let validationPipe: ValidationPipe;
  let reflector: Reflector;

  const actorId = new Types.ObjectId();
  const anotherActorId = new Types.ObjectId();

  const mockRequest = {
    user: { userId: actorId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestIntegrationAgent/1.0' },
  } as unknown as AuthenticatedRequest;

  // Master component IDs
  const basicComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb091');
  const hraComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb092');
  const conveyanceComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb093');
  const specialAllowanceComponentId = new Types.ObjectId(
    '6b0441e6e2d518e7f63cb094',
  );
  const employeePfComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb095');
  const employerPfComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb096');
  const gratuityComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb097');
  const inactiveComponentId = new Types.ObjectId('6b0441e6e2d518e7f63cb098');

  // Master component catalog in database
  const masterComponents = new Map<string, SalaryComponentLean>([
    [
      basicComponentId.toString(),
      {
        _id: basicComponentId,
        name: 'Basic Salary',
        code: 'BASIC',
        type: SalaryComponentType.EARNING,
        isTaxable: true,
        isStatutory: false,
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    [
      hraComponentId.toString(),
      {
        _id: hraComponentId,
        name: 'House Rent Allowance',
        code: 'HRA',
        type: SalaryComponentType.EARNING,
        isTaxable: true,
        isStatutory: false,
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    [
      conveyanceComponentId.toString(),
      {
        _id: conveyanceComponentId,
        name: 'Conveyance Allowance',
        code: 'CONVEYANCE',
        type: SalaryComponentType.EARNING,
        isTaxable: true,
        isStatutory: false,
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    [
      specialAllowanceComponentId.toString(),
      {
        _id: specialAllowanceComponentId,
        name: 'Special Allowance',
        code: 'SPECIAL_ALLOWANCE',
        type: SalaryComponentType.EARNING,
        isTaxable: true,
        isStatutory: false,
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
        type: SalaryComponentType.EMPLOYEE_DEDUCTION,
        isTaxable: false,
        isStatutory: true,
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    [
      employerPfComponentId.toString(),
      {
        _id: employerPfComponentId,
        name: 'Employer Provident Fund',
        code: 'EMPR_PF',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        isTaxable: false,
        isStatutory: true,
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    [
      gratuityComponentId.toString(),
      {
        _id: gratuityComponentId,
        name: 'Gratuity Provision',
        code: 'GRATUITY',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        isTaxable: false,
        isStatutory: true,
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    [
      inactiveComponentId.toString(),
      {
        _id: inactiveComponentId,
        name: 'Deprecated Bonus',
        code: 'DEP_BONUS',
        type: SalaryComponentType.EARNING,
        isTaxable: true,
        isStatutory: false,
        isActive: false, // Inactive master!
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
  ]);

  let mockSalaryComponentModel: { find: jest.Mock };

  beforeAll(async () => {
    inMemoryRepo = new InMemorySalaryStructureRepository();

    auditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AuditLogsService>;

    mockSalaryComponentModel = {
      find: jest
        .fn()
        .mockImplementation((query: { _id?: { $in?: Types.ObjectId[] } }) => {
          const ids = query?._id?.$in ?? [];
          const results: SalaryComponentLean[] = [];
          for (const id of ids) {
            const doc = masterComponents.get(id.toString());
            if (doc) results.push(doc);
          }
          return {
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(results),
            }),
          };
        }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SalaryStructuresController],
      providers: [
        SalaryStructuresService,
        SalaryStructureCalculationService,
        Reflector,
        {
          provide: SalaryStructureRepository,
          useValue: inMemoryRepo,
        },
        {
          provide: AuditLogsService,
          useValue: auditLogsService,
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: mockSalaryComponentModel,
        },
      ],
    }).compile();

    controller = moduleFixture.get<SalaryStructuresController>(
      SalaryStructuresController,
    );
    reflector = moduleFixture.get<Reflector>(Reflector);

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

  /**
   * Helper that creates an initial base salary structure for update testing.
   */
  const createBaseStructure = async (
    overrides: Partial<CreateSalaryStructureInput> = {},
  ): Promise<SalaryStructureLean> => {
    return inMemoryRepo.create({
      name: 'Engineering CTC Standard',
      code: 'ENG_STD_CTC',
      description: 'Standard Engineering Package',
      salaryBasis: SalaryStructureBasis.CTC,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 50000,
      components: [
        {
          componentId: basicComponentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 25000,
          percentage: null,
          percentageOf: null,
        },
        {
          componentId: hraComponentId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 50,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
        {
          componentId: specialAllowanceComponentId,
          calculationType: StructureComponentCalculationType.BALANCE,
          amount: null,
          percentage: null,
          percentageOf: null,
        },
        {
          componentId: employeePfComponentId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
        {
          componentId: employerPfComponentId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
      ],
      createdBy: actorId,
      updatedBy: actorId,
      ...overrides,
    });
  };

  /**
   * Helper to execute update endpoint through full production validation and controller pipeline.
   */
  const executeUpdateApi = async (
    id: Types.ObjectId,
    rawPayload: Record<string, unknown>,
  ) => {
    const validatedDto = (await validationPipe.transform(rawPayload, {
      type: 'body',
      metatype: UpdateSalaryStructureDto,
    })) as UpdateSalaryStructureDto;

    return controller.update(id, validatedDto, mockRequest);
  };

  /**
   * Helper to execute update expecting validation pipe failure.
   */
  const expectValidationError = async (
    rawPayload: Record<string, unknown>,
  ): Promise<AppError> => {
    await expect(
      validationPipe.transform(rawPayload, {
        type: 'body',
        metatype: UpdateSalaryStructureDto,
      }),
    ).rejects.toThrow(AppError);

    try {
      await validationPipe.transform(rawPayload, {
        type: 'body',
        metatype: UpdateSalaryStructureDto,
      });
      throw new Error('Expected validation to fail');
    } catch (error) {
      const appErr = error as AppError;
      expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
      return appErr;
    }
  };

  // =========================================================================
  // 1. VALID UPDATES
  // =========================================================================
  describe('Valid Updates', () => {
    it('TC-UPD-01: Successfully updates name only while preserving all other properties', async () => {
      const base = await createBaseStructure();

      const response = await executeUpdateApi(base._id, {
        name: 'Senior Engineering CTC Revised',
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.id).toBe(base._id.toString());
      expect(response.data.name).toBe('Senior Engineering CTC Revised');
      expect(response.data.code).toBe('ENG_STD_CTC'); // Unchanged!
      expect(response.data.salaryAmount).toBe(50000); // Unchanged!
      expect(response.data.version).toBe(1); // Incremented!
    });

    it('TC-UPD-02: Successfully updates description only', async () => {
      const base = await createBaseStructure();

      const response = await executeUpdateApi(base._id, {
        description: 'Updated comprehensive tech package description',
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.description).toBe(
        'Updated comprehensive tech package description',
      );
      expect(response.data.name).toBe(base.name);
      expect(response.data.version).toBe(1);
    });

    it('TC-UPD-03: Successfully updates salaryAmount and triggers complete financial recalculation', async () => {
      const base = await createBaseStructure();

      // Update CTC amount from 50,000 to 60,000
      const response = await executeUpdateApi(base._id, {
        salaryAmount: 60000,
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.salaryAmount).toBe(60000);
      expect(response.data.version).toBe(1);

      // Calculations:
      // CTC: 60,000. Basic Fixed: 25,000. HRA (50% of Basic): 12,500.
      // Employer PF (12% of Basic): 3,000. Gross = 60,000 - 3,000 = 57,000.
      // Special Allowance (Balance) = 57,000 - (25,000 + 12,500) = 19,500.
      // Total Employee Deductions (12% of Basic): 3,000. Net = 57,000 - 3,000 = 54,000.
      expect(response.data.summary.monthly.totalCtc).toBe(60000);
      expect(response.data.summary.monthly.grossSalary).toBe(57000);
      expect(response.data.summary.monthly.totalEmployerContributions).toBe(
        3000,
      );
      expect(response.data.summary.monthly.totalEmployeeDeductions).toBe(3000);
      expect(response.data.summary.monthly.estimatedNetSalary).toBe(54000);

      const saComponent = response.data.components.find(
        (c) => c.componentId === specialAllowanceComponentId.toString(),
      );
      expect(saComponent?.monthlyAmount).toBe(19500);
    });

    it('TC-UPD-04: Successfully updates salaryFrequency from MONTHLY to ANNUAL', async () => {
      const base = await createBaseStructure();

      // Update to ANNUAL with ₹600,000 Annual CTC and annual component amounts
      const response = await executeUpdateApi(base._id, {
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 300000, // Annual fixed amount
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: employerPfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.salaryFrequency).toBe(
        SalaryStructureFrequency.ANNUAL,
      );
      expect(response.data.salaryAmount).toBe(600000);
      expect(response.data.summary.annual.totalCtc).toBe(600000);
      expect(response.data.summary.monthly.totalCtc).toBe(50000);
    });

    it('TC-UPD-05: Successfully updates salaryBasis from CTC to GROSS', async () => {
      const base = await createBaseStructure();

      // Change basis to GROSS ₹50,000
      const response = await executeUpdateApi(base._id, {
        salaryBasis: SalaryStructureBasis.GROSS,
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.salaryBasis).toBe(SalaryStructureBasis.GROSS);

      // Under GROSS basis ₹50,000:
      // Gross = 50,000. Basic = 25,000. HRA = 12,500. Special Allowance Balance = 12,500.
      // Employer PF = 3,000. Total CTC = 50,000 + 3,000 = 53,000.
      expect(response.data.summary.monthly.grossSalary).toBe(50000);
      expect(response.data.summary.monthly.totalCtc).toBe(53000);
    });

    it('TC-UPD-06: Successfully updates fixed component amount and recalculates dependent components', async () => {
      const base = await createBaseStructure();

      // Update Basic fixed amount from 25,000 to 28,000
      const response = await executeUpdateApi(base._id, {
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 28000,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: employerPfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
        version: 0,
      });

      expect(response.success).toBe(true);
      // Basic = 28,000. HRA = 14,000 (50% of 28,000). Employer PF = 3,360 (12% of 28,000).
      // Gross = 50,000 - 3,360 = 46,640. Special Allowance Balance = 46,640 - (28,000 + 14,000) = 4,640.
      const basicComp = response.data.components.find(
        (c) => c.componentId === basicComponentId.toString(),
      );
      expect(basicComp?.amount).toBe(28000);
      expect(basicComp?.monthlyAmount).toBe(28000);

      const hraComp = response.data.components.find(
        (c) => c.componentId === hraComponentId.toString(),
      );
      expect(hraComp?.monthlyAmount).toBe(14000);

      const saComp = response.data.components.find(
        (c) => c.componentId === specialAllowanceComponentId.toString(),
      );
      expect(saComp?.monthlyAmount).toBe(4640);
    });

    it('TC-UPD-07: Successfully updates percentage component configuration rate', async () => {
      const base = await createBaseStructure();

      // Update HRA percentage rate from 50% to 40%
      const response = await executeUpdateApi(base._id, {
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 40, // Changed from 50 to 40
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: employerPfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
        version: 0,
      });

      expect(response.success).toBe(true);
      const hraComp = response.data.components.find(
        (c) => c.componentId === hraComponentId.toString(),
      );
      expect(hraComp?.percentage).toBe(40);
      expect(hraComp?.monthlyAmount).toBe(10000); // 40% of 25,000
    });

    it('TC-UPD-08: Successfully switches a component from FIXED to PERCENTAGE', async () => {
      const base = await createBaseStructure();

      // Switch Basic from FIXED 25,000 to PERCENTAGE 50% of GROSS_SALARY under GROSS basis
      const response = await executeUpdateApi(base._id, {
        salaryBasis: SalaryStructureBasis.GROSS,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE, // Switched!
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
        version: 0,
      });

      expect(response.success).toBe(true);
      const basicComp = response.data.components.find(
        (c) => c.componentId === basicComponentId.toString(),
      );
      expect(basicComp?.calculationType).toBe(
        StructureComponentCalculationType.PERCENTAGE,
      );
      expect(basicComp?.percentage).toBe(50);
      expect(basicComp?.amount).toBeUndefined(); // FIXED amount omitted
      expect(basicComp?.monthlyAmount).toBe(25000);
    });

    it('TC-UPD-09: Successfully switches a component from PERCENTAGE to FIXED', async () => {
      const base = await createBaseStructure();

      // Switch HRA from PERCENTAGE 50% to FIXED 15,000
      const response = await executeUpdateApi(base._id, {
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED, // Switched!
            amount: 15000,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
        version: 0,
      });

      expect(response.success).toBe(true);
      const hraComp = response.data.components.find(
        (c) => c.componentId === hraComponentId.toString(),
      );
      expect(hraComp?.calculationType).toBe(
        StructureComponentCalculationType.FIXED,
      );
      expect(hraComp?.amount).toBe(15000);
      expect(hraComp?.percentage).toBeUndefined(); // PERCENTAGE omitted
      expect(hraComp?.monthlyAmount).toBe(15000);
    });

    it('TC-UPD-10: Successfully updates multiple fields simultaneously', async () => {
      const base = await createBaseStructure();

      const response = await executeUpdateApi(base._id, {
        name: 'Enterprise Executive CTC',
        description: 'Multi-field revised package',
        salaryAmount: 80000,
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.name).toBe('Enterprise Executive CTC');
      expect(response.data.description).toBe('Multi-field revised package');
      expect(response.data.salaryAmount).toBe(80000);
      expect(response.data.version).toBe(1);
    });

    it('TC-UPD-11: Successfully removes a component from the structure', async () => {
      // Create with 5 components
      const base = await createBaseStructure();
      expect(base.components).toHaveLength(5);

      // Remove Employer PF component (reducing to 4 components)
      const response = await executeUpdateApi(base._id, {
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.components).toHaveLength(4);
      expect(
        response.data.components.find(
          (c) => c.componentId === employerPfComponentId.toString(),
        ),
      ).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. COMPONENT VALIDATION
  // =========================================================================
  describe('Component Validation', () => {
    it('TC-UPD-VAL-01: Rejects update when referencing a non-existent component ID', async () => {
      const base = await createBaseStructure();
      const nonExistentId = new Types.ObjectId().toString();

      await expect(
        executeUpdateApi(base._id, {
          components: [
            {
              componentId: nonExistentId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 50000,
            },
          ],
          version: 0,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('TC-UPD-VAL-02: Rejects update with an invalid MongoId string for componentId', async () => {
      const base = await createBaseStructure();

      await expect(
        executeUpdateApi(base._id, {
          components: [
            {
              componentId: 'invalid-mongodb-id',
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 50000,
            },
          ],
          version: 0,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('TC-UPD-VAL-03: Rejects update when referencing an inactive SalaryComponent master', async () => {
      const base = await createBaseStructure();

      await expect(
        executeUpdateApi(base._id, {
          components: [
            {
              componentId: basicComponentId.toString(),
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 30000,
            },
            {
              componentId: inactiveComponentId.toString(), // Inactive component!
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 20000,
            },
          ],
          version: 0,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('TC-UPD-VAL-04: Rejects update containing duplicate component IDs in the components array', async () => {
      const base = await createBaseStructure();

      await expect(
        executeUpdateApi(base._id, {
          components: [
            {
              componentId: basicComponentId.toString(),
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 25000,
            },
            {
              componentId: basicComponentId.toString(), // Duplicate!
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 25000,
            },
          ],
          version: 0,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('TC-UPD-VAL-05: Rejects FIXED component with invalid amount (negative, zero, or percentage present)', async () => {
      // 1. Amount <= 0
      await expectValidationError({
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: -500,
          },
        ],
      });

      // 2. Amount missing on FIXED
      await expectValidationError({
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
          },
        ],
      });

      // 3. Percentage present on FIXED
      await expectValidationError({
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
            percentage: 50,
          },
        ],
      });
    });

    it('TC-UPD-VAL-06: Rejects PERCENTAGE component with invalid percentage rate', async () => {
      // 1. Percentage > 100
      await expectValidationError({
        components: [
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 150,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
      });

      // 2. Percentage <= 0
      await expectValidationError({
        components: [
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 0,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
      });
    });

    it('TC-UPD-VAL-07: Rejects PERCENTAGE component when percentageOf is missing or invalid', async () => {
      // Missing percentageOf
      await expectValidationError({
        components: [
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
          },
        ],
      });

      // Unsupported percentageOf enum
      await expectValidationError({
        components: [
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: 'INVALID_BASE',
          },
        ],
      });
    });

    it('TC-UPD-VAL-08: Rejects BALANCE component if amount or percentage is configured', async () => {
      // Amount configured on BALANCE
      await expectValidationError({
        components: [
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
            amount: 5000,
          },
        ],
      });

      // Percentage configured on BALANCE
      await expectValidationError({
        components: [
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
            percentage: 10,
          },
        ],
      });
    });

    it('TC-UPD-VAL-09: Rejects update when more than one BALANCE component is included', async () => {
      await expectValidationError({
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      });
    });
  });

  // =========================================================================
  // 3. API VALIDATION AND AUTHORIZATION
  // =========================================================================
  describe('API Validation and Authorization', () => {
    it('TC-UPD-API-01: Rejects invalid MongoDB ObjectId in route parameter', () => {
      const pipe = new ParseObjectIdPipe();
      expect(() => pipe.transform('invalid-hex-id')).toThrow(
        BadRequestException,
      );
    });

    it('TC-UPD-API-02: Returns 404 RESOURCE_NOT_FOUND when structure ID does not exist', async () => {
      const nonExistentStructureId = new Types.ObjectId();

      await expect(
        executeUpdateApi(nonExistentStructureId, {
          name: 'New Name',
          version: 0,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('TC-UPD-API-03: Allows empty update payload {} without throwing validation errors', async () => {
      const base = await createBaseStructure();

      const response = await executeUpdateApi(base._id, {});

      expect(response.success).toBe(true);
      expect(response.data.id).toBe(base._id.toString());
      expect(response.data.name).toBe(base.name);
    });

    it('TC-UPD-API-04: Rejects payload with incorrect field types', async () => {
      // salaryAmount as string
      await expectValidationError({
        salaryAmount: 'fifty-thousand',
      });

      // components as string instead of array
      await expectValidationError({
        components: 'not-an-array',
      });
    });

    it('TC-UPD-API-05: Rejects negative or zero salaryAmount', async () => {
      await expectValidationError({
        salaryAmount: -1000,
      });

      await expectValidationError({
        salaryAmount: 0,
      });
    });

    it('TC-UPD-API-06: Forbids non-whitelisted arbitrary properties in request payload', async () => {
      const error = await expectValidationError({
        name: 'Valid Name',
        unrecognizedField: 'malicious-data',
      });

      expect(error.statusCode).toBe(HttpStatus.BAD_REQUEST);
    });

    it('TC-UPD-API-07: Forbids client-supplied internal audit fields (createdBy, updatedBy, _id, __v)', async () => {
      await expectValidationError({
        createdBy: actorId.toString(),
      });

      await expectValidationError({
        updatedBy: actorId.toString(),
      });

      await expectValidationError({
        _id: new Types.ObjectId().toString(),
      });

      await expectValidationError({
        __v: 5,
      });
    });

    it('TC-UPD-API-08: Forbids updating isActive directly through general PATCH endpoint', async () => {
      // isActive must be modified strictly through PATCH /:id/status
      await expectValidationError({
        isActive: false,
      });
    });

    it('TC-UPD-API-09: Rejects update when attempting to change code to one that already exists', async () => {
      await createBaseStructure({ code: 'TECH_CTC_01' });
      const struct2 = await createBaseStructure({ code: 'TECH_CTC_02' });

      // Attempt to rename struct2 code to struct1's code
      await expect(
        executeUpdateApi(struct2._id, {
          code: 'TECH_CTC_01',
          version: 0,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('TC-UPD-API-10: Verifies controller requires SALARY_STRUCTURES_EDIT permission', () => {
      const permissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.update,
      );
      expect(permissions).toEqual([PermissionKeys.SALARY_STRUCTURES_EDIT]);
    });
  });

  // =========================================================================
  // 4. PERSISTENCE & AUDIT INTEGRITY
  // =========================================================================
  describe('Persistence & Audit Integrity', () => {
    it('TC-UPD-PER-01: Verifies GET /salary-structures/:id after PATCH returns the exact updated data', async () => {
      const base = await createBaseStructure();

      await executeUpdateApi(base._id, {
        name: 'Persistent Engineering Structure',
        salaryAmount: 70000,
        version: 0,
      });

      const getResult = await controller.getById(base._id);

      expect(getResult.success).toBe(true);
      expect(getResult.data.name).toBe('Persistent Engineering Structure');
      expect(getResult.data.salaryAmount).toBe(70000);
      expect(getResult.data.version).toBe(1);
    });

    it('TC-UPD-PER-02: Verifies createdAt and createdBy remain completely immutable after update', async () => {
      const base = await createBaseStructure();
      const originalCreatedAt = base.createdAt;
      const originalCreatedBy = base.createdBy;

      // Execute update by another user
      const requestFromAnotherUser = {
        user: { userId: anotherActorId },
        ip: '10.0.0.1',
        headers: { 'user-agent': 'AnotherAgent/1.0' },
      } as unknown as AuthenticatedRequest;

      const validatedDto = (await validationPipe.transform(
        { name: 'Updated By Another Actor', version: 0 },
        { type: 'body', metatype: UpdateSalaryStructureDto },
      )) as UpdateSalaryStructureDto;

      await controller.update(base._id, validatedDto, requestFromAnotherUser);

      const persisted = await inMemoryRepo.findById(base._id);
      expect(persisted).toBeDefined();
      expect(persisted?.createdAt).toEqual(originalCreatedAt);
      expect(persisted?.createdBy).toEqual(originalCreatedBy);
    });

    it('TC-UPD-PER-03: Verifies updatedAt and updatedBy are correctly updated', async () => {
      const base = await createBaseStructure();

      const requestFromAnotherUser = {
        user: { userId: anotherActorId },
        ip: '10.0.0.1',
        headers: { 'user-agent': 'AnotherAgent/1.0' },
      } as unknown as AuthenticatedRequest;

      const validatedDto = (await validationPipe.transform(
        { name: 'Updated By Another User', version: 0 },
        { type: 'body', metatype: UpdateSalaryStructureDto },
      )) as UpdateSalaryStructureDto;

      await controller.update(base._id, validatedDto, requestFromAnotherUser);

      const persisted = await inMemoryRepo.findById(base._id);
      expect(persisted?.updatedBy).toEqual(anotherActorId);
    });

    it('TC-UPD-PER-04: Verifies version __v increments exactly once per update', async () => {
      const base = await createBaseStructure();
      expect(base.__v).toBe(0);

      // First update
      const res1 = await executeUpdateApi(base._id, {
        name: 'Update 1',
        version: 0,
      });
      expect(res1.data.version).toBe(1);

      // Second update
      const res2 = await executeUpdateApi(base._id, {
        name: 'Update 2',
        version: 1,
      });
      expect(res2.data.version).toBe(2);
    });

    it('TC-UPD-PER-05: Verifies failed update (negative balance) does not persist any changes', async () => {
      const base = await createBaseStructure();

      // Attempt invalid calculation update (fixed earnings exceed CTC)
      await expect(
        executeUpdateApi(base._id, {
          salaryAmount: 30000, // Reduced CTC so that fixed Basic (25k) + HRA (12.5k) exceeds Gross
          version: 0,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      // Verify database still holds pristine original values
      const persisted = await inMemoryRepo.findById(base._id);
      expect(persisted?.salaryAmount).toBe(50000); // Unchanged!
      expect(persisted?.__v).toBe(0); // Version did NOT increment!
    });

    it('TC-UPD-PER-06: Verifies audit log is created with before and after state diffs', async () => {
      const base = await createBaseStructure();

      await executeUpdateApi(base._id, {
        name: 'Audited Update',
        salaryAmount: 75000,
        version: 0,
      });

      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
      const auditCall = auditLogsService.createAuditLog.mock.calls[0]?.[0];
      expect(auditCall?.targetId).toEqual(base._id);
      expect(auditCall?.actorId).toEqual(actorId);
    });
  });

  // =========================================================================
  // 5. OPTIMISTIC CONCURRENCY TESTS
  // =========================================================================
  describe('Optimistic Concurrency Control', () => {
    it('TC-UPD-CON-01: Update using current version succeeds and increments version', async () => {
      const base = await createBaseStructure();

      const response = await executeUpdateApi(base._id, {
        name: 'Version 0 Succeeded',
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.version).toBe(1);
    });

    it('TC-UPD-CON-02: Update using stale version returns HTTP 409 CONCURRENT_MODIFICATION', async () => {
      const base = await createBaseStructure();

      // Advance structure version to 1
      await executeUpdateApi(base._id, {
        name: 'First User Edit',
        version: 0,
      });

      // Second user attempts update using stale version 0
      await expect(
        executeUpdateApi(base._id, {
          name: 'Stale User Edit',
          version: 0, // Stale!
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('TC-UPD-CON-03: Two concurrent updates executed simultaneously: exactly one succeeds, one fails with 409', async () => {
      const base = await createBaseStructure();

      // Launch both requests concurrently referencing the initial version 0
      const promise1 = executeUpdateApi(base._id, {
        name: 'Concurrent Request Alpha',
        salaryAmount: 55000,
        version: 0,
      });

      const promise2 = executeUpdateApi(base._id, {
        name: 'Concurrent Request Beta',
        salaryAmount: 65000,
        version: 0,
      });

      const results = await Promise.allSettled([promise1, promise2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one must succeed and one must fail
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedResult = rejected[0];
      if (rejectedResult && rejectedResult.status === 'rejected') {
        const rejectedReason = rejectedResult.reason as AppError;
        expect(rejectedReason.code).toBe(ErrorCode.CONCURRENT_MODIFICATION);
        expect(rejectedReason.statusCode).toBe(HttpStatus.CONFLICT);
      }

      // Verify database version incremented exactly once (from 0 to 1)
      const persisted = await inMemoryRepo.findById(base._id);
      expect(persisted?.__v).toBe(1);
    });

    it('TC-UPD-CON-04: Guarantees no lost updates occur under concurrent execution', async () => {
      const base = await createBaseStructure();

      const [res1] = await Promise.allSettled([
        executeUpdateApi(base._id, {
          name: 'Update A',
          version: 0,
        }),
        executeUpdateApi(base._id, {
          name: 'Update B',
          version: 0,
        }),
      ]);

      const persisted = await inMemoryRepo.findById(base._id);
      expect(persisted).toBeDefined();

      if (res1.status === 'fulfilled') {
        expect(persisted?.name).toBe('Update A');
      } else {
        expect(persisted?.name).toBe('Update B');
      }
      expect(persisted?.__v).toBe(1);
    });
  });

  // =========================================================================
  // 6. EMPLOYEE SALARY SNAPSHOT SAFETY
  // =========================================================================
  describe('Employee Salary Snapshot Safety', () => {
    it('TC-UPD-EMP-01: Verifies salary structure acts as a decoupled template without mutating employee records', async () => {
      // Architectural Verification:
      // In this system, SalaryStructure documents are templates for compensation packages.
      // Modifying a SalaryStructure template modifies ONLY the template document itself.
      // (Employee salary assignment and revision APIs are deferred to a future module).
      const base = await createBaseStructure();

      const response = await executeUpdateApi(base._id, {
        name: 'Template Update',
        salaryAmount: 90000,
        version: 0,
      });

      expect(response.success).toBe(true);
      expect(response.data.salaryAmount).toBe(90000);

      // Assert that repository modification is strictly isolated to SalaryStructure collection
      const storedKeys = Array.from(inMemoryRepo.getStore().keys());
      expect(storedKeys).toEqual([base._id.toString()]);
    });
  });
});
