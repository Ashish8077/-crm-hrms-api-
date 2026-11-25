import { Types } from 'mongoose';
import {
  SalaryStructureMapper,
  SalaryStructureCreateResponse,
  SalaryStructureDetailResponse,
  SalaryStructureListItemResponse,
} from './salary-structure.mapper';
import { SalaryStructureLean } from '../schemas/salary-structure.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../constants/salary-structure.constant';
import {
  CalculationMasterMap,
  SalaryBreakupLineItem,
  SalaryStructureBreakupResult,
} from '../services/salary-structure-calculation.service';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';

describe('SalaryStructureMapper', () => {
  const structureId = new Types.ObjectId();
  const basicId = new Types.ObjectId();
  const hraId = new Types.ObjectId();
  const specialAllowanceId = new Types.ObjectId();
  const actorId = new Types.ObjectId();

  const mockMasterMap: CalculationMasterMap = {
    [basicId.toString()]: {
      _id: basicId,
      name: 'Basic Salary',
      code: 'BASIC',
      type: SalaryComponentType.EARNING,
      calculationType: null,
      percentageOf: null,
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
      calculationType: null,
      percentageOf: null,
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
      calculationType: null,
      percentageOf: null,
      isTaxable: true,
      isStatutory: false,
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  };

  const mockLeanStructure: SalaryStructureLean = {
    _id: structureId,
    name: 'Engineering CTC L2',
    code: 'ENG_L2_CTC',
    description: 'Senior engineer compensation template',
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 50000,
    components: [
      {
        componentId: basicId,
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 25000,
        percentage: null,
        percentageOf: null,
      },
      {
        componentId: hraId,
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        amount: null,
        percentage: 50,
        percentageOf: StructureComponentPercentageBasis.BASIC,
      },
      {
        componentId: specialAllowanceId,
        calculationType: StructureComponentCalculationType.BALANCE,
        amount: null,
        percentage: null,
        percentageOf: null,
      },
    ],
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    __v: 1,
  };

  const mockEarnings: SalaryBreakupLineItem[] = [
    {
      componentId: basicId.toString(),
      name: 'Basic Salary',
      code: 'BASIC',
      type: SalaryComponentType.EARNING,
      calculationType: StructureComponentCalculationType.FIXED,
      monthlyAmount: 25000,
      annualAmount: 300000,
    },
    {
      componentId: hraId.toString(),
      name: 'House Rent Allowance',
      code: 'HRA',
      type: SalaryComponentType.EARNING,
      calculationType: StructureComponentCalculationType.PERCENTAGE,
      monthlyAmount: 12500,
      annualAmount: 150000,
    },
    {
      componentId: specialAllowanceId.toString(),
      name: 'Special Allowance',
      code: 'SPECIAL_ALLOWANCE',
      type: SalaryComponentType.EARNING,
      calculationType: StructureComponentCalculationType.BALANCE,
      monthlyAmount: 12500,
      annualAmount: 150000,
    },
  ];

  const mockBreakup: SalaryStructureBreakupResult = {
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    inputSalaryAmount: 50000,
    grossSalaryMonthly: 50000,
    grossSalaryAnnual: 600000,
    totalEmployerContributionsMonthly: 0,
    totalEmployerContributionsAnnual: 0,
    totalCtcMonthly: 50000,
    totalCtcAnnual: 600000,
    totalEmployeeDeductionsMonthly: 0,
    totalEmployeeDeductionsAnnual: 0,
    estimatedNetSalaryMonthly: 50000,
    estimatedNetSalaryAnnual: 600000,
    earnings: mockEarnings,
    employeeDeductions: [],
    employerContributions: [],
  };

  describe('toCreateResponse', () => {
    it('TC-MAP-01: Maps essential fields with explicit monthly and annual summaries without duplicate root summary fields', () => {
      const response: SalaryStructureCreateResponse =
        SalaryStructureMapper.toCreateResponse(mockLeanStructure, mockBreakup);

      expect(response).toEqual({
        id: structureId.toString(),
        name: 'Engineering CTC L2',
        code: 'ENG_L2_CTC',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        isActive: true,
        version: 1,
        summary: {
          monthly: {
            grossSalary: 50000,
            employerContributions: 0,
            totalCtc: 50000,
            employeeDeductions: 0,
            estimatedNetSalary: 50000,
          },
          annual: {
            grossSalary: 600000,
            employerContributions: 0,
            totalCtc: 600000,
            employeeDeductions: 0,
            estimatedNetSalary: 600000,
          },
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      // Verify omitted fields from create response
      const raw = response as unknown as Record<string, unknown>;
      expect(raw.components).toBeUndefined();
      expect(raw.breakup).toBeUndefined();
      expect(raw.updatedAt).toBeUndefined();
      expect(raw.description).toBeUndefined();

      // Verify selected-frequency values are NOT repeated at the summary root
      const summaryRaw = response.summary as unknown as Record<string, unknown>;
      expect(summaryRaw.grossSalary).toBeUndefined();
      expect(summaryRaw.totalCtc).toBeUndefined();
      expect(summaryRaw.employerContributions).toBeUndefined();
      expect(summaryRaw.employeeDeductions).toBeUndefined();
      expect(summaryRaw.estimatedNetSalary).toBeUndefined();
    });

    it('TC-MAP-02: Maps essential fields with ANNUAL frequency without root summary fields', () => {
      const annualStructure: SalaryStructureLean = {
        ...mockLeanStructure,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
      };

      const response: SalaryStructureCreateResponse =
        SalaryStructureMapper.toCreateResponse(annualStructure, mockBreakup);

      expect(response.salaryFrequency).toBe(SalaryStructureFrequency.ANNUAL);
      expect(response.summary.annual.grossSalary).toBe(600000);
      expect(response.summary.annual.totalCtc).toBe(600000);
      expect(response.summary.monthly.grossSalary).toBe(50000);
      expect(response.summary.monthly.totalCtc).toBe(50000);

      const summaryRaw = response.summary as unknown as Record<string, unknown>;
      expect(summaryRaw.grossSalary).toBeUndefined();
      expect(summaryRaw.totalCtc).toBeUndefined();

      const raw = response as unknown as Record<string, unknown>;
      expect(raw.components).toBeUndefined();
      expect(raw.breakup).toBeUndefined();
    });
  });

  describe('toDetailResponse', () => {
    it('TC-MAP-03: Maps complete salary structure with single enriched components array and authoritative summary', () => {
      const response: SalaryStructureDetailResponse =
        SalaryStructureMapper.toDetailResponse(
          mockLeanStructure,
          mockMasterMap,
          mockBreakup,
        );

      expect(response.id).toBe(structureId.toString());
      expect(response.name).toBe('Engineering CTC L2');
      expect(response.code).toBe('ENG_L2_CTC');
      expect(response.description).toBe(
        'Senior engineer compensation template',
      );
      expect(response.salaryBasis).toBe(SalaryStructureBasis.CTC);
      expect(response.salaryFrequency).toBe(SalaryStructureFrequency.MONTHLY);
      expect(response.salaryAmount).toBe(50000);
      expect(response.isActive).toBe(true);
      expect(response.version).toBe(1);

      // Verify single enriched components array
      expect(response.components).toHaveLength(3);

      // 1. Basic (FIXED) -> amount included, percentage/percentageOf omitted
      const basicComp = response.components[0];
      expect(basicComp.componentId).toBe(basicId.toString());
      expect(basicComp.name).toBe('Basic Salary');
      expect(basicComp.code).toBe('BASIC');
      expect(basicComp.type).toBe(SalaryComponentType.EARNING);
      expect(basicComp.calculationType).toBe(
        StructureComponentCalculationType.FIXED,
      );
      expect(basicComp.amount).toBe(25000);
      expect(basicComp.percentage).toBeUndefined();
      expect(basicComp.percentageOf).toBeUndefined();
      expect(basicComp.monthlyAmount).toBe(25000);
      expect(basicComp.annualAmount).toBe(300000);

      // 2. HRA (PERCENTAGE) -> percentage & percentageOf included, amount omitted
      const hraComp = response.components[1];
      expect(hraComp.componentId).toBe(hraId.toString());
      expect(hraComp.name).toBe('House Rent Allowance');
      expect(hraComp.code).toBe('HRA');
      expect(hraComp.type).toBe(SalaryComponentType.EARNING);
      expect(hraComp.calculationType).toBe(
        StructureComponentCalculationType.PERCENTAGE,
      );
      expect(hraComp.percentage).toBe(50);
      expect(hraComp.percentageOf).toBe(
        StructureComponentPercentageBasis.BASIC,
      );
      expect(hraComp.amount).toBeUndefined();
      expect(hraComp.monthlyAmount).toBe(12500);
      expect(hraComp.annualAmount).toBe(150000);

      // 3. Special Allowance (BALANCE) -> amount, percentage, percentageOf all omitted
      const saComp = response.components[2];
      expect(saComp.componentId).toBe(specialAllowanceId.toString());
      expect(saComp.name).toBe('Special Allowance');
      expect(saComp.code).toBe('SPECIAL_ALLOWANCE');
      expect(saComp.type).toBe(SalaryComponentType.EARNING);
      expect(saComp.calculationType).toBe(
        StructureComponentCalculationType.BALANCE,
      );
      expect(saComp.amount).toBeUndefined();
      expect(saComp.percentage).toBeUndefined();
      expect(saComp.percentageOf).toBeUndefined();
      expect(saComp.monthlyAmount).toBe(12500);
      expect(saComp.annualAmount).toBe(150000);

      // Verify authoritative grouped financial summary (without redundant totalEarnings)
      expect(response.summary).toBeDefined();
      expect(response.summary.monthly).toEqual({
        grossSalary: 50000,
        totalEmployeeDeductions: 0,
        totalEmployerContributions: 0,
        totalCtc: 50000,
        estimatedNetSalary: 50000,
      });
      expect(response.summary.annual).toEqual({
        grossSalary: 600000,
        totalEmployeeDeductions: 0,
        totalEmployerContributions: 0,
        totalCtc: 600000,
        estimatedNetSalary: 600000,
      });

      // Verify absence of duplicate breakup property
      const raw = response as unknown as Record<string, unknown>;
      expect(raw.breakup).toBeUndefined();
    });
  });

  describe('toListItemResponse', () => {
    it('TC-MAP-04: Maps lightweight summary for list API with grossSalary and totalCtc, omitting complete component breakdowns', () => {
      const response: SalaryStructureListItemResponse =
        SalaryStructureMapper.toListItemResponse(mockLeanStructure);

      expect(response).toEqual({
        id: structureId.toString(),
        name: 'Engineering CTC L2',
        code: 'ENG_L2_CTC',
        description: 'Senior engineer compensation template',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        grossSalary: 50000,
        totalCtc: 50000,
        componentsCount: 3,
        isActive: true,
        version: 1,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      const raw = response as unknown as Record<string, unknown>;
      expect(raw.components).toBeUndefined();
      expect(raw.breakup).toBeUndefined();
      expect(raw.summary).toBeUndefined();
    });

    it('TC-MAP-04B: Maps passed-in grossSalary and totalCtc values for list items', () => {
      const response: SalaryStructureListItemResponse =
        SalaryStructureMapper.toListItemResponse(
          mockLeanStructure,
          46096.25,
          50000,
        );

      expect(response.grossSalary).toBe(46096.25);
      expect(response.totalCtc).toBe(50000);
      expect(response.salaryAmount).toBe(50000);
    });
  });

  describe('toUpdateAuditDetails', () => {
    it('TC-MAP-05: Accurately captures modified fields between before and after states', () => {
      const updatedStructure: SalaryStructureLean = {
        ...mockLeanStructure,
        name: 'Updated Engineering CTC L2',
        salaryAmount: 700000,
      };

      const auditDetails = SalaryStructureMapper.toUpdateAuditDetails(
        mockLeanStructure,
        updatedStructure,
      );

      expect(auditDetails.changes.name).toEqual({
        from: 'Engineering CTC L2',
        to: 'Updated Engineering CTC L2',
      });
      expect(auditDetails.changes.salaryAmount).toEqual({
        from: 50000,
        to: 700000,
      });
      expect(auditDetails.changes.code).toBeUndefined();
    });
  });
});
