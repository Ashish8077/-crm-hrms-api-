import { SalaryComponentLean } from '../schemas/salary-component.schema';
import {
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
} from '../constants/salary-component.constant';

export type SalaryComponentMapperInput = SalaryComponentLean;

export interface SalaryComponentResponse {
  id: string;
  name: string;
  code: string;
  type: SalaryComponentType;
  calculationType?: SalaryComponentCalculationType | null;
  percentageOf?: SalaryComponentPercentageBasis | null;
  isTaxable: boolean;
  isStatutory: boolean;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalaryComponentAuditChange<T> {
  from: T;
  to: T;
}

export interface SalaryComponentUpdateAuditDetails {
  [key: string]: unknown;
  changes: {
    name?: SalaryComponentAuditChange<string>;
    code?: SalaryComponentAuditChange<string>;
    type?: SalaryComponentAuditChange<SalaryComponentType>;
    calculationType?: SalaryComponentAuditChange<SalaryComponentCalculationType | null>;
    percentageOf?: SalaryComponentAuditChange<SalaryComponentPercentageBasis | null>;
    isTaxable?: SalaryComponentAuditChange<boolean>;
    isStatutory?: SalaryComponentAuditChange<boolean>;
    description?: SalaryComponentAuditChange<string | null>;
    isActive?: SalaryComponentAuditChange<boolean>;
  };
}

export class SalaryComponentMapper {
  static toResponse(
    component: SalaryComponentMapperInput,
  ): SalaryComponentResponse {
    return {
      id: component._id.toString(),
      name: component.name,
      code: component.code,
      type:
        component.type === SalaryComponentType.DEDUCTION
          ? SalaryComponentType.EMPLOYEE_DEDUCTION
          : component.type,
      calculationType: component.calculationType ?? null,
      percentageOf: component.percentageOf ?? null,
      isTaxable: component.isTaxable,
      isStatutory: component.isStatutory,
      description: component.description ?? null,
      isActive: component.isActive,
      createdAt: component.createdAt,
      updatedAt: component.updatedAt,
    };
  }

  static toUpdateAuditDetails(
    before: SalaryComponentMapperInput,
    after: SalaryComponentMapperInput,
  ): SalaryComponentUpdateAuditDetails {
    const changes: SalaryComponentUpdateAuditDetails['changes'] = {};

    if (before.name !== after.name) {
      changes.name = { from: before.name, to: after.name };
    }
    if (before.code !== after.code) {
      changes.code = { from: before.code, to: after.code };
    }
    if (before.type !== after.type) {
      changes.type = { from: before.type, to: after.type };
    }
    if (before.calculationType !== after.calculationType) {
      changes.calculationType = {
        from: before.calculationType ?? null,
        to: after.calculationType ?? null,
      };
    }
    if (before.percentageOf !== after.percentageOf) {
      changes.percentageOf = {
        from: before.percentageOf ?? null,
        to: after.percentageOf ?? null,
      };
    }
    if (before.isTaxable !== after.isTaxable) {
      changes.isTaxable = { from: before.isTaxable, to: after.isTaxable };
    }
    if (before.isStatutory !== after.isStatutory) {
      changes.isStatutory = {
        from: before.isStatutory,
        to: after.isStatutory,
      };
    }
    if (before.description !== after.description) {
      changes.description = {
        from: before.description ?? null,
        to: after.description ?? null,
      };
    }
    if (before.isActive !== after.isActive) {
      changes.isActive = { from: before.isActive, to: after.isActive };
    }

    return { changes };
  }
}
