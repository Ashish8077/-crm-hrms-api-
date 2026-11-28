import { HttpStatus } from '@nestjs/common';
import { ComponentDependencyResolver } from './component-dependency.resolver';
import { ResolvedSalaryComponent } from './salary-component.resolver';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { StructureComponentCalculationType } from '../../salary-structures/constants/salary-structure.constant';
import { toDecimal } from '../../../common/utils/financial-math.util';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('ComponentDependencyResolver', () => {
  const resolver = new ComponentDependencyResolver();

  const makeFixed = (
    code: string,
    classification = SalaryComponentType.EARNING,
  ): ResolvedSalaryComponent => ({
    componentId: `id_${code}`,
    code,
    name: code,
    classification,
    calculationMethod: StructureComponentCalculationType.FIXED,
    monthlyFixedAmount: toDecimal(10000),
    percentage: null,
    percentageOf: null,
  });

  const makePct = (
    code: string,
    percentageOf: string,
    classification = SalaryComponentType.EARNING,
  ): ResolvedSalaryComponent => ({
    componentId: `id_${code}`,
    code,
    name: code,
    classification,
    calculationMethod: StructureComponentCalculationType.PERCENTAGE,
    monthlyFixedAmount: null,
    percentage: 10,
    percentageOf,
  });

  it('resolves multi-level percentage dependencies deterministically regardless of input array order', () => {
    const special = makePct('SPECIAL', 'HRA');
    const pf = makePct(
      'PF_EE',
      'BASIC',
      SalaryComponentType.EMPLOYEE_DEDUCTION,
    );
    const hra = makePct('HRA', 'BASIC');
    const basic = makeFixed('BASIC');

    const ordered = resolver.resolveExecutionOrder(
      [special, pf, hra, basic],
      [],
      false,
    );
    const codes = ordered.map((c) => c.code);

    expect(codes.indexOf('BASIC')).toBeLessThan(codes.indexOf('HRA'));
    expect(codes.indexOf('HRA')).toBeLessThan(codes.indexOf('SPECIAL'));
    expect(codes.indexOf('BASIC')).toBeLessThan(codes.indexOf('PF_EE'));
  });

  it('rejects missing base component with 400 VALIDATION_ERROR', () => {
    const hra = makePct('HRA', 'BASIC');

    try {
      resolver.resolveExecutionOrder([hra], [], false);
      throw new Error('Expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
  });

  it('rejects self-referencing and multi-node circular dependencies', () => {
    const selfLoop = makePct('COMP_A', 'COMP_A');
    try {
      resolver.resolveExecutionOrder([selfLoop], [], false);
      throw new Error('Expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const a = makePct('COMP_A', 'COMP_B');
    const b = makePct('COMP_B', 'COMP_C');
    const c = makePct('COMP_C', 'COMP_A');

    try {
      resolver.resolveExecutionOrder([a, b, c], [], false);
      throw new Error('Expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
  });

  it('rejects earning component depending on GROSS_EARNINGS as circular', () => {
    const basic = makeFixed('BASIC');
    const badEarning = makePct('BONUS', 'GROSS_EARNINGS');

    try {
      resolver.resolveExecutionOrder([basic, badEarning], [], true);
      throw new Error('Expected AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
  });

  it('orders BALANCE earning after all FIXED and PERCENTAGE earnings and before GROSS-dependent deductions', () => {
    const balanceComp: ResolvedSalaryComponent = {
      componentId: 'id_SPECIAL_ALLOWANCE',
      code: 'SPECIAL_ALLOWANCE',
      name: 'Special Allowance',
      classification: SalaryComponentType.EARNING,
      calculationMethod: StructureComponentCalculationType.BALANCE,
      monthlyFixedAmount: null,
      percentage: null,
      percentageOf: null,
    };
    const basic = makeFixed('BASIC');
    const hra = makePct('HRA', 'BASIC');
    const grossDed = makePct(
      'ESIC_EE',
      'GROSS_SALARY',
      SalaryComponentType.EMPLOYEE_DEDUCTION,
    );

    // Even when BALANCE is first in configuredOrder and input array
    const ordered = resolver.resolveExecutionOrder(
      [grossDed, balanceComp, hra, basic],
      ['SPECIAL_ALLOWANCE', 'BASIC', 'HRA'],
      true,
    );
    const codes = ordered.map((c) => c.code);

    expect(codes.indexOf('BASIC')).toBeLessThan(codes.indexOf('HRA'));
    expect(codes.indexOf('HRA')).toBeLessThan(
      codes.indexOf('SPECIAL_ALLOWANCE'),
    );
    expect(codes.indexOf('SPECIAL_ALLOWANCE')).toBeLessThan(
      codes.indexOf('ESIC_EE'),
    );
  });

  it('rejects BALANCE dependency resolution for non-EARNING component', () => {
    const badBalance: ResolvedSalaryComponent = {
      componentId: 'id_DED_BAL',
      code: 'DED_BAL',
      name: 'Ded Balance',
      classification: SalaryComponentType.EMPLOYEE_DEDUCTION,
      calculationMethod: StructureComponentCalculationType.BALANCE,
      monthlyFixedAmount: null,
      percentage: null,
      percentageOf: null,
    };

    try {
      resolver.resolveExecutionOrder([badBalance], [], true);
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
