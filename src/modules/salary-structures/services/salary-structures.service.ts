import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CreateSalaryStructureInput,
  SalaryStructureRepository,
  UpdateSalaryStructureInput,
} from '../repositories/salary-structure.repository';
import {
  CalculateBreakupParams,
  CalculationMasterMap,
  SalaryStructureBreakupResult,
  SalaryStructureCalculationService,
} from './salary-structure-calculation.service';
import {
  SalaryComponent,
  SalaryComponentDocument,
  SalaryComponentLean,
} from '../../salary-components/schemas/salary-component.schema';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { CreateSalaryStructureDto } from '../dto/create-salary-structure.dto';
import { UpdateSalaryStructureDto } from '../dto/update-salary-structure.dto';
import { UpdateSalaryStructureStatusDto } from '../dto/update-salary-structure-status.dto';
import { CalculateSalaryStructureDto } from '../dto/calculate-salary-structure.dto';
import { ListSalaryStructuresQueryDto } from '../dto/list-salary-structures-query.dto';
import {
  SalaryStructureCreateResponseDto,
  SalaryStructureDetailResponseDto,
  SalaryStructureListItemResponseDto,
} from '../dto/salary-structure-response.dto';
import { SalaryStructureMapper } from '../mappers/salary-structure.mapper';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
} from '../constants/salary-structure.constant';

@Injectable()
export class SalaryStructuresService {
  constructor(
    private readonly salaryStructureRepository: SalaryStructureRepository,
    private readonly calculationService: SalaryStructureCalculationService,
    private readonly auditLogsService: AuditLogsService,
    @InjectModel(SalaryComponent.name)
    private readonly salaryComponentModel: Model<SalaryComponentDocument>,
  ) {}

  /**
   * Creates a new salary structure template.
   */
  async create(
    dto: CreateSalaryStructureDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<SalaryStructureCreateResponseDto> {
    const normalizedCode = dto.code.trim().toUpperCase();
    const normalizedName = dto.name.trim();

    // 1. Fetch referenced SalaryComponent masters
    const componentObjectIds = dto.components.map(
      (c) => new Types.ObjectId(c.componentId),
    );

    const masterDocs = await this.salaryComponentModel
      .find({ _id: { $in: componentObjectIds } })
      .lean<SalaryComponentLean[]>()
      .exec();

    const masterMap: CalculationMasterMap = {};
    for (const doc of masterDocs) {
      masterMap[doc._id.toString()] = doc;
    }

    // Verify all components exist
    for (const comp of dto.components) {
      const master = masterMap[comp.componentId];
      if (!master) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Referenced SalaryComponent '${comp.componentId}' not found`,
          HttpStatus.NOT_FOUND,
        );
      }
      if (!master.isActive) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot create salary structure with inactive component '${master.name}' (${master.code}).`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 2. Validate and calculate breakup
    const calculationParams: CalculateBreakupParams = {
      salaryBasis: dto.salaryBasis,
      salaryFrequency: dto.salaryFrequency,
      salaryAmount: dto.salaryAmount,
      masterMap,
      components: dto.components.map((c) => ({
        componentId: new Types.ObjectId(c.componentId),
        calculationType: c.calculationType,
        amount: c.amount ?? null,
        percentage: c.percentage ?? null,
        percentageOf: c.percentageOf ?? null,
      })),
    };

    const breakup = this.calculationService.calculate(calculationParams);

    // 3. Persist salary structure template
    const createInput: CreateSalaryStructureInput = {
      name: normalizedName,
      code: normalizedCode,
      description: dto.description?.trim() ?? null,
      salaryBasis: dto.salaryBasis,
      salaryFrequency: dto.salaryFrequency,
      salaryAmount: dto.salaryAmount,
      components: dto.components.map((c) => ({
        componentId: new Types.ObjectId(c.componentId),
        calculationType: c.calculationType,
        amount: c.amount ?? null,
        percentage: c.percentage ?? null,
        percentageOf: c.percentageOf ?? null,
      })),
      isActive: dto.isActive ?? true,
      createdBy: actorId,
      updatedBy: actorId,
    };

    try {
      const created = await this.salaryStructureRepository.create(createInput);

      await this.auditLogsService.createAuditLog({
        actorId,
        action: AuditAction.SALARY_STRUCTURE_CREATED,
        targetId: created._id,
        targetModel: AuditTargetModel.SALARY_STRUCTURE,
        details: {
          name: created.name,
          code: created.code,
          salaryBasis: created.salaryBasis,
          salaryFrequency: created.salaryFrequency,
          salaryAmount: created.salaryAmount,
          componentsCount: created.components.length,
        },
        ipAddress: clientMetadata?.ipAddress ?? null,
        userAgent: clientMetadata?.userAgent ?? null,
      });

      return SalaryStructureMapper.toCreateResponse(created, breakup);
    } catch (error: unknown) {
      if (this.salaryStructureRepository.isDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Salary structure with code '${normalizedCode}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  /**
   * Calculates ephemeral salary preview without persisting.
   */
  async calculatePreview(
    dto: CalculateSalaryStructureDto,
  ): Promise<SalaryStructureBreakupResult> {
    const componentObjectIds = dto.components.map(
      (c) => new Types.ObjectId(c.componentId),
    );

    const masterDocs = await this.salaryComponentModel
      .find({ _id: { $in: componentObjectIds } })
      .lean<SalaryComponentLean[]>()
      .exec();

    const masterMap: CalculationMasterMap = {};
    for (const doc of masterDocs) {
      masterMap[doc._id.toString()] = doc;
    }

    for (const comp of dto.components) {
      const master = masterMap[comp.componentId];
      if (!master) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Referenced SalaryComponent '${comp.componentId}' not found`,
          HttpStatus.NOT_FOUND,
        );
      }
      if (!master.isActive) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot preview salary structure with inactive component '${master.name}' (${master.code}).`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const breakup = this.calculationService.calculate({
      salaryBasis: dto.salaryBasis,
      salaryFrequency: dto.salaryFrequency,
      salaryAmount: dto.salaryAmount,
      masterMap,
      components: dto.components.map((c) => ({
        componentId: new Types.ObjectId(c.componentId),
        calculationType: c.calculationType,
        amount: c.amount ?? null,
        percentage: c.percentage ?? null,
        percentageOf: c.percentageOf ?? null,
      })),
    });

    if (dto.includeDiagnostics === false) {
      const cleanResult = { ...breakup };
      delete cleanResult.diagnostics;
      return cleanResult;
    }

    return breakup;
  }

  /**
   * Retrieves paginated list of salary structures with lightweight summary representation.
   * Derives grossSalary and totalCtc in frequency units for direct cross-structure comparison.
   */
  async list(
    query: ListSalaryStructuresQueryDto,
  ): Promise<PaginatedResult<SalaryStructureListItemResponseDto>> {
    const result = await this.salaryStructureRepository.findList(query);

    // Fetch master components for all structures on the current page in a single query
    const allComponentIds = Array.from(
      new Set(
        result.data.flatMap((item) =>
          item.components.map((c) => c.componentId.toString()),
        ),
      ),
    ).map((id) => new Types.ObjectId(id));

    const masterMap: CalculationMasterMap = {};
    if (allComponentIds.length > 0) {
      try {
        const masterDocs = await this.salaryComponentModel
          .find({ _id: { $in: allComponentIds } })
          .lean<SalaryComponentLean[]>()
          .exec();
        if (masterDocs) {
          for (const doc of masterDocs) {
            masterMap[doc._id.toString()] = doc;
          }
        }
      } catch {
        // Fall back gracefully if master docs cannot be loaded
      }
    }

    const data = result.data.map((item) => {
      let grossSalary = item.salaryAmount;
      let totalCtc = item.salaryAmount;

      try {
        const breakup = this.calculationService.calculate({
          salaryBasis: item.salaryBasis,
          salaryFrequency: item.salaryFrequency,
          salaryAmount: item.salaryAmount,
          masterMap,
          components: item.components,
        });

        const isMonthly =
          item.salaryFrequency === SalaryStructureFrequency.MONTHLY;
        grossSalary = isMonthly
          ? breakup.grossSalaryMonthly
          : breakup.grossSalaryAnnual;
        totalCtc = isMonthly ? breakup.totalCtcMonthly : breakup.totalCtcAnnual;
      } catch {
        // Fallback: salaryAmount matches configured basis
        grossSalary = item.salaryAmount;
        totalCtc = item.salaryAmount;
      }

      return SalaryStructureMapper.toListItemResponse(
        item,
        grossSalary,
        totalCtc,
      );
    });

    return {
      data,
      meta: result.meta,
    };
  }

  /**
   * Retrieves single salary structure with calculated breakup and enriched components.
   */
  async getById(id: Types.ObjectId): Promise<SalaryStructureDetailResponseDto> {
    const structure = await this.salaryStructureRepository.findById(id);
    if (!structure) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary structure not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Load components to calculate current breakup
    const componentObjectIds = structure.components.map((c) => c.componentId);
    const masterDocs = await this.salaryComponentModel
      .find({ _id: { $in: componentObjectIds } })
      .lean<SalaryComponentLean[]>()
      .exec();

    const masterMap: CalculationMasterMap = {};
    for (const doc of masterDocs) {
      masterMap[doc._id.toString()] = doc;
    }

    let breakup: SalaryStructureBreakupResult | undefined;
    try {
      breakup = this.calculationService.calculate({
        salaryBasis: structure.salaryBasis,
        salaryFrequency: structure.salaryFrequency,
        salaryAmount: structure.salaryAmount,
        masterMap,
        components: structure.components,
      });
    } catch {
      // If a component was modified in master such that legacy structure cannot cleanly evaluate,
      // return structure without breakup rather than 500 error.
      breakup = undefined;
    }

    return SalaryStructureMapper.toDetailResponse(
      structure,
      masterMap,
      breakup,
    );
  }

  /**
   * Updates an existing salary structure template.
   * Guarantees optimistic concurrency and does NOT alter existing employee salary snapshots.
   */
  async update(
    id: Types.ObjectId,
    dto: UpdateSalaryStructureDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<SalaryStructureDetailResponseDto> {
    const existing = await this.salaryStructureRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary structure not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const effectiveBasis: SalaryStructureBasis =
      dto.salaryBasis ?? existing.salaryBasis;
    const effectiveFrequency: SalaryStructureFrequency =
      dto.salaryFrequency ?? existing.salaryFrequency;
    const effectiveAmount: number = dto.salaryAmount ?? existing.salaryAmount;

    const effectiveComponents =
      dto.components !== undefined
        ? dto.components.map((c) => ({
            componentId: new Types.ObjectId(c.componentId),
            calculationType: c.calculationType,
            amount: c.amount ?? null,
            percentage: c.percentage ?? null,
            percentageOf: c.percentageOf ?? null,
          }))
        : existing.components;

    // Load components and validate calculation
    const componentObjectIds = effectiveComponents.map((c) => c.componentId);
    const masterDocs = await this.salaryComponentModel
      .find({ _id: { $in: componentObjectIds } })
      .lean<SalaryComponentLean[]>()
      .exec();

    const masterMap: CalculationMasterMap = {};
    for (const doc of masterDocs) {
      masterMap[doc._id.toString()] = doc;
    }

    for (const comp of effectiveComponents) {
      const master = masterMap[comp.componentId.toString()];
      if (!master) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Referenced SalaryComponent '${comp.componentId.toString()}' not found`,
          HttpStatus.NOT_FOUND,
        );
      }
      if (dto.components !== undefined && !master.isActive) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot update salary structure with inactive component '${master.name}' (${master.code}).`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const breakup = this.calculationService.calculate({
      salaryBasis: effectiveBasis,
      salaryFrequency: effectiveFrequency,
      salaryAmount: effectiveAmount,
      masterMap,
      components: effectiveComponents,
    });

    const updateInput: UpdateSalaryStructureInput = {
      updatedBy: actorId,
      version: dto.version,
    };

    if (dto.name !== undefined) {
      updateInput.name = dto.name.trim();
    }
    if (dto.code !== undefined) {
      updateInput.code = dto.code.trim().toUpperCase();
    }
    if (dto.description !== undefined) {
      updateInput.description = dto.description.trim();
    }
    if (dto.salaryBasis !== undefined) {
      updateInput.salaryBasis = dto.salaryBasis;
    }
    if (dto.salaryFrequency !== undefined) {
      updateInput.salaryFrequency = dto.salaryFrequency;
    }
    if (dto.salaryAmount !== undefined) {
      updateInput.salaryAmount = dto.salaryAmount;
    }
    if (dto.components !== undefined) {
      updateInput.components = effectiveComponents;
    }

    try {
      const updated = await this.salaryStructureRepository.updateById(
        id,
        updateInput,
      );

      if (!updated) {
        // If version was supplied, this was a concurrent modification
        if (dto.version !== undefined) {
          throw new AppError(
            ErrorCode.CONCURRENT_MODIFICATION,
            'Salary structure was modified concurrently by another user. Please reload and try again.',
            HttpStatus.CONFLICT,
          );
        }
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Salary structure not found',
          HttpStatus.NOT_FOUND,
        );
      }

      await this.auditLogsService.createAuditLog({
        actorId,
        action: AuditAction.SALARY_STRUCTURE_UPDATED,
        targetId: id,
        targetModel: AuditTargetModel.SALARY_STRUCTURE,
        details: SalaryStructureMapper.toUpdateAuditDetails(existing, updated),
        ipAddress: clientMetadata?.ipAddress ?? null,
        userAgent: clientMetadata?.userAgent ?? null,
      });

      return SalaryStructureMapper.toDetailResponse(
        updated,
        masterMap,
        breakup,
      );
    } catch (error: unknown) {
      if (this.salaryStructureRepository.isDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Salary structure with code '${updateInput.code ?? dto.code ?? 'UNKNOWN'}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
      if (this.salaryStructureRepository.isVersionError(error)) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Salary structure was modified concurrently by another user. Please reload and try again.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  /**
   * Activates or deactivates a salary structure template.
   * Enforces strict pre-activation validations, optimistic concurrency, and idempotency.
   */
  async updateStatus(
    id: Types.ObjectId,
    dto: UpdateSalaryStructureStatusDto,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
    session?: ClientSession,
  ): Promise<SalaryStructureDetailResponseDto> {
    const existing = await this.salaryStructureRepository.findById(id);
    if (!existing) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary structure not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // 1. Idempotency Check: if status is already in the target state, return without modification
    if (existing.isActive === dto.isActive) {
      if (
        dto.version !== undefined &&
        typeof existing.__v === 'number' &&
        existing.__v !== dto.version
      ) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Salary structure was modified concurrently by another user. Please reload and try again.',
          HttpStatus.CONFLICT,
        );
      }

      const componentObjectIds = existing.components.map((c) => c.componentId);
      const masterDocs = await this.salaryComponentModel
        .find({ _id: { $in: componentObjectIds } })
        .lean<SalaryComponentLean[]>()
        .exec();

      const masterMap: CalculationMasterMap = {};
      for (const doc of masterDocs) {
        masterMap[doc._id.toString()] = doc;
      }

      let breakup: SalaryStructureBreakupResult | undefined;
      try {
        breakup = this.calculationService.calculate({
          salaryBasis: existing.salaryBasis,
          salaryFrequency: existing.salaryFrequency,
          salaryAmount: existing.salaryAmount,
          masterMap,
          components: existing.components,
        });
      } catch {
        breakup = undefined;
      }

      return SalaryStructureMapper.toDetailResponse(
        existing,
        masterMap,
        breakup,
      );
    }

    // Load master documents for referenced components
    const componentObjectIds = existing.components.map((c) => c.componentId);
    const masterDocs = await this.salaryComponentModel
      .find({ _id: { $in: componentObjectIds } })
      .lean<SalaryComponentLean[]>()
      .exec();

    const masterMap: CalculationMasterMap = {};
    for (const doc of masterDocs) {
      masterMap[doc._id.toString()] = doc;
    }

    let breakup: SalaryStructureBreakupResult | undefined;

    // 2. Strict Pre-Activation Validations
    if (dto.isActive) {
      // 2a. Verify all referenced components exist and are active in master
      for (const comp of existing.components) {
        const master = masterMap[comp.componentId.toString()];
        if (!master) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            `Cannot activate salary structure: Referenced SalaryComponent '${comp.componentId.toString()}' not found`,
            HttpStatus.NOT_FOUND,
          );
        }
        if (!master.isActive) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Cannot activate salary structure with inactive component '${master.name}' (${master.code}).`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // 2b. Validate component configuration and salary calculations
      try {
        breakup = this.calculationService.calculate({
          salaryBasis: existing.salaryBasis,
          salaryFrequency: existing.salaryFrequency,
          salaryAmount: existing.salaryAmount,
          masterMap,
          components: existing.components,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw new AppError(
            error.code,
            `Cannot activate salary structure due to calculation error: ${error.message}`,
            error.statusCode,
            error.details,
          );
        }
        throw error;
      }
    } else {
      // Deactivation: attempt calculation for response details if possible
      try {
        breakup = this.calculationService.calculate({
          salaryBasis: existing.salaryBasis,
          salaryFrequency: existing.salaryFrequency,
          salaryAmount: existing.salaryAmount,
          masterMap,
          components: existing.components,
        });
      } catch {
        breakup = undefined;
      }
    }

    // 3. Atomic status transition with optimistic concurrency
    const updated =
      dto.version !== undefined
        ? await this.salaryStructureRepository.updateStatus(
            id,
            dto.isActive,
            actorId,
            dto.version,
            session,
          )
        : session !== undefined
          ? await this.salaryStructureRepository.updateStatus(
              id,
              dto.isActive,
              actorId,
              undefined,
              session,
            )
          : await this.salaryStructureRepository.updateStatus(
              id,
              dto.isActive,
              actorId,
            );

    if (!updated) {
      if (dto.version !== undefined) {
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Salary structure was modified concurrently by another user. Please reload and try again.',
          HttpStatus.CONFLICT,
        );
      }
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Salary structure not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // 4. Audit Log
    const auditData = {
      actorId,
      action: AuditAction.SALARY_STRUCTURE_STATUS_CHANGED,
      targetId: id,
      targetModel: AuditTargetModel.SALARY_STRUCTURE,
      details: {
        from: existing.isActive,
        to: dto.isActive,
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    };

    if (session !== undefined) {
      await this.auditLogsService.createAuditLog(auditData, session);
    } else {
      await this.auditLogsService.createAuditLog(auditData);
    }

    return SalaryStructureMapper.toDetailResponse(updated, masterMap, breakup);
  }
}
