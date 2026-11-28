import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { PayrollCalculationService } from './payroll-calculation.service';
import {
  SalaryComponent,
  SalaryComponentLean,
} from '../../salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { PayrollSettingsRepository } from '../repositories/payroll-settings.repository';
import { PayrollCalculationRuleRepository } from '../repositories/payroll-calculation-rule.repository';
import { PayrollPreviewCalculationType } from '../dto/calculate-payroll-preview.dto';
import {
  NegativeNetPayPolicy,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../constants/payroll-configuration.constant';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('PayrollCalculationService', () => {
  let service: PayrollCalculationService;
  let salaryComponentModel: { find: jest.Mock };
  let settingsRepository: { findActive: jest.Mock };
  let ruleRepository: { findActive: jest.Mock };

  const actorId = new Types.ObjectId();

  const makeMaster = (
    code: string,
    name: string,
    type: SalaryComponentType,
    isActive = true,
  ): SalaryComponentLean => ({
    _id: new Types.ObjectId(),
    name,
    code,
    type,
    calculationType: null,
    percentageOf: null,
    defaultValue: null,
    isTaxable: type === SalaryComponentType.EARNING,
    isStatutory: false,
    description: null,
    isActive,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    salaryComponentModel = {
      find: jest.fn(),
    };
    settingsRepository = {
      findActive: jest.fn().mockResolvedValue(null),
    };
    ruleRepository = {
      findActive: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollCalculationService,
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: salaryComponentModel,
        },
        {
          provide: PayrollSettingsRepository,
          useValue: settingsRepository,
        },
        {
          provide: PayrollCalculationRuleRepository,
          useValue: ruleRepository,
        },
      ],
    }).compile();

    service = module.get(PayrollCalculationService);
  });

  const mockMasters = (docs: SalaryComponentLean[]) => {
    salaryComponentModel.find.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(docs),
      }),
    });
  };

  it('calculates fixed components and computes Gross Earnings, Total Deductions, and Net Salary', async () => {
    const basic = makeMaster(
      'BASIC',
      'Basic Salary',
      SalaryComponentType.EARNING,
    );
    const conv = makeMaster(
      'CONVEYANCE',
      'Conveyance Allowance',
      SalaryComponentType.EARNING,
    );
    const pt = makeMaster(
      'PT',
      'Professional Tax',
      SalaryComponentType.EMPLOYEE_DEDUCTION,
    );
    mockMasters([basic, conv, pt]);

    const result = await service.calculatePreview({
      components: [
        {
          componentId: basic._id.toString(),
          calculationType: PayrollPreviewCalculationType.FIXED,
          amount: 30000,
        },
        {
          componentId: conv._id.toString(),
          calculationType: PayrollPreviewCalculationType.FIXED,
          amount: 1600,
        },
        {
          componentId: pt._id.toString(),
          calculationType: PayrollPreviewCalculationType.FIXED,
          amount: 200,
        },
      ],
    });

    expect(result.currency).toBe('INR');
    expect(result.summary.grossEarnings).toBe(31600);
    expect(result.summary.totalDeductions).toBe(200);
    expect(result.summary.netSalary).toBe(31400);
    expect(result.earnings).toHaveLength(2);
    expect(result.deductions).toHaveLength(1);
  });

  it('calculates percentage components in dependency order (HRA on BASIC, PF on BASIC, ESI on GROSS_EARNINGS)', async () => {
    const basic = makeMaster(
      'BASIC',
      'Basic Salary',
      SalaryComponentType.EARNING,
    );
    const hra = makeMaster(
      'HRA',
      'House Rent Allowance',
      SalaryComponentType.EARNING,
    );
    const pf = makeMaster(
      'PF',
      'Provident Fund',
      SalaryComponentType.EMPLOYEE_DEDUCTION,
    );
    const esi = makeMaster(
      'ESI',
      'Employee State Insurance',
      SalaryComponentType.EMPLOYEE_DEDUCTION,
    );
    // Intentionally pass HRA and PF BEFORE BASIC in input array to test topological sort
    mockMasters([hra, pf, basic, esi]);

    const result = await service.calculatePreview({
      components: [
        {
          componentId: hra._id.toString(),
          calculationType: PayrollPreviewCalculationType.PERCENTAGE,
          percentage: 40,
          percentageOf: 'BASIC',
        },
        {
          componentId: pf._id.toString(),
          calculationType: PayrollPreviewCalculationType.PERCENTAGE,
          percentage: 12,
          percentageOf: 'BASIC',
        },
        {
          componentId: esi._id.toString(),
          calculationType: PayrollPreviewCalculationType.PERCENTAGE,
          percentage: 0.75,
          percentageOf: 'GROSS_EARNINGS',
        },
        {
          componentId: basic._id.toString(),
          calculationType: PayrollPreviewCalculationType.FIXED,
          amount: 15000,
        },
      ],
    });

    // BASIC = 15000, HRA = 6000 => Gross = 21000
    // PF = 12% of 15000 = 1800, ESI = 0.75% of 21000 = 157.5 => Deductions = 1957.5
    // Net = 21000 - 1957.5 = 19042.5
    expect(result.executionOrder.indexOf('BASIC')).toBeLessThan(
      result.executionOrder.indexOf('HRA'),
    );
    expect(result.summary.grossEarnings).toBe(21000);
    expect(result.summary.totalDeductions).toBe(1957.5);
    expect(result.summary.netSalary).toBe(19042.5);
  });

  it('applies configured HALF_EVEN rounding and precision cleanly', async () => {
    const basic = makeMaster(
      'BASIC',
      'Basic Salary',
      SalaryComponentType.EARNING,
    );
    const bonus = makeMaster('BONUS', 'Bonus', SalaryComponentType.EARNING);
    mockMasters([basic, bonus]);

    ruleRepository.findActive.mockResolvedValue({
      roundingMode: PayrollRoundingMode.HALF_EVEN,
      roundingPrecision: 2,
      prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
      prorateFixedComponents: true,
      prorateDeductions: false,
      negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
      componentExecutionOrder: [],
    });

    const result = await service.calculatePreview({
      components: [
        {
          componentId: basic._id.toString(),
          calculationType: PayrollPreviewCalculationType.FIXED,
          amount: 100.05,
        },
        {
          componentId: bonus._id.toString(),
          calculationType: PayrollPreviewCalculationType.PERCENTAGE,
          percentage: 50,
          percentageOf: 'BASIC', // 50.025 -> HALF_EVEN 2 decimals => 50.02
        },
      ],
    });

    const bonusLine = result.earnings.find((e) => e.code === 'BONUS');
    expect(bonusLine?.calculatedAmount).toBe(50.02);
    expect(result.summary.grossEarnings).toBe(150.07);
  });

  it('applies monthly salary proration for earnings while honoring prorateDeductions=false', async () => {
    const basic = makeMaster(
      'BASIC',
      'Basic Salary',
      SalaryComponentType.EARNING,
    );
    const hra = makeMaster('HRA', 'HRA', SalaryComponentType.EARNING);
    const pt = makeMaster(
      'PT',
      'Professional Tax',
      SalaryComponentType.EMPLOYEE_DEDUCTION,
    );
    mockMasters([basic, hra, pt]);

    ruleRepository.findActive.mockResolvedValue({
      roundingMode: PayrollRoundingMode.HALF_EVEN,
      roundingPrecision: 2,
      prorationPolicy: PayrollProrationPolicy.FIXED_30_DAYS,
      prorateFixedComponents: true,
      prorateDeductions: false,
      negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
      componentExecutionOrder: [],
    });

    const result = await service.calculatePreview({
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
        {
          componentId: pt._id.toString(),
          calculationType: PayrollPreviewCalculationType.FIXED,
          amount: 200,
        },
      ],
    });

    // Basic prorated 20000 * 15/30 = 10000; HRA = 50% of 10000 = 5000 => Gross = 15000
    // PT stays 200 (prorateDeductions=false) => Net = 14800
    expect(result.proration.applied).toBe(true);
    expect(result.proration.factor).toBe(0.5);
    expect(result.summary.grossEarnings).toBe(15000);
    expect(result.summary.totalDeductions).toBe(200);
    expect(result.summary.netSalary).toBe(14800);
  });

  it('rejects missing percentage base component', async () => {
    const hra = makeMaster('HRA', 'HRA', SalaryComponentType.EARNING);
    mockMasters([hra]);

    await expect(
      service.calculatePreview({
        components: [
          {
            componentId: hra._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 40,
            percentageOf: 'BASIC',
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects circular calculation dependencies between components', async () => {
    const compA = makeMaster(
      'COMP_A',
      'Component A',
      SalaryComponentType.EARNING,
    );
    const compB = makeMaster(
      'COMP_B',
      'Component B',
      SalaryComponentType.EARNING,
    );
    mockMasters([compA, compB]);

    await expect(
      service.calculatePreview({
        components: [
          {
            componentId: compA._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: 'COMP_B',
          },
          {
            componentId: compB._id.toString(),
            calculationType: PayrollPreviewCalculationType.PERCENTAGE,
            percentage: 20,
            percentageOf: 'COMP_A',
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects inactive component usage in calculation preview', async () => {
    const inactiveComp = makeMaster(
      'OLD_ALLOWANCE',
      'Old Allowance',
      SalaryComponentType.EARNING,
      false,
    );
    mockMasters([inactiveComp]);

    await expect(
      service.calculatePreview({
        components: [
          {
            componentId: inactiveComp._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 5000,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects negative net salary when negativeNetPayPolicy is REJECT', async () => {
    const basic = makeMaster('BASIC', 'Basic', SalaryComponentType.EARNING);
    const tds = makeMaster(
      'TDS',
      'TDS',
      SalaryComponentType.EMPLOYEE_DEDUCTION,
    );
    mockMasters([basic, tds]);

    await expect(
      service.calculatePreview({
        components: [
          {
            componentId: basic._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 1000,
          },
          {
            componentId: tds._id.toString(),
            calculationType: PayrollPreviewCalculationType.FIXED,
            amount: 2000,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });
});
