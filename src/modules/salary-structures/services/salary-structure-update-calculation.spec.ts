import { Types } from 'mongoose';
import {
  SalaryStructureCalculationService,
  CalculationMasterMap,
} from './salary-structure-calculation.service';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { roundBankers } from '../../../common/utils/financial-math.util';

describe('SalaryStructureUpdateCalculation Unit Tests', () => {
  let calculationService: SalaryStructureCalculationService;

  const basicId = new Types.ObjectId();
  const hraId = new Types.ObjectId();
  const conveyanceId = new Types.ObjectId();
  const specialAllowanceId = new Types.ObjectId();
  const employeePfId = new Types.ObjectId();
  const professionalTaxId = new Types.ObjectId();
  const employerPfId = new Types.ObjectId();
  const gratuityId = new Types.ObjectId();
  const actorId = new Types.ObjectId();

  const masterMap: CalculationMasterMap = {
    [basicId.toString()]: {
      _id: basicId,
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
    [hraId.toString()]: {
      _id: hraId,
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
    [conveyanceId.toString()]: {
      _id: conveyanceId,
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
    [specialAllowanceId.toString()]: {
      _id: specialAllowanceId,
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
    [employeePfId.toString()]: {
      _id: employeePfId,
      name: 'Employee PF',
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
    [professionalTaxId.toString()]: {
      _id: professionalTaxId,
      name: 'Professional Tax',
      code: 'PT',
      type: SalaryComponentType.EMPLOYEE_DEDUCTION,
      isTaxable: false,
      isStatutory: true,
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    [employerPfId.toString()]: {
      _id: employerPfId,
      name: 'Employer PF',
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
    [gratuityId.toString()]: {
      _id: gratuityId,
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
  };

  beforeEach(() => {
    calculationService = new SalaryStructureCalculationService();
  });

  describe('TC-UNIT-01: FIXED components calculation', () => {
    it('accurately resolves fixed monetary amounts in monthly frequency', () => {
      const result = calculationService.calculate({
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        masterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 30000,
          },
          {
            componentId: conveyanceId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 20000,
          },
        ],
      });

      // Basic FIXED 30000, Conveyance FIXED 20000 -> Gross 50000
      expect(result.grossSalaryMonthly).toBe(50000);
      expect(result.grossSalaryAnnual).toBe(600000);
      expect(result.earnings[0].monthlyAmount).toBe(30000);
      expect(result.earnings[0].annualAmount).toBe(360000);
      expect(result.earnings[1].monthlyAmount).toBe(20000);
      expect(result.earnings[1].annualAmount).toBe(240000);
    });
  });

  describe('TC-UNIT-02: PERCENTAGE components based on BASIC', () => {
    it('accurately resolves percentage of BASIC for earnings and deductions', () => {
      const result = calculationService.calculate({
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        masterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: hraId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 40,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employeePfId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
      });

      // Basic: 25,000. HRA (40% of 25,000) = 10,000. Employee PF (12% of 25,000) = 3,000.
      const hraItem = result.earnings.find((e) => e.code === 'HRA');
      expect(hraItem).toBeDefined();
      expect(hraItem?.monthlyAmount).toBe(10000);
      expect(hraItem?.annualAmount).toBe(120000);

      const pfItem = result.employeeDeductions.find((d) => d.code === 'EMP_PF');
      expect(pfItem).toBeDefined();
      expect(pfItem?.monthlyAmount).toBe(3000);
      expect(pfItem?.annualAmount).toBe(36000);
    });
  });

  describe('TC-UNIT-03: PERCENTAGE components based on GROSS_SALARY', () => {
    it('accurately resolves percentage of GROSS_SALARY for Basic Salary', () => {
      const result = calculationService.calculate({
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 60000,
        masterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      });

      // Basic = 50% of 60,000 = 30,000. Special Allowance (BALANCE) = 60,000 - 30,000 = 30,000.
      const basicItem = result.earnings.find((e) => e.code === 'BASIC');
      expect(basicItem).toBeDefined();
      expect(basicItem?.monthlyAmount).toBe(30000);
      expect(basicItem?.annualAmount).toBe(360000);

      const balanceItem = result.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(balanceItem?.monthlyAmount).toBe(30000);
    });
  });

  describe('TC-UNIT-04: BALANCE component calculation', () => {
    it('correctly absorbs remaining unallocated gross salary after all fixed and percentage earnings', () => {
      const result = calculationService.calculate({
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 75000,
        masterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 35000,
          },
          {
            componentId: hraId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: conveyanceId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 2500,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      });

      // Basic: 35,000. HRA: 50% of 35,000 = 17,500. Conveyance: 2,500.
      // Sum of allocated earnings = 35,000 + 17,500 + 2,500 = 55,000.
      // Balance = 75,000 - 55,000 = 20,000.
      const saItem = result.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(saItem).toBeDefined();
      expect(saItem?.monthlyAmount).toBe(20000);
      expect(saItem?.annualAmount).toBe(240000);
      expect(result.grossSalaryMonthly).toBe(75000);
    });
  });

  describe('TC-UNIT-05: GROSS-based structure complete financial reconciliation', () => {
    it('reconciles Gross, Employee Deductions, Employer Contributions, Net Salary, and Total CTC', () => {
      // Independent test specification:
      // Gross: 50,000
      // Basic: 50% of Gross = 25,000
      // HRA: 40% of Basic = 10,000
      // Conveyance: Fixed 2,000
      // Special Allowance (BALANCE): 50,000 - (25,000 + 10,000 + 2,000) = 13,000
      // Employee PF: 12% of Basic = 3,000
      // Professional Tax: Fixed 200
      // Employer PF: 12% of Basic = 3,000
      // Gratuity Provision: Fixed 1,202
      // Expected Summary:
      // Gross: 50,000
      // Deductions: 3,000 + 200 = 3,200
      // Estimated Net: 50,000 - 3,200 = 46,800
      // Employer Cost: 3,000 + 1,202 = 4,202
      // CTC: 50,000 + 4,202 = 54,202

      const result = calculationService.calculate({
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        masterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
          },
          {
            componentId: hraId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 40,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: conveyanceId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 2000,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employeePfId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: professionalTaxId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 200,
          },
          {
            componentId: employerPfId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: gratuityId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 1202,
          },
        ],
      });

      expect(result.grossSalaryMonthly).toBe(50000);
      expect(result.grossSalaryAnnual).toBe(600000);
      expect(result.totalEmployeeDeductionsMonthly).toBe(3200);
      expect(result.totalEmployeeDeductionsAnnual).toBe(38400);
      expect(result.estimatedNetSalaryMonthly).toBe(46800);
      expect(result.estimatedNetSalaryAnnual).toBe(561600);
      expect(result.totalEmployerContributionsMonthly).toBe(4202);
      expect(result.totalEmployerContributionsAnnual).toBe(50424);
      expect(result.totalCtcMonthly).toBe(54202);
      expect(result.totalCtcAnnual).toBe(650424);
    });
  });

  describe('TC-UNIT-06: CTC-based structure derivation of Gross Salary', () => {
    it('correctly subtracts employer contributions from CTC to derive Gross and solve Balance component', () => {
      // Independent test specification:
      // CTC: 60,000 monthly
      // Basic: Fixed 30,000
      // HRA: 50% of Basic = 15,000
      // Employer PF: 12% of Basic = 3,600
      // Gratuity: Fixed 1,442
      // Employee PF: 12% of Basic = 3,600
      // Special Allowance: BALANCE
      // Expected:
      // Employer Cost: 3,600 + 1,442 = 5,042
      // Derived Gross: 60,000 - 5,042 = 54,958
      // Special Allowance: 54,958 - (30,000 + 15,000) = 9,958
      // Deductions: 3,600
      // Net: 54,958 - 3,600 = 51,358

      const result = calculationService.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 60000,
        masterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 30000,
          },
          {
            componentId: hraId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employeePfId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: employerPfId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: gratuityId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 1442,
          },
        ],
      });

      expect(result.totalCtcMonthly).toBe(60000);
      expect(result.totalEmployerContributionsMonthly).toBe(5042);
      expect(result.grossSalaryMonthly).toBe(54958);
      const saItem = result.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(saItem?.monthlyAmount).toBe(9958);
      expect(result.totalEmployeeDeductionsMonthly).toBe(3600);
      expect(result.estimatedNetSalaryMonthly).toBe(51358);
    });
  });

  describe('TC-UNIT-07: MONTHLY and ANNUAL conversion rules', () => {
    it('derives exact monthly and annual values according to banker rounding standards', () => {
      // Annual CTC: 600,000
      // Basic Annual: Fixed 300,000
      // HRA: 50% of Basic = 150,000
      // Employer PF: 12% of Basic = 36,000
      // Gratuity: Fixed 10,845
      // Employee PF: 12% of Basic = 36,000
      // Special Allowance: BALANCE
      // Expected Annual:
      // Employer Contributions: 36,000 + 10,845 = 46,845
      // Gross: 600,000 - 46,845 = 553,155
      // Special Allowance: 553,155 - 450,000 = 103,155
      // Expected Monthly:
      // Basic: 300,000 / 12 = 25,000
      // HRA: 150,000 / 12 = 12,500
      // Employer PF: 36,000 / 12 = 3,000
      // Gratuity: 10,845 / 12 = 903.75
      // Special Allowance: 103,155 / 12 = 8,596.25
      // Gross Monthly: 553,155 / 12 = 46,096.25
      // Net Monthly: 46,096.25 - 3,000 = 43,096.25

      const result = calculationService.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        masterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 300000,
          },
          {
            componentId: hraId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: employeePfId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: employerPfId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: gratuityId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 10845,
          },
        ],
      });

      expect(result.totalCtcAnnual).toBe(600000);
      expect(result.totalCtcMonthly).toBe(50000);
      expect(result.grossSalaryAnnual).toBe(553155);
      expect(result.grossSalaryMonthly).toBe(46096.25);
      expect(result.totalEmployerContributionsAnnual).toBe(46845);
      expect(result.totalEmployerContributionsMonthly).toBe(3903.75);

      const gratuity = result.employerContributions.find(
        (c) => c.code === 'GRATUITY',
      );
      expect(gratuity?.annualAmount).toBe(10845);
      expect(gratuity?.monthlyAmount).toBe(903.75);

      const sa = result.earnings.find((e) => e.code === 'SPECIAL_ALLOWANCE');
      expect(sa?.annualAmount).toBe(103155);
      expect(sa?.monthlyAmount).toBe(8596.25);

      expect(result.totalEmployeeDeductionsAnnual).toBe(36000);
      expect(result.totalEmployeeDeductionsMonthly).toBe(3000);
      expect(result.estimatedNetSalaryAnnual).toBe(517155);
      expect(result.estimatedNetSalaryMonthly).toBe(43096.25);
    });
  });

  describe('TC-UNIT-08: Rounding precision and banker rounding', () => {
    it('verifies roundBankers rounds half to even to prevent cumulative reconciliation drift', () => {
      // Banker's rounding: half (0.5) rounds to nearest even integer
      expect(roundBankers(2.5, 0)).toBe(2);
      expect(roundBankers(3.5, 0)).toBe(4);
      expect(roundBankers(12.505, 2)).toBe(12.5);
      expect(roundBankers(12.515, 2)).toBe(12.52);
      expect(roundBankers(12.525, 2)).toBe(12.52);
      expect(roundBankers(12.535, 2)).toBe(12.54);
    });
  });

  describe('TC-UNIT-09: Invalid and circular dependency rejections', () => {
    it('rejects structure when a component references BASIC but BASIC is omitted', () => {
      expect(() =>
        calculationService.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 50000,
          masterMap,
          components: [
            {
              componentId: hraId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              percentage: 50,
              percentageOf: StructureComponentPercentageBasis.BASIC, // Missing BASIC!
            },
          ],
        }),
      ).toThrow(AppError);

      try {
        calculationService.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 50000,
          masterMap,
          components: [
            {
              componentId: hraId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              percentage: 50,
              percentageOf: StructureComponentPercentageBasis.BASIC,
            },
          ],
        });
      } catch (error) {
        const err = error as AppError;
        expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(err.message).toContain("require a component with code 'BASIC'");
      }
    });

    it('rejects structure when BALANCE calculationType is used on an EMPLOYEE_DEDUCTION component', () => {
      expect(() =>
        calculationService.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 50000,
          masterMap,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 40000,
            },
            {
              componentId: employeePfId,
              calculationType: StructureComponentCalculationType.BALANCE, // Illegal on deduction!
            },
          ],
        }),
      ).toThrow(AppError);

      try {
        calculationService.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 50000,
          masterMap,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 40000,
            },
            {
              componentId: employeePfId,
              calculationType: StructureComponentCalculationType.BALANCE,
            },
          ],
        });
      } catch (error) {
        const err = error as AppError;
        expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(err.message).toContain(
          'BALANCE calculationType is only supported for EARNING components',
        );
      }
    });
  });

  describe('TC-UNIT-10: Negative BALANCE rejection', () => {
    it('rejects update calculation when configured fixed and percentage earnings exceed Gross Salary', () => {
      // Gross: 50,000. Basic Fixed: 35,000. Conveyance Fixed: 20,000.
      // Total configured earnings = 55,000 > 50,000. Balance would be -5,000.
      expect(() =>
        calculationService.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 50000,
          masterMap,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 35000,
            },
            {
              componentId: conveyanceId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 20000,
            },
            {
              componentId: specialAllowanceId,
              calculationType: StructureComponentCalculationType.BALANCE,
            },
          ],
        }),
      ).toThrow(AppError);

      try {
        calculationService.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 50000,
          masterMap,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 35000,
            },
            {
              componentId: conveyanceId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 20000,
            },
            {
              componentId: specialAllowanceId,
              calculationType: StructureComponentCalculationType.BALANCE,
            },
          ],
        });
      } catch (error) {
        const err = error as AppError;
        expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(err.message).toContain('exceed Gross Salary');
      }
    });

    it('rejects CTC update calculation when fixed employer costs exceed CTC', () => {
      // CTC: 10,000. Gratuity Fixed: 15,000.
      expect(() =>
        calculationService.calculate({
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 10000,
          masterMap,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 5000,
            },
            {
              componentId: gratuityId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 15000, // Exceeds CTC!
            },
            {
              componentId: specialAllowanceId,
              calculationType: StructureComponentCalculationType.BALANCE,
            },
          ],
        }),
      ).toThrow(AppError);

      try {
        calculationService.calculate({
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 10000,
          masterMap,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 5000,
            },
            {
              componentId: gratuityId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 15000,
            },
            {
              componentId: specialAllowanceId,
              calculationType: StructureComponentCalculationType.BALANCE,
            },
          ],
        });
      } catch (error) {
        const err = error as AppError;
        expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(err.message).toContain(
          'Configured fixed employer costs equal or exceed total CTC',
        );
      }
    });
  });
});
