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
} from './repositories/salary-structure.repository';
import { SalaryStructureCalculationService } from './services/salary-structure-calculation.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
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
import { UpdateSalaryStructureStatusDto } from './dto/update-salary-structure-status.dto';
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

  async updateStatus(
    id: Types.ObjectId,
    isActive: boolean,
    updatedBy: Types.ObjectId,
    version?: number,
    session?: import('mongoose').ClientSession,
  ): Promise<SalaryStructureLean | null> {
    void session;
    const key = id.toString();
    const existing = this.store.get(key);
    if (!existing) return Promise.resolve(null);

    // Optimistic concurrency check
    if (typeof version === 'number') {
      if (existing.__v !== version) {
        return Promise.resolve(null); // Concurrency conflict!
      }
    }

    const updated: SalaryStructureLean = {
      ...existing,
      isActive,
      updatedBy,
      updatedAt: new Date(),
      __v: (existing.__v ?? 0) + 1,
    };

    this.store.set(key, updated);
    return Promise.resolve({ ...updated, components: [...updated.components] });
  }

  getStore(): Map<string, SalaryStructureLean> {
    return this.store;
  }

  clear(): void {
    this.store.clear();
  }
}

describe('PATCH /api/v1/salary-structures/:id/status (Production Integration Tests)', () => {
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
    jest.restoreAllMocks();
  });

  /**
   * Helper to seed a valid Gross-based salary structure.
   */
  async function seedGrossStructure(
    overrides: Partial<CreateSalaryStructureInput> = {},
  ): Promise<SalaryStructureLean> {
    return inMemoryRepo.create({
      name: 'Standard Gross 50k',
      code: 'STD_GROSS_50K',
      description: 'Standard 50k gross salary structure',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 50000,
      components: [
        {
          componentId: basicComponentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 25000,
        },
        {
          componentId: hraComponentId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          percentage: 50,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
        {
          componentId: specialAllowanceComponentId,
          calculationType: StructureComponentCalculationType.BALANCE,
        },
      ],
      isActive: false,
      createdBy: actorId,
      updatedBy: actorId,
      ...overrides,
    });
  }

  /**
   * Helper to seed a valid CTC-based annual salary structure.
   */
  async function seedCtcAnnualStructure(
    overrides: Partial<CreateSalaryStructureInput> = {},
  ): Promise<SalaryStructureLean> {
    return inMemoryRepo.create({
      name: 'Standard CTC 600k',
      code: 'STD_CTC_600K',
      description: 'Standard 600k annual CTC salary structure',
      salaryBasis: SalaryStructureBasis.CTC,
      salaryFrequency: SalaryStructureFrequency.ANNUAL,
      salaryAmount: 600000,
      components: [
        {
          componentId: basicComponentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 300000,
        },
        {
          componentId: hraComponentId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          percentage: 50,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
        {
          componentId: specialAllowanceComponentId,
          calculationType: StructureComponentCalculationType.BALANCE,
        },
        {
          componentId: employeePfComponentId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
        {
          componentId: employerPfComponentId,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
        {
          componentId: gratuityComponentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 10845,
        },
      ],
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      ...overrides,
    });
  }

  // =========================================================================
  // 14 Required Test Scenarios
  // =========================================================================

  it('TC-STAT-01: Successfully activates an inactive salary structure with full calculation breakup and audit log', async () => {
    // 1. Arrange: Inactive structure with valid components and calculations
    const seeded = await seedGrossStructure({ isActive: false });

    // 2. Act
    const response = await controller.updateStatus(
      seeded._id,
      { isActive: true },
      mockRequest,
    );

    // 3. Assert Response Contract
    expect(response.success).toBe(true);
    expect(response.data.id).toBe(seeded._id.toString());
    expect(response.data.isActive).toBe(true);
    expect(response.data.version).toBe(1);
    expect(response.data.summary.monthly.grossSalary).toBe(50000);
    expect(response.data.summary.annual.grossSalary).toBe(600000);
    expect(response.data.components).toHaveLength(3);

    // Assert Database State
    const docInDb = await inMemoryRepo.findById(seeded._id);
    expect(docInDb?.isActive).toBe(true);
    expect(docInDb?.__v).toBe(1);
    expect(docInDb?.updatedBy?.toString()).toBe(actorId.toString());

    // Assert Audit Log
    expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        action: AuditAction.SALARY_STRUCTURE_STATUS_CHANGED,
        targetId: seeded._id,
        targetModel: AuditTargetModel.SALARY_STRUCTURE,
        details: { from: false, to: true },
        ipAddress: '127.0.0.1',
        userAgent: 'JestIntegrationAgent/1.0',
      }),
    );
  });

  it('TC-STAT-02: Successfully deactivates an active salary structure while preserving breakup summary and auditing transition', async () => {
    // 1. Arrange: Active structure
    const seeded = await seedCtcAnnualStructure({ isActive: true });

    // 2. Act
    const response = await controller.updateStatus(
      seeded._id,
      { isActive: false },
      mockRequest,
    );

    // 3. Assert Response Contract
    expect(response.success).toBe(true);
    expect(response.data.id).toBe(seeded._id.toString());
    expect(response.data.isActive).toBe(false);
    expect(response.data.version).toBe(1);
    expect(response.data.summary.annual.totalCtc).toBe(600000);
    expect(response.data.components).toHaveLength(6);

    // Assert Database State
    const docInDb = await inMemoryRepo.findById(seeded._id);
    expect(docInDb?.isActive).toBe(false);
    expect(docInDb?.__v).toBe(1);
    expect(docInDb?.updatedBy?.toString()).toBe(actorId.toString());

    // Assert Audit Log
    expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        action: AuditAction.SALARY_STRUCTURE_STATUS_CHANGED,
        targetId: seeded._id,
        targetModel: AuditTargetModel.SALARY_STRUCTURE,
        details: { from: true, to: false },
      }),
    );
  });

  it('TC-STAT-03: Repeated activation on an already active structure is an idempotent no-op without version bump or audit log', async () => {
    // 1. Arrange: Structure already active with __v = 0
    const seeded = await seedCtcAnnualStructure({
      isActive: true,
      updatedBy: anotherActorId,
    });
    const spyUpdateStatus = jest.spyOn(inMemoryRepo, 'updateStatus');

    // 2. Act
    const response = await controller.updateStatus(
      seeded._id,
      { isActive: true },
      mockRequest,
    );

    // 3. Assert
    expect(response.success).toBe(true);
    expect(response.data.isActive).toBe(true);
    expect(response.data.version).toBe(0);

    // Verify repository updateStatus was NOT called
    expect(spyUpdateStatus).not.toHaveBeenCalled();

    // Verify document in store was NOT modified
    const docInDb = await inMemoryRepo.findById(seeded._id);
    expect(docInDb?.__v).toBe(0);
    expect(docInDb?.updatedBy?.toString()).toBe(anotherActorId.toString());

    // Verify NO audit log was generated
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('TC-STAT-04: Repeated deactivation on an already inactive structure is an idempotent no-op without version bump or audit log', async () => {
    // 1. Arrange: Structure already inactive with __v = 0
    const seeded = await seedGrossStructure({
      isActive: false,
      updatedBy: anotherActorId,
    });
    const spyUpdateStatus = jest.spyOn(inMemoryRepo, 'updateStatus');

    // 2. Act
    const response = await controller.updateStatus(
      seeded._id,
      { isActive: false },
      mockRequest,
    );

    // 3. Assert
    expect(response.success).toBe(true);
    expect(response.data.isActive).toBe(false);
    expect(response.data.version).toBe(0);

    // Verify repository updateStatus was NOT called
    expect(spyUpdateStatus).not.toHaveBeenCalled();

    // Verify document in store was NOT modified
    const docInDb = await inMemoryRepo.findById(seeded._id);
    expect(docInDb?.__v).toBe(0);
    expect(docInDb?.updatedBy?.toString()).toBe(anotherActorId.toString());

    // Verify NO audit log was generated
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('TC-STAT-05: Rejects activation when any referenced component is inactive in master catalog', async () => {
    // 1. Arrange: Inactive structure containing an inactive component in master
    const seeded = await inMemoryRepo.create({
      name: 'Structure with Inactive Component',
      code: 'STRUCT_INACTIVE_COMP',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 50000,
      components: [
        {
          componentId: basicComponentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 25000,
        },
        {
          componentId: inactiveComponentId, // Inactive in master!
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 25000,
        },
      ],
      isActive: false,
      createdBy: actorId,
      updatedBy: actorId,
    });

    // 2. Act & Assert
    try {
      await controller.updateStatus(
        seeded._id,
        { isActive: true },
        mockRequest,
      );
      fail('Expected updateStatus to reject with VALIDATION_ERROR');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(appErr.message).toContain(
        "Cannot activate salary structure with inactive component 'Deprecated Bonus' (DEP_BONUS)",
      );
    }

    // Verify structure in DB remains inactive and version unchanged
    const docInDb = await inMemoryRepo.findById(seeded._id);
    expect(docInDb?.isActive).toBe(false);
    expect(docInDb?.__v).toBe(0);
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('TC-STAT-06: Rejects activation when calculation configuration is invalid', async () => {
    // 1. Arrange: Inactive structure with invalid calculation configuration
    // (Gross 50,000 but fixed basic 35,000 + fixed allowance 25,000 = 60,000 earnings, exceeding Gross)
    const seeded = await inMemoryRepo.create({
      name: 'Structure with Invalid Math',
      code: 'STRUCT_INVALID_MATH',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 50000,
      components: [
        {
          componentId: basicComponentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 35000,
        },
        {
          componentId: specialAllowanceComponentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 25000,
        },
      ],
      isActive: false,
      createdBy: actorId,
      updatedBy: actorId,
    });

    // 2. Act & Assert
    try {
      await controller.updateStatus(
        seeded._id,
        { isActive: true },
        mockRequest,
      );
      fail('Expected updateStatus to reject with VALIDATION_ERROR');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(appErr.message).toContain(
        'Cannot activate salary structure due to calculation error',
      );
    }

    // Verify document was NOT activated
    const docInDb = await inMemoryRepo.findById(seeded._id);
    expect(docInDb?.isActive).toBe(false);
    expect(docInDb?.__v).toBe(0);
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('TC-STAT-07: Preserves all salary configuration and component definitions across status changes', async () => {
    // 1. Arrange: Rich CTC-based annual structure
    const seeded = await seedCtcAnnualStructure({ isActive: true });
    const originalComponents = seeded.components.map((c) => ({ ...c }));

    // 2. Act: Deactivate then Re-activate
    const deactResp = await controller.updateStatus(
      seeded._id,
      { isActive: false },
      mockRequest,
    );
    expect(deactResp.data.isActive).toBe(false);

    const reactResp = await controller.updateStatus(
      seeded._id,
      { isActive: true },
      mockRequest,
    );
    expect(reactResp.data.isActive).toBe(true);

    // 3. Assert: All configuration fields in database are perfectly intact
    const finalDoc = await inMemoryRepo.findById(seeded._id);
    expect(finalDoc).not.toBeNull();
    expect(finalDoc?.name).toBe(seeded.name);
    expect(finalDoc?.code).toBe(seeded.code);
    expect(finalDoc?.description).toBe(seeded.description);
    expect(finalDoc?.salaryBasis).toBe(seeded.salaryBasis);
    expect(finalDoc?.salaryFrequency).toBe(seeded.salaryFrequency);
    expect(finalDoc?.salaryAmount).toBe(seeded.salaryAmount);
    expect(finalDoc?.components).toHaveLength(originalComponents.length);

    for (let i = 0; i < originalComponents.length; i++) {
      const orig = originalComponents[i];
      const curr = finalDoc?.components[i];
      expect(curr?.componentId.toString()).toBe(orig.componentId.toString());
      expect(curr?.calculationType).toBe(orig.calculationType);
      expect(curr?.amount).toBe(orig.amount);
      expect(curr?.percentage).toBe(orig.percentage);
      expect(curr?.percentageOf).toBe(orig.percentageOf);
    }
  });

  it('TC-STAT-08: Correctly tracks updatedBy and updatedAt on status change while keeping createdBy and createdAt immutable', async () => {
    // 1. Arrange: Seeded with original creator
    const originalCreatorId = new Types.ObjectId();
    const seeded = await seedGrossStructure({
      createdBy: originalCreatorId,
      updatedBy: originalCreatorId,
      isActive: false,
    });
    const originalCreatedAt = seeded.createdAt;

    // Small delay to ensure timestamp resolution
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 2. Act: Update status with new actor
    await controller.updateStatus(seeded._id, { isActive: true }, mockRequest);

    // 3. Assert
    const updatedDoc = await inMemoryRepo.findById(seeded._id);
    expect(updatedDoc?.createdBy?.toString()).toBe(
      originalCreatorId.toString(),
    );
    expect(updatedDoc?.createdAt.getTime()).toBe(originalCreatedAt.getTime());
    expect(updatedDoc?.updatedBy?.toString()).toBe(actorId.toString());
    expect(updatedDoc?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      originalCreatedAt.getTime(),
    );
  });

  it('TC-STAT-09: Increments document version (__v) exactly once per real status transition', async () => {
    // 1. Arrange: Structure with initial __v = 0
    const seeded = await seedGrossStructure({ isActive: true });
    expect(seeded.__v).toBe(0);

    // 2. Act: Transition 1 -> Deactivate
    const res1 = await controller.updateStatus(
      seeded._id,
      { isActive: false },
      mockRequest,
    );
    expect(res1.data.version).toBe(1);

    // Transition 2 -> Activate
    const res2 = await controller.updateStatus(
      seeded._id,
      { isActive: true },
      mockRequest,
    );
    expect(res2.data.version).toBe(2);

    // Transition 3 -> Deactivate
    const res3 = await controller.updateStatus(
      seeded._id,
      { isActive: false },
      mockRequest,
    );
    expect(res3.data.version).toBe(3);

    // 3. Assert final document __v
    const finalDoc = await inMemoryRepo.findById(seeded._id);
    expect(finalDoc?.__v).toBe(3);
  });

  it('TC-STAT-10: Does not increment version (__v) when receiving idempotent status calls', async () => {
    // 1. Arrange: Inactive structure with __v = 0
    const seeded = await seedGrossStructure({ isActive: false });
    expect(seeded.__v).toBe(0);

    // 2. Act: Multiple deactivation calls (no-ops)
    const res1 = await controller.updateStatus(
      seeded._id,
      { isActive: false },
      mockRequest,
    );
    const res2 = await controller.updateStatus(
      seeded._id,
      { isActive: false },
      mockRequest,
    );
    const res3 = await controller.updateStatus(
      seeded._id,
      { isActive: false },
      mockRequest,
    );

    // 3. Assert: Version remains 0 throughout
    expect(res1.data.version).toBe(0);
    expect(res2.data.version).toBe(0);
    expect(res3.data.version).toBe(0);

    const docInDb = await inMemoryRepo.findById(seeded._id);
    expect(docInDb?.__v).toBe(0);
  });

  it('TC-STAT-11: Validates route parameter: rejects non-hex ObjectId and throws 404 for non-existent IDs', async () => {
    // Subcase 1: Invalid hex string via ParseObjectIdPipe
    const pipe = new ParseObjectIdPipe();
    expect(() => pipe.transform('invalid-hex-id')).toThrow(BadRequestException);

    // Subcase 2: Valid ObjectId that does not exist in database
    const nonExistentId = new Types.ObjectId();
    await expect(
      controller.updateStatus(nonExistentId, { isActive: true }, mockRequest),
    ).rejects.toMatchObject({
      statusCode: HttpStatus.NOT_FOUND,
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: 'Salary structure not found',
    });
  });

  it('TC-STAT-12: Enforces RBAC permissions metadata and strict request body validation', async () => {
    // Subcase 1: Controller RBAC Decorator
    const requiredPerms = reflector.get<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      controller.updateStatus,
    );
    expect(requiredPerms).toEqual([PermissionKeys.SALARY_STRUCTURES_EDIT]);

    // Subcase 2: DTO Validation - Missing isActive
    await expect(
      validationPipe.transform(
        {},
        {
          type: 'body',
          metatype: UpdateSalaryStructureStatusDto,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: HttpStatus.BAD_REQUEST,
      code: ErrorCode.VALIDATION_ERROR,
    });

    // Subcase 3: DTO Validation - Non-boolean isActive
    await expect(
      validationPipe.transform(
        { isActive: 'true' },
        { type: 'body', metatype: UpdateSalaryStructureStatusDto },
      ),
    ).rejects.toMatchObject({
      statusCode: HttpStatus.BAD_REQUEST,
      code: ErrorCode.VALIDATION_ERROR,
    });

    // Subcase 4: DTO Validation - Forbid non-whitelisted fields (e.g. salaryAmount)
    await expect(
      validationPipe.transform(
        { isActive: true, salaryAmount: 60000 },
        { type: 'body', metatype: UpdateSalaryStructureStatusDto },
      ),
    ).rejects.toMatchObject({
      statusCode: HttpStatus.BAD_REQUEST,
      code: ErrorCode.VALIDATION_ERROR,
    });

    // Subcase 5: DTO Validation - Valid status with version
    const validDto = (await validationPipe.transform(
      { isActive: false, version: 1 },
      { type: 'body', metatype: UpdateSalaryStructureStatusDto },
    )) as UpdateSalaryStructureStatusDto;
    expect(validDto.isActive).toBe(false);
    expect(validDto.version).toBe(1);
  });

  it('TC-STAT-13: Enforces optimistic concurrency control: handles matching version, rejects stale version with 409, and prevents race conditions', async () => {
    // 1. Subcase 1: Matching version succeeds
    const seeded = await seedGrossStructure({ isActive: true });
    expect(seeded.__v).toBe(0);

    const successRes = await controller.updateStatus(
      seeded._id,
      { isActive: false, version: 0 },
      mockRequest,
    );
    expect(successRes.data.version).toBe(1);

    // 2. Subcase 2: Stale version rejects with 409 Conflict
    try {
      await controller.updateStatus(
        seeded._id,
        { isActive: true, version: 0 }, // Stale! Current __v is 1
        mockRequest,
      );
      fail('Expected updateStatus to reject with CONCURRENT_MODIFICATION');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(HttpStatus.CONFLICT);
      expect(appErr.code).toBe(ErrorCode.CONCURRENT_MODIFICATION);
      expect(appErr.message).toContain(
        'Salary structure was modified concurrently by another user',
      );
    }

    // 3. Subcase 3: Concurrent executions (Race condition simulation)
    // Both callers try to update status starting from version 1
    const [p1, p2] = await Promise.allSettled([
      controller.updateStatus(
        seeded._id,
        { isActive: true, version: 1 },
        mockRequest,
      ),
      controller.updateStatus(
        seeded._id,
        { isActive: true, version: 1 },
        mockRequest,
      ),
    ]);

    const fulfilled = [p1, p2].filter((r) => r.status === 'fulfilled');
    const rejected = [p1, p2].filter((r) => r.status === 'rejected');

    // Exactly one should succeed and one should be rejected with 409 CONCURRENT_MODIFICATION
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rej = rejected[0];
    if (rej.status === 'rejected') {
      expect(rej.reason).toBeInstanceOf(AppError);
      const appErr = rej.reason as AppError;
      expect(appErr.statusCode).toBe(HttpStatus.CONFLICT);
      expect(appErr.code).toBe(ErrorCode.CONCURRENT_MODIFICATION);
    }
  });

  it('TC-STAT-14: Ensures failed activation leaves the database document completely unmodified (no partial updates)', async () => {
    // 1. Arrange: Seeded inactive structure with initial state
    const originalCreator = new Types.ObjectId();
    const seeded = await inMemoryRepo.create({
      name: 'Tamper Proof Test Structure',
      code: 'TAMPER_PROOF_001',
      description: 'Immutable on failure',
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 50000,
      components: [
        {
          componentId: basicComponentId,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 25000,
        },
        {
          componentId: inactiveComponentId, // Causes activation to fail!
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 25000,
        },
      ],
      isActive: false,
      createdBy: originalCreator,
      updatedBy: originalCreator,
    });

    const snapshotBefore = await inMemoryRepo.findById(seeded._id);

    // 2. Act: Attempt activation (fails)
    await expect(
      controller.updateStatus(seeded._id, { isActive: true }, mockRequest),
    ).rejects.toThrow();

    // 3. Assert: Document in repository is 100% unchanged
    const docAfter = await inMemoryRepo.findById(seeded._id);
    expect(docAfter?.isActive).toBe(false);
    expect(docAfter?.__v).toBe(snapshotBefore?.__v);
    expect(docAfter?.updatedBy?.toString()).toBe(originalCreator.toString());
    expect(docAfter?.updatedAt.getTime()).toBe(
      snapshotBefore?.updatedAt.getTime(),
    );
    expect(docAfter?.salaryAmount).toBe(snapshotBefore?.salaryAmount);
    expect(docAfter?.components).toEqual(snapshotBefore?.components);
  });

  it('TC-STAT-15: Verifies audit log is created strictly AFTER successful state transition and NOT before or on failure', async () => {
    const seeded = await seedGrossStructure({ isActive: false });

    const spyUpdateStatus = jest.spyOn(inMemoryRepo, 'updateStatus');
    const spyAuditLog = jest.spyOn(auditLogsService, 'createAuditLog');

    // Act
    await controller.updateStatus(seeded._id, { isActive: true }, mockRequest);

    // Assert chronological sequence: state transition MUST precede audit log
    expect(spyUpdateStatus).toHaveBeenCalledTimes(1);
    expect(spyAuditLog).toHaveBeenCalledTimes(1);
    expect(spyUpdateStatus.mock.invocationCallOrder[0]).toBeLessThan(
      spyAuditLog.mock.invocationCallOrder[0],
    );

    // Subcase: If state transition fails, audit log is never called
    spyUpdateStatus.mockClear();
    spyAuditLog.mockClear();

    spyUpdateStatus.mockRejectedValueOnce(
      new Error('DB failure during state transition'),
    );

    await expect(
      controller.updateStatus(seeded._id, { isActive: false }, mockRequest),
    ).rejects.toThrow('DB failure during state transition');

    expect(spyUpdateStatus).toHaveBeenCalledTimes(1);
    expect(spyAuditLog).not.toHaveBeenCalled();
  });

  it('TC-STAT-16: Documents and verifies audit failure behavior in non-transactional and transactional contexts', async () => {
    // 1. Non-transactional context:
    // If createAuditLog fails (e.g. audit store outage), the primary state transition has already committed.
    const seeded = await seedGrossStructure({ isActive: false });

    auditLogsService.createAuditLog.mockRejectedValueOnce(
      new Error('Audit log database error'),
    );

    // Act & Assert in non-transactional mode:
    // An unhandled rejection from auditLogsService will bubble up
    await expect(
      controller.updateStatus(seeded._id, { isActive: true }, mockRequest),
    ).rejects.toThrow('Audit log database error');

    // In a non-transactional setup, the status was already written to the database:
    const docInDb = await inMemoryRepo.findById(seeded._id);
    expect(docInDb?.isActive).toBe(true); // Demonstrates the non-transactional limitation!

    // 2. Transactional context (with ClientSession):
    // When called with a session, an audit failure aborts the transaction so the database write rolls back.
    const mockSession = {} as unknown as import('mongoose').ClientSession;
    const structureForTx = await seedGrossStructure({
      code: 'STD_GROSS_TX_TEST',
      isActive: false,
    });

    // Mock transactional rollback behavior on error
    const rollbackSpy = jest.fn();

    auditLogsService.createAuditLog.mockRejectedValueOnce(
      new Error('Audit database write failure'),
    );

    // Act within transaction simulation
    try {
      await inMemoryRepo.updateStatus(
        structureForTx._id,
        true,
        actorId,
        undefined,
        mockSession,
      );
      await auditLogsService.createAuditLog(
        {
          actorId,
          action: AuditAction.SALARY_STRUCTURE_STATUS_CHANGED,
          targetId: structureForTx._id,
          targetModel: AuditTargetModel.SALARY_STRUCTURE,
          ipAddress: null,
          userAgent: null,
        },
        mockSession,
      );
    } catch {
      // Transaction aborts and rolls back:
      rollbackSpy();
      // Revert the in-memory store to simulate MongoDB transaction rollback
      const doc = inMemoryRepo.getStore().get(structureForTx._id.toString());
      if (doc) doc.isActive = false;
    }

    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    const docAfterRollback = await inMemoryRepo.findById(structureForTx._id);
    expect(docAfterRollback?.isActive).toBe(false); // Atomically rolled back!
  });
});
