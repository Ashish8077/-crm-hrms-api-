import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  EmployeeSalaryLean,
  SalarySnapshot,
  SalarySnapshotComponentItem,
} from '../schemas/employee-salary.schema';
import {
  EmployeeSalaryRepository,
  CreateEmployeeSalaryInput,
} from '../repositories/employee-salary.repository';
import {
  EmployeeSalaryStatus,
  normalizeEffectiveDate,
  areEffectiveDateIntervalsOverlapping,
} from '../constants/employee-salary.constant';
import {
  Employee,
  EmployeeDocument,
} from '../../employees/schemas/employee.schema';
import { ActiveEmploymentStatuses } from '../../employees/constants/employee.constant';
import {
  SalaryStructure,
  SalaryStructureDocument,
  SalaryStructureLean,
} from '../../salary-structures/schemas/salary-structure.schema';
import {
  SalaryComponent,
  SalaryComponentDocument,
  SalaryComponentLean,
} from '../../salary-components/schemas/salary-component.schema';
import {
  CalculationMasterMap,
  SalaryStructureCalculationService,
} from '../../salary-structures/services/salary-structure-calculation.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { EmployeeSalaryHistoryQueryDto } from '../dto/employee-salary-history-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { AssignSalaryDto } from '../dto/assign-salary.dto';

@Injectable()
export class EmployeeSalariesService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly employeeSalaryRepository: EmployeeSalaryRepository,
    private readonly calculationService: SalaryStructureCalculationService,
    private readonly auditLogsService: AuditLogsService,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(SalaryStructure.name)
    private readonly salaryStructureModel: Model<SalaryStructureDocument>,
    @InjectModel(SalaryComponent.name)
    private readonly salaryComponentModel: Model<SalaryComponentDocument>,
  ) {}

  /**
   * Assigns a salary structure to an employee for the first time or creates a new salary revision.
   * Atomically executes in a MongoDB transaction:
   * 1. Validates employee eligibility and joining date constraint.
   * 2. Validates salary structure and active component masters.
   * 3. Calculates immutable snapshot via SalaryStructureCalculationService.
   * 4. Enforces interval overlap protection and strictly forward-dated revisions.
   * 5. Closes previous active assignment (setting effectiveTo and SUPERSEDED status).
   * 6. Records transactional audit log.
   */
  async assignSalary(
    employeeId: Types.ObjectId,
    dto: AssignSalaryDto,
    actorId: Types.ObjectId,
    metadata?: ClientMetadata,
  ): Promise<EmployeeSalaryLean> {
    // 1. Normalize effectiveFrom to midnight UTC (date-only semantics)
    let normalizedEffectiveFrom: Date;
    try {
      normalizedEffectiveFrom = normalizeEffectiveDate(dto.effectiveFrom);
    } catch {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid effectiveFrom date format: '${dto.effectiveFrom}'. Expected YYYY-MM-DD or valid ISO date.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2. Validate Employee existence, soft-delete, status eligibility, and joining date
    const employee = await this.employeeModel
      .findById(employeeId)
      .lean<Employee | null>()
      .exec();

    if (!employee || employee.deletedAt !== null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!ActiveEmploymentStatuses.includes(employee.employmentStatus)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Employee with employment status '${employee.employmentStatus}' is not eligible for salary assignment. Eligible statuses: ${ActiveEmploymentStatuses.join(', ')}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const normalizedJoiningDate = normalizeEffectiveDate(
      employee.dateOfJoining,
    );
    if (normalizedEffectiveFrom.getTime() < normalizedJoiningDate.getTime()) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Salary assignment effectiveFrom (${normalizedEffectiveFrom.toISOString().slice(0, 10)}) cannot precede the employee date of joining (${normalizedJoiningDate.toISOString().slice(0, 10)}).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Validate Salary Structure existence and active status
    const structureObjectId = new Types.ObjectId(dto.salaryStructureId);
    const structure = await this.salaryStructureModel
      .findById(structureObjectId)
      .lean<SalaryStructureLean | null>()
      .exec();

    if (!structure) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary structure not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!structure.isActive) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot assign inactive salary structure '${structure.name}' (${structure.code}).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. Validate referenced Salary Component masters
    const componentObjectIds = structure.components.map((c) => c.componentId);
    const masterDocs = await this.salaryComponentModel
      .find({ _id: { $in: componentObjectIds } })
      .lean<SalaryComponentLean[]>()
      .exec();

    const masterMap: CalculationMasterMap = {};
    for (const doc of masterDocs) {
      masterMap[doc._id.toString()] = doc;
    }

    for (const comp of structure.components) {
      const master = masterMap[comp.componentId.toString()];
      if (!master) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Referenced SalaryComponent '${comp.componentId.toString()}' in structure not found`,
          HttpStatus.NOT_FOUND,
        );
      }
      if (!master.isActive) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot assign salary structure with inactive component '${master.name}' (${master.code}).`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 5. Generate server-side authoritative salary snapshot via calculation service
    const breakup = this.calculationService.calculate({
      salaryBasis: structure.salaryBasis,
      salaryFrequency: structure.salaryFrequency,
      salaryAmount: structure.salaryAmount,
      masterMap,
      components: structure.components,
    });

    const structureCompMap = new Map(
      structure.components.map((c) => [c.componentId.toString(), c]),
    );

    const enrichItems = (
      items: typeof breakup.earnings,
    ): SalarySnapshotComponentItem[] =>
      items.map((item) => {
        const conf = structureCompMap.get(item.componentId);
        return {
          componentId: item.componentId,
          name: item.name,
          code: item.code,
          type: item.type,
          calculationType: item.calculationType,
          amount: conf?.amount ?? null,
          percentage: conf?.percentage ?? null,
          percentageOf: conf?.percentageOf ?? null,
          monthlyAmount: item.monthlyAmount,
          annualAmount: item.annualAmount,
        };
      });

    const salarySnapshot: SalarySnapshot = {
      salaryBasis: structure.salaryBasis,
      salaryFrequency: structure.salaryFrequency,
      inputSalaryAmount: structure.salaryAmount,
      grossSalaryMonthly: breakup.grossSalaryMonthly,
      grossSalaryAnnual: breakup.grossSalaryAnnual,
      totalEmployerContributionsMonthly:
        breakup.totalEmployerContributionsMonthly,
      totalEmployerContributionsAnnual:
        breakup.totalEmployerContributionsAnnual,
      totalCtcMonthly: breakup.totalCtcMonthly,
      totalCtcAnnual: breakup.totalCtcAnnual,
      totalEmployeeDeductionsMonthly: breakup.totalEmployeeDeductionsMonthly,
      totalEmployeeDeductionsAnnual: breakup.totalEmployeeDeductionsAnnual,
      estimatedNetSalaryMonthly: breakup.estimatedNetSalaryMonthly,
      estimatedNetSalaryAnnual: breakup.estimatedNetSalaryAnnual,
      summary: breakup.summary ?? {
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
      earnings: enrichItems(breakup.earnings),
      employeeDeductions: enrichItems(breakup.employeeDeductions),
      employerContributions: enrichItems(breakup.employerContributions),
    };

    // 6. Execute revision or initial assignment inside a MongoDB transaction session
    const session = await this.connection.startSession();
    try {
      let createdAssignment!: EmployeeSalaryLean;

      await session.withTransaction(async () => {
        // Query all existing assignments for the employee to enforce non-overlap & revision chronology
        const existingAssignments =
          await this.employeeSalaryRepository.findAllByEmployeeId(
            employeeId,
            session,
          );

        const activeAssignment =
          existingAssignments.find(
            (a) =>
              a.status === EmployeeSalaryStatus.ACTIVE &&
              a.effectiveTo === null,
          ) ?? null;

        const requestedInterval = {
          effectiveFrom: normalizedEffectiveFrom,
          effectiveTo: null,
        };

        if (
          activeAssignment &&
          normalizedEffectiveFrom.getTime() <=
            activeAssignment.effectiveFrom.getTime()
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Revision effectiveFrom (${normalizedEffectiveFrom.toISOString().slice(0, 10)}) must be strictly later than the active assignment's effectiveFrom (${activeAssignment.effectiveFrom.toISOString().slice(0, 10)}). Backdated revisions are not permitted.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        // Prevent overlap against all other existing intervals (closed SUPERSEDED history or future records)
        for (const existing of existingAssignments) {
          if (activeAssignment && existing._id.equals(activeAssignment._id)) {
            continue;
          }
          if (
            areEffectiveDateIntervalsOverlapping(existing, requestedInterval)
          ) {
            throw new AppError(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              `Conflicting salary assignment already exists for period [${existing.effectiveFrom.toISOString().slice(0, 10)} to ${existing.effectiveTo ? existing.effectiveTo.toISOString().slice(0, 10) : 'ongoing'}] (Assignment ID: ${existing._id.toString()}).`,
              HttpStatus.CONFLICT,
            );
          }
        }

        if (!activeAssignment) {
          // --- Initial Assignment (or Re-assignment with only historical closed assignments) ---
          const createInput: CreateEmployeeSalaryInput = {
            employeeId,
            salaryStructureId: structure._id,
            effectiveFrom: normalizedEffectiveFrom,
            effectiveTo: null,
            salaryBasis: structure.salaryBasis,
            salaryFrequency: structure.salaryFrequency,
            salaryAmount: structure.salaryAmount,
            salaryStructureVersion: structure.__v ?? 0,
            salarySnapshot,
            status: EmployeeSalaryStatus.ACTIVE,
            createdBy: actorId,
            updatedBy: actorId,
          };

          createdAssignment = await this.employeeSalaryRepository.create(
            createInput,
            session,
          );

          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.EMPLOYEE_SALARY_ASSIGNED,
              targetId: createdAssignment._id,
              targetModel: AuditTargetModel.EMPLOYEE_SALARY,
              details: {
                employeeId: employeeId.toString(),
                salaryStructureId: structure._id.toString(),
                salaryStructureName: structure.name,
                salaryStructureCode: structure.code,
                effectiveFrom: normalizedEffectiveFrom
                  .toISOString()
                  .slice(0, 10),
                salaryBasis: structure.salaryBasis,
                salaryFrequency: structure.salaryFrequency,
                salaryAmount: structure.salaryAmount,
                grossSalaryMonthly: salarySnapshot.grossSalaryMonthly,
                totalCtcMonthly: salarySnapshot.totalCtcMonthly,
                estimatedNetSalaryMonthly:
                  salarySnapshot.estimatedNetSalaryMonthly,
              },
              ipAddress: metadata?.ipAddress ?? null,
              userAgent: metadata?.userAgent ?? null,
            },
            session,
          );
        } else {
          // --- Salary Revision Flow (Active open-ended assignment exists) ---
          // Atomic close of active assignment: set effectiveTo = new effectiveFrom and status = SUPERSEDED
          const closedPrevious =
            await this.employeeSalaryRepository.closePreviousAssignment(
              activeAssignment._id,
              normalizedEffectiveFrom,
              actorId,
              session,
            );

          if (!closedPrevious) {
            throw new AppError(
              ErrorCode.CONCURRENT_MODIFICATION,
              'Concurrent revision detected. The employee salary assignment has already been modified by another request.',
              HttpStatus.CONFLICT,
            );
          }

          const createInput: CreateEmployeeSalaryInput = {
            employeeId,
            salaryStructureId: structure._id,
            effectiveFrom: normalizedEffectiveFrom,
            effectiveTo: null,
            salaryBasis: structure.salaryBasis,
            salaryFrequency: structure.salaryFrequency,
            salaryAmount: structure.salaryAmount,
            salaryStructureVersion: structure.__v ?? 0,
            salarySnapshot,
            status: EmployeeSalaryStatus.ACTIVE,
            createdBy: actorId,
            updatedBy: actorId,
          };

          createdAssignment = await this.employeeSalaryRepository.create(
            createInput,
            session,
          );

          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.EMPLOYEE_SALARY_REVISED,
              targetId: createdAssignment._id,
              targetModel: AuditTargetModel.EMPLOYEE_SALARY,
              details: {
                employeeId: employeeId.toString(),
                previousAssignmentId: activeAssignment._id.toString(),
                previousSalaryStructureId:
                  activeAssignment.salaryStructureId.toString(),
                newSalaryStructureId: structure._id.toString(),
                effectiveFrom: normalizedEffectiveFrom
                  .toISOString()
                  .slice(0, 10),
                previousSalaryAmount: activeAssignment.salaryAmount,
                newSalaryAmount: structure.salaryAmount,
                previousGrossMonthly:
                  activeAssignment.salarySnapshot.grossSalaryMonthly,
                newGrossMonthly: salarySnapshot.grossSalaryMonthly,
                previousTotalCtcMonthly:
                  activeAssignment.salarySnapshot.totalCtcMonthly,
                newTotalCtcMonthly: salarySnapshot.totalCtcMonthly,
              },
              ipAddress: metadata?.ipAddress ?? null,
              userAgent: metadata?.userAgent ?? null,
            },
            session,
          );
        }
      });

      return createdAssignment;
    } catch (err: unknown) {
      if (this.employeeSalaryRepository.isDuplicateKeyError(err)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'A concurrent active salary assignment already exists for this employee.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Retrieves the currently effective salary assignment for an employee as of a specific date.
   * If asOfDate is not specified, defaults to current UTC date.
   */
  async getCurrentSalary(
    employeeId: Types.ObjectId,
    asOfDate?: string | Date,
  ): Promise<EmployeeSalaryLean | null> {
    const employee = await this.employeeModel
      .findById(employeeId)
      .lean<Employee | null>()
      .exec();

    if (!employee || employee.deletedAt !== null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    let targetDate: Date;
    if (asOfDate) {
      try {
        targetDate = normalizeEffectiveDate(asOfDate);
      } catch {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid asOfDate format: '${asOfDate instanceof Date ? asOfDate.toISOString() : asOfDate}'. Expected YYYY-MM-DD or valid ISO date.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    } else {
      targetDate = normalizeEffectiveDate(new Date());
    }

    return this.employeeSalaryRepository.findCurrentByEmployeeId(
      employeeId,
      targetDate,
    );
  }

  /**
   * Retrieves paginated salary assignment history for an employee, supporting dynamic sorting.
   */
  async getSalaryHistory(
    employeeId: Types.ObjectId,
    query: EmployeeSalaryHistoryQueryDto,
  ): Promise<PaginatedResult<EmployeeSalaryLean>> {
    const employee = await this.employeeModel
      .findById(employeeId)
      .lean<Employee | null>()
      .exec();

    if (!employee || employee.deletedAt !== null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.employeeSalaryRepository.findPaginatedByEmployeeId(
      employeeId,
      query,
    );
  }
}
