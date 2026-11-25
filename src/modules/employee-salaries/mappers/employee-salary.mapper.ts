import { EmployeeSalaryLean } from '../schemas/employee-salary.schema';
import {
  EmployeeSalaryListItemDto,
  EmployeeSalaryResponseDto,
} from '../dto/employee-salary-response.dto';

function formatDateOnly(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  return null;
}

export class EmployeeSalaryMapper {
  static toResponseDto(doc: EmployeeSalaryLean): EmployeeSalaryResponseDto {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      salaryStructureId: doc.salaryStructureId.toString(),
      effectiveFrom: formatDateOnly(doc.effectiveFrom) ?? '',
      effectiveTo: formatDateOnly(doc.effectiveTo),
      salaryBasis: doc.salaryBasis,
      salaryFrequency: doc.salaryFrequency,
      salaryAmount: doc.salaryAmount,
      salaryStructureVersion: doc.salaryStructureVersion,
      status: doc.status,
      salarySnapshot: {
        salaryBasis: doc.salarySnapshot.salaryBasis,
        salaryFrequency: doc.salarySnapshot.salaryFrequency,
        inputSalaryAmount: doc.salarySnapshot.inputSalaryAmount,
        grossSalaryMonthly: doc.salarySnapshot.grossSalaryMonthly,
        grossSalaryAnnual: doc.salarySnapshot.grossSalaryAnnual,
        totalEmployerContributionsMonthly:
          doc.salarySnapshot.totalEmployerContributionsMonthly,
        totalEmployerContributionsAnnual:
          doc.salarySnapshot.totalEmployerContributionsAnnual,
        totalCtcMonthly: doc.salarySnapshot.totalCtcMonthly,
        totalCtcAnnual: doc.salarySnapshot.totalCtcAnnual,
        totalEmployeeDeductionsMonthly:
          doc.salarySnapshot.totalEmployeeDeductionsMonthly,
        totalEmployeeDeductionsAnnual:
          doc.salarySnapshot.totalEmployeeDeductionsAnnual,
        estimatedNetSalaryMonthly: doc.salarySnapshot.estimatedNetSalaryMonthly,
        estimatedNetSalaryAnnual: doc.salarySnapshot.estimatedNetSalaryAnnual,
        summary: doc.salarySnapshot.summary,
        earnings: doc.salarySnapshot.earnings,
        employeeDeductions: doc.salarySnapshot.employeeDeductions,
        employerContributions: doc.salarySnapshot.employerContributions,
      },
      createdBy: doc.createdBy.toString(),
      updatedBy: doc.updatedBy.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  static toListItemDto(doc: EmployeeSalaryLean): EmployeeSalaryListItemDto {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      salaryStructureId: doc.salaryStructureId.toString(),
      effectiveFrom: formatDateOnly(doc.effectiveFrom) ?? '',
      effectiveTo: formatDateOnly(doc.effectiveTo),
      salaryBasis: doc.salaryBasis,
      salaryFrequency: doc.salaryFrequency,
      salaryAmount: doc.salaryAmount,
      status: doc.status,
      grossSalaryMonthly: doc.salarySnapshot.grossSalaryMonthly,
      totalCtcMonthly: doc.salarySnapshot.totalCtcMonthly,
      estimatedNetSalaryMonthly: doc.salarySnapshot.estimatedNetSalaryMonthly,
      createdAt: doc.createdAt,
    };
  }
}
