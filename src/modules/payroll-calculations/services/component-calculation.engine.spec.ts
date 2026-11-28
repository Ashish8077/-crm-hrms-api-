import { HttpStatus } from '@nestjs/common';
import { ComponentCalculationEngine } from './component-calculation.engine';
import { ResolvedSalaryComponent } from './salary-component.resolver';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { StructureComponentCalculationType } from '../../salary-structures/constants/salary-structure.constant';
import { toDecimal } from '../../../common/utils/financial-math.util';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('ComponentCalculationEngine', () => {
  const engine = new ComponentCalculationEngine();

  const makeComp = (
    overrides: Partial<ResolvedSalaryComponent> & { code: string },
  ): ResolvedSalaryComponent => ({
    componentId: `id_${overrides.code}`,
    name: overrides.code,
    classification: SalaryComponentType.EARNING,
    calculationMethod: StructureComponentCalculationType.FIXED,
    monthlyFixedAmount: null,
    percentage: null,
    percentageOf: null,
    ...overrides,
  });

  it('calculates BALANCE earning as targetMonthlyGross minus sum of other monthly earnings in Decimal', () => {
    const ordered: ResolvedSalaryComponent[] = [
      makeComp({
        code: 'BASIC',
        calculationMethod: StructureComponentCalculationType.FIXED,
        monthlyFixedAmount: toDecimal(20000),
      }),
      makeComp({
        code: 'HRA',
        calculationMethod: StructureComponentCalculationType.PERCENTAGE,
        percentage: 50,
        percentageOf: 'BASIC',
      }),
      makeComp({
        code: 'SPECIAL_ALLOWANCE',
        calculationMethod: StructureComponentCalculationType.BALANCE,
      }),
      makeComp({
        code: 'ESIC_EE',
        classification: SalaryComponentType.EMPLOYEE_DEDUCTION,
        calculationMethod: StructureComponentCalculationType.PERCENTAGE,
        percentage: 1,
        percentageOf: 'GROSS_SALARY',
      }),
    ];

    const results = engine.calculateMonthlyAmounts(ordered, toDecimal(40000));
    const byCode = new Map(results.map((r) => [r.component.code, r]));

    expect(byCode.get('BASIC')!.monthlyCalculatedAmountDec.toFixed(2)).toBe(
      '20000.00',
    );
    expect(byCode.get('HRA')!.monthlyCalculatedAmountDec.toFixed(2)).toBe(
      '10000.00',
    );
    expect(
      byCode.get('SPECIAL_ALLOWANCE')!.monthlyCalculatedAmountDec.toFixed(2),
    ).toBe('10000.00');
    expect(
      byCode.get('SPECIAL_ALLOWANCE')!.monthlyBaseAmountDec.toFixed(2),
    ).toBe('40000.00');
    // Gross-dependent deduction sees full 40,000.00 (including BALANCE)
    expect(byCode.get('ESIC_EE')!.monthlyBaseAmountDec.toFixed(2)).toBe(
      '40000.00',
    );
    expect(byCode.get('ESIC_EE')!.monthlyCalculatedAmountDec.toFixed(2)).toBe(
      '400.00',
    );
  });

  it('rejects negative BALANCE when other earnings exceed targetMonthlyGross', () => {
    const ordered: ResolvedSalaryComponent[] = [
      makeComp({
        code: 'BASIC',
        calculationMethod: StructureComponentCalculationType.FIXED,
        monthlyFixedAmount: toDecimal(30000),
      }),
      makeComp({
        code: 'HRA',
        calculationMethod: StructureComponentCalculationType.PERCENTAGE,
        percentage: 50,
        percentageOf: 'BASIC',
      }),
      makeComp({
        code: 'SPECIAL_ALLOWANCE',
        calculationMethod: StructureComponentCalculationType.BALANCE,
      }),
    ];

    try {
      engine.calculateMonthlyAmounts(ordered, toDecimal(40000));
      throw new Error('Expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
  });

  it('rejects BALANCE when targetMonthlyGross is null', () => {
    const ordered: ResolvedSalaryComponent[] = [
      makeComp({
        code: 'SPECIAL_ALLOWANCE',
        calculationMethod: StructureComponentCalculationType.BALANCE,
      }),
    ];

    try {
      engine.calculateMonthlyAmounts(ordered, null);
      throw new Error('Expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
  });

  it('rejects BALANCE on non-EARNING component', () => {
    const ordered: ResolvedSalaryComponent[] = [
      makeComp({
        code: 'DED_BAL',
        classification: SalaryComponentType.EMPLOYEE_DEDUCTION,
        calculationMethod: StructureComponentCalculationType.BALANCE,
      }),
    ];

    try {
      engine.calculateMonthlyAmounts(ordered, toDecimal(40000));
      throw new Error('Expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
  });
});
