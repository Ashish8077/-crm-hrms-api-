/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpStatus, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { ValidationError } from 'class-validator';
import { PayrollConfigurationController } from './payroll-configuration.controller';
import { PayrollSettingsService } from './services/payroll-settings.service';
import { PayrollCalculationRuleService } from './services/payroll-calculation-rule.service';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import { UpdateCalculationRulesDto } from './dto/update-calculation-rules.dto';
import { CalculatePayrollPreviewDto } from './dto/calculate-payroll-preview.dto';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
  WorkingDaysPolicy,
} from './constants/payroll-configuration.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('PayrollConfigurationController & Validation/RBAC', () => {
  let controller: PayrollConfigurationController;
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let validationPipe: ValidationPipe;
  let activeRoleKey: 'HR_ADMIN' | 'EMPLOYEE' = 'HR_ADMIN';

  const actorId = new Types.ObjectId();
  const componentId = new Types.ObjectId();

  const mockRequest = {
    user: {
      userId: actorId,
      sessionId: new Types.ObjectId(),
      roleIds: [new Types.ObjectId()],
    },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestClient/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockSettingsService = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  };

  const mockCalculationRuleService = {
    getCalculationRules: jest.fn(),
    updateCalculationRules: jest.fn(),
  };

  const mockCalculationService = {
    calculatePreview: jest.fn(),
  };

  const mockAuthorizationService = {
    hasPermissions: jest.fn(
      (_roleIds: Types.ObjectId[], requiredPermissions: string[]) => {
        if (activeRoleKey === 'HR_ADMIN') {
          return Promise.resolve(true);
        }
        return Promise.resolve(requiredPermissions.length === 0);
      },
    ),
  };

  const createExecutionContext = (
    handler: object,
    user: unknown = mockRequest.user,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PayrollConfigurationController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollConfigurationController],
      providers: [
        { provide: PayrollSettingsService, useValue: mockSettingsService },
        {
          provide: PayrollCalculationRuleService,
          useValue: mockCalculationRuleService,
        },
        {
          provide: PayrollCalculationService,
          useValue: mockCalculationService,
        },
        { provide: AuthorizationService, useValue: mockAuthorizationService },
        PermissionsGuard,
        Reflector,
      ],
    }).compile();

    controller = module.get(PayrollConfigurationController);
    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);

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

    activeRoleKey = 'HR_ADMIN';
    jest.clearAllMocks();
  });

  describe('RBAC Permission Metadata & Guard Enforcement', () => {
    it('binds expected permission keys on every endpoint handler', () => {
      expect(
        reflector.get<string[]>(
          REQUIRE_PERMISSIONS_KEY,
          controller.getSettings,
        ),
      ).toEqual([PermissionKeys.PAYROLL_SETTINGS_VIEW]);
      expect(
        reflector.get<string[]>(
          REQUIRE_PERMISSIONS_KEY,
          controller.updateSettings,
        ),
      ).toEqual([PermissionKeys.PAYROLL_SETTINGS_EDIT]);
      expect(
        reflector.get<string[]>(
          REQUIRE_PERMISSIONS_KEY,
          controller.getCalculationRules,
        ),
      ).toEqual([PermissionKeys.PAYROLL_SETTINGS_VIEW]);
      expect(
        reflector.get<string[]>(
          REQUIRE_PERMISSIONS_KEY,
          controller.updateCalculationRules,
        ),
      ).toEqual([PermissionKeys.PAYROLL_SETTINGS_EDIT]);
      expect(
        reflector.get<string[]>(
          REQUIRE_PERMISSIONS_KEY,
          controller.calculatePreview,
        ),
      ).toEqual([PermissionKeys.PAYROLL_SETTINGS_VIEW]);
    });

    it('blocks non-HR employees from accessing payroll settings and calculation rules (403)', async () => {
      activeRoleKey = 'EMPLOYEE';

      await expect(
        guard.canActivate(createExecutionContext(controller.getSettings)),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });

      await expect(
        guard.canActivate(createExecutionContext(controller.updateSettings)),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });

      await expect(
        guard.canActivate(
          createExecutionContext(controller.updateCalculationRules),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('allows HR admin users through PermissionsGuard', async () => {
      activeRoleKey = 'HR_ADMIN';
      await expect(
        guard.canActivate(createExecutionContext(controller.updateSettings)),
      ).resolves.toBe(true);
    });
  });

  describe('DTO Validation & Controller Delegation', () => {
    it('GET /settings delegates and wraps active settings', async () => {
      mockSettingsService.getSettings.mockResolvedValue({
        id: new Types.ObjectId().toString(),
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

      const res = await controller.getSettings();
      expect(res.success).toBe(true);
      expect(res.data.currency).toBe('INR');
    });

    it('UpdatePayrollSettingsDto rejects invalid cutoffDay (>28), unsupported currency, and unknown properties', async () => {
      await expect(
        validationPipe.transform(
          { cutoffDay: 30 },
          { type: 'body', metatype: UpdatePayrollSettingsDto },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      await expect(
        validationPipe.transform(
          { currency: 'XYZ' },
          { type: 'body', metatype: UpdatePayrollSettingsDto },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      await expect(
        validationPipe.transform(
          { cutoffDay: 20, unexpectedField: true },
          { type: 'body', metatype: UpdatePayrollSettingsDto },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('UpdateCalculationRulesDto & CalculatePayrollPreviewDto enforce validation and return results', async () => {
      const validRuleDto = (await validationPipe.transform(
        {
          roundingMode: PayrollRoundingMode.HALF_EVEN,
          roundingPrecision: 2,
          prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
          negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
        },
        { type: 'body', metatype: UpdateCalculationRulesDto },
      )) as UpdateCalculationRulesDto;

      mockCalculationRuleService.updateCalculationRules.mockResolvedValue({
        id: new Types.ObjectId().toString(),
        ...validRuleDto,
      });

      const ruleRes = await controller.updateCalculationRules(
        validRuleDto,
        mockRequest,
      );
      expect(ruleRes.success).toBe(true);

      await expect(
        validationPipe.transform(
          {
            components: [
              {
                componentId: componentId.toString(),
                calculationType: 'PERCENTAGE',
                percentage: 150,
                percentageOf: 'BASIC',
              },
            ],
          },
          { type: 'body', metatype: CalculatePayrollPreviewDto },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      const validPreviewDto = (await validationPipe.transform(
        {
          components: [
            {
              componentId: componentId.toString(),
              calculationType: 'FIXED',
              amount: 30000,
            },
          ],
        },
        { type: 'body', metatype: CalculatePayrollPreviewDto },
      )) as CalculatePayrollPreviewDto;

      mockCalculationService.calculatePreview.mockResolvedValue({
        currency: 'INR',
        summary: {
          grossEarnings: 30000,
          totalDeductions: 1800,
          employerContributions: 0,
          netSalary: 28200,
          netPayClamped: false,
        },
      });

      const previewRes = await controller.calculatePreview(validPreviewDto);
      expect(previewRes.data.summary.netSalary).toBe(28200);
    });
  });
});
