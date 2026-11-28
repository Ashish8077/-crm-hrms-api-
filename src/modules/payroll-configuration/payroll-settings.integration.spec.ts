/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import {
  ExecutionContext,
  HttpStatus,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { PayrollConfigurationController } from './payroll-configuration.controller';
import { PayrollSettingsService } from './services/payroll-settings.service';
import {
  PayrollSettingsRepository,
  UpsertPayrollSettingsInput,
} from './repositories/payroll-settings.repository';
import { PayrollCalculationRuleService } from './services/payroll-calculation-rule.service';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  PAYROLL_CONFIGURATION_DEFAULTS,
  PAYROLL_SETTINGS_SINGLETON_KEY,
  PayrollFrequency,
  WorkingDaysPolicy,
} from './constants/payroll-configuration.constant';
import { PayrollSettingsLean } from './schemas/payroll-settings.schema';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

/**
 * Stateful in-memory repository simulating MongoDB collection behavior:
 * - Singleton unique index enforcement on singletonKey: 1
 * - Atomic findOneAndUpdate with optimistic concurrency (__v matching)
 * - Partial field updates ($set semantics preserving unchanged fields)
 * - Fault injection for database failures and race-condition duplicate key errors
 */
class InMemoryPayrollSettingsRepository {
  private store = new Map<string, PayrollSettingsLean>();

  // Fault injection hooks
  public simulateDbError: Error | null = null;
  public simulateDuplicateKeyError = false;
  public simulateDuplicateKeyOnDefaultOnce = false;

  clear(): void {
    this.store.clear();
    this.simulateDbError = null;
    this.simulateDuplicateKeyError = false;
    this.simulateDuplicateKeyOnDefaultOnce = false;
  }

  seed(doc: PayrollSettingsLean): void {
    this.store.set(PAYROLL_SETTINGS_SINGLETON_KEY, { ...doc });
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

  async findActive(): Promise<PayrollSettingsLean | null> {
    if (this.simulateDbError) {
      throw this.simulateDbError;
    }
    const doc = this.store.get(PAYROLL_SETTINGS_SINGLETON_KEY);
    return doc ? { ...doc } : null;
  }

  async findOrCreateDefault(
    actorId: Types.ObjectId | null,
  ): Promise<{ settings: PayrollSettingsLean; created: boolean }> {
    if (this.simulateDbError) {
      throw this.simulateDbError;
    }

    const existing = await this.findActive();
    if (existing) {
      return { settings: existing, created: false };
    }

    try {
      if (this.simulateDuplicateKeyOnDefaultOnce) {
        // Simulate another thread winning the insert race
        this.simulateDuplicateKeyOnDefaultOnce = false;
        const racedDoc: PayrollSettingsLean = {
          _id: new Types.ObjectId(),
          singletonKey: PAYROLL_SETTINGS_SINGLETON_KEY,
          currency: PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY,
          currencyPrecision: PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY_PRECISION,
          payrollFrequency: PAYROLL_CONFIGURATION_DEFAULTS.PAYROLL_FREQUENCY,
          cutoffDay: PAYROLL_CONFIGURATION_DEFAULTS.CUTOFF_DAY,
          paymentDay: PAYROLL_CONFIGURATION_DEFAULTS.PAYMENT_DAY,
          financialYearStartMonth:
            PAYROLL_CONFIGURATION_DEFAULTS.FINANCIAL_YEAR_START_MONTH,
          workingDaysPolicy: PAYROLL_CONFIGURATION_DEFAULTS.WORKING_DAYS_POLICY,
          fixedWorkingDaysPerMonth:
            PAYROLL_CONFIGURATION_DEFAULTS.FIXED_WORKING_DAYS_PER_MONTH,
          isPayrollProcessingEnabled:
            PAYROLL_CONFIGURATION_DEFAULTS.IS_PAYROLL_PROCESSING_ENABLED,
          hasProcessedPayroll: false,
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: new Date(),
          updatedAt: new Date(),
          __v: 0,
        };
        this.store.set(PAYROLL_SETTINGS_SINGLETON_KEY, racedDoc);

        const dupErr = new Error(
          'E11000 duplicate key error collection: payroll_settings index: uq_payroll_settings_singleton',
        );
        (dupErr as unknown as { code: number }).code = 11000;
        throw dupErr;
      }

      const now = new Date();
      const doc: PayrollSettingsLean = {
        _id: new Types.ObjectId(),
        singletonKey: PAYROLL_SETTINGS_SINGLETON_KEY,
        currency: PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY,
        currencyPrecision: PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY_PRECISION,
        payrollFrequency: PAYROLL_CONFIGURATION_DEFAULTS.PAYROLL_FREQUENCY,
        cutoffDay: PAYROLL_CONFIGURATION_DEFAULTS.CUTOFF_DAY,
        paymentDay: PAYROLL_CONFIGURATION_DEFAULTS.PAYMENT_DAY,
        financialYearStartMonth:
          PAYROLL_CONFIGURATION_DEFAULTS.FINANCIAL_YEAR_START_MONTH,
        workingDaysPolicy: PAYROLL_CONFIGURATION_DEFAULTS.WORKING_DAYS_POLICY,
        fixedWorkingDaysPerMonth:
          PAYROLL_CONFIGURATION_DEFAULTS.FIXED_WORKING_DAYS_PER_MONTH,
        isPayrollProcessingEnabled:
          PAYROLL_CONFIGURATION_DEFAULTS.IS_PAYROLL_PROCESSING_ENABLED,
        hasProcessedPayroll: false,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: now,
        updatedAt: now,
        __v: 0,
      };
      this.store.set(PAYROLL_SETTINGS_SINGLETON_KEY, doc);
      return { settings: { ...doc }, created: true };
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        const doc = await this.findActive();
        if (doc) {
          return { settings: doc, created: false };
        }
      }
      throw error;
    }
  }

  async upsertSettings(
    data: UpsertPayrollSettingsInput,
    actorId: Types.ObjectId,
    expectedVersion?: number,
  ): Promise<PayrollSettingsLean | null> {
    if (this.simulateDbError) {
      throw this.simulateDbError;
    }

    if (this.simulateDuplicateKeyError) {
      const dupErr = new Error(
        'E11000 duplicate key error collection: payroll_settings index: uq_payroll_settings_singleton',
      );
      (dupErr as unknown as { code: number }).code = 11000;
      throw dupErr;
    }

    const existing = this.store.get(PAYROLL_SETTINGS_SINGLETON_KEY);

    // If version is specified, atomic findOneAndUpdate filters on { singletonKey, __v: expectedVersion }
    if (expectedVersion !== undefined) {
      if (!existing || existing.__v !== expectedVersion) {
        return null; // Optimistic lock failed: 0 matched documents
      }
    }

    const now = new Date();

    if (!existing) {
      // First upsert without expected version
      const doc: PayrollSettingsLean = {
        _id: new Types.ObjectId(),
        singletonKey: PAYROLL_SETTINGS_SINGLETON_KEY,
        currency: data.currency ?? PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY,
        currencyPrecision:
          data.currencyPrecision ??
          PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY_PRECISION,
        payrollFrequency:
          data.payrollFrequency ??
          PAYROLL_CONFIGURATION_DEFAULTS.PAYROLL_FREQUENCY,
        cutoffDay: data.cutoffDay ?? PAYROLL_CONFIGURATION_DEFAULTS.CUTOFF_DAY,
        paymentDay:
          data.paymentDay ?? PAYROLL_CONFIGURATION_DEFAULTS.PAYMENT_DAY,
        financialYearStartMonth:
          data.financialYearStartMonth ??
          PAYROLL_CONFIGURATION_DEFAULTS.FINANCIAL_YEAR_START_MONTH,
        workingDaysPolicy:
          data.workingDaysPolicy ??
          PAYROLL_CONFIGURATION_DEFAULTS.WORKING_DAYS_POLICY,
        fixedWorkingDaysPerMonth:
          data.fixedWorkingDaysPerMonth !== undefined
            ? data.fixedWorkingDaysPerMonth
            : PAYROLL_CONFIGURATION_DEFAULTS.FIXED_WORKING_DAYS_PER_MONTH,
        isPayrollProcessingEnabled:
          data.isPayrollProcessingEnabled ??
          PAYROLL_CONFIGURATION_DEFAULTS.IS_PAYROLL_PROCESSING_ENABLED,
        hasProcessedPayroll: false,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: now,
        updatedAt: now,
        __v: 0,
      };
      this.store.set(PAYROLL_SETTINGS_SINGLETON_KEY, doc);
      return { ...doc };
    }

    // Partial update semantics: only fields explicitly in data (not undefined) are updated
    const updated: PayrollSettingsLean = {
      ...existing,
      ...(data.currency !== undefined && { currency: data.currency }),
      ...(data.currencyPrecision !== undefined && {
        currencyPrecision: data.currencyPrecision,
      }),
      ...(data.payrollFrequency !== undefined && {
        payrollFrequency: data.payrollFrequency,
      }),
      ...(data.cutoffDay !== undefined && { cutoffDay: data.cutoffDay }),
      ...(data.paymentDay !== undefined && { paymentDay: data.paymentDay }),
      ...(data.financialYearStartMonth !== undefined && {
        financialYearStartMonth: data.financialYearStartMonth,
      }),
      ...(data.workingDaysPolicy !== undefined && {
        workingDaysPolicy: data.workingDaysPolicy,
      }),
      ...(data.fixedWorkingDaysPerMonth !== undefined && {
        fixedWorkingDaysPerMonth: data.fixedWorkingDaysPerMonth,
      }),
      ...(data.isPayrollProcessingEnabled !== undefined && {
        isPayrollProcessingEnabled: data.isPayrollProcessingEnabled,
      }),
      updatedBy: actorId,
      updatedAt: now,
      __v: existing.__v + 1,
    };

    this.store.set(PAYROLL_SETTINGS_SINGLETON_KEY, updated);
    return { ...updated };
  }
}

describe('Company Payroll Settings Integration Test Suite', () => {
  let controller: PayrollConfigurationController;
  let service: PayrollSettingsService;
  let repository: InMemoryPayrollSettingsRepository;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;

  const hrAdminId = new Types.ObjectId();
  const payrollViewerId = new Types.ObjectId();
  const standardEmployeeId = new Types.ObjectId();

  const hrAdminRole = new Types.ObjectId();
  const payrollViewerRole = new Types.ObjectId();
  const employeeRole = new Types.ObjectId();

  // Role permissions map
  const rolePermissionsMap = new Map<string, string[]>([
    [
      hrAdminRole.toString(),
      [
        PermissionKeys.PAYROLL_SETTINGS_VIEW,
        PermissionKeys.PAYROLL_SETTINGS_EDIT,
      ],
    ],
    [payrollViewerRole.toString(), [PermissionKeys.PAYROLL_SETTINGS_VIEW]],
    [employeeRole.toString(), [PermissionKeys.LEAVE_REQUESTS_VIEW_OWN]],
  ]);

  const createRequest = (
    userId: Types.ObjectId,
    roleId: Types.ObjectId,
  ): AuthenticatedRequest =>
    ({
      user: {
        userId,
        sessionId: new Types.ObjectId(),
        roleIds: [roleId],
      },
      ip: '192.168.1.50',
      headers: { 'user-agent': 'CompanyPayrollIntegration/2.0' },
    }) as unknown as AuthenticatedRequest;

  const createExecutionContext = (
    handler: object,
    request: AuthenticatedRequest | null,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PayrollConfigurationController,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  beforeAll(async () => {
    repository = new InMemoryPayrollSettingsRepository();

    auditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AuditLogsService>;

    const mockAuthService = {
      hasPermissions: jest.fn(
        async (roleIds: Types.ObjectId[], required: string[]) => {
          const granted = new Set<string>();
          for (const roleId of roleIds) {
            const perms = rolePermissionsMap.get(roleId.toString()) ?? [];
            perms.forEach((p) => granted.add(p));
          }
          return required.every((req) => granted.has(req));
        },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollConfigurationController],
      providers: [
        PayrollSettingsService,
        {
          provide: PayrollSettingsRepository,
          useValue: repository,
        },
        {
          provide: AuditLogsService,
          useValue: auditLogsService,
        },
        {
          provide: PayrollCalculationRuleService,
          useValue: {},
        },
        {
          provide: PayrollCalculationService,
          useValue: {},
        },
        {
          provide: AuthorizationService,
          useValue: mockAuthService,
        },
        PermissionsGuard,
        Reflector,
      ],
    }).compile();

    controller = module.get(PayrollConfigurationController);
    service = module.get(PayrollSettingsService);
    guard = module.get(PermissionsGuard);

    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
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
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Initial Settings Creation & Singleton Deduplication
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Initial Settings Creation & Singleton Deduplication', () => {
    it('creates default company settings on first query when DB is empty', async () => {
      expect(repository.getStoreCount()).toBe(0);

      const response = await controller.getSettings();

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        currency: 'INR',
        currencyPrecision: 2,
        payrollFrequency: PayrollFrequency.MONTHLY,
        cutoffDay: 25,
        paymentDay: 1,
        financialYearStartMonth: 4,
        workingDaysPolicy: WorkingDaysPolicy.CALENDAR_DAYS,
        fixedWorkingDaysPerMonth: null,
        isPayrollProcessingEnabled: true,
        version: 0,
      });

      // Verify exactly one document created in database collection
      expect(repository.getStoreCount()).toBe(1);
    });

    it('subsequent queries reuse the singleton without creating duplicate documents', async () => {
      await controller.getSettings();
      await controller.getSettings();
      await controller.getSettings();

      expect(repository.getStoreCount()).toBe(1);
    });

    it('recovers from concurrent race on initial creation and preserves single-document guarantee', async () => {
      // Instruct in-memory repository to simulate a duplicate key error on the first insert attempt
      repository.simulateDuplicateKeyOnDefaultOnce = true;

      // The service catch block detects E11000 and retrieves the already inserted singleton
      const response = await controller.getSettings();

      expect(response.success).toBe(true);
      expect(response.data.currency).toBe('INR');
      expect(repository.getStoreCount()).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Partial Updates & Field Preservation
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Partial Updates & Field Preservation', () => {
    it('updating only cutoffDay and paymentDay strictly preserves all other fields', async () => {
      // 1. Initialize settings with defaults
      await controller.getSettings();
      const initialActive = await repository.findActive();
      expect(initialActive).not.toBeNull();
      const originalCreatedAt = initialActive!.createdAt;

      // 2. Execute partial update
      const updateDto: UpdatePayrollSettingsDto = {
        cutoffDay: 20,
        paymentDay: 5,
      };

      const hrRequest = createRequest(hrAdminId, hrAdminRole);
      const res = await controller.updateSettings(updateDto, hrRequest);

      expect(res.success).toBe(true);
      expect(res.data.cutoffDay).toBe(20);
      expect(res.data.paymentDay).toBe(5);

      // Verify database document state: all untouched fields are fully preserved
      const updatedDoc = await repository.findActive();
      expect(updatedDoc).not.toBeNull();
      expect(updatedDoc!.cutoffDay).toBe(20);
      expect(updatedDoc!.paymentDay).toBe(5);
      expect(updatedDoc!.currency).toBe('INR');
      expect(updatedDoc!.currencyPrecision).toBe(2);
      expect(updatedDoc!.payrollFrequency).toBe(PayrollFrequency.MONTHLY);
      expect(updatedDoc!.financialYearStartMonth).toBe(4);
      expect(updatedDoc!.workingDaysPolicy).toBe(
        WorkingDaysPolicy.CALENDAR_DAYS,
      );
      expect(updatedDoc!.fixedWorkingDaysPerMonth).toBeNull();
      expect(updatedDoc!.isPayrollProcessingEnabled).toBe(true);
      expect(updatedDoc!.createdAt.getTime()).toBe(originalCreatedAt.getTime());
      expect(updatedDoc!.updatedBy?.toString()).toBe(hrAdminId.toString());
      expect(updatedDoc!.__v).toBe(1);

      // Verify audit log write
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: hrAdminId,
          action: AuditAction.PAYROLL_SETTINGS_UPDATED,
          targetModel: AuditTargetModel.PAYROLL_SETTINGS,
          details: expect.objectContaining({
            cutoffDay: 20,
            paymentDay: 5,
            version: 1,
          }),
        }),
      );
    });

    it('updating only isPayrollProcessingEnabled toggles processing state without altering policies', async () => {
      await controller.getSettings();

      const hrRequest = createRequest(hrAdminId, hrAdminRole);
      const res = await controller.updateSettings(
        { isPayrollProcessingEnabled: false },
        hrRequest,
      );

      expect(res.data.isPayrollProcessingEnabled).toBe(false);
      expect(res.data.cutoffDay).toBe(25);
      expect(res.data.paymentDay).toBe(1);
      expect(res.data.workingDaysPolicy).toBe(WorkingDaysPolicy.CALENDAR_DAYS);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. DTO Validation & Invalid Input Rejection
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. DTO Validation & Invalid Input Rejection', () => {
    const validateBody = async (
      body: Record<string, unknown>,
    ): Promise<UpdatePayrollSettingsDto> => {
      return (await validationPipe.transform(body, {
        type: 'body',
        metatype: UpdatePayrollSettingsDto,
      })) as UpdatePayrollSettingsDto;
    };

    it('rejects unknown/forbidden properties', async () => {
      await expect(
        validateBody({ cutoffDay: 25, unknownKey: 'malicious' }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects cutoffDay outside 1-28 range', async () => {
      await expect(validateBody({ cutoffDay: 0 })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      await expect(validateBody({ cutoffDay: 29 })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      await expect(validateBody({ cutoffDay: -5 })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects paymentDay outside 1-31 range', async () => {
      await expect(validateBody({ paymentDay: 0 })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      await expect(validateBody({ paymentDay: 32 })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects financialYearStartMonth outside 1-12 range', async () => {
      await expect(
        validateBody({ financialYearStartMonth: 0 }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      await expect(
        validateBody({ financialYearStartMonth: 13 }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('rejects unsupported currency code, but converts supported lowercase to uppercase', async () => {
      await expect(validateBody({ currency: 'XYZ' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      const transformed = await validateBody({
        currency: 'usd',
      });
      expect(transformed.currency).toBe('USD');
    });

    it('rejects negative version numbers', async () => {
      await expect(validateBody({ version: -1 })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Optimistic Concurrency Control (OCC) & Stale Updates
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Optimistic Concurrency Control (OCC) & Stale Updates', () => {
    it('succeeds when version matches current document version and increments versionKey', async () => {
      await controller.getSettings(); // Initializes version 0
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      const res = await controller.updateSettings(
        { cutoffDay: 22, version: 0 },
        hrRequest,
      );

      expect(res.data.version).toBe(1);
      expect(res.data.cutoffDay).toBe(22);
    });

    it('rejects stale update when client submits outdated version with 409 Conflict', async () => {
      await controller.getSettings(); // Version 0
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      // Admin 1 updates to Version 1
      await controller.updateSettings({ cutoffDay: 20, version: 0 }, hrRequest);

      // Admin 2 attempts update still referencing Version 0
      await expect(
        controller.updateSettings({ cutoffDay: 24, version: 0 }, hrRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('rejects version specification before configuration document exists', async () => {
      expect(repository.getStoreCount()).toBe(0);
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      await expect(
        controller.updateSettings({ cutoffDay: 25, version: 0 }, hrRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('catches concurrent atomic race condition at repository level and rejects with 409 Conflict', async () => {
      await controller.getSettings(); // Version 0

      // Simulate a concurrent write having just advanced the version in database
      await repository.upsertSettings(
        { cutoffDay: 21, updatedBy: hrAdminId },
        hrAdminId,
      ); // Version is now 1 in DB

      // Attempting to upsert expecting version 0 will fail the atomic query filter
      await expect(
        service.updateSettings({ cutoffDay: 22, version: 0 }, hrAdminId),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Conditional Validation for Working Days Policy
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Conditional Validation for Working Days Policy', () => {
    it('rejects FIXED_WORKING_DAYS when fixedWorkingDaysPerMonth is omitted', async () => {
      await controller.getSettings();
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      await expect(
        controller.updateSettings(
          { workingDaysPolicy: WorkingDaysPolicy.FIXED_WORKING_DAYS },
          hrRequest,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('accepts FIXED_WORKING_DAYS when valid fixedWorkingDaysPerMonth is provided', async () => {
      await controller.getSettings();
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      const res = await controller.updateSettings(
        {
          workingDaysPolicy: WorkingDaysPolicy.FIXED_WORKING_DAYS,
          fixedWorkingDaysPerMonth: 26,
        },
        hrRequest,
      );

      expect(res.data.workingDaysPolicy).toBe(
        WorkingDaysPolicy.FIXED_WORKING_DAYS,
      );
      expect(res.data.fixedWorkingDaysPerMonth).toBe(26);

      const doc = await repository.findActive();
      expect(doc!.workingDaysPolicy).toBe(WorkingDaysPolicy.FIXED_WORKING_DAYS);
      expect(doc!.fixedWorkingDaysPerMonth).toBe(26);
    });

    it('rejects providing fixedWorkingDaysPerMonth when workingDaysPolicy is CALENDAR_DAYS', async () => {
      await controller.getSettings();
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      await expect(
        controller.updateSettings(
          {
            workingDaysPolicy: WorkingDaysPolicy.CALENDAR_DAYS,
            fixedWorkingDaysPerMonth: 26,
          },
          hrRequest,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('switching from FIXED_WORKING_DAYS to CALENDAR_DAYS automatically clears fixedWorkingDaysPerMonth to null', async () => {
      await controller.getSettings();
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      // First set to FIXED_WORKING_DAYS = 26
      await controller.updateSettings(
        {
          workingDaysPolicy: WorkingDaysPolicy.FIXED_WORKING_DAYS,
          fixedWorkingDaysPerMonth: 26,
        },
        hrRequest,
      );

      // Now switch back to CALENDAR_DAYS
      const res = await controller.updateSettings(
        { workingDaysPolicy: WorkingDaysPolicy.CALENDAR_DAYS },
        hrRequest,
      );

      expect(res.data.workingDaysPolicy).toBe(WorkingDaysPolicy.CALENDAR_DAYS);
      expect(res.data.fixedWorkingDaysPerMonth).toBeNull();

      const doc = await repository.findActive();
      expect(doc!.fixedWorkingDaysPerMonth).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Role-Based Access Control (RBAC) Enforcement
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Role-Based Access Control (RBAC) Enforcement', () => {
    it('rejects unauthenticated requests without user identity with 401 Unauthorized', async () => {
      const unauthRequest = {
        ip: '192.168.1.50',
        headers: {},
        user: undefined,
      } as unknown as AuthenticatedRequest;

      const unauthContext = createExecutionContext(
        controller.getSettings,
        unauthRequest,
      );

      await expect(guard.canActivate(unauthContext)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
        statusCode: HttpStatus.UNAUTHORIZED,
      });
    });

    it('blocks regular employee from both viewing and editing settings with 403 Forbidden', async () => {
      const empReq = createRequest(standardEmployeeId, employeeRole);

      await expect(
        guard.canActivate(
          createExecutionContext(controller.getSettings, empReq),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });

      await expect(
        guard.canActivate(
          createExecutionContext(controller.updateSettings, empReq),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('allows viewer role to read settings but blocks modification with 403 Forbidden', async () => {
      const viewerReq = createRequest(payrollViewerId, payrollViewerRole);

      // GET permitted
      await expect(
        guard.canActivate(
          createExecutionContext(controller.getSettings, viewerReq),
        ),
      ).resolves.toBe(true);

      // PUT blocked
      await expect(
        guard.canActivate(
          createExecutionContext(controller.updateSettings, viewerReq),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('allows full HR Administrator access to both view and edit settings', async () => {
      const hrReq = createRequest(hrAdminId, hrAdminRole);

      await expect(
        guard.canActivate(
          createExecutionContext(controller.getSettings, hrReq),
        ),
      ).resolves.toBe(true);

      await expect(
        guard.canActivate(
          createExecutionContext(controller.updateSettings, hrReq),
        ),
      ).resolves.toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Database Failures & Data Consistency
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. Database Failures & Data Consistency', () => {
    it('propagates database error cleanly without creating partial records or audit logs', async () => {
      await controller.getSettings();
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      repository.simulateDbError = new Error(
        'MongoDB network connectivity failure during update',
      );

      await expect(
        controller.updateSettings({ cutoffDay: 22 }, hrRequest),
      ).rejects.toThrow('MongoDB network connectivity failure during update');

      // Verify no audit log was generated for the failed write
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('translates duplicate key error during upsertSettings into 409 Conflict', async () => {
      await controller.getSettings();
      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      repository.simulateDuplicateKeyError = true;

      await expect(
        controller.updateSettings({ cutoffDay: 22 }, hrRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('locks down currency, frequency, and financialYear mutations when payroll was processed', async () => {
      await controller.getSettings();
      // Simulate historical payroll has run
      const doc = await repository.findActive();
      repository.seed({ ...doc!, hasProcessedPayroll: true });

      const hrRequest = createRequest(hrAdminId, hrAdminRole);

      // 1. Changing currency blocked
      await expect(
        controller.updateSettings({ currency: 'USD' }, hrRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });

      // 2. Changing financialYearStartMonth blocked
      await expect(
        controller.updateSettings({ financialYearStartMonth: 1 }, hrRequest),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });

      // 3. Operational updates (cutoffDay, paymentDay, processing toggle) STILL permitted
      const operationalUpdate = await controller.updateSettings(
        { cutoffDay: 24, isPayrollProcessingEnabled: false },
        hrRequest,
      );
      expect(operationalUpdate.data.cutoffDay).toBe(24);
      expect(operationalUpdate.data.isPayrollProcessingEnabled).toBe(false);
    });
  });
});
