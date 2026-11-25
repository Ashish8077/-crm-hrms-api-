/* eslint-disable @typescript-eslint/unbound-method */
import {
  ExecutionContext,
  HttpStatus,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PayrollConfigurationController } from './payroll-configuration.controller';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { PayrollSettingsService } from './services/payroll-settings.service';
import { PayrollCalculationRuleService } from './services/payroll-calculation-rule.service';
import { PayrollSettingsRepository } from './repositories/payroll-settings.repository';
import { PayrollCalculationRuleRepository } from './repositories/payroll-calculation-rule.repository';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  NegativeNetPayPolicy,
  PayrollRoundingMode,
} from './constants/payroll-configuration.constant';
import {
  SalaryComponent,
  SalaryComponentLean,
} from '../salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  CalculatePayrollPreviewDto,
  PayrollPreviewCalculationType,
} from './dto/calculate-payroll-preview.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('Payroll Calculation Preview Integration & Safety Suite', () => {
  let controller: PayrollConfigurationController;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;
  let activeUserRole: 'HR_ADMIN' | 'EMPLOYEE' = 'HR_ADMIN';

  const actorId = new Types.ObjectId();
  const superAdminRoleId = new Types.ObjectId();

  const mockRequest = {
    user: {
      userId: actorId,
      sessionId: new Types.ObjectId(),
      roleIds: [superAdminRoleId],
    },
    ip: '10.0.0.1',
    headers: { 'user-agent': 'Jest-CalculationPreview/1.0' },
  } as unknown as AuthenticatedRequest;

  // In-memory master components store
  const masterComponents = new Map<string, SalaryComponentLean>();

  const createMaster = (
    code: string,
    name: string,
    type: SalaryComponentType,
    isActive = true,
    defaultValue: number | null = null,
  ): SalaryComponentLean => {
    const id = new Types.ObjectId();
    const doc: SalaryComponentLean = {
      _id: id,
      name,
      code,
      type,
      calculationType: null,
      percentageOf: null,
      defaultValue,
      isTaxable: type === SalaryComponentType.EARNING,
      isStatutory: false,
      description: null,
      isActive,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    masterComponents.set(id.toString(), doc);
    return doc;
  };

  // Mock settings & rules state
  let currentSettings: Record<string, unknown> | null = null;
  let currentRules: Record<string, unknown> | null = null;

  const mockSalaryComponentModel = {
    find: jest
      .fn()
      .mockImplementation((query: { _id?: { $in?: Types.ObjectId[] } }) => {
        return {
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockImplementation(() => {
              if (query?._id?.$in) {
                const ids = query._id.$in.map((id) => id.toString());
                const found = ids
                  .map((id) => masterComponents.get(id))
                  .filter(Boolean) as SalaryComponentLean[];
                return Promise.resolve(found);
              }
              return Promise.resolve(Array.from(masterComponents.values()));
            }),
          }),
        };
      }),
  };

  const mockSettingsRepository = {
    findActive: jest
      .fn()
      .mockImplementation(() => Promise.resolve(currentSettings)),
  };

  const mockRuleRepository = {
    findActive: jest
      .fn()
      .mockImplementation(() => Promise.resolve(currentRules)),
  };

  const mockAuthorizationService = {
    hasPermissions: jest.fn(
      (_roleIds: Types.ObjectId[], requiredPermissions: string[]) => {
        if (activeUserRole === 'HR_ADMIN') {
          return Promise.resolve(true);
        }
        return Promise.resolve(requiredPermissions.length === 0);
      },
    ),
  };

  const createExecutionContext = (
    handler: object,
    request: unknown = mockRequest,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PayrollConfigurationController,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  const validateBody = async <T>(
    metatype: new () => T,
    body: Record<string, unknown>,
  ): Promise<T> => {
    return (await validationPipe.transform(body, {
      type: 'body',
      metatype,
    })) as T;
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollConfigurationController],
      providers: [
        PayrollCalculationService,
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: mockSalaryComponentModel,
        },
        {
          provide: PayrollSettingsRepository,
          useValue: mockSettingsRepository,
        },
        {
          provide: PayrollCalculationRuleRepository,
          useValue: mockRuleRepository,
        },
        {
          provide: PayrollSettingsService,
          useValue: { getSettings: jest.fn(), updateSettings: jest.fn() },
        },
        {
          provide: PayrollCalculationRuleService,
          useValue: {
            getCalculationRules: jest.fn(),
            updateCalculationRules: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: { createAuditLog: jest.fn() },
        },
        {
          provide: AuthorizationService,
          useValue: mockAuthorizationService,
        },
        PermissionsGuard,
        Reflector,
      ],
    }).compile();

    controller = module.get(PayrollConfigurationController);
    guard = module.get(PermissionsGuard);

    validationPipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          HttpStatus.BAD_REQUEST,
          mapValidationErrors(errors),
        ),
    });
  });

  beforeEach(() => {
    masterComponents.clear();
    currentSettings = null;
    currentRules = null;
    activeUserRole = 'HR_ADMIN';
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION A: Fixed & Percentage Calculations
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Section A: Fixed & Percentage Calculations', () => {
    it('calculates single fixed BASIC earning component correctly', async () => {
      const basic = createMaster(
        'BASIC',
        'Basic Salary',
        SalaryComponentType.EARNING,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 45000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.success).toBe(true);
      expect(res.data.summary.grossEarnings).toBe(45000);
      expect(res.data.summary.totalDeductions).toBe(0);
      expect(res.data.summary.employerContributions).toBe(0);
      expect(res.data.summary.netSalary).toBe(45000);
      expect(res.data.earnings).toHaveLength(1);
      expect(res.data.earnings[0].calculatedAmount).toBe(45000);
    });

    it('calculates multiple fixed earning components and sums Gross correctly', async () => {
      const basic = createMaster(
        'BASIC',
        'Basic Salary',
        SalaryComponentType.EARNING,
      );
      const conv = createMaster(
        'CONVEYANCE',
        'Conveyance Allowance',
        SalaryComponentType.EARNING,
      );
      const sa = createMaster(
        'SPECIAL_ALLOWANCE',
        'Special Allowance',
        SalaryComponentType.EARNING,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
          {
            componentId: conv._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 5000,
          },
          {
            componentId: sa._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 15000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.grossEarnings).toBe(50000);
      expect(res.data.summary.netSalary).toBe(50000);
      expect(res.data.earnings).toHaveLength(3);
    });

    it('calculates fixed deduction component reducing Net Pay without reducing Gross', async () => {
      const basic = createMaster(
        'BASIC',
        'Basic Salary',
        SalaryComponentType.EARNING,
      );
      const pt = createMaster(
        'PT',
        'Professional Tax',
        SalaryComponentType.EMPLOYEE_DEDUCTION,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: pt._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 200,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.grossEarnings).toBe(25000);
      expect(res.data.summary.totalDeductions).toBe(200);
      expect(res.data.summary.netSalary).toBe(24800);
      expect(res.data.deductions).toHaveLength(1);
    });

    it('classifies employer contributions separately without affecting Gross or Net', async () => {
      const basic = createMaster(
        'BASIC',
        'Basic Salary',
        SalaryComponentType.EARNING,
      );
      const gratuity = createMaster(
        'GRATUITY',
        'Gratuity Provision',
        SalaryComponentType.EMPLOYER_CONTRIBUTION,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 50000,
          },
          {
            componentId: gratuity._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 2400,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.grossEarnings).toBe(50000);
      expect(res.data.summary.totalDeductions).toBe(0);
      expect(res.data.summary.employerContributions).toBe(2400);
      expect(res.data.summary.netSalary).toBe(50000);
      expect(res.data.employerContributions).toHaveLength(1);
    });

    it('handles zero amount (0) correctly as a valid fixed component', async () => {
      const bonus = createMaster(
        'BONUS',
        'Performance Bonus',
        SalaryComponentType.EARNING,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: bonus._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 0,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);
      expect(res.data.summary.grossEarnings).toBe(0);
      expect(res.data.summary.netSalary).toBe(0);
      expect(res.data.earnings[0].calculatedAmount).toBe(0);
    });

    it('calculates percentage HRA based on BASIC accurately', async () => {
      const basic = createMaster(
        'BASIC',
        'Basic Salary',
        SalaryComponentType.EARNING,
      );
      const hra = createMaster(
        'HRA',
        'House Rent Allowance',
        SalaryComponentType.EARNING,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 40000,
          },
          {
            componentId: hra._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 40,
            percentageOf: 'BASIC',
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.grossEarnings).toBe(56000); // 40000 + 16000
      expect(res.data.summary.netSalary).toBe(56000);
      const hraItem = res.data.earnings.find((e) => e.code === 'HRA');
      expect(hraItem?.baseAmount).toBe(40000);
      expect(hraItem?.calculatedAmount).toBe(16000);
    });

    it('rejects percentage component referencing a missing base with 400 Bad Request', async () => {
      const hra = createMaster(
        'HRA',
        'House Rent Allowance',
        SalaryComponentType.EARNING,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: hra._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: 'BASIC',
          },
        ],
      });

      await expect(controller.calculatePreview(dto)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('automatically resolves topological calculation order when percentage component precedes its base in request', async () => {
      const basic = createMaster(
        'BASIC',
        'Basic Salary',
        SalaryComponentType.EARNING,
      );
      const hra = createMaster(
        'HRA',
        'House Rent Allowance',
        SalaryComponentType.EARNING,
      );

      // Pass HRA first, BASIC second
      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: hra._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: 'BASIC',
          },
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.executionOrder).toEqual(['BASIC', 'HRA']);
      expect(res.data.summary.grossEarnings).toBe(45000);
    });

    it('handles 0% and 100% percentage rates correctly', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const zeroPct = createMaster(
        'ZERO_COMP',
        'Zero Comp',
        SalaryComponentType.EARNING,
      );
      const fullPct = createMaster(
        'FULL_COMP',
        'Full Comp',
        SalaryComponentType.EARNING,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 20000,
          },
          {
            componentId: zeroPct._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 0,
            percentageOf: 'BASIC',
          },
          {
            componentId: fullPct._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 100,
            percentageOf: 'BASIC',
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(
        res.data.earnings.find((e) => e.code === 'ZERO_COMP')?.calculatedAmount,
      ).toBe(0);
      expect(
        res.data.earnings.find((e) => e.code === 'FULL_COMP')?.calculatedAmount,
      ).toBe(20000);
    });

    it('rejects negative percentage and percentage above 100 at DTO validation level', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          components: [
            {
              componentId: basic._id.toString(),
              calculationType: 'PERCENTAGE',
              percentage: -10,
              percentageOf: 'BASIC',
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          components: [
            {
              componentId: basic._id.toString(),
              calculationType: 'PERCENTAGE',
              percentage: 100.01,
              percentageOf: 'BASIC',
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects missing amount for FIXED calculation when master defaultValue is also null', async () => {
      const basic = createMaster(
        'BASIC',
        'Basic',
        SalaryComponentType.EARNING,
        true,
        null,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
          },
        ],
      });

      await expect(controller.calculatePreview(dto)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects missing percentage or percentageOf for PERCENTAGE calculation', async () => {
      const hra = createMaster('HRA', 'HRA', SalaryComponentType.EARNING);

      // Missing percentage
      const dto1 = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: hra._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentageOf: 'BASIC',
          },
        ],
      });
      await expect(controller.calculatePreview(dto1)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      // Missing percentageOf
      const dto2 = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: hra._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 50,
          },
        ],
      });
      await expect(controller.calculatePreview(dto2)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects incompatible component configurations (FIXED with percentage, or PERCENTAGE with amount)', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      // FIXED with percentage
      const dtoFixedWithPct = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 20000,
            percentage: 10,
          },
        ],
      });
      await expect(
        controller.calculatePreview(dtoFixedWithPct),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      // PERCENTAGE with amount
      const dtoPctWithAmount = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 10,
            percentageOf: 'BASIC',
            amount: 20000,
          },
        ],
      });
      await expect(
        controller.calculatePreview(dtoPctWithAmount),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION B: Proration
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Section B: Proration', () => {
    it('full-period salary (30/30) results in factor 1.0 and proration.applied false', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 30,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.proration.applied).toBe(false);
      expect(res.data.proration.factor).toBe(1);
      expect(res.data.summary.grossEarnings).toBe(30000);
    });

    it('half-period salary (15/30) applies 0.5 factor correctly', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 15,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 40000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.proration.applied).toBe(true);
      expect(res.data.proration.factor).toBe(0.5);
      expect(res.data.summary.grossEarnings).toBe(20000);
      expect(res.data.earnings[0].prorated).toBe(true);
    });

    it('zero payable days (0/30) produces 0 factor and zero earnings', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 0,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 50000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.proration.applied).toBe(true);
      expect(res.data.proration.factor).toBe(0);
      expect(res.data.summary.grossEarnings).toBe(0);
      expect(res.data.summary.netSalary).toBe(0);
    });

    it('rejects payableDays greater than totalDaysInPeriod with 400 Bad Request', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 31,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
        ],
      });

      await expect(controller.calculatePreview(dto)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects negative payableDays or zero totalDays at DTO level', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      // Negative payable days
      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          totalDaysInPeriod: 30,
          payableDays: -1,
          components: [
            {
              componentId: basic._id.toString(),
              calculationType: 'FIXED',
              amount: 10000,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      // Zero total days
      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          totalDaysInPeriod: 0,
          payableDays: 0,
          components: [
            {
              componentId: basic._id.toString(),
              calculationType: 'FIXED',
              amount: 10000,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('respects prorateFixedComponents = false (fixed earnings are NOT prorated)', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      currentRules = {
        prorateFixedComponents: false,
        prorateDeductions: false,
      };

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 15,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.grossEarnings).toBe(30000);
      expect(res.data.earnings[0].prorated).toBe(false);
    });

    it('respects prorateDeductions = true (unprorated fixed deductions ARE prorated)', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const pt = createMaster(
        'PT',
        'Professional Tax',
        SalaryComponentType.EMPLOYEE_DEDUCTION,
      );
      currentRules = {
        prorateFixedComponents: true,
        prorateDeductions: true,
      };

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 15,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
          {
            componentId: pt._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 200,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.grossEarnings).toBe(15000);
      expect(res.data.summary.totalDeductions).toBe(100); // 200 * 15/30
      expect(res.data.summary.netSalary).toBe(14900);
      expect(res.data.deductions[0].prorated).toBe(true);
    });

    it('verifies that proration is applied exactly once: percentage component is NOT double prorated', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const hra = createMaster('HRA', 'HRA', SalaryComponentType.EARNING);
      currentRules = {
        prorateFixedComponents: true,
        prorateDeductions: false,
      };

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 15,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 20000,
          },
          {
            componentId: hra._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: 'BASIC',
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      // BASIC prorated to 10,000.
      // HRA = 50% of 10,000 = 5,000. (If double-prorated, it would erroneously be 2,500).
      expect(
        res.data.earnings.find((e) => e.code === 'BASIC')?.calculatedAmount,
      ).toBe(10000);
      expect(
        res.data.earnings.find((e) => e.code === 'HRA')?.calculatedAmount,
      ).toBe(5000);
      expect(res.data.summary.grossEarnings).toBe(15000);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION C: Rounding & Precision
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Section C: Rounding & Precision', () => {
    it('applies Precision 0 rounding correctly to integers', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      currentRules = {
        roundingMode: PayrollRoundingMode.HALF_UP,
        roundingPrecision: 0,
        prorateFixedComponents: true,
      };

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 17,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      // 30000 * 17 / 30 = 17000
      expect(res.data.roundingPrecision).toBe(0);
      expect(res.data.summary.grossEarnings).toBe(17000);
    });

    it('applies HALF_EVEN (Bankers Rounding) tie rounding to even digits', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const testComp = createMaster(
        'TEST_COMP',
        'Test',
        SalaryComponentType.EARNING,
      );
      currentRules = {
        roundingMode: PayrollRoundingMode.HALF_EVEN,
        roundingPrecision: 0,
      };

      // 2.5 rounds to 2 (even digit), while 3.5 rounds to 4 (even digit)
      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 2.5,
          },
          {
            componentId: testComp._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 3.5,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      const basicItem = res.data.earnings.find((e) => e.code === 'BASIC');
      const testItem = res.data.earnings.find((e) => e.code === 'TEST_COMP');

      expect(basicItem?.calculatedAmount).toBe(2);
      expect(testItem?.calculatedAmount).toBe(4);
    });

    it('ensures consistent rounding between line items and totals', async () => {
      const c1 = createMaster('C1', 'Comp 1', SalaryComponentType.EARNING);
      const c2 = createMaster('C2', 'Comp 2', SalaryComponentType.EARNING);
      const d1 = createMaster(
        'D1',
        'Deduction 1',
        SalaryComponentType.EMPLOYEE_DEDUCTION,
      );

      currentRules = {
        roundingMode: PayrollRoundingMode.HALF_EVEN,
        roundingPrecision: 2,
      };

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: c1._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 10000.33,
          },
          {
            componentId: c2._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 20000.67,
          },
          {
            componentId: d1._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 500.56,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      // C1: 10000.33, C2: 20000.67 => Gross: 30001.00
      // D1: 500.56 => Total Deductions: 500.56
      // Net: 30001.00 - 500.56 = 29500.44
      expect(res.data.summary.grossEarnings).toBe(30001);
      expect(res.data.summary.totalDeductions).toBe(500.56);
      expect(res.data.summary.netSalary).toBe(29500.44);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION D: Negative Net Pay Handling
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Section D: Negative Net Pay Handling', () => {
    it('Gross greater than deductions results in positive Net and netPayClamped false', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const pf = createMaster(
        'PF',
        'PF',
        SalaryComponentType.EMPLOYEE_DEDUCTION,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
          {
            componentId: pf._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 3600,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.netSalary).toBe(26400);
      expect(res.data.summary.netPayClamped).toBe(false);
    });

    it('Gross exactly equals deductions results in Net = 0 and netPayClamped false', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const ded = createMaster(
        'DED',
        'Deduction',
        SalaryComponentType.EMPLOYEE_DEDUCTION,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 15000,
          },
          {
            componentId: ded._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 15000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.netSalary).toBe(0);
      expect(res.data.summary.netPayClamped).toBe(false);
    });

    it('Deductions exceed Gross with REJECT policy throws 400 Bad Request', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const ded = createMaster(
        'DED',
        'Deduction',
        SalaryComponentType.EMPLOYEE_DEDUCTION,
      );
      currentRules = {
        negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
      };

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 10000,
          },
          {
            componentId: ded._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 12000,
          },
        ],
      });

      await expect(controller.calculatePreview(dto)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('Deductions exceed Gross with CLAMP_TO_ZERO policy clamps Net to 0 with netPayClamped true', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const ded = createMaster(
        'DED',
        'Deduction',
        SalaryComponentType.EMPLOYEE_DEDUCTION,
      );
      currentRules = {
        negativeNetPayPolicy: NegativeNetPayPolicy.CLAMP_TO_ZERO,
      };

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 10000,
          },
          {
            componentId: ded._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 15000,
          },
        ],
      });

      const res = await controller.calculatePreview(dto);

      expect(res.data.summary.grossEarnings).toBe(10000);
      expect(res.data.summary.totalDeductions).toBe(15000);
      expect(res.data.summary.netSalary).toBe(0);
      expect(res.data.summary.netPayClamped).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION E: Component Validation & Integrity
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Section E: Component Validation & Integrity', () => {
    it('rejects invalid MongoDB ID in componentId at DTO level', async () => {
      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          components: [
            {
              componentId: 'invalid-not-a-mongo-id',
              calculationType: 'FIXED',
              amount: 10000,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects nonexistent componentId with 404 RESOURCE_NOT_FOUND', async () => {
      const nonexistentId = new Types.ObjectId().toString();

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: nonexistentId,
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 10000,
          },
        ],
      });

      await expect(controller.calculatePreview(dto)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('rejects inactive component with 400 Bad Request', async () => {
      const inactiveComp = createMaster(
        'OLD_ALLOWANCE',
        'Old',
        SalaryComponentType.EARNING,
        false,
      );

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: inactiveComp._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 5000,
          },
        ],
      });

      await expect(controller.calculatePreview(dto)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects duplicate componentId in input with 400 Bad Request', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 20000,
          },
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 10000,
          },
        ],
      });

      await expect(controller.calculatePreview(dto)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects unsupported calculation type at DTO level', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          components: [
            {
              componentId: basic._id.toString(),
              calculationType: 'BALANCE', // unsupported in preview
              amount: 10000,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects empty components array at DTO level', async () => {
      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          components: [],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects missing components array at DTO level', async () => {
      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          totalDaysInPeriod: 30,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects unknown request properties according to whitelist policy', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);

      await expect(
        validateBody(CalculatePayrollPreviewDto, {
          components: [
            {
              componentId: basic._id.toString(),
              calculationType: 'FIXED',
              amount: 10000,
            },
          ],
          unknownProperty: 'injection',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION F: Preview Isolation and Safety
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Section F: Preview Isolation and Safety', () => {
    it('guarded by PAYROLL_SETTINGS_VIEW permission: unauthorized employee receives 403 Forbidden', async () => {
      const handler = controller.calculatePreview;
      const context = createExecutionContext(handler);

      activeUserRole = 'HR_ADMIN';
      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);

      activeUserRole = 'EMPLOYEE';
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('deterministic calculation: identical requests yield identical results', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const hra = createMaster('HRA', 'HRA', SalaryComponentType.EARNING);

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        totalDaysInPeriod: 30,
        payableDays: 20,
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 30000,
          },
          {
            componentId: hra._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 40,
            percentageOf: 'BASIC',
          },
        ],
      });

      const res1 = await controller.calculatePreview(dto);
      const res2 = await controller.calculatePreview(dto);

      expect(res1.data).toEqual(res2.data);
    });

    it('preview is strictly read-only: does not modify or persist any payroll data', async () => {
      const basic = createMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
      const initialMasterCount = masterComponents.size;

      const dto = await validateBody(CalculatePayrollPreviewDto, {
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 50000,
          },
        ],
      });

      await controller.calculatePreview(dto);

      // Verify no database mutation
      expect(masterComponents.size).toBe(initialMasterCount);
      expect(mockSettingsRepository.findActive).toHaveBeenCalled();
    });
  });
});
