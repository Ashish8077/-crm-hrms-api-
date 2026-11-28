/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
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
import { PayrollSettingsService } from './services/payroll-settings.service';
import { PayrollCalculationRuleService } from './services/payroll-calculation-rule.service';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import {
  PayrollCalculationRuleRepository,
  UpsertPayrollCalculationRuleInput,
} from './repositories/payroll-calculation-rule.repository';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import {
  NegativeNetPayPolicy,
  PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
  PAYROLL_CONFIGURATION_DEFAULTS,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from './constants/payroll-configuration.constant';
import { PayrollCalculationRuleLean } from './schemas/payroll-calculation-rule.schema';
import { SalaryComponent } from '../salary-components/schemas/salary-component.schema';
import { UpdateCalculationRulesDto } from './dto/update-calculation-rules.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

/**
 * Stateful in-memory repository simulating MongoDB collection for Calculation Rules:
 * - Singleton unique index enforcement on singletonKey: 1
 * - Atomic findOneAndUpdate with optimistic concurrency (__v matching)
 * - Partial field updates ($set semantics preserving unchanged fields & statutoryConfig merging)
 * - Fault injection for database failures and race-condition duplicate key errors
 */
class InMemoryPayrollCalculationRuleRepository {
  private store = new Map<string, PayrollCalculationRuleLean>();

  public simulateDbError: Error | null = null;
  public simulateDuplicateKeyError = false;
  public simulateDuplicateKeyOnDefaultOnce = false;

  clear(): void {
    this.store.clear();
    this.simulateDbError = null;
    this.simulateDuplicateKeyError = false;
    this.simulateDuplicateKeyOnDefaultOnce = false;
  }

  seed(doc: PayrollCalculationRuleLean): void {
    this.store.set(PAYROLL_CALCULATION_RULES_SINGLETON_KEY, { ...doc });
  }

  getStoreCount(): number {
    return this.store.size;
  }

  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as { code?: number; message?: string };
    return (
      err.code === 11000 ||
      (typeof err.message === 'string' && err.message.includes('E11000'))
    );
  }

  async findActive(): Promise<PayrollCalculationRuleLean | null> {
    if (this.simulateDbError) {
      throw this.simulateDbError;
    }
    const doc = this.store.get(PAYROLL_CALCULATION_RULES_SINGLETON_KEY);
    return doc ? { ...doc } : null;
  }

  async findOrCreateDefault(
    actorId: Types.ObjectId | null,
  ): Promise<{ rule: PayrollCalculationRuleLean; created: boolean }> {
    if (this.simulateDbError) {
      throw this.simulateDbError;
    }

    const existing = await this.findActive();
    if (existing) {
      return { rule: existing, created: false };
    }

    try {
      if (this.simulateDuplicateKeyOnDefaultOnce) {
        this.simulateDuplicateKeyOnDefaultOnce = false;
        const dupError = Object.assign(
          new Error(
            'E11000 duplicate key error collection: payroll_calculation_rules index: singletonKey_1',
          ),
          { code: 11000 },
        );
        throw dupError;
      }

      const defaultDoc: PayrollCalculationRuleLean = {
        _id: new Types.ObjectId(),
        singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
        roundingMode: PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_MODE,
        roundingPrecision: PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION,
        prorationPolicy: PAYROLL_CONFIGURATION_DEFAULTS.PRORATION_POLICY,
        prorateFixedComponents:
          PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_FIXED_COMPONENTS,
        prorateDeductions: PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_DEDUCTIONS,
        prorateEmployerContributions:
          PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_EMPLOYER_CONTRIBUTIONS,
        negativeNetPayPolicy:
          PAYROLL_CONFIGURATION_DEFAULTS.NEGATIVE_NET_PAY_POLICY,
        statutoryConfig: {
          ...PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG,
        },
        componentExecutionOrder: [],
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0,
      };

      this.store.set(PAYROLL_CALCULATION_RULES_SINGLETON_KEY, defaultDoc);
      return { rule: { ...defaultDoc }, created: true };
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        const doc = await this.findActive();
        if (doc) {
          return { rule: doc, created: false };
        }
      }
      throw error;
    }
  }

  async upsertRule(
    data: UpsertPayrollCalculationRuleInput,
    actorId: Types.ObjectId,
    expectedVersion?: number,
  ): Promise<PayrollCalculationRuleLean | null> {
    if (this.simulateDbError) {
      throw this.simulateDbError;
    }

    if (this.simulateDuplicateKeyError) {
      const dupError = new Error(
        'E11000 duplicate key error collection: payroll_calculation_rules index: singletonKey_1',
      ) as Error & { code: number };
      dupError.code = 11000;
      throw dupError;
    }

    const current = this.store.get(PAYROLL_CALCULATION_RULES_SINGLETON_KEY);

    if (current && expectedVersion !== undefined) {
      if (current.__v !== expectedVersion) {
        return null;
      }
    }

    const now = new Date();
    const existing = current ?? {
      _id: new Types.ObjectId(),
      singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
      roundingMode: PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_MODE,
      roundingPrecision: PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION,
      prorationPolicy: PAYROLL_CONFIGURATION_DEFAULTS.PRORATION_POLICY,
      prorateFixedComponents:
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_FIXED_COMPONENTS,
      prorateDeductions: PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_DEDUCTIONS,
      prorateEmployerContributions:
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_EMPLOYER_CONTRIBUTIONS,
      negativeNetPayPolicy:
        PAYROLL_CONFIGURATION_DEFAULTS.NEGATIVE_NET_PAY_POLICY,
      statutoryConfig: { ...PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG },
      componentExecutionOrder: [],
      createdBy: actorId,
      createdAt: now,
      __v: 0,
    };

    const updated: PayrollCalculationRuleLean = {
      _id: existing._id,
      singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
      roundingMode: data.roundingMode ?? existing.roundingMode,
      roundingPrecision: data.roundingPrecision ?? existing.roundingPrecision,
      prorationPolicy: data.prorationPolicy ?? existing.prorationPolicy,
      prorateFixedComponents:
        data.prorateFixedComponents ?? existing.prorateFixedComponents,
      prorateDeductions: data.prorateDeductions ?? existing.prorateDeductions,
      prorateEmployerContributions:
        data.prorateEmployerContributions ??
        existing.prorateEmployerContributions,
      negativeNetPayPolicy:
        data.negativeNetPayPolicy ?? existing.negativeNetPayPolicy,
      statutoryConfig: data.statutoryConfig
        ? { ...data.statutoryConfig }
        : { ...existing.statutoryConfig },
      componentExecutionOrder:
        data.componentExecutionOrder !== undefined
          ? [...data.componentExecutionOrder]
          : [...existing.componentExecutionOrder],
      createdBy: existing.createdBy,
      updatedBy: actorId,
      createdAt: existing.createdAt,
      updatedAt: now,
      __v: existing.__v + 1,
    };

    this.store.set(PAYROLL_CALCULATION_RULES_SINGLETON_KEY, updated);
    return { ...updated };
  }
}

describe('Payroll Calculation Rules Integration & Validation Suite', () => {
  let controller: PayrollConfigurationController;
  let repository: InMemoryPayrollCalculationRuleRepository;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;
  let activeUserRole: 'SUPER_ADMIN' | 'HR_ADMIN' | 'EMPLOYEE' = 'SUPER_ADMIN';

  const actorId = new Types.ObjectId();
  const superAdminRoleId = new Types.ObjectId();

  const mockRequest = {
    user: {
      userId: actorId,
      sessionId: new Types.ObjectId(),
      roleIds: [superAdminRoleId],
    },
    ip: '192.168.1.100',
    headers: { 'user-agent': 'Jest-PayrollCalculationRuleTest/2.0' },
  } as unknown as AuthenticatedRequest;

  const mockAuditLogsService = {
    createAuditLog: jest.fn().mockResolvedValue(undefined),
  };

  const mockSalaryComponentModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockImplementation(() => {
            return Promise.resolve([
              { code: 'BASIC' },
              { code: 'HRA' },
              { code: 'SPECIAL_ALLOWANCE' },
              { code: 'PF' },
              { code: 'PT' },
              { code: 'TDS' },
              { code: 'GRATUITY' },
            ]);
          }),
        }),
      }),
    }),
  };

  const mockAuthorizationService = {
    hasPermissions: jest.fn(
      (_roleIds: Types.ObjectId[], requiredPermissions: string[]) => {
        if (activeUserRole === 'SUPER_ADMIN' || activeUserRole === 'HR_ADMIN') {
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
    repository = new InMemoryPayrollCalculationRuleRepository();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollConfigurationController],
      providers: [
        PayrollCalculationRuleService,
        {
          provide: PayrollCalculationRuleRepository,
          useValue: repository,
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: mockSalaryComponentModel,
        },
        {
          provide: PayrollSettingsService,
          useValue: {
            getSettings: jest.fn(),
            updateSettings: jest.fn(),
          },
        },
        {
          provide: PayrollCalculationService,
          useValue: {
            calculatePreview: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogsService,
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
    repository.clear();
    jest.clearAllMocks();
    activeUserRole = 'SUPER_ADMIN';
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GROUP 1: Retrieval & Missing Rules Handling
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Group 1: Retrieval & Missing Rules Handling', () => {
    it('1.1 Retrieves existing calculation rules and hides internal singletonKey', async () => {
      repository.seed({
        _id: new Types.ObjectId(),
        singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
        roundingMode: PayrollRoundingMode.HALF_UP,
        roundingPrecision: 0,
        prorationPolicy: PayrollProrationPolicy.WORKING_DAYS,
        prorateFixedComponents: false,
        prorateDeductions: true,
        prorateEmployerContributions: false,
        negativeNetPayPolicy: NegativeNetPayPolicy.CLAMP_TO_ZERO,
        statutoryConfig: {
          pfEnabled: true,
          esiEnabled: false,
          ptEnabled: true,
          tdsEnabled: false,
        },
        componentExecutionOrder: ['BASIC', 'HRA'],
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        __v: 2,
      });

      const res = await controller.getCalculationRules();

      expect(res.success).toBe(true);
      expect(res.data.roundingMode).toBe(PayrollRoundingMode.HALF_UP);
      expect(res.data.roundingPrecision).toBe(0);
      expect(res.data.prorationPolicy).toBe(
        PayrollProrationPolicy.WORKING_DAYS,
      );
      expect(res.data.prorateFixedComponents).toBe(false);
      expect(res.data.prorateDeductions).toBe(true);
      expect(res.data.negativeNetPayPolicy).toBe(
        NegativeNetPayPolicy.CLAMP_TO_ZERO,
      );
      expect(res.data.statutoryConfig).toEqual({
        pfEnabled: true,
        esiEnabled: false,
        ptEnabled: true,
        tdsEnabled: false,
      });
      expect(res.data.componentExecutionOrder).toEqual(['BASIC', 'HRA']);
      expect(res.data.version).toBe(2);
      expect(
        (res.data as unknown as Record<string, unknown>).singletonKey,
      ).toBeUndefined();
    });

    it('1.2 Missing rules: auto-initializes and returns system defaults', async () => {
      expect(repository.getStoreCount()).toBe(0);

      const res = await controller.getCalculationRules();

      expect(res.success).toBe(true);
      expect(repository.getStoreCount()).toBe(1);
      expect(res.data.roundingMode).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_MODE,
      );
      expect(res.data.roundingPrecision).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION,
      );
      expect(res.data.prorationPolicy).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATION_POLICY,
      );
      expect(res.data.prorateFixedComponents).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_FIXED_COMPONENTS,
      );
      expect(res.data.prorateDeductions).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_DEDUCTIONS,
      );
      expect(res.data.negativeNetPayPolicy).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.NEGATIVE_NET_PAY_POLICY,
      );
      expect(res.data.statutoryConfig).toEqual(
        PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG,
      );
      expect(res.data.componentExecutionOrder).toEqual([]);
      expect(res.data.version).toBe(0);
    });

    it('1.3 Handles duplicate key race condition gracefully during concurrent first read', async () => {
      repository.seed({
        _id: new Types.ObjectId(),
        singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
        roundingMode: PayrollRoundingMode.HALF_EVEN,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: false,
        prorateEmployerContributions: false,
        negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
        statutoryConfig: { ...PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG },
        componentExecutionOrder: [],
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0,
      });
      repository.simulateDuplicateKeyOnDefaultOnce = true;

      const res = await controller.getCalculationRules();
      expect(res.success).toBe(true);
      expect(res.data.version).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GROUP 2: Create, Update & Partial Updates
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Group 2: Create, Update & Partial Updates', () => {
    it('2.1 Creates calculation rules if none exist without duplicate documents', async () => {
      expect(repository.getStoreCount()).toBe(0);

      const dto = await validateBody(UpdateCalculationRulesDto, {
        roundingMode: PayrollRoundingMode.HALF_UP,
        roundingPrecision: 3,
      });

      const res = await controller.updateCalculationRules(dto, mockRequest);

      expect(res.success).toBe(true);
      expect(repository.getStoreCount()).toBe(1);
      expect(res.data.roundingMode).toBe(PayrollRoundingMode.HALF_UP);
      expect(res.data.roundingPrecision).toBe(3);
      expect(mockAuditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PAYROLL_CALCULATION_RULES_UPDATED,
          targetModel: AuditTargetModel.PAYROLL_CALCULATION_RULE,
        }),
      );
    });

    it('2.2 Partial update: updating only roundingMode preserves all other fields', async () => {
      await controller.getCalculationRules(); // seed defaults

      const dto = await validateBody(UpdateCalculationRulesDto, {
        roundingMode: PayrollRoundingMode.FLOOR,
      });

      const res = await controller.updateCalculationRules(dto, mockRequest);

      expect(res.success).toBe(true);
      expect(res.data.roundingMode).toBe(PayrollRoundingMode.FLOOR);
      expect(res.data.roundingPrecision).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION,
      );
      expect(res.data.prorationPolicy).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATION_POLICY,
      );
      expect(res.data.prorateFixedComponents).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_FIXED_COMPONENTS,
      );
      expect(res.data.prorateDeductions).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_DEDUCTIONS,
      );
      expect(res.data.negativeNetPayPolicy).toBe(
        PAYROLL_CONFIGURATION_DEFAULTS.NEGATIVE_NET_PAY_POLICY,
      );
      expect(res.data.statutoryConfig).toEqual(
        PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG,
      );
      expect(repository.getStoreCount()).toBe(1);
    });

    it('2.3 Nested statutoryConfig partial update preserves other statutory flags', async () => {
      await controller.getCalculationRules();

      const dto = await validateBody(UpdateCalculationRulesDto, {
        statutoryConfig: {
          pfEnabled: false,
        },
      });

      const res = await controller.updateCalculationRules(dto, mockRequest);

      expect(res.success).toBe(true);
      expect(res.data.statutoryConfig).toEqual({
        pfEnabled: false,
        esiEnabled: true,
        ptEnabled: true,
        tdsEnabled: true,
      });
    });

    it('2.4 Omitted componentExecutionOrder does not erase existing configured execution order', async () => {
      // First update sets an order
      const firstDto = await validateBody(UpdateCalculationRulesDto, {
        componentExecutionOrder: ['BASIC', 'HRA', 'PF'],
      });
      await controller.updateCalculationRules(firstDto, mockRequest);

      // Second partial update does NOT include componentExecutionOrder
      const secondDto = await validateBody(UpdateCalculationRulesDto, {
        roundingPrecision: 4,
      });
      const res = await controller.updateCalculationRules(
        secondDto,
        mockRequest,
      );

      expect(res.success).toBe(true);
      expect(res.data.roundingPrecision).toBe(4);
      expect(res.data.componentExecutionOrder).toEqual(['BASIC', 'HRA', 'PF']);
    });

    it('2.5 Explicit empty array [] clears componentExecutionOrder', async () => {
      const firstDto = await validateBody(UpdateCalculationRulesDto, {
        componentExecutionOrder: ['BASIC', 'HRA'],
      });
      await controller.updateCalculationRules(firstDto, mockRequest);

      const secondDto = await validateBody(UpdateCalculationRulesDto, {
        componentExecutionOrder: [],
      });
      const res = await controller.updateCalculationRules(
        secondDto,
        mockRequest,
      );

      expect(res.success).toBe(true);
      expect(res.data.componentExecutionOrder).toEqual([]);
    });

    it('2.6 Persistence verified: retrieving rules after updates returns the persisted document', async () => {
      const dto = await validateBody(UpdateCalculationRulesDto, {
        roundingMode: PayrollRoundingMode.CEIL,
        roundingPrecision: 3,
        prorationPolicy: PayrollProrationPolicy.FIXED_30_DAYS,
        negativeNetPayPolicy: NegativeNetPayPolicy.CLAMP_TO_ZERO,
        prorateFixedComponents: false,
        prorateDeductions: true,
      });
      await controller.updateCalculationRules(dto, mockRequest);

      const fetched = await controller.getCalculationRules();
      expect(fetched.data.roundingMode).toBe(PayrollRoundingMode.CEIL);
      expect(fetched.data.roundingPrecision).toBe(3);
      expect(fetched.data.prorationPolicy).toBe(
        PayrollProrationPolicy.FIXED_30_DAYS,
      );
      expect(fetched.data.negativeNetPayPolicy).toBe(
        NegativeNetPayPolicy.CLAMP_TO_ZERO,
      );
      expect(fetched.data.prorateFixedComponents).toBe(false);
      expect(fetched.data.prorateDeductions).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GROUP 3: DTO Validations & Enum Constraints
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Group 3: DTO Validations & Enum Constraints', () => {
    it('3.1 Validates roundingMode enum and rejects invalid values', async () => {
      for (const mode of Object.values(PayrollRoundingMode)) {
        const dto = await validateBody(UpdateCalculationRulesDto, {
          roundingMode: mode,
        });
        expect(dto.roundingMode).toBe(mode);
      }

      await expect(
        validateBody(UpdateCalculationRulesDto, {
          roundingMode: 'INVALID_ROUNDING',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('3.2 Validates roundingPrecision boundaries (0 to 4)', async () => {
      for (const precision of [0, 1, 2, 3, 4]) {
        const dto = await validateBody(UpdateCalculationRulesDto, {
          roundingPrecision: precision,
        });
        expect(dto.roundingPrecision).toBe(precision);
      }

      // Below min: -1
      await expect(
        validateBody(UpdateCalculationRulesDto, { roundingPrecision: -1 }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      // Above max: 5
      await expect(
        validateBody(UpdateCalculationRulesDto, { roundingPrecision: 5 }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      // Non-integer: 2.5
      await expect(
        validateBody(UpdateCalculationRulesDto, { roundingPrecision: 2.5 }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('3.3 Validates prorationPolicy enum and rejects invalid values', async () => {
      for (const policy of Object.values(PayrollProrationPolicy)) {
        const dto = await validateBody(UpdateCalculationRulesDto, {
          prorationPolicy: policy,
        });
        expect(dto.prorationPolicy).toBe(policy);
      }

      await expect(
        validateBody(UpdateCalculationRulesDto, {
          prorationPolicy: 'UNKNOWN_POLICY',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('3.4 Validates negativeNetPayPolicy enum and rejects invalid values', async () => {
      for (const policy of Object.values(NegativeNetPayPolicy)) {
        const dto = await validateBody(UpdateCalculationRulesDto, {
          negativeNetPayPolicy: policy,
        });
        expect(dto.negativeNetPayPolicy).toBe(policy);
      }

      await expect(
        validateBody(UpdateCalculationRulesDto, {
          negativeNetPayPolicy: 'ALLOW_NEGATIVE',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('3.5 Validates boolean values for prorateFixedComponents, prorateDeductions, and prorateEmployerContributions', async () => {
      const dto = await validateBody(UpdateCalculationRulesDto, {
        prorateFixedComponents: false,
        prorateDeductions: true,
        prorateEmployerContributions: true,
      });
      expect(dto.prorateFixedComponents).toBe(false);
      expect(dto.prorateDeductions).toBe(true);
      expect(dto.prorateEmployerContributions).toBe(true);

      await expect(
        validateBody(UpdateCalculationRulesDto, {
          prorateEmployerContributions: 'not-a-boolean',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('3.6 Validates nested statutoryConfig boolean flags and rejects invalid types', async () => {
      await expect(
        validateBody(UpdateCalculationRulesDto, {
          statutoryConfig: {
            pfEnabled: 'yes',
          },
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('3.7 Rejects unknown request properties according to whitelist policy', async () => {
      await expect(
        validateBody(UpdateCalculationRulesDto, {
          roundingPrecision: 2,
          unrecognizedField: 'malicious-data',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GROUP 4: Component Execution Order & Master Validation
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Group 4: Component Execution Order & Master Validation', () => {
    it('4.1 Validates componentExecutionOrder against existing component codes in master', async () => {
      const dto = await validateBody(UpdateCalculationRulesDto, {
        componentExecutionOrder: ['BASIC', 'HRA', 'PF'],
      });

      const res = await controller.updateCalculationRules(dto, mockRequest);
      expect(res.success).toBe(true);
      expect(res.data.componentExecutionOrder).toEqual(['BASIC', 'HRA', 'PF']);
    });

    it('4.2 Rejects unknown component codes not present in SalaryComponent master', async () => {
      const dto = await validateBody(UpdateCalculationRulesDto, {
        componentExecutionOrder: ['BASIC', 'NON_EXISTENT_COMPONENT'],
      });

      await expect(
        controller.updateCalculationRules(dto, mockRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('4.3 Rejects duplicate component codes in componentExecutionOrder', async () => {
      await expect(
        validateBody(UpdateCalculationRulesDto, {
          componentExecutionOrder: ['BASIC', 'HRA', 'BASIC'],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('4.4 Normalizes lowercase and trimmed component codes', async () => {
      const dto = await validateBody(UpdateCalculationRulesDto, {
        componentExecutionOrder: [' basic ', 'hra '],
      });

      expect(dto.componentExecutionOrder).toEqual(['BASIC', 'HRA']);
      const res = await controller.updateCalculationRules(dto, mockRequest);
      expect(res.data.componentExecutionOrder).toEqual(['BASIC', 'HRA']);
    });

    it('4.5 Rejects case-insensitive duplicates produced after normalization', async () => {
      await expect(
        validateBody(UpdateCalculationRulesDto, {
          componentExecutionOrder: ['basic', 'BASIC'],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GROUP 5: Optimistic Concurrency Control
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Group 5: Optimistic Concurrency Control', () => {
    it('5.1 Rejects update with 409 Conflict if provided version does not match current __v', async () => {
      await controller.getCalculationRules(); // seed __v: 0

      const dto = await validateBody(UpdateCalculationRulesDto, {
        roundingMode: PayrollRoundingMode.HALF_UP,
        version: 99, // Stale version
      });

      await expect(
        controller.updateCalculationRules(dto, mockRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('5.2 Successfully increments __v from 0 to 1 with matching version', async () => {
      await controller.getCalculationRules(); // seed __v: 0

      const dto = await validateBody(UpdateCalculationRulesDto, {
        roundingMode: PayrollRoundingMode.HALF_UP,
        version: 0,
      });

      const res = await controller.updateCalculationRules(dto, mockRequest);
      expect(res.success).toBe(true);
      expect(res.data.version).toBe(1);
    });

    it('5.3 Consecutive concurrent update without refreshing version fails with 409', async () => {
      await controller.getCalculationRules(); // seed __v: 0

      const dto1 = await validateBody(UpdateCalculationRulesDto, {
        roundingPrecision: 1,
        version: 0,
      });
      await controller.updateCalculationRules(dto1, mockRequest); // increments to __v: 1

      // Second administrator uses stale version 0
      const dto2 = await validateBody(UpdateCalculationRulesDto, {
        roundingPrecision: 3,
        version: 0,
      });

      await expect(
        controller.updateCalculationRules(dto2, mockRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GROUP 6: RBAC Authorization Enforcement
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Group 6: RBAC Authorization Enforcement', () => {
    it('6.1 GET /calculation-rules requires PAYROLL_SETTINGS_VIEW permission', async () => {
      const handler = controller.getCalculationRules;
      const context = createExecutionContext(handler);

      activeUserRole = 'SUPER_ADMIN';
      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);

      activeUserRole = 'EMPLOYEE';
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('6.2 PUT /calculation-rules requires PAYROLL_SETTINGS_EDIT permission', async () => {
      const handler = controller.updateCalculationRules;
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

    it('6.3 Unauthenticated request throws 401 Unauthorized', async () => {
      const handler = controller.getCalculationRules;
      const unauthContext = createExecutionContext(handler, {
        user: undefined,
        ip: '127.0.0.1',
        headers: {},
      });

      await expect(guard.canActivate(unauthContext)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
        statusCode: HttpStatus.UNAUTHORIZED,
      });
    });
  });
});
