import { SalaryStructureLean } from '../schemas/salary-structure.schema';
import {
  CalculationMasterMap,
  SalaryBreakupLineItem,
  SalaryStructureBreakupResult,
} from '../services/salary-structure-calculation.service';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import {
  SalaryStructureCreateResponseDto,
  SalaryStructureDetailResponseDto,
  SalaryStructureEnrichedComponentDto,
  SalaryStructureFinancialGroupSummaryDto,
  SalaryStructureGroupedPeriodSummaryDto,
  SalaryStructureListItemResponseDto,
} from '../dto/salary-structure-response.dto';

// Re-export strongly typed response DTO interfaces for backwards compatibility
export type SalaryStructureCreateResponse = SalaryStructureCreateResponseDto;
export type SalaryStructureDetailResponse = SalaryStructureDetailResponseDto;
export type SalaryStructureResponse = SalaryStructureDetailResponseDto;
export type SalaryStructureListItemResponse =
  SalaryStructureListItemResponseDto;

export interface SalaryStructureAuditChange<T> {
  from: T;
  to: T;
}

export interface SalaryStructureUpdateAuditDetails {
  [key: string]: unknown;
  changes: {
    name?: SalaryStructureAuditChange<string>;
    code?: SalaryStructureAuditChange<string>;
    description?: SalaryStructureAuditChange<string | null>;
    salaryBasis?: SalaryStructureAuditChange<SalaryStructureBasis>;
    salaryFrequency?: SalaryStructureAuditChange<SalaryStructureFrequency>;
    salaryAmount?: SalaryStructureAuditChange<number>;
    componentsCount?: SalaryStructureAuditChange<number>;
    isActive?: SalaryStructureAuditChange<boolean>;
  };
}

export class SalaryStructureMapper {
  /**
   * Maps creation result to concise response containing essential fields and financial summary.
   * Does not return complete component arrays or individual component calculations.
   */
  static toCreateResponse(
    structure: SalaryStructureLean,
    breakup: SalaryStructureBreakupResult,
  ): SalaryStructureCreateResponseDto {
    return {
      id: structure._id.toString(),
      name: structure.name,
      code: structure.code,
      salaryBasis: structure.salaryBasis,
      salaryFrequency: structure.salaryFrequency,
      salaryAmount: structure.salaryAmount,
      isActive: structure.isActive,
      version: structure.__v ?? 0,
      summary: {
        monthly: {
          grossSalary: breakup.grossSalaryMonthly,
          employerContributions: breakup.totalEmployerContributionsMonthly,
          totalCtc: breakup.totalCtcMonthly,
          employeeDeductions: breakup.totalEmployeeDeductionsMonthly,
          estimatedNetSalary: breakup.estimatedNetSalaryMonthly,
        },
        annual: {
          grossSalary: breakup.grossSalaryAnnual,
          employerContributions: breakup.totalEmployerContributionsAnnual,
          totalCtc: breakup.totalCtcAnnual,
          employeeDeductions: breakup.totalEmployeeDeductionsAnnual,
          estimatedNetSalary: breakup.estimatedNetSalaryAnnual,
        },
      },
      createdAt: structure.createdAt,
    };
  }

  /**
   * Maps full salary structure details for GET by ID and updates.
   * Returns a single enriched components array (configuration + master info + calculated amounts)
   * and an authoritative grouped financial summary, omitting duplicate breakup and null fields.
   */
  static toDetailResponse(
    structure: SalaryStructureLean,
    masterMap: CalculationMasterMap = {},
    breakup?: SalaryStructureBreakupResult,
  ): SalaryStructureDetailResponseDto {
    // Index calculated breakup line items for direct O(1) lookup
    const calculatedItems = new Map<string, SalaryBreakupLineItem>();
    if (breakup) {
      for (const item of [
        ...breakup.earnings,
        ...breakup.employeeDeductions,
        ...breakup.employerContributions,
      ]) {
        calculatedItems.set(item.componentId, item);
      }
    }

    const components: SalaryStructureEnrichedComponentDto[] =
      structure.components.map((comp) => {
        const componentIdStr = comp.componentId.toString();
        const master = masterMap[componentIdStr];
        const calculated = calculatedItems.get(componentIdStr);

        const enriched: SalaryStructureEnrichedComponentDto = {
          componentId: componentIdStr,
          name: master ? master.name : (calculated?.name ?? 'Unknown'),
          code: master ? master.code : (calculated?.code ?? 'UNKNOWN'),
          type: master
            ? master.type
            : (calculated?.type ?? SalaryComponentType.EARNING),
          calculationType: comp.calculationType,
          monthlyAmount: calculated?.monthlyAmount ?? 0,
          annualAmount: calculated?.annualAmount ?? 0,
        };

        // Conditional omission: FIXED returns amount only; PERCENTAGE returns percentage & percentageOf; BALANCE returns none
        if (comp.calculationType === StructureComponentCalculationType.FIXED) {
          if (comp.amount !== null && comp.amount !== undefined) {
            enriched.amount = comp.amount;
          }
        } else if (
          comp.calculationType === StructureComponentCalculationType.PERCENTAGE
        ) {
          if (comp.percentage !== null && comp.percentage !== undefined) {
            enriched.percentage = comp.percentage;
          }
          if (comp.percentageOf !== null && comp.percentageOf !== undefined) {
            enriched.percentageOf = comp.percentageOf;
          }
        }

        return enriched;
      });

    // Authoritative single-location financial summary
    let summary: SalaryStructureFinancialGroupSummaryDto;
    if (breakup) {
      summary = {
        monthly: {
          grossSalary: breakup.grossSalaryMonthly,
          totalEmployeeDeductions: breakup.totalEmployeeDeductionsMonthly,
          totalEmployerContributions: breakup.totalEmployerContributionsMonthly,
          totalCtc: breakup.totalCtcMonthly,
          estimatedNetSalary: breakup.estimatedNetSalaryMonthly,
        },
        annual: {
          grossSalary: breakup.grossSalaryAnnual,
          totalEmployeeDeductions: breakup.totalEmployeeDeductionsAnnual,
          totalEmployerContributions: breakup.totalEmployerContributionsAnnual,
          totalCtc: breakup.totalCtcAnnual,
          estimatedNetSalary: breakup.estimatedNetSalaryAnnual,
        },
      };
    } else {
      const emptyGroup: SalaryStructureGroupedPeriodSummaryDto = {
        grossSalary: 0,
        totalEmployeeDeductions: 0,
        totalEmployerContributions: 0,
        totalCtc: 0,
        estimatedNetSalary: 0,
      };
      summary = {
        monthly: { ...emptyGroup },
        annual: { ...emptyGroup },
      };
    }

    return {
      id: structure._id.toString(),
      name: structure.name,
      code: structure.code,
      description: structure.description ?? null,
      salaryBasis: structure.salaryBasis,
      salaryFrequency: structure.salaryFrequency,
      salaryAmount: structure.salaryAmount,
      components,
      summary,
      isActive: structure.isActive,
      version: structure.__v ?? 0,
      createdAt: structure.createdAt,
      updatedAt: structure.updatedAt,
    };
  }

  /**
   * Maps lightweight structure representation for GET /salary-structures list view.
   * Omits complete component arrays to maintain optimal pagination performance.
   * Includes grossSalary and totalCtc in frequency units for direct cross-structure comparison.
   */
  static toListItemResponse(
    structure: SalaryStructureLean,
    grossSalary?: number,
    totalCtc?: number,
  ): SalaryStructureListItemResponseDto {
    return {
      id: structure._id.toString(),
      name: structure.name,
      code: structure.code,
      description: structure.description ?? null,
      salaryBasis: structure.salaryBasis,
      salaryFrequency: structure.salaryFrequency,
      salaryAmount: structure.salaryAmount,
      grossSalary: grossSalary ?? structure.salaryAmount,
      totalCtc: totalCtc ?? structure.salaryAmount,
      componentsCount: structure.components.length,
      isActive: structure.isActive,
      version: structure.__v ?? 0,
      createdAt: structure.createdAt,
      updatedAt: structure.updatedAt,
    };
  }

  /**
   * Backwards-compatible alias for toDetailResponse.
   */
  static toResponse(
    structure: SalaryStructureLean,
    breakup?: SalaryStructureBreakupResult,
    masterMap?: CalculationMasterMap,
  ): SalaryStructureDetailResponseDto {
    return this.toDetailResponse(structure, masterMap ?? {}, breakup);
  }

  /**
   * Constructs audit log details when salary structure fields change.
   */
  static toUpdateAuditDetails(
    before: SalaryStructureLean,
    after: SalaryStructureLean,
  ): SalaryStructureUpdateAuditDetails {
    const changes: SalaryStructureUpdateAuditDetails['changes'] = {};

    if (before.name !== after.name) {
      changes.name = { from: before.name, to: after.name };
    }
    if (before.code !== after.code) {
      changes.code = { from: before.code, to: after.code };
    }
    if (before.description !== after.description) {
      changes.description = {
        from: before.description ?? null,
        to: after.description ?? null,
      };
    }
    if (before.salaryBasis !== after.salaryBasis) {
      changes.salaryBasis = {
        from: before.salaryBasis,
        to: after.salaryBasis,
      };
    }
    if (before.salaryFrequency !== after.salaryFrequency) {
      changes.salaryFrequency = {
        from: before.salaryFrequency,
        to: after.salaryFrequency,
      };
    }
    if (before.salaryAmount !== after.salaryAmount) {
      changes.salaryAmount = {
        from: before.salaryAmount,
        to: after.salaryAmount,
      };
    }
    if (before.components.length !== after.components.length) {
      changes.componentsCount = {
        from: before.components.length,
        to: after.components.length,
      };
    }
    if (before.isActive !== after.isActive) {
      changes.isActive = { from: before.isActive, to: after.isActive };
    }

    return { changes };
  }
}
