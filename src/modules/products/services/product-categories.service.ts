import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  calculateSkip,
  buildPaginationMeta,
} from '../../../common/pagination/pagination.util';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateProductCategoryDto } from '../dto/create-product-category.dto';
import { ListProductCategoriesQueryDto } from '../dto/list-product-categories-query.dto';
import { UpdateProductCategoryDto } from '../dto/update-product-category.dto';
import {
  ProductCategoryMapper,
  ProductCategoryResponse,
  ProductCategoryTreeResponse,
} from '../mappers/product-category.mapper';
import { ProductCategoryRepository } from '../repositories/product-category.repository';
import { ProductRepository } from '../repositories/product.repository';

@Injectable()
export class ProductCategoriesService {
  private readonly logger = new Logger(ProductCategoriesService.name);

  constructor(
    private readonly categoryRepository: ProductCategoryRepository,
    private readonly productRepository: ProductRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateProductCategoryDto,
    actorId: Types.ObjectId,
  ): Promise<ProductCategoryResponse> {
    const codeUpper = dto.code.trim().toUpperCase();
    const existing = await this.categoryRepository.findByCode(codeUpper);
    if (existing) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Category with code '${codeUpper}' already exists`,
        HttpStatus.CONFLICT,
      );
    }

    let parentObjectId: Types.ObjectId | null = null;
    if (dto.parentCategoryId) {
      parentObjectId = new Types.ObjectId(dto.parentCategoryId);
      const parent = await this.categoryRepository.findById(parentObjectId);
      if (!parent) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Parent category not found',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const created = await this.categoryRepository.create({
      name: dto.name.trim(),
      code: codeUpper,
      description: dto.description?.trim() || null,
      parentCategoryId: parentObjectId,
      isActive: true,
      createdBy: actorId,
    });

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_CATEGORY_CREATED,
      targetId: created._id,
      targetModel: AuditTargetModel.PRODUCT_CATEGORY,
      details: { name: created.name, code: created.code },
      ipAddress: null,
      userAgent: null,
    });

    return ProductCategoryMapper.toResponse(created, 0);
  }

  async findAll(
    queryDto: ListProductCategoriesQueryDto,
  ): Promise<
    PaginatedResult<ProductCategoryResponse> | ProductCategoryTreeResponse[]
  > {
    // If tree view is requested
    if (queryDto.tree) {
      const activeCategories = await this.categoryRepository.findActiveTree();
      return ProductCategoryMapper.toTreeResponse(activeCategories);
    }

    // Flat paginated list
    const filter: Record<string, unknown> = { deletedAt: null };

    if (queryDto.isActive !== undefined) {
      filter.isActive = queryDto.isActive;
    }

    if (queryDto.parentCategoryId) {
      filter.parentCategoryId = new Types.ObjectId(queryDto.parentCategoryId);
    }

    if (queryDto.search) {
      const regex = new RegExp(queryDto.search.trim(), 'i');
      filter.$or = [{ name: regex }, { description: regex }, { code: regex }];
    }

    const page = queryDto.page || 1;
    const limit = queryDto.limit || 20;
    const skip = calculateSkip(page, limit);

    const [items, total] = await Promise.all([
      this.categoryRepository.findAll(filter, skip, limit),
      this.categoryRepository.count(filter),
    ]);

    // Attach active product count to each category
    const mapped = await Promise.all(
      items.map(async (cat) => {
        const count = await this.productRepository.countActiveByCategoryId(
          cat._id,
        );
        return ProductCategoryMapper.toResponse(cat, count);
      }),
    );

    return {
      data: mapped,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findById(id: Types.ObjectId): Promise<ProductCategoryResponse> {
    const category = await this.categoryRepository.findById(id);
    if (!category) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Category not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const productCount =
      await this.productRepository.countActiveByCategoryId(id);
    return ProductCategoryMapper.toResponse(category, productCount);
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateProductCategoryDto,
    actorId: Types.ObjectId,
  ): Promise<ProductCategoryResponse> {
    const category = await this.categoryRepository.findById(id);
    if (!category) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Category not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const updateFields: Record<string, unknown> = { updatedBy: actorId };

    if (dto.name !== undefined) {
      updateFields.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      updateFields.description = dto.description?.trim() || null;
    }

    if (dto.isActive !== undefined) {
      updateFields.isActive = dto.isActive;
    }

    if (dto.parentCategoryId !== undefined) {
      if (dto.parentCategoryId === null || dto.parentCategoryId === '') {
        updateFields.parentCategoryId = null;
      } else {
        const newParentId = new Types.ObjectId(dto.parentCategoryId);

        if (newParentId.equals(id)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'A category cannot be its own parent',
            HttpStatus.BAD_REQUEST,
          );
        }

        const parent = await this.categoryRepository.findById(newParentId);
        if (!parent) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Parent category not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.checkCircularParent(id, newParentId);
        updateFields.parentCategoryId = newParentId;
      }
    }

    const updated = await this.categoryRepository.updateById(id, updateFields);
    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Category not found after update',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_CATEGORY_UPDATED,
      targetId: id,
      targetModel: AuditTargetModel.PRODUCT_CATEGORY,
      details: updateFields,
      ipAddress: null,
      userAgent: null,
    });

    const productCount =
      await this.productRepository.countActiveByCategoryId(id);
    return ProductCategoryMapper.toResponse(updated, productCount);
  }

  async delete(id: Types.ObjectId, actorId: Types.ObjectId): Promise<void> {
    const category = await this.categoryRepository.findById(id);
    if (!category) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Category not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Guard rule: check for linked active products
    const activeProducts =
      await this.productRepository.countActiveByCategoryId(id);
    if (activeProducts > 0) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Cannot delete category: ${activeProducts} active product(s) are linked to this category`,
        HttpStatus.CONFLICT,
      );
    }

    // Soft delete
    await this.categoryRepository.updateById(id, {
      deletedAt: new Date(),
      deletedBy: actorId,
      isActive: false,
    });

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_CATEGORY_DELETED,
      targetId: id,
      targetModel: AuditTargetModel.PRODUCT_CATEGORY,
      details: { name: category.name, code: category.code },
      ipAddress: null,
      userAgent: null,
    });
  }

  private async checkCircularParent(
    categoryId: Types.ObjectId,
    newParentId: Types.ObjectId,
  ): Promise<void> {
    let currentParentId: Types.ObjectId | null | undefined = newParentId;
    const visited = new Set<string>();

    while (currentParentId) {
      if (currentParentId.equals(categoryId)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Circular parent category reference detected',
          HttpStatus.BAD_REQUEST,
        );
      }
      const currentParentIdStr = currentParentId.toString();
      if (visited.has(currentParentIdStr)) {
        break;
      }
      visited.add(currentParentIdStr);

      const parent = await this.categoryRepository.findById(currentParentId);
      currentParentId = parent?.parentCategoryId ?? null;
    }
  }
}
