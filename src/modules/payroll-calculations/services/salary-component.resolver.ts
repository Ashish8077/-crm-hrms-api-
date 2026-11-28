import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SalaryComponent,
  SalaryComponentDocument,
  SalaryComponentLean,
} from '../../salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import {
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../../salary-structures/constants/salary-structure.constant';
import { SalaryStructureLean } from '../../salary-structures/schemas/salary-structure.schema';
import { CalculationMasterMap } from '../../salary-structures/services/salary-structure-calculation.service';
import { Decimal, toDecimal } from '../../../common/utils/financial-math.util';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

export interface ResolvedSalaryComponent {
  componentId: string;
  code: string;
  name: string;
  classification: SalaryComponentType;
  calculationMethod: StructureComponentCalculationType;
  monthlyFixedAmount: Decimal | null;
  percentage: number | null;
  percentageOf: string | null;
}

export interface ResolvedStructureComponents {
  components: ResolvedSalaryComponent[];
  masterMap: CalculationMasterMap;
}

@Injectable()
export class SalaryComponentResolver {
  constructor(
    @InjectModel(SalaryComponent.name)
    private readonly salaryComponentModel: Model<SalaryComponentDocument>,
  ) {}

  async resolveForStructure(
    structure: SalaryStructureLean,
  ): Promise<ResolvedStructureComponents> {
    const seenIds = new Set<string>();
    const componentObjectIds: Types.ObjectId[] = [];

    for (const item of structure.components) {
      const idStr = item.componentId.toString();
      if (seenIds.has(idStr)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Duplicate componentId '${idStr}' in salary structure '${structure.code}'.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      seenIds.add(idStr);
      componentObjectIds.push(new Types.ObjectId(idStr));
    }

    // Batch-fetch all master component definitions in a single query
    const masterDocs = await this.salaryComponentModel
      .find({ _id: { $in: componentObjectIds } })
      .lean<SalaryComponentLean[]>()
      .exec();

    const masterMap = new Map<string, SalaryComponentLean>();
    for (const doc of masterDocs) {
      masterMap.set(doc._id.toString(), doc);
    }

    return this.resolveWithMasterMap(structure, masterMap);
  }

  /**
   * Batch-fetches unique master salary components across multiple salary structures in 1 query.
   */
  async fetchMasterMapForStructures(
    structures: SalaryStructureLean[],
  ): Promise<Map<string, SalaryComponentLean>> {
    const idMap = new Map<string, Types.ObjectId>();
    for (const structure of structures) {
      for (const item of structure.components) {
        const idStr = item.componentId.toString();
        if (!idMap.has(idStr)) {
          idMap.set(idStr, new Types.ObjectId(idStr));
        }
      }
    }
    const masterMap = new Map<string, SalaryComponentLean>();
    if (idMap.size === 0) return masterMap;

    const docs = await this.salaryComponentModel
      .find({ _id: { $in: Array.from(idMap.values()) } })
      .lean<SalaryComponentLean[]>()
      .exec();

    for (const doc of docs) {
      masterMap.set(doc._id.toString(), doc);
    }
    return masterMap;
  }

  resolveWithMasterMap(
    structure: SalaryStructureLean,
    masterMap: Map<string, SalaryComponentLean>,
  ): ResolvedStructureComponents {
    const seenIds = new Set<string>();
    for (const item of structure.components) {
      const idStr = item.componentId.toString();
      if (seenIds.has(idStr)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Duplicate componentId '${idStr}' in salary structure '${structure.code}'.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      seenIds.add(idStr);
    }

    const isAnnualStructure =
      structure.salaryFrequency === SalaryStructureFrequency.ANNUAL;
    const resolved: ResolvedSalaryComponent[] = [];
    const seenCodes = new Set<string>();
    let balanceCount = 0;

    for (const item of structure.components) {
      const idStr = item.componentId.toString();
      const master = masterMap.get(idStr);

      if (!master) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Referenced SalaryComponent '${idStr}' in salary structure '${structure.code}' not found.`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (!master.isActive) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Inactive salary component '${master.name}' (${master.code}) cannot be used in payroll calculation.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const code = master.code.trim().toUpperCase();
      if (seenCodes.has(code)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Duplicate component code '${code}' in salary structure '${structure.code}'.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      seenCodes.add(code);

      if (!Object.values(SalaryComponentType).includes(master.type)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid component classification '${String(master.type)}' for component '${code}'.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Normalize deprecated DEDUCTION to EMPLOYEE_DEDUCTION
      const classification =
        master.type === SalaryComponentType.DEDUCTION
          ? SalaryComponentType.EMPLOYEE_DEDUCTION
          : master.type;

      if (
        item.calculationType !== StructureComponentCalculationType.FIXED &&
        item.calculationType !== StructureComponentCalculationType.PERCENTAGE &&
        item.calculationType !== StructureComponentCalculationType.BALANCE
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unsupported calculationType '${String(item.calculationType)}' for component '${code}'.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (item.calculationType === StructureComponentCalculationType.BALANCE) {
        balanceCount += 1;
        if (balanceCount > 1) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `At most one BALANCE component is allowed per salary structure '${structure.code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        if (classification !== SalaryComponentType.EARNING) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `BALANCE calculationType is supported only for EARNING components (found '${classification}' for component '${code}').`,
            HttpStatus.BAD_REQUEST,
          );
        }

        resolved.push({
          componentId: idStr,
          code,
          name: master.name,
          classification,
          calculationMethod: StructureComponentCalculationType.BALANCE,
          monthlyFixedAmount: null,
          percentage: null,
          percentageOf: null,
        });
      } else if (
        item.calculationType === StructureComponentCalculationType.FIXED
      ) {
        const rawAmount = item.amount;
        if (
          rawAmount === null ||
          rawAmount === undefined ||
          !Number.isFinite(rawAmount) ||
          rawAmount < 0
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Valid non-negative amount is required for FIXED component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        const rawDec = toDecimal(rawAmount);
        const monthlyFixedAmount = isAnnualStructure
          ? rawDec.dividedBy(12)
          : rawDec;

        resolved.push({
          componentId: idStr,
          code,
          name: master.name,
          classification,
          calculationMethod: StructureComponentCalculationType.FIXED,
          monthlyFixedAmount,
          percentage: null,
          percentageOf: null,
        });
      } else {
        const rawPct = item.percentage;
        if (
          rawPct === null ||
          rawPct === undefined ||
          !Number.isFinite(rawPct) ||
          rawPct < 0 ||
          rawPct > 100
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Valid percentage (0-100) is required for PERCENTAGE component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        const baseCode = (item.percentageOf ?? '').trim().toUpperCase();
        if (!baseCode) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `percentageOf base is required for PERCENTAGE component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        resolved.push({
          componentId: idStr,
          code,
          name: master.name,
          classification,
          calculationMethod: StructureComponentCalculationType.PERCENTAGE,
          monthlyFixedAmount: null,
          percentage: rawPct,
          percentageOf: baseCode,
        });
      }
    }

    const calculationMasterMap: CalculationMasterMap = {};
    for (const item of structure.components) {
      const idStr = item.componentId.toString();
      const master = masterMap.get(idStr);
      if (master) {
        calculationMasterMap[idStr] = master;
      }
    }

    return {
      components: resolved,
      masterMap: calculationMasterMap,
    };
  }
}
