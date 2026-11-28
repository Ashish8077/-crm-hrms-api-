/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { PayrollCalculationRuleService } from './payroll-calculation-rule.service';
import { PayrollCalculationRuleRepository } from '../repositories/payroll-calculation-rule.repository';
import { SalaryComponent } from '../../salary-components/schemas/salary-component.schema';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PayrollCalculationRuleLean } from '../schemas/payroll-calculation-rule.schema';
import {
  NegativeNetPayPolicy,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../constants/payroll-configuration.constant';
import { AuditAction } from '../../audit-logs/constants/audit-log.constant';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('PayrollCalculationRuleService', () => {
  let service: PayrollCalculationRuleService;
  let repository: jest.Mocked<PayrollCalculationRuleRepository>;
  let salaryComponentModel: { find: jest.Mock };
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const actorId = new Types.ObjectId();
  const ruleId = new Types.ObjectId();

  const buildRule = (
    overrides: Partial<PayrollCalculationRuleLean> = {},
  ): PayrollCalculationRuleLean => ({
    _id: ruleId,
    singletonKey: 'DEFAULT',
    roundingMode: PayrollRoundingMode.HALF_EVEN,
    roundingPrecision: 2,
    prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
    prorateFixedComponents: true,
    prorateDeductions: false,
    prorateEmployerContributions: false,
    negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
    statutoryConfig: {
      pfEnabled: true,
      esiEnabled: true,
      ptEnabled: true,
      tdsEnabled: true,
    },
    componentExecutionOrder: [],
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    __v: 0,
    ...overrides,
  });

  beforeEach(async () => {
    salaryComponentModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollCalculationRuleService,
        {
          provide: PayrollCalculationRuleRepository,
          useValue: {
            findActive: jest.fn(),
            findOrCreateDefault: jest.fn(),
            upsertRule: jest.fn(),
            isDuplicateKeyError: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: salaryComponentModel,
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get(PayrollCalculationRuleService);
    repository = module.get(PayrollCalculationRuleRepository);
    auditLogsService = module.get(AuditLogsService);
    jest.clearAllMocks();
  });

  it('retrieves default calculation rules and hides internal singletonKey', async () => {
    repository.findOrCreateDefault.mockResolvedValue({
      rule: buildRule(),
      created: true,
    });

    const result = await service.getCalculationRules();

    expect(result.roundingMode).toBe(PayrollRoundingMode.HALF_EVEN);
    expect(result.prorationPolicy).toBe(PayrollProrationPolicy.CALENDAR_DAYS);
    expect(
      (result as unknown as Record<string, unknown>).singletonKey,
    ).toBeUndefined();
  });

  it('updates calculation rules and verifies componentExecutionOrder codes exist', async () => {
    repository.findActive.mockResolvedValue(buildRule({ __v: 0 }));
    salaryComponentModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue([{ code: 'BASIC' }, { code: 'HRA' }]),
        }),
      }),
    });
    repository.upsertRule.mockResolvedValue(
      buildRule({
        roundingMode: PayrollRoundingMode.HALF_UP,
        componentExecutionOrder: ['BASIC', 'HRA'],
        __v: 1,
      }),
    );

    const result = await service.updateCalculationRules(
      {
        roundingMode: PayrollRoundingMode.HALF_UP,
        componentExecutionOrder: ['BASIC', 'HRA'],
        version: 0,
      },
      actorId,
    );

    expect(result.roundingMode).toBe(PayrollRoundingMode.HALF_UP);
    expect(result.componentExecutionOrder).toEqual(['BASIC', 'HRA']);
    expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PAYROLL_CALCULATION_RULES_UPDATED,
      }),
    );
  });

  it('rejects unknown component codes in componentExecutionOrder', async () => {
    repository.findActive.mockResolvedValue(buildRule());
    salaryComponentModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([{ code: 'BASIC' }]),
        }),
      }),
    });

    await expect(
      service.updateCalculationRules(
        { componentExecutionOrder: ['BASIC', 'NON_EXISTENT'] },
        actorId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
    expect(repository.upsertRule).not.toHaveBeenCalled();
  });

  it('rejects concurrent calculation rule updates on version mismatch', async () => {
    repository.findActive.mockResolvedValue(buildRule({ __v: 3 }));

    await expect(
      service.updateCalculationRules(
        { roundingPrecision: 0, version: 2 },
        actorId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
  });
});
