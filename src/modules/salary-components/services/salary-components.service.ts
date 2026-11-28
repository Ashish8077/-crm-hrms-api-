import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateSalaryComponentInput,
  SalaryComponentRepository,
  UpdateSalaryComponentInput,
} from '../repositories/salary-component.repository';
import {
  SalaryStructure,
  SalaryStructureDocument,
} from '../../salary-structures/schemas/salary-structure.schema';
import {
  EmployeeSalary,
  EmployeeSalaryDocument,
} from '../../employee-salaries/schemas/employee-salary.schema';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { CreateSalaryComponentDto } from '../dto/create-salary-component.dto';
import { UpdateSalaryComponentDto } from '../dto/update-salary-component.dto';
import { UpdateSalaryComponentStatusDto } from '../dto/update-salary-component-status.dto';
import { ListSalaryComponentsQueryDto } from '../dto/list-salary-components-query.dto';
import {
  SalaryComponentMapper,
  SalaryComponentResponse,
} from '../mappers/salary-component.mapper';
import {
  GRATUITY_COMPONENT_CODE,
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
} from '../constants/salary-component.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { SalaryComponentLean } from '../schemas/salary-component.schema';

@Injectable()
export class SalaryComponentsService {
  constructor(
    private readonly salaryComponentRepository: SalaryComponentRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectModel(SalaryStructure.name)
    private readonly salaryStructureModel: Model<SalaryStructureDocument>,
    @InjectModel(EmployeeSalary.name)
    private readonly employeeSalaryModel: Model<EmployeeSalaryDocument>,
  ) {}

  /**
   * Creates a new salary component definition.
   * Relies on the unique database index { code: 1 } for concurrency-safe duplicate prevention.
   */
  async create(
    dto: CreateSalaryComponentDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<SalaryComponentResponse> {
    const normalizedCode = dto.code.trim().toUpperCase();
    const normalizedName = dto.name.trim();

    // Defense-in-depth: Gratuity Provision classification enforcement
    if (normalizedCode === GRATUITY_COMPONENT_CODE) {
      if (dto.type !== SalaryComponentType.EMPLOYER_CONTRIBUTION) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Gratuity Provision must be classified as an EMPLOYER_CONTRIBUTION. It cannot be an EARNING or EMPLOYEE_DEDUCTION.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.isStatutory === false) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Gratuity Provision must be marked as a statutory component (isStatutory: true)',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Explicit duplicate check before insert
    const existingWithCode =
      await this.salaryComponentRepository.findByCode(normalizedCode);
    if (existingWithCode) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Salary component with code '${normalizedCode}' already exists`,
        HttpStatus.CONFLICT,
      );
    }

    // Defense-in-depth: validate calculationType vs percentageOf rules
    if (dto.calculationType === SalaryComponentCalculationType.FIXED) {
      if (dto.percentageOf !== undefined && dto.percentageOf !== null) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'percentageOf must not be provided when calculationType is FIXED',
          HttpStatus.BAD_REQUEST,
        );
      }
    } else if (
      dto.calculationType === SalaryComponentCalculationType.PERCENTAGE
    ) {
      if (
        !dto.percentageOf ||
        !Object.values(SalaryComponentPercentageBasis).includes(
          dto.percentageOf,
        )
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `percentageOf is required when calculationType is PERCENTAGE and must be one of: ${Object.values(
            SalaryComponentPercentageBasis,
          ).join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const componentData: CreateSalaryComponentInput = {
      name: normalizedName,
      code: normalizedCode,
      type: dto.type,
      calculationType: dto.calculationType ?? null,
      percentageOf:
        dto.calculationType === SalaryComponentCalculationType.PERCENTAGE
          ? (dto.percentageOf ?? null)
          : null,
      defaultValue: dto.defaultValue ?? null,
      isTaxable: dto.isTaxable ?? false,
      isStatutory:
        normalizedCode === GRATUITY_COMPONENT_CODE
          ? true
          : (dto.isStatutory ?? false),
      description: dto.description?.trim() ?? null,
      isActive: dto.isActive ?? true,
      createdBy: actorId,
      updatedBy: actorId,
    };

    try {
      const created: SalaryComponentLean =
        await this.salaryComponentRepository.create(componentData);

      await this.auditLogsService.createAuditLog({
        actorId,
        action: AuditAction.SALARY_COMPONENT_CREATED,
        targetId: created._id,
        targetModel: AuditTargetModel.SALARY_COMPONENT,
        details: {
          name: created.name,
          code: created.code,
          type: created.type,
          calculationType: created.calculationType,
        },
        ipAddress: clientMetadata?.ipAddress ?? null,
        userAgent: clientMetadata?.userAgent ?? null,
      });

      return SalaryComponentMapper.toResponse(created);
    } catch (error: unknown) {
      if (this.salaryComponentRepository.isDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Salary component with code '${normalizedCode}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  /**
   * Retrieves a paginated and filtered list of salary components.
   */
  async list(
    query: ListSalaryComponentsQueryDto,
  ): Promise<PaginatedResult<SalaryComponentResponse>> {
    const result = await this.salaryComponentRepository.findList(query);
    return {
      data: result.data.map((c) => SalaryComponentMapper.toResponse(c)),
      meta: result.meta,
    };
  }

  /**
   * Retrieves a single salary component by ID.
   */
  async getById(id: Types.ObjectId): Promise<SalaryComponentResponse> {
    const component = await this.salaryComponentRepository.findById(id);
    if (!component) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary component not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return SalaryComponentMapper.toResponse(component);
  }

  /**
   * Updates an existing salary component definition partially.
   */
  async update(
    id: Types.ObjectId,
    dto: UpdateSalaryComponentDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<SalaryComponentResponse> {
    const existing = await this.salaryComponentRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary component not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const effectiveCode = (
      dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code
    ).toUpperCase();
    const effectiveType = dto.type ?? existing.type;
    const effectiveIsStatutory =
      dto.isStatutory !== undefined ? dto.isStatutory : existing.isStatutory;

    if (effectiveCode === GRATUITY_COMPONENT_CODE) {
      if (effectiveType !== SalaryComponentType.EMPLOYER_CONTRIBUTION) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Gratuity Provision must be classified as an EMPLOYER_CONTRIBUTION. It cannot be an EARNING or EMPLOYEE_DEDUCTION.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (effectiveIsStatutory === false) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Gratuity Provision must be marked as a statutory component (isStatutory: true)',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (dto.code !== undefined) {
      const normalizedNewCode = dto.code.trim().toUpperCase();
      const existingWithCode = await this.salaryComponentRepository.findByCode(
        normalizedNewCode,
        id,
      );
      if (existingWithCode) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Salary component with code '${normalizedNewCode}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const effectiveCalculationType =
      dto.calculationType ?? existing.calculationType;

    let effectivePercentageOf: SalaryComponentPercentageBasis | null =
      existing.percentageOf ?? null;

    if (effectiveCalculationType === SalaryComponentCalculationType.FIXED) {
      if (dto.percentageOf !== undefined && dto.percentageOf !== null) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'percentageOf must not be provided when calculationType is FIXED',
          HttpStatus.BAD_REQUEST,
        );
      }
      effectivePercentageOf = null;
    } else if (
      effectiveCalculationType === SalaryComponentCalculationType.PERCENTAGE
    ) {
      if (dto.percentageOf !== undefined) {
        if (
          !dto.percentageOf ||
          !Object.values(SalaryComponentPercentageBasis).includes(
            dto.percentageOf,
          )
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `percentageOf is required when calculationType is PERCENTAGE and must be one of: ${Object.values(
              SalaryComponentPercentageBasis,
            ).join(', ')}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        effectivePercentageOf = dto.percentageOf;
      } else if (!effectivePercentageOf) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'percentageOf is required when calculationType is changed to PERCENTAGE',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const updateData: UpdateSalaryComponentInput = {
      updatedBy: actorId,
    };

    if (dto.name !== undefined) {
      updateData.name = dto.name.trim();
    }
    if (dto.code !== undefined) {
      updateData.code = dto.code.trim().toUpperCase();
    }
    if (dto.type !== undefined) {
      updateData.type = dto.type;
    }
    if (dto.calculationType !== undefined) {
      updateData.calculationType = dto.calculationType;
      updateData.percentageOf = effectivePercentageOf;
    } else if (dto.percentageOf !== undefined) {
      updateData.percentageOf = effectivePercentageOf;
    }
    if (dto.defaultValue !== undefined) {
      updateData.defaultValue = dto.defaultValue;
    }
    if (dto.isTaxable !== undefined) {
      updateData.isTaxable = dto.isTaxable;
    }
    if (dto.isStatutory !== undefined) {
      updateData.isStatutory = dto.isStatutory;
    } else if (effectiveCode === GRATUITY_COMPONENT_CODE) {
      updateData.isStatutory = true;
    }
    if (dto.description !== undefined) {
      updateData.description = dto.description.trim();
    }

    try {
      const updated = await this.salaryComponentRepository.updateById(
        id,
        updateData,
      );

      if (!updated) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Salary component not found',
          HttpStatus.NOT_FOUND,
        );
      }

      await this.auditLogsService.createAuditLog({
        actorId,
        action: AuditAction.SALARY_COMPONENT_UPDATED,
        targetId: id,
        targetModel: AuditTargetModel.SALARY_COMPONENT,
        details: SalaryComponentMapper.toUpdateAuditDetails(existing, updated),
        ipAddress: clientMetadata?.ipAddress ?? null,
        userAgent: clientMetadata?.userAgent ?? null,
      });

      return SalaryComponentMapper.toResponse(updated);
    } catch (error: unknown) {
      if (this.salaryComponentRepository.isDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Salary component with code '${updateData.code ?? dto.code ?? 'UNKNOWN'}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  /**
   * Activates or deactivates a salary component.
   * Does not perform hard-deletion; maintains historical integrity.
   */
  async updateStatus(
    id: Types.ObjectId,
    dto: UpdateSalaryComponentStatusDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<SalaryComponentResponse> {
    const existing = await this.salaryComponentRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary component not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.isActive === dto.isActive) {
      return SalaryComponentMapper.toResponse(existing);
    }

    const updated = await this.salaryComponentRepository.updateStatus(
      id,
      dto.isActive,
      actorId,
    );

    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary component not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.SALARY_COMPONENT_STATUS_CHANGED,
      targetId: id,
      targetModel: AuditTargetModel.SALARY_COMPONENT,
      details: {
        from: existing.isActive,
        to: dto.isActive,
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return SalaryComponentMapper.toResponse(updated);
  }

  /**
   * Controlled admin/HR master-data helper to safely ensure the Gratuity Provision
   * component exists without creating duplicates. Checks whether GRATUITY already exists;
   * if absent, creates it with authoritative employer contribution & statutory metadata.
   */
  async ensureGratuityComponent(
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<SalaryComponentResponse> {
    const existing = await this.salaryComponentRepository.findByCode(
      GRATUITY_COMPONENT_CODE,
    );
    if (existing) {
      return SalaryComponentMapper.toResponse(existing);
    }

    return this.create(
      {
        name: 'Gratuity Provision',
        code: GRATUITY_COMPONENT_CODE,
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        isStatutory: true,
        isTaxable: false,
        isActive: true,
        description:
          'Estimated monthly employer gratuity provision (Payment of Gratuity Act compliance)',
      },
      actorId,
      clientMetadata,
    );
  }

  /**
   * Safely deletes a salary component if and only if it is not referenced
   * by any SalaryStructure templates or EmployeeSalary historical assignments.
   */
  async delete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<{ deleted: true; id: string }> {
    const existing = await this.salaryComponentRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary component not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const idStr = id.toString();
    const [referencedInStructure, referencedInEmployeeSalary] =
      await Promise.all([
        this.salaryStructureModel
          .exists({ 'components.componentId': id })
          .exec(),
        this.employeeSalaryModel
          .exists({
            $or: [
              { 'salarySnapshot.earnings.componentId': idStr },
              { 'salarySnapshot.employeeDeductions.componentId': idStr },
              { 'salarySnapshot.employerContributions.componentId': idStr },
            ],
          })
          .exec(),
      ]);

    if (referencedInStructure || referencedInEmployeeSalary) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Cannot delete salary component '${existing.code}' because it is referenced by existing salary structures or employee salary records. Deactivate it instead.`,
        HttpStatus.CONFLICT,
      );
    }

    await this.salaryComponentRepository.deleteById(id);

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.SALARY_COMPONENT_DELETED,
      targetId: id,
      targetModel: AuditTargetModel.SALARY_COMPONENT,
      details: { name: existing.name, code: existing.code },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return { deleted: true, id: idStr };
  }
}
