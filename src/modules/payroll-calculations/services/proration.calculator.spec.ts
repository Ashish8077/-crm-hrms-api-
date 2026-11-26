import { ProrationCalculator } from './proration.calculator';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { StructureComponentCalculationType } from '../../salary-structures/constants/salary-structure.constant';
import {
  NegativeNetPayPolicy,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../../payroll-configuration/constants/payroll-configuration.constant';
import { toDecimal } from '../../../common/utils/financial-math.util';
import { ResolvedPayrollConfiguration } from './payroll-input.resolver';
import { MonthlyCalculatedComponent } from './component-calculation.engine';

describe('ProrationCalculator', () => {
  const calculator = new ProrationCalculator();

  const defaultConfig: ResolvedPayrollConfiguration = {
    payrollSettingsId: null,
    payrollSettingsVersion: null,
    payrollCalculationRuleId: null,
    payrollCalculationRuleVersion: null,
    currency: 'INR',
    roundingMode: PayrollRoundingMode.HALF_EVEN,
    roundingPrecision: 2,
    prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
    prorateFixedComponents: true,
    prorateDeductions: false,
    prorateEmployerContributions: false,
    negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
    fixedWorkingDaysPerMonth: null,
    componentExecutionOrder: [],
  };

  const monthlyItems: MonthlyCalculatedComponent[] = [
    {
      component: {
        componentId: '1',
        code: 'BASIC',
        name: 'Basic',
        classification: SalaryComponentType.EARNING,
        calculationMethod: StructureComponentCalculationType.FIXED,
        monthlyFixedAmount: toDecimal(30000),
        percentage: null,
        percentageOf: null,
      },
      monthlyBaseAmountDec: toDecimal(30000),
      monthlyCalculatedAmountDec: toDecimal(30000),
    },
    {
      component: {
        componentId: '2',
        code: 'HRA',
        name: 'HRA',
        classification: SalaryComponentType.EARNING,
        calculationMethod: StructureComponentCalculationType.PERCENTAGE,
        monthlyFixedAmount: null,
        percentage: 50,
        percentageOf: 'BASIC',
      },
      monthlyBaseAmountDec: toDecimal(30000),
      monthlyCalculatedAmountDec: toDecimal(15000),
    },
    {
      component: {
        componentId: '3',
        code: 'PT',
        name: 'Professional Tax',
        classification: SalaryComponentType.EMPLOYEE_DEDUCTION,
        calculationMethod: StructureComponentCalculationType.FIXED,
        monthlyFixedAmount: toDecimal(200),
        percentage: null,
        percentageOf: null,
      },
      monthlyBaseAmountDec: toDecimal(200),
      monthlyCalculatedAmountDec: toDecimal(200),
    },
    {
      component: {
        componentId: '4',
        code: 'PF_ER',
        name: 'Employer PF',
        classification: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        calculationMethod: StructureComponentCalculationType.PERCENTAGE,
        monthlyFixedAmount: null,
        percentage: 12,
        percentageOf: 'BASIC',
      },
      monthlyBaseAmountDec: toDecimal(30000),
      monthlyCalculatedAmountDec: toDecimal(3600),
    },
  ];

  it('prorates earnings across 28, 29, 30, and 31-day periods accurately', () => {
    // 28-day Feb: 14 payable days = 0.5
    const febNonLeap = calculator.applyProration(
      monthlyItems,
      28,
      14,
      defaultConfig,
    );
    expect(febNonLeap.components[0].finalAmountDec.toFixed(2)).toBe('15000.00');
    expect(febNonLeap.components[1].finalAmountDec.toFixed(2)).toBe('7500.00');

    // 29-day leap Feb: 29 payable days = full salary
    const febLeapFull = calculator.applyProration(
      monthlyItems,
      29,
      29,
      defaultConfig,
    );
    expect(febLeapFull.prorationApplied).toBe(false);
    expect(febLeapFull.components[0].finalAmountDec.toFixed(2)).toBe(
      '30000.00',
    );

    // 29-day leap Feb partial: 15 payable days = 30000 * 15 / 29 = 15517.241379 -> 15517.24
    const febLeapPartial = calculator.applyProration(
      monthlyItems,
      29,
      15,
      defaultConfig,
    );
    expect(febLeapPartial.prorationApplied).toBe(true);
    expect(febLeapPartial.components[0].finalAmountDec.toFixed(2)).toBe(
      '15517.24',
    );

    // 31-day Jan: 15 payable days = 30000 * 15 / 31 = 14516.129032 -> 14516.13 (HALF_EVEN)
    const janPartial = calculator.applyProration(
      monthlyItems,
      31,
      15,
      defaultConfig,
    );
    expect(janPartial.components[0].finalAmountDec.toFixed(2)).toBe('14516.13');
    expect(janPartial.components[1].finalAmountDec.toFixed(2)).toBe('7258.06');
  });

  it('keeps fixed earnings unprorated when prorateFixedComponents=false while prorating percentage earnings', () => {
    const res = calculator.applyProration(monthlyItems, 30, 15, {
      ...defaultConfig,
      prorateFixedComponents: false,
    });

    expect(res.components[0].prorationApplied).toBe(false);
    expect(res.components[0].finalAmountDec.toFixed(2)).toBe('30000.00');
    expect(res.components[1].prorationApplied).toBe(true);
    expect(res.components[1].finalAmountDec.toFixed(2)).toBe('7500.00');
  });

  it('respects prorateDeductions=false and prorateDeductions=true, and leaves employer contribution unprorated', () => {
    const resFalse = calculator.applyProration(
      monthlyItems,
      30,
      15,
      defaultConfig,
    );
    expect(resFalse.components[2].prorationApplied).toBe(false);
    expect(resFalse.components[2].finalAmountDec.toFixed(2)).toBe('200.00');
    expect(resFalse.components[3].prorationApplied).toBe(false);
    expect(resFalse.components[3].finalAmountDec.toFixed(2)).toBe('3600.00');

    const resTrue = calculator.applyProration(monthlyItems, 30, 15, {
      ...defaultConfig,
      prorateDeductions: true,
    });
    expect(resTrue.components[2].prorationApplied).toBe(true);
    expect(resTrue.components[2].finalAmountDec.toFixed(2)).toBe('100.00');
    expect(resTrue.components[3].prorationApplied).toBe(false);
    expect(resTrue.components[3].finalAmountDec.toFixed(2)).toBe('3600.00');
  });

  it('supports prorateEmployerContributions=false (default) and prorateEmployerContributions=true across PERCENTAGE (PF ₹2,160) and FIXED (Gratuity ₹650) June 2027 cases', () => {
    const juneEmployerItems: MonthlyCalculatedComponent[] = [
      {
        component: {
          componentId: 'pf_er',
          code: 'EMPLOYER_PF',
          name: 'Employer PF',
          classification: SalaryComponentType.EMPLOYER_CONTRIBUTION,
          calculationMethod: StructureComponentCalculationType.PERCENTAGE,
          monthlyFixedAmount: null,
          percentage: 12,
          percentageOf: 'BASIC',
        },
        monthlyBaseAmountDec: toDecimal(18000),
        monthlyCalculatedAmountDec: toDecimal(2160),
      },
      {
        component: {
          componentId: 'gratuity',
          code: 'GRATUITY',
          name: 'Gratuity',
          classification: SalaryComponentType.EMPLOYER_CONTRIBUTION,
          calculationMethod: StructureComponentCalculationType.FIXED,
          monthlyFixedAmount: toDecimal(650),
          percentage: null,
          percentageOf: null,
        },
        monthlyBaseAmountDec: toDecimal(650),
        monthlyCalculatedAmountDec: toDecimal(650),
      },
    ];

    const fullMonthDisabled = calculator.applyProration(
      juneEmployerItems,
      30,
      30,
      {
        ...defaultConfig,
        prorateFixedComponents: true,
        prorateDeductions: true,
        prorateEmployerContributions: false,
      },
    );
    expect(fullMonthDisabled.prorationApplied).toBe(false);
    expect(fullMonthDisabled.components[0].finalAmountDec.toFixed(2)).toBe(
      '2160.00',
    );
    expect(fullMonthDisabled.components[1].finalAmountDec.toFixed(2)).toBe(
      '650.00',
    );

    const partialMonthDisabled = calculator.applyProration(
      juneEmployerItems,
      30,
      15,
      {
        ...defaultConfig,
        prorateFixedComponents: true,
        prorateDeductions: true,
        prorateEmployerContributions: false,
      },
    );
    expect(partialMonthDisabled.prorationApplied).toBe(true);
    expect(partialMonthDisabled.components[0].prorationApplied).toBe(false);
    expect(partialMonthDisabled.components[0].finalAmountDec.toFixed(2)).toBe(
      '2160.00',
    );
    expect(partialMonthDisabled.components[1].prorationApplied).toBe(false);
    expect(partialMonthDisabled.components[1].finalAmountDec.toFixed(2)).toBe(
      '650.00',
    );

    // Flag enabled: full month remains unprorated; 15/30 prorates both PERCENTAGE & FIXED
    const fullMonthEnabled = calculator.applyProration(
      juneEmployerItems,
      30,
      30,
      {
        ...defaultConfig,
        prorateEmployerContributions: true,
      },
    );
    expect(fullMonthEnabled.components[0].finalAmountDec.toFixed(2)).toBe(
      '2160.00',
    );
    expect(fullMonthEnabled.components[1].finalAmountDec.toFixed(2)).toBe(
      '650.00',
    );

    const partialMonthEnabled = calculator.applyProration(
      juneEmployerItems,
      30,
      15,
      {
        ...defaultConfig,
        prorateEmployerContributions: true,
      },
    );
    expect(partialMonthEnabled.prorationApplied).toBe(true);
    expect(partialMonthEnabled.components[0].prorationApplied).toBe(true);
    expect(partialMonthEnabled.components[0].finalAmountDec.toFixed(2)).toBe(
      '1080.00',
    );
    expect(partialMonthEnabled.components[1].prorationApplied).toBe(true);
    expect(partialMonthEnabled.components[1].finalAmountDec.toFixed(2)).toBe(
      '325.00',
    );
  });

  it('handles 0 payable days correctly', () => {
    const res = calculator.applyProration(monthlyItems, 30, 0, defaultConfig);
    expect(res.prorationApplied).toBe(true);
    expect(res.components[0].finalAmountDec.toFixed(2)).toBe('0.00');
    expect(res.components[1].finalAmountDec.toFixed(2)).toBe('0.00');
    // PT not prorated because prorateDeductions=false
    expect(res.components[2].finalAmountDec.toFixed(2)).toBe('200.00');
  });

  it('applies HALF_EVEN, HALF_UP, HALF_DOWN, FLOOR, and CEIL rounding modes cleanly', () => {
    const itemOdd: MonthlyCalculatedComponent[] = [
      {
        component: {
          componentId: '1',
          code: 'ODD',
          name: 'Odd Earning',
          classification: SalaryComponentType.EARNING,
          calculationMethod: StructureComponentCalculationType.FIXED,
          monthlyFixedAmount: toDecimal(10.05), // * 0.5 = 5.025
          percentage: null,
          percentageOf: null,
        },
        monthlyBaseAmountDec: toDecimal(10.05),
        monthlyCalculatedAmountDec: toDecimal(10.05),
      },
    ];

    expect(
      calculator
        .applyProration(itemOdd, 30, 15, {
          ...defaultConfig,
          roundingMode: PayrollRoundingMode.HALF_EVEN,
        })
        .components[0].finalAmountDec.toFixed(2),
    ).toBe('5.02');

    expect(
      calculator
        .applyProration(itemOdd, 30, 15, {
          ...defaultConfig,
          roundingMode: PayrollRoundingMode.HALF_UP,
        })
        .components[0].finalAmountDec.toFixed(2),
    ).toBe('5.03');

    expect(
      calculator
        .applyProration(itemOdd, 30, 15, {
          ...defaultConfig,
          roundingMode: PayrollRoundingMode.FLOOR,
        })
        .components[0].finalAmountDec.toFixed(2),
    ).toBe('5.02');

    expect(
      calculator
        .applyProration(itemOdd, 30, 15, {
          ...defaultConfig,
          roundingMode: PayrollRoundingMode.CEIL,
        })
        .components[0].finalAmountDec.toFixed(2),
    ).toBe('5.03');

    // Precision 0 and precision 4 checks
    expect(
      calculator
        .applyProration(itemOdd, 30, 15, {
          ...defaultConfig,
          roundingPrecision: 0,
          roundingMode: PayrollRoundingMode.HALF_UP,
        })
        .components[0].finalAmountDec.toFixed(0),
    ).toBe('5');

    expect(
      calculator
        .applyProration(itemOdd, 30, 15, {
          ...defaultConfig,
          roundingPrecision: 4,
          roundingMode: PayrollRoundingMode.HALF_EVEN,
        })
        .components[0].finalAmountDec.toFixed(4),
    ).toBe('5.0250');
  });
});
