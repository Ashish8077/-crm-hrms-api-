import { Logger } from '@nestjs/common';
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

describe('SalaryStructureCalculationService', () => {
  let service: SalaryStructureCalculationService;

  const basicId = new Types.ObjectId();
  const hraId = new Types.ObjectId();
  const specialAllowanceId = new Types.ObjectId();
  const employeePfId = new Types.ObjectId();
  const employerPfId = new Types.ObjectId();
  const gratuityId = new Types.ObjectId();

  const mockMasterMap: CalculationMasterMap = {
    [basicId.toString()]: {
      _id: basicId,
      name: 'Basic Salary',
      code: 'BASIC',
      type: SalaryComponentType.EARNING,
      isTaxable: true,
      isStatutory: false,
      isActive: true,
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    [hraId.toString()]: {
      _id: hraId,
      name: 'House Rent Allowance',
      code: 'HRA',
      type: SalaryComponentType.EARNING,
      isTaxable: true,
      isStatutory: false,
      isActive: true,
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    [specialAllowanceId.toString()]: {
      _id: specialAllowanceId,
      name: 'Special Allowance',
      code: 'SPECIAL_ALLOWANCE',
      type: SalaryComponentType.EARNING,
      isTaxable: true,
      isStatutory: false,
      isActive: true,
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    [employeePfId.toString()]: {
      _id: employeePfId,
      name: 'Employee PF',
      code: 'EMP_PF',
      type: SalaryComponentType.EMPLOYEE_DEDUCTION,
      isTaxable: false,
      isStatutory: true,
      isActive: true,
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    [employerPfId.toString()]: {
      _id: employerPfId,
      name: 'Employer PF',
      code: 'EMPR_PF',
      type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
      isTaxable: false,
      isStatutory: true,
      isActive: true,
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    [gratuityId.toString()]: {
      _id: gratuityId,
      name: 'Gratuity Provision',
      code: 'GRATUITY',
      type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
      isTaxable: false,
      isStatutory: true,
      isActive: true,
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  beforeEach(() => {
    service = new SalaryStructureCalculationService();
  });

  describe('GROSS-based calculations', () => {
    it('TC-CALC-01: Correctly calculates Gross-based structure with Basic, HRA, Balance Special Allowance, and Employer Costs', () => {
      const result = service.calculate({
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        masterMap: mockMasterMap,
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
            amount: 723,
          },
        ],
      });

      // Basic: 50% of 50,000 = 25,000
      // HRA: 50% of 25,000 = 12,500
      // Special Allowance (Balance): 50,000 - (25,000 + 12,500) = 12,500
      expect(result.grossSalaryMonthly).toBe(50000);
      expect(result.grossSalaryAnnual).toBe(600000);

      const basicLine = result.earnings.find((e) => e.code === 'BASIC');
      const hraLine = result.earnings.find((e) => e.code === 'HRA');
      const saLine = result.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );

      expect(basicLine?.monthlyAmount).toBe(25000);
      expect(hraLine?.monthlyAmount).toBe(12500);
      expect(saLine?.monthlyAmount).toBe(12500);

      // Employer PF: 12% of 25,000 = 3,000
      // Gratuity: 723
      // Total Employer Cost: 3,723
      // Total CTC: 50,000 + 3,723 = 53,723
      expect(result.totalEmployerContributionsMonthly).toBe(3723);
      expect(result.totalCtcMonthly).toBe(53723);

      // Employee PF: 12% of 25,000 = 3,000
      // Net Salary: 50,000 - 3,000 = 47,000
      expect(result.totalEmployeeDeductionsMonthly).toBe(3000);
      expect(result.estimatedNetSalaryMonthly).toBe(47000);
    });

    it('TC-CALC-02: Rejects Gross-based structure when earnings exceed Gross Salary (negative balance)', () => {
      expect(() =>
        service.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 20000,
          masterMap: mockMasterMap,
          components: [
            {
              componentId: basicId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 15000,
            },
            {
              componentId: hraId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 10000, // 15,000 + 10,000 = 25,000 > 20,000!
            },
            {
              componentId: specialAllowanceId,
              calculationType: StructureComponentCalculationType.BALANCE,
            },
          ],
        }),
      ).toThrow(AppError);
    });
  });

  describe('CTC-based calculations', () => {
    it('TC-CALC-03: Correctly derives Gross from CTC when Employer PF is % of Basic and Basic is % of Gross', () => {
      // CTC = 40,000
      // Employer PF = 12% of Basic
      // Gratuity = 723 (fixed)
      // Basic = 50% of Gross
      // Effective employer rate on Gross = 12% * 50% = 6% (0.06)
      // Fixed employer cost = 723
      // Gross = (40,000 - 723) / (1 + 0.06) = 39,277 / 1.06 = 37,053.77358...
      const result = service.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 40000,
        masterMap: mockMasterMap,
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
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
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
            amount: 723,
          },
        ],
      });

      // Verification: Gross + Employer Contributions must equal CTC (40,000)
      expect(result.totalCtcMonthly).toBe(40000);
      const grossPlusEmployer =
        result.grossSalaryMonthly + result.totalEmployerContributionsMonthly;
      expect(Math.abs(grossPlusEmployer - 40000)).toBeLessThanOrEqual(0.02);
    });

    it('TC-CALC-04: Correctly derives Gross from CTC when Basic is FIXED and Employer PF is % of Basic', () => {
      // CTC = 50,000
      // Basic = 20,000 (fixed)
      // Employer PF = 12% of Basic = 2,400 (fixed)
      // Gratuity = 1,000 (fixed)
      // Total Employer Cost = 3,400
      // Gross Salary = 50,000 - 3,400 = 46,600
      const result = service.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        masterMap: mockMasterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 20000,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
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
            amount: 1000,
          },
        ],
      });

      expect(result.grossSalaryMonthly).toBe(46600);
      expect(result.totalEmployerContributionsMonthly).toBe(3400);
      expect(result.totalCtcMonthly).toBe(50000);
    });

    it('TC-CALC-05: Rejects CTC calculation when fixed employer costs exceed CTC', () => {
      expect(() =>
        service.calculate({
          salaryBasis: SalaryStructureBasis.CTC,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 1000,
          masterMap: mockMasterMap,
          components: [
            {
              componentId: gratuityId,
              calculationType: StructureComponentCalculationType.FIXED,
              amount: 5000, // 5,000 > 1,000!
            },
          ],
        }),
      ).toThrow(AppError);
    });
  });

  describe('Validation & Boundary Protection', () => {
    it('TC-CALC-06: Throws validation error if component references BASIC but BASIC is missing', () => {
      expect(() =>
        service.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 30000,
          masterMap: mockMasterMap,
          components: [
            {
              componentId: hraId,
              calculationType: StructureComponentCalculationType.PERCENTAGE,
              percentage: 50,
              percentageOf: StructureComponentPercentageBasis.BASIC,
            },
          ],
        }),
      ).toThrow(AppError);
    });

    it('TC-CALC-07: Throws validation error if BALANCE calculationType is used on a deduction component', () => {
      expect(() =>
        service.calculate({
          salaryBasis: SalaryStructureBasis.GROSS,
          salaryFrequency: SalaryStructureFrequency.MONTHLY,
          salaryAmount: 30000,
          masterMap: mockMasterMap,
          components: [
            {
              componentId: employeePfId, // Deduction!
              calculationType: StructureComponentCalculationType.BALANCE,
            },
          ],
        }),
      ).toThrow(AppError);
    });
  });

  describe('Gratuity Provision Configuration & Calculation', () => {
    it('TC-CALC-GRATUITY-01: Gratuity Provision is purely an employer contribution that contributes to CTC but does not inflate Gross or reduce Net salary', () => {
      const result = service.calculate({
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        masterMap: mockMasterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: gratuityId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 1200,
          },
        ],
      });

      // 1. Gross Salary must not be inflated by Gratuity Provision
      expect(result.grossSalaryMonthly).toBe(50000);
      expect(result.grossSalaryAnnual).toBe(600000);

      // 2. Gratuity must be categorized exclusively as Employer Contribution
      expect(result.totalEmployerContributionsMonthly).toBe(1200);
      expect(result.totalEmployerContributionsAnnual).toBe(14400);

      const gratuityLine = result.employerContributions.find(
        (c) => c.code === 'GRATUITY',
      );
      expect(gratuityLine).toBeDefined();
      expect(gratuityLine?.monthlyAmount).toBe(1200);
      expect(gratuityLine?.annualAmount).toBe(14400);

      // 3. Gratuity must not appear in earnings or employee deductions
      expect(result.earnings.some((e) => e.code === 'GRATUITY')).toBe(false);
      expect(result.employeeDeductions.some((d) => d.code === 'GRATUITY')).toBe(
        false,
      );

      // 4. Total CTC must include Gratuity: Gross (50,000) + Gratuity (1,200) = 51,200
      expect(result.totalCtcMonthly).toBe(51200);
      expect(result.totalCtcAnnual).toBe(614400);

      // 5. Estimated Net Salary must not deduct Gratuity Provision
      expect(result.totalEmployeeDeductionsMonthly).toBe(0);
      expect(result.estimatedNetSalaryMonthly).toBe(50000);
      expect(result.estimatedNetSalaryAnnual).toBe(600000);
    });

    it('TC-CALC-GRATUITY-02: Gratuity Provision is optional and omitting it yields identical Gross and Net without errors', () => {
      const result = service.calculate({
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        masterMap: mockMasterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      });

      expect(result.grossSalaryMonthly).toBe(50000);
      expect(result.totalEmployerContributionsMonthly).toBe(0);
      expect(result.totalCtcMonthly).toBe(50000);
      expect(result.estimatedNetSalaryMonthly).toBe(50000);
      expect(result.employerContributions.length).toBe(0);
    });

    it('TC-CALC-GRATUITY-03: Under CTC basis, Gratuity fixed amount is factored into employer costs before deriving Gross, reconciling exactly', () => {
      const result = service.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 60000,
        masterMap: mockMasterMap,
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
          {
            componentId: gratuityId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 2000,
          },
        ],
      });

      // Fixed employer cost = 2,000 (Gratuity)
      // Gross = CTC (60,000) - Fixed Employer Cost (2,000) = 58,000
      expect(result.grossSalaryMonthly).toBe(58000);
      expect(result.totalEmployerContributionsMonthly).toBe(2000);
      expect(result.totalCtcMonthly).toBe(60000);
      expect(result.estimatedNetSalaryMonthly).toBe(58000);

      const gratuityLine = result.employerContributions.find(
        (c) => c.code === 'GRATUITY',
      );
      expect(gratuityLine?.monthlyAmount).toBe(2000);
      expect(gratuityLine?.annualAmount).toBe(24000);
    });
  });

  describe('Annual CTC Salary Structure Calculation Contract', () => {
    it('TC-CALC-ANNUAL-01: Verifies Annual CTC 480,000 calculation where fixed amounts are configured in annual units', () => {
      // Annual CTC: 480,000
      // Basic: 240,000 (annual FIXED) -> Monthly = 20,000
      // Employer PF: 12% of BASIC -> Annual = 28,800; Monthly = 2,400
      // Gratuity Provision: 8,676 (annual FIXED) -> Monthly = 723
      // Total Employer Contributions: 28,800 + 8,676 = 37,476 annual -> Monthly = 3,123
      // Gross Salary: 480,000 - 37,476 = 442,524 annual -> Monthly = 36,877
      // Special Allowance: BALANCE -> Annual = 442,524 - 240,000 = 202,524; Monthly = 16,877
      // Employee PF: 12% of BASIC -> Annual = 28,800; Monthly = 2,400
      // Estimated Net Salary: 442,524 - 28,800 = 413,724 annual -> Monthly = 34,477
      const result = service.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 480000,
        masterMap: mockMasterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 240000,
          },
          {
            componentId: specialAllowanceId,
            calculationType: StructureComponentCalculationType.BALANCE,
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
            amount: 8676,
          },
          {
            componentId: employeePfId,
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 12,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
      });

      // 1. Annual Breakdowns
      expect(result.salaryFrequency).toBe(SalaryStructureFrequency.ANNUAL);
      expect(result.inputSalaryAmount).toBe(480000);
      expect(result.totalCtcAnnual).toBe(480000);
      expect(result.grossSalaryAnnual).toBe(442524);
      expect(result.totalEmployerContributionsAnnual).toBe(37476);
      expect(result.totalEmployeeDeductionsAnnual).toBe(28800);
      expect(result.estimatedNetSalaryAnnual).toBe(413724);

      // 2. Monthly Breakdowns
      expect(result.totalCtcMonthly).toBe(40000);
      expect(result.grossSalaryMonthly).toBe(36877);
      expect(result.totalEmployerContributionsMonthly).toBe(3123);
      expect(result.totalEmployeeDeductionsMonthly).toBe(2400);
      expect(result.estimatedNetSalaryMonthly).toBe(34477);

      // 3. Structured summary object
      expect(result.summary?.annual).toEqual({
        grossSalary: 442524,
        employerContributions: 37476,
        totalCtc: 480000,
        employeeDeductions: 28800,
        estimatedNetSalary: 413724,
      });
      expect(result.summary?.monthly).toEqual({
        grossSalary: 36877,
        employerContributions: 3123,
        totalCtc: 40000,
        employeeDeductions: 2400,
        estimatedNetSalary: 34477,
      });

      // 4. Line items verification (both monthly and annual)
      const basicLine = result.earnings.find((e) => e.code === 'BASIC');
      expect(basicLine?.monthlyAmount).toBe(20000);
      expect(basicLine?.annualAmount).toBe(240000);

      const saLine = result.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(saLine?.monthlyAmount).toBe(16877);
      expect(saLine?.annualAmount).toBe(202524);

      const empPfLine = result.employeeDeductions.find(
        (e) => e.code === 'EMP_PF',
      );
      expect(empPfLine?.monthlyAmount).toBe(2400);
      expect(empPfLine?.annualAmount).toBe(28800);

      const emprPfLine = result.employerContributions.find(
        (e) => e.code === 'EMPR_PF',
      );
      expect(emprPfLine?.monthlyAmount).toBe(2400);
      expect(emprPfLine?.annualAmount).toBe(28800);

      const gratuityLine = result.employerContributions.find(
        (c) => c.code === 'GRATUITY',
      );
      expect(gratuityLine?.monthlyAmount).toBe(723);
      expect(gratuityLine?.annualAmount).toBe(8676);
    });

    it('TC-CALC-ANNUAL-02: Verifies exact failing scenario for Annual CTC 600,000 with Basic 300,000, HRA, SA Balance, PF, and Gratuity', () => {
      // Input:
      // - salaryBasis: CTC
      // - salaryFrequency: ANNUAL
      // - salaryAmount: 600000
      // Components:
      // 1. Basic Salary: FIXED ₹300000
      // 2. HRA: 50% of BASIC
      // 3. Special Allowance: BALANCE
      // 4. Employee PF: 12% of BASIC
      // 5. Employer PF: 12% of BASIC
      // 6. Gratuity Provision: FIXED ₹10845
      const result = service.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        masterMap: mockMasterMap,
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

      // Expected calculation assertions:
      // - Basic: ₹300000 (monthly: ₹25000)
      const basicLine = result.earnings.find((e) => e.code === 'BASIC');
      expect(basicLine).toBeDefined();
      expect(basicLine?.annualAmount).toBe(300000);
      expect(basicLine?.monthlyAmount).toBe(25000);

      // - HRA: ₹150000 (monthly: ₹12500)
      const hraLine = result.earnings.find((e) => e.code === 'HRA');
      expect(hraLine).toBeDefined();
      expect(hraLine?.annualAmount).toBe(150000);
      expect(hraLine?.monthlyAmount).toBe(12500);

      // - Employee PF: ₹36000 (monthly: ₹3000)
      const empPfLine = result.employeeDeductions.find(
        (e) => e.code === 'EMP_PF',
      );
      expect(empPfLine).toBeDefined();
      expect(empPfLine?.annualAmount).toBe(36000);
      expect(empPfLine?.monthlyAmount).toBe(3000);

      // - Employer PF: ₹36000 (monthly: ₹3000)
      const emprPfLine = result.employerContributions.find(
        (e) => e.code === 'EMPR_PF',
      );
      expect(emprPfLine).toBeDefined();
      expect(emprPfLine?.annualAmount).toBe(36000);
      expect(emprPfLine?.monthlyAmount).toBe(3000);

      // - Gratuity: ₹10845 (monthly: ₹903.75)
      const gratuityLine = result.employerContributions.find(
        (c) => c.code === 'GRATUITY',
      );
      expect(gratuityLine).toBeDefined();
      expect(gratuityLine?.annualAmount).toBe(10845);
      expect(gratuityLine?.monthlyAmount).toBe(903.75);

      // - Employer Contributions: ₹46845 (monthly: ₹3903.75)
      expect(result.totalEmployerContributionsAnnual).toBe(46845);
      expect(result.totalEmployerContributionsMonthly).toBe(3903.75);

      // - Gross Salary: ₹553155 (monthly: ₹46096.25)
      expect(result.grossSalaryAnnual).toBe(553155);
      expect(result.grossSalaryMonthly).toBe(46096.25);

      // - Special Allowance: ₹103155 (monthly: ₹8596.25)
      const saLine = result.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(saLine).toBeDefined();
      expect(saLine?.annualAmount).toBe(103155);
      expect(saLine?.monthlyAmount).toBe(8596.25);

      // - Total CTC: ₹600000 (monthly: ₹50000)
      expect(result.totalCtcAnnual).toBe(600000);
      expect(result.totalCtcMonthly).toBe(50000);

      // - Estimated Net Salary: ₹517155 (monthly: ₹43096.25)
      expect(result.estimatedNetSalaryAnnual).toBe(517155);
      expect(result.estimatedNetSalaryMonthly).toBe(43096.25);

      // CTC Reconciliation Verification: Gross + Employer Contributions === CTC
      expect(
        result.grossSalaryAnnual + result.totalEmployerContributionsAnnual,
      ).toBe(result.totalCtcAnnual);
      expect(
        result.grossSalaryMonthly + result.totalEmployerContributionsMonthly,
      ).toBe(result.totalCtcMonthly);

      // Net Salary Reconciliation Verification: Gross - Employee Deductions === Net
      expect(
        result.grossSalaryAnnual - result.totalEmployeeDeductionsAnnual,
      ).toBe(result.estimatedNetSalaryAnnual);
      expect(
        result.grossSalaryMonthly - result.totalEmployeeDeductionsMonthly,
      ).toBe(result.estimatedNetSalaryMonthly);

      // Verify intermediate calculation diagnostics
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics?.length).toBe(6);

      const basicDiag = result.diagnostics?.find((d) => d.code === 'BASIC');
      expect(basicDiag).toMatchObject({
        code: 'BASIC',
        category: SalaryComponentType.EARNING,
        calculationType: StructureComponentCalculationType.FIXED,
        calculationBase: 'FIXED',
        frequency: SalaryStructureFrequency.ANNUAL,
        resolvedPeriodAmount: 300000,
        monthlyAmount: 25000,
        annualAmount: 300000,
      });

      const hraDiag = result.diagnostics?.find((d) => d.code === 'HRA');
      expect(hraDiag).toMatchObject({
        code: 'HRA',
        category: SalaryComponentType.EARNING,
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        calculationBase: StructureComponentPercentageBasis.BASIC,
        frequency: SalaryStructureFrequency.ANNUAL,
        resolvedPeriodAmount: 150000,
        monthlyAmount: 12500,
        annualAmount: 150000,
      });

      const saDiag = result.diagnostics?.find(
        (d) => d.code === 'SPECIAL_ALLOWANCE',
      );
      expect(saDiag).toMatchObject({
        code: 'SPECIAL_ALLOWANCE',
        category: SalaryComponentType.EARNING,
        calculationType: StructureComponentCalculationType.BALANCE,
        calculationBase: 'BALANCE',
        frequency: SalaryStructureFrequency.ANNUAL,
        resolvedPeriodAmount: 103155,
        monthlyAmount: 8596.25,
        annualAmount: 103155,
      });

      const empPfDiag = result.diagnostics?.find((d) => d.code === 'EMP_PF');
      expect(empPfDiag).toMatchObject({
        code: 'EMP_PF',
        category: SalaryComponentType.EMPLOYEE_DEDUCTION,
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        calculationBase: StructureComponentPercentageBasis.BASIC,
        frequency: SalaryStructureFrequency.ANNUAL,
        resolvedPeriodAmount: 36000,
        monthlyAmount: 3000,
        annualAmount: 36000,
      });

      const emprPfDiag = result.diagnostics?.find((d) => d.code === 'EMPR_PF');
      expect(emprPfDiag).toMatchObject({
        code: 'EMPR_PF',
        category: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        calculationBase: StructureComponentPercentageBasis.BASIC,
        frequency: SalaryStructureFrequency.ANNUAL,
        resolvedPeriodAmount: 36000,
        monthlyAmount: 3000,
        annualAmount: 36000,
      });

      const gratuityDiag = result.diagnostics?.find(
        (d) => d.code === 'GRATUITY',
      );
      expect(gratuityDiag).toMatchObject({
        code: 'GRATUITY',
        category: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        calculationType: StructureComponentCalculationType.FIXED,
        calculationBase: 'FIXED',
        frequency: SalaryStructureFrequency.ANNUAL,
        resolvedPeriodAmount: 10845,
        monthlyAmount: 903.75,
        annualAmount: 10845,
      });
    });

    it('TC-CALC-CHECK-A: Monthly (₹50,000) and Annual (₹600,000) equivalence produces identical monthly salary breakups', () => {
      // Structure 1: Monthly CTC ₹50,000
      const monthlyResult = service.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        masterMap: mockMasterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000, // Monthly Basic
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
            amount: 903.75, // Monthly Gratuity (10,845 / 12)
          },
        ],
      });

      // Structure 2: Annual CTC ₹600,000 (with equivalent amounts * 12)
      const annualResult = service.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        masterMap: mockMasterMap,
        components: [
          {
            componentId: basicId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 300000, // Annual Basic (25,000 * 12)
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
            amount: 10845, // Annual Gratuity (903.75 * 12)
          },
        ],
      });

      // Assert complete Monthly Equivalence between both structures:
      // 1. Gross Salary Monthly
      expect(monthlyResult.grossSalaryMonthly).toBe(46096.25);
      expect(annualResult.grossSalaryMonthly).toBe(46096.25);
      expect(monthlyResult.grossSalaryMonthly).toBe(
        annualResult.grossSalaryMonthly,
      );

      // 2. Total CTC Monthly
      expect(monthlyResult.totalCtcMonthly).toBe(50000);
      expect(annualResult.totalCtcMonthly).toBe(50000);
      expect(monthlyResult.totalCtcMonthly).toBe(annualResult.totalCtcMonthly);

      // 3. Employer Contributions Monthly
      expect(monthlyResult.totalEmployerContributionsMonthly).toBe(3903.75);
      expect(annualResult.totalEmployerContributionsMonthly).toBe(3903.75);
      expect(monthlyResult.totalEmployerContributionsMonthly).toBe(
        annualResult.totalEmployerContributionsMonthly,
      );

      // 4. Employee Deductions Monthly
      expect(monthlyResult.totalEmployeeDeductionsMonthly).toBe(3000);
      expect(annualResult.totalEmployeeDeductionsMonthly).toBe(3000);
      expect(monthlyResult.totalEmployeeDeductionsMonthly).toBe(
        annualResult.totalEmployeeDeductionsMonthly,
      );

      // 5. Estimated Net Salary Monthly
      expect(monthlyResult.estimatedNetSalaryMonthly).toBe(43096.25);
      expect(annualResult.estimatedNetSalaryMonthly).toBe(43096.25);
      expect(monthlyResult.estimatedNetSalaryMonthly).toBe(
        annualResult.estimatedNetSalaryMonthly,
      );

      // 6. Each individual component's monthly amount must be strictly identical
      const getMonthlyMap = (res: typeof monthlyResult) => {
        const map = new Map<string, number>();
        for (const item of [
          ...res.earnings,
          ...res.employeeDeductions,
          ...res.employerContributions,
        ]) {
          map.set(item.code, item.monthlyAmount);
        }
        return map;
      };

      const m1 = getMonthlyMap(monthlyResult);
      const m2 = getMonthlyMap(annualResult);

      expect(m1.get('BASIC')).toBe(m2.get('BASIC')); // 25,000
      expect(m1.get('HRA')).toBe(m2.get('HRA')); // 12,500
      expect(m1.get('SPECIAL_ALLOWANCE')).toBe(m2.get('SPECIAL_ALLOWANCE')); // 8,596.25
      expect(m1.get('EMP_PF')).toBe(m2.get('EMP_PF')); // 3,000
      expect(m1.get('EMPR_PF')).toBe(m2.get('EMPR_PF')); // 3,000
      expect(m1.get('GRATUITY')).toBe(m2.get('GRATUITY')); // 903.75
    });

    it('TC-CALC-CHECK-B: Verifies Rounding consistency rule: monthlyAmount = roundBankers(annualAmount / 12, 2) and annual is preserved', () => {
      const annualResult = service.calculate({
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        masterMap: mockMasterMap,
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

      // Verify that for all line items:
      // 1. annualAmount is the original exact calculated amount
      // 2. monthlyAmount = roundBankers(annualAmount / 12, 2)
      // 3. annualAmount was NOT re-calculated from already-rounded monthly values
      for (const line of [
        ...annualResult.earnings,
        ...annualResult.employeeDeductions,
        ...annualResult.employerContributions,
      ]) {
        expect(line.monthlyAmount).toBe(
          Math.round((line.annualAmount / 12) * 100) / 100,
        );
      }

      // Check specific values
      const gratuity = annualResult.employerContributions.find(
        (c) => c.code === 'GRATUITY',
      );
      expect(gratuity?.annualAmount).toBe(10845); // Original annual amount preserved
      expect(gratuity?.monthlyAmount).toBe(903.75); // 10,845 / 12 = 903.75

      const specialAllowance = annualResult.earnings.find(
        (e) => e.code === 'SPECIAL_ALLOWANCE',
      );
      expect(specialAllowance?.annualAmount).toBe(103155); // Original annual amount preserved
      expect(specialAllowance?.monthlyAmount).toBe(8596.25); // 103,155 / 12 = 8,596.25

      // Reconciliation exactness: Annual Gross + Annual Employer Cost === Annual CTC
      expect(
        annualResult.grossSalaryAnnual +
          annualResult.totalEmployerContributionsAnnual,
      ).toBe(annualResult.totalCtcAnnual);
    });

    it('TC-CALC-PROD-LOG: Calculation diagnostics suppress debug logging when NODE_ENV is production and emit in non-production without PII', () => {
      const originalEnv = process.env.NODE_ENV;
      const debugSpy = jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation();

      const testPayload = {
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        masterMap: mockMasterMap,
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
        ],
      };

      try {
        // 1. In production: logging must be completely suppressed
        process.env.NODE_ENV = 'production';
        debugSpy.mockClear();

        service.calculate(testPayload);

        expect(debugSpy).not.toHaveBeenCalled();

        // 2. In non-production (e.g. development): debug logging is active and contains NO employee PII
        process.env.NODE_ENV = 'development';
        debugSpy.mockClear();

        service.calculate(testPayload);

        expect(debugSpy).toHaveBeenCalled();
        for (const call of debugSpy.mock.calls) {
          const logMsg = String(call[0]);
          // Must not log employee identity or personal info
          expect(logMsg).not.toMatch(
            /employeeId|userId|aadhaar|pan|email|phone/i,
          );
        }
      } finally {
        process.env.NODE_ENV = originalEnv;
        debugSpy.mockRestore();
      }
    });
  });
});
