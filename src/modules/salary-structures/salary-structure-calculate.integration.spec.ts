/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus, ValidationPipe, ValidationError } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
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
import { CalculateSalaryStructureDto } from './dto/calculate-salary-structure.dto';
import { SalaryStructureLean } from './schemas/salary-structure.schema';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { SalaryStructureMapper } from './mappers/salary-structure.mapper';

/**
 * In-memory repository simulating the MongoDB SalaryStructure collection.
 */
class InMemorySalaryStructureRepository {
  private readonly store = new Map<string, SalaryStructureLean>();

  async create(data: CreateSalaryStructureInput): Promise<SalaryStructureLean> {
    const id = new Types.ObjectId();
    const now = new Date();
    const doc: SalaryStructureLean = {
      _id: id,
      name: data.name,
      code: data.code.trim().toUpperCase(),
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
    const doc = this.store.get(id.toString());
    return Promise.resolve(doc ? { ...doc } : null);
  }

  getStore(): Map<string, SalaryStructureLean> {
    return this.store;
  }

  clear(): void {
    this.store.clear();
  }
}

describe('POST /api/v1/salary-structures/calculate (Production Preview Tests)', () => {
  let controller: SalaryStructuresController;
  let inMemoryRepo: InMemorySalaryStructureRepository;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let validationPipe: ValidationPipe;
  let reflector: Reflector;

  const actorId = new Types.ObjectId();

  // Master component ObjectIDs
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

  // Master database component catalog
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
        isActive: false, // Inactive master component!
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

  // =========================================================================
  // 16 Required Production-Grade Test Scenarios
  // =========================================================================

  describe('1. FIXED component calculation', () => {
    it('TC-CALC-01: Correctly calculates FIXED components with independent monthly and annual derivations', async () => {
      // Input: GROSS 50000 Monthly, 3 fixed components
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 30000,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 15000,
          },
          {
            componentId: conveyanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 5000,
          },
        ],
      };

      const response = await controller.calculatePreview(dto);

      expect(response.success).toBe(true);
      expect(response.data.grossSalaryMonthly).toBe(50000);
      expect(response.data.grossSalaryAnnual).toBe(600000);

      // Verify independently calculated component amounts
      const basicItem = response.data.earnings.find((e) => e.code === 'BASIC');
      expect(basicItem).toBeDefined();
      expect(basicItem?.monthlyAmount).toBe(30000);
      expect(basicItem?.annualAmount).toBe(360000);

      const hraItem = response.data.earnings.find((e) => e.code === 'HRA');
      expect(hraItem).toBeDefined();
      expect(hraItem?.monthlyAmount).toBe(15000);
      expect(hraItem?.annualAmount).toBe(180000);

      const convItem = response.data.earnings.find(
        (e) => e.code === 'CONVEYANCE',
      );
      expect(convItem).toBeDefined();
      expect(convItem?.monthlyAmount).toBe(5000);
      expect(convItem?.annualAmount).toBe(60000);
    });
  });

  describe('2. PERCENTAGE based on BASIC', () => {
    it('TC-CALC-02: Accurately evaluates PERCENTAGE components calculated against BASIC', async () => {
      // Input: GROSS 60000 Monthly, BASIC = 30000, HRA = 50% BASIC (15000), EMP_PF = 12% BASIC (3600)
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 60000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 30000,
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
      };

      const response = await controller.calculatePreview(dto);

      expect(response.success).toBe(true);
      // HRA = 50% of 30,000 = 15,000 monthly, 180,000 annual
      const hraItem = response.data.earnings.find((e) => e.code === 'HRA');
      expect(hraItem?.monthlyAmount).toBe(15000);
      expect(hraItem?.annualAmount).toBe(180000);

      // EMP_PF = 12% of 30,000 = 3,600 monthly, 43,200 annual
      const pfItem = response.data.employeeDeductions.find(
        (e) => e.code === 'EMP_PF',
      );
      expect(pfItem?.monthlyAmount).toBe(3600);
      expect(pfItem?.annualAmount).toBe(43200);

      // Estimated Net = 60000 - 3600 = 56400
      expect(response.data.estimatedNetSalaryMonthly).toBe(56400);
      expect(response.data.estimatedNetSalaryAnnual).toBe(676800);
    });
  });

  describe('3. PERCENTAGE based on GROSS_SALARY', () => {
    it('TC-CALC-03: Accurately evaluates PERCENTAGE components calculated against GROSS_SALARY', async () => {
      // Input: GROSS 50000 Monthly, BASIC = 50% GROSS (25000), HRA = 20% GROSS (10000), SA = BALANCE (15000)
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 20,
            percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      const response = await controller.calculatePreview(dto);

      expect(response.success).toBe(true);
      const basic = response.data.earnings.find((e) => e.code === 'BASIC');
      expect(basic?.monthlyAmount).toBe(25000);
      expect(basic?.annualAmount).toBe(300000);

      const hra = response.data.earnings.find((e) => e.code === 'HRA');
      expect(hra?.monthlyAmount).toBe(10000);
      expect(hra?.annualAmount).toBe(120000);

      const sa = response.data.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(sa?.monthlyAmount).toBe(15000);
      expect(sa?.annualAmount).toBe(180000);
    });
  });

  describe('4. BALANCE component calculation', () => {
    it('TC-CALC-04: Resolves BALANCE component absorbing exact unallocated Gross remainder', async () => {
      // Input: GROSS 80000 Monthly, Basic = 40000, HRA = 20000, SA = BALANCE
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 80000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 40000,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 20000,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      const response = await controller.calculatePreview(dto);

      // Remainder: 80,000 - (40,000 + 20,000) = 20,000 monthly, 240,000 annual
      const sa = response.data.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(sa?.monthlyAmount).toBe(20000);
      expect(sa?.annualAmount).toBe(240000);

      const totalEarningsMonthly = response.data.earnings.reduce(
        (sum, item) => sum + item.monthlyAmount,
        0,
      );
      expect(totalEarningsMonthly).toBe(80000);
    });
  });

  describe('5. CTC-based reconciliation', () => {
    it('TC-CALC-05: Derives Gross, solves employer contributions, and balances salary from total CTC', async () => {
      // Input: ANNUAL CTC 600,000
      // Basic = 300,000, HRA = 50% Basic (150,000), Emp PF = 12% Basic (36,000), Empr PF = 12% Basic (36,000), Gratuity = 10,845
      // Expected:
      // Employer Contributions = 36,000 + 10,845 = 46,845
      // Gross Salary = 600,000 - 46,845 = 553,155
      // Special Allowance = 553,155 - (300,000 + 150,000) = 103,155
      // Total CTC = 600,000
      // Estimated Net = 553,155 - 36,000 = 517,155
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 300000,
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
          {
            componentId: gratuityComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 10845,
          },
        ],
      };

      const response = await controller.calculatePreview(dto);

      expect(response.data.totalCtcAnnual).toBe(600000);
      expect(response.data.totalCtcMonthly).toBe(50000);
      expect(response.data.grossSalaryAnnual).toBe(553155);
      expect(response.data.grossSalaryMonthly).toBe(46096.25);
      expect(response.data.totalEmployerContributionsAnnual).toBe(46845);
      expect(response.data.totalEmployerContributionsMonthly).toBe(3903.75);
      expect(response.data.totalEmployeeDeductionsAnnual).toBe(36000);
      expect(response.data.totalEmployeeDeductionsMonthly).toBe(3000);
      expect(response.data.estimatedNetSalaryAnnual).toBe(517155);
      expect(response.data.estimatedNetSalaryMonthly).toBe(43096.25);

      const sa = response.data.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(sa?.annualAmount).toBe(103155);
      expect(sa?.monthlyAmount).toBe(8596.25);
    });
  });

  describe('6. GROSS-based reconciliation', () => {
    it('TC-CALC-06: Derives Total CTC by adding employer contributions and Net by subtracting deductions', async () => {
      // Input: GROSS 50000 Monthly, Basic 25000, HRA 15000, Balance SA 10000, Empr PF 12% Basic (3000), Emp PF 12% Basic (3000)
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 15000,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employerPfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: employeePfComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
      };

      const response = await controller.calculatePreview(dto);

      expect(response.data.grossSalaryMonthly).toBe(50000);
      expect(response.data.totalEmployerContributionsMonthly).toBe(3000);
      expect(response.data.totalCtcMonthly).toBe(53000); // Gross + Employer Contributions
      expect(response.data.totalEmployeeDeductionsMonthly).toBe(3000);
      expect(response.data.estimatedNetSalaryMonthly).toBe(47000); // Gross - Employee Deductions
    });
  });

  describe('7. Monthly/annual conversion', () => {
    it('TC-CALC-07: Produces identical monthly breakups between equivalent Monthly and Annual salary structures', async () => {
      // Configuration A: Monthly CTC ₹50,000 (Annual = ₹600,000)
      const monthlyDto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
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
        ],
      };

      // Configuration B: Annual CTC ₹600,000 (Monthly = ₹50,000)
      const annualDto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 300000, // 25,000 * 12
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
        ],
      };

      const [monthlyRes, annualRes] = await Promise.all([
        controller.calculatePreview(monthlyDto),
        controller.calculatePreview(annualDto),
      ]);

      // Both configurations MUST produce identical monthly summary numbers
      expect(monthlyRes.data.grossSalaryMonthly).toBe(
        annualRes.data.grossSalaryMonthly,
      );
      expect(monthlyRes.data.totalCtcMonthly).toBe(
        annualRes.data.totalCtcMonthly,
      );
      expect(monthlyRes.data.estimatedNetSalaryMonthly).toBe(
        annualRes.data.estimatedNetSalaryMonthly,
      );

      // Verify each component monthly amount matches
      for (const itemM of monthlyRes.data.earnings) {
        const itemA = annualRes.data.earnings.find(
          (e) => e.code === itemM.code,
        );
        expect(itemM.monthlyAmount).toBe(itemA?.monthlyAmount);
      }
    });
  });

  describe('8. Correct financial rounding', () => {
    it("TC-CALC-08: Applies Banker's rounding (round half to even) without floating-point drift", async () => {
      // Annual Gross ₹50,003 -> 50,003 / 12 = 4166.916666... -> rounds to 4166.92
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 50003,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      const response = await controller.calculatePreview(dto);

      expect(response.data.grossSalaryMonthly).toBe(4166.92);
      expect(response.data.grossSalaryAnnual).toBe(50003);

      const basic = response.data.earnings.find((e) => e.code === 'BASIC');
      // Basic Annual: 50,003 * 0.5 = 25001.50 -> Monthly: 25001.50 / 12 = 2083.45833... -> 2083.46
      expect(basic?.annualAmount).toBe(25001.5);
      expect(basic?.monthlyAmount).toBe(2083.46);

      // Special Allowance Annual: 25001.50 -> Monthly: 2083.46
      const sa = response.data.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(sa?.annualAmount).toBe(25001.5);
      expect(sa?.monthlyAmount).toBe(2083.46);

      // Zero floating-point artifacts: string serialization contains at most 2 decimal digits
      const monthlyStr = response.data.grossSalaryMonthly.toString();
      const decimalDigits = monthlyStr.includes('.')
        ? monthlyStr.split('.')[1].length
        : 0;
      expect(decimalDigits).toBeLessThanOrEqual(2);
    });
  });

  describe('9. Negative BALANCE rejection', () => {
    it('TC-CALC-09: Rejects when fixed and percentage earnings exceed Gross salary (negative balance)', async () => {
      // Gross: 50000 Monthly. Basic: 35000, HRA: 20000 -> Total configured earnings = 55000 > 50000
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 35000,
          },
          {
            componentId: hraComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 20000,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      try {
        await controller.calculatePreview(dto);
        fail('Expected calculatePreview to throw VALIDATION_ERROR');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toContain(
          'Configured earnings (55000) exceed Gross Salary (50000). Balance cannot be negative.',
        );
      }
    });
  });

  describe('10. Missing component or dependency rejection', () => {
    it('TC-CALC-10A: Throws 404 RESOURCE_NOT_FOUND when referencing non-existent SalaryComponent ID', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: nonExistentId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 50000,
          },
        ],
      };

      try {
        await controller.calculatePreview(dto);
        fail('Expected calculatePreview to throw RESOURCE_NOT_FOUND');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(HttpStatus.NOT_FOUND);
        expect(appErr.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
        expect(appErr.message).toContain(
          `Referenced SalaryComponent '${nonExistentId}' not found`,
        );
      }
    });

    it('TC-CALC-10B: Throws 400 VALIDATION_ERROR when component depends on BASIC but BASIC component is absent', async () => {
      // HRA depends on BASIC, but only HRA and Special Allowance are in the structure
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
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
        ],
      };

      try {
        await controller.calculatePreview(dto);
        fail('Expected calculatePreview to throw VALIDATION_ERROR');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toContain(
          "Components configured with percentage of 'BASIC' require a component with code 'BASIC' in the structure.",
        );
      }
    });
  });

  describe('11. Duplicate component rejection', () => {
    it('TC-CALC-11: Rejects duplicate component IDs in the components array via DTO validation', async () => {
      const payload = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
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
      };

      try {
        await validationPipe.transform(payload, {
          type: 'body',
          metatype: CalculateSalaryStructureDto,
        });
        fail('Expected validationPipe to throw VALIDATION_ERROR');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });
  });

  describe('12. Inactive component rejection', () => {
    it('TC-CALC-12: Rejects calculation when referencing an inactive SalaryComponent master document', async () => {
      // Inactive component in master (isActive: false)
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: inactiveComponentId.toString(), // Inactive!
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
        ],
      };

      try {
        await controller.calculatePreview(dto);
        fail('Expected calculatePreview to throw VALIDATION_ERROR');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toContain(
          "Cannot preview salary structure with inactive component 'Deprecated Bonus' (DEP_BONUS)",
        );
      }
    });
  });

  describe('13. Invalid percentage and fixed amount rejection', () => {
    it('TC-CALC-13A: Rejects FIXED component with zero or negative amount', async () => {
      const payload = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: -500, // Invalid fixed amount
          },
        ],
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: CalculateSalaryStructureDto,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('TC-CALC-13B: Rejects PERCENTAGE component with percentage exceeding 100 or non-positive', async () => {
      const payload = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 150, // Invalid (> 100)
            percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
          },
        ],
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: CalculateSalaryStructureDto,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('TC-CALC-13C: Rejects BALANCE component if amount or percentage is provided', async () => {
      const payload = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
            amount: 5000, // BALANCE must not supply amount!
          },
        ],
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: CalculateSalaryStructureDto,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('14. Unsupported or circular dependency rejection', () => {
    it('TC-CALC-14: Rejects circular dependency where BASIC is configured as percentage of BASIC', async () => {
      const dto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.BASIC, // Circular: BASIC depends on BASIC!
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      try {
        await controller.calculatePreview(dto);
        fail('Expected calculatePreview to throw VALIDATION_ERROR');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toContain(
          "BASIC component cannot be calculated as percentage of 'BASIC'",
        );
      }
    });
  });

  describe('15. Unknown request properties rejection', () => {
    it('TC-CALC-15: Rejects payloads containing unknown/unwhitelisted properties at top-level or component-level', async () => {
      // Subcase A: Top-level unknown property
      await expect(
        validationPipe.transform(
          {
            salaryBasis: SalaryStructureBasis.CTC,
            salaryFrequency: SalaryStructureFrequency.ANNUAL,
            salaryAmount: 600000,
            unknownTopLevelProp: 'not-allowed',
            components: [
              {
                componentId: basicComponentId.toString(),
                calculationType: StructureComponentCalculationType.FIXED,
                amount: 300000,
              },
            ],
          },
          { type: 'body', metatype: CalculateSalaryStructureDto },
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      // Subcase B: Component-level unknown property
      await expect(
        validationPipe.transform(
          {
            salaryBasis: SalaryStructureBasis.CTC,
            salaryFrequency: SalaryStructureFrequency.ANNUAL,
            salaryAmount: 600000,
            components: [
              {
                componentId: basicComponentId.toString(),
                calculationType: StructureComponentCalculationType.FIXED,
                amount: 300000,
                unknownComponentProp: true,
              },
            ],
          },
          { type: 'body', metatype: CalculateSalaryStructureDto },
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('16. Verify preview does not create or modify SalaryStructure business records', () => {
    it('TC-CALC-16: Zero-mutation guarantee - preview leaves database documents, count, and audit logs untouched', async () => {
      // 1. Arrange: Existing active structure in repository
      const seeded = await inMemoryRepo.create({
        name: 'Executive Leadership CTC',
        code: 'EXEC_LEAD_01',
        description: 'Existing structure template',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 1200000,
        components: [
          {
            componentId: basicComponentId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 600000,
          },
        ],
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
      });

      const initialStoreSize = inMemoryRepo.getStore().size;
      const initialDocSnapshot = JSON.stringify(seeded);

      // Spies to confirm no persistence calls occur
      const spyCreate = jest.spyOn(inMemoryRepo, 'create');
      const spyAuditLog = jest.spyOn(auditLogsService, 'createAuditLog');

      // 2. Act: Call calculate preview with a new structure configuration
      const calculateDto: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 300000,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      const response = await controller.calculatePreview(calculateDto);

      // 3. Assert: Calculation returned valid result
      expect(response.success).toBe(true);
      expect(response.data.totalCtcAnnual).toBe(600000);

      // Assert repository store size did NOT change
      expect(inMemoryRepo.getStore().size).toBe(initialStoreSize);

      // Assert existing document is 100% byte-for-byte identical
      const docAfter = await inMemoryRepo.findById(seeded._id);
      expect(JSON.stringify(docAfter)).toBe(initialDocSnapshot);

      // Assert repository create was NOT called
      expect(spyCreate).not.toHaveBeenCalled();

      // Assert NO audit log was generated
      expect(spyAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('Diagnostics Intentional Exposure & Access Control', () => {
    it('TC-CALC-DIAG-01: Retains diagnostics by default for admin configuration preview and omits when includeDiagnostics is false', async () => {
      const dtoWithDiag: CalculateSalaryStructureDto = {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId.toString(),
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: specialAllowanceComponentId.toString(),
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      // 1. By default: diagnostics present
      const resWithDiag = await controller.calculatePreview(dtoWithDiag);
      expect(resWithDiag.data.diagnostics).toBeDefined();
      expect(resWithDiag.data.diagnostics?.length).toBe(2);

      // 2. When includeDiagnostics is false: diagnostics cleanly omitted
      const resWithoutDiag = await controller.calculatePreview({
        ...dtoWithDiag,
        includeDiagnostics: false,
      });
      expect(resWithoutDiag.data.diagnostics).toBeUndefined();
      expect(resWithoutDiag.data.grossSalaryMonthly).toBe(50000);
    });

    it('TC-CALC-DIAG-02: Persistent structure response mappers never expose diagnostics to ordinary users', () => {
      const mockBreakup = {
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
        diagnostics: [
          {
            componentId: basicComponentId.toString(),
            code: 'BASIC',
            name: 'Basic Salary',
            category: SalaryComponentType.EARNING,
            calculationType: StructureComponentCalculationType.FIXED,
            calculationBase: 'FIXED' as const,
            frequency: SalaryStructureFrequency.MONTHLY,
            resolvedPeriodAmount: 25000,
            monthlyAmount: 25000,
            annualAmount: 300000,
          },
        ],
      };

      const mockStructure: SalaryStructureLean = {
        _id: new Types.ObjectId(),
        name: 'Standard Template',
        code: 'STD_001',
        description: null,
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: basicComponentId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
        ],
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0,
      };

      const createResp = SalaryStructureMapper.toCreateResponse(
        mockStructure,
        mockBreakup,
      );
      expect(
        (createResp as unknown as Record<string, unknown>).diagnostics,
      ).toBeUndefined();

      const detailResp = SalaryStructureMapper.toDetailResponse(
        mockStructure,
        {},
        mockBreakup,
      );
      expect(
        (detailResp as unknown as Record<string, unknown>).diagnostics,
      ).toBeUndefined();
    });

    it('TC-CALC-SEC-01: Gated by SALARY_STRUCTURES_VIEW permission to restrict calculation to authorized personnel', () => {
      const requiredPerms = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        controller.calculatePreview,
      );
      expect(requiredPerms).toEqual([PermissionKeys.SALARY_STRUCTURES_VIEW]);
    });
  });
});
