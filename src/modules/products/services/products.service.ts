import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
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
import { AuthenticatedUser } from '../../auth/types/auth-request.type';
import { SystemRole } from '../../roles/constants/role.constant';
import { RoleRepository } from '../../roles/repositories/role.repository';
import { BillingCycle } from '../constants/billing-cycle.constant';
import { PricingType } from '../constants/pricing-type.constant';
import {
  DEFAULT_CATEGORY_CODE,
  PRODUCT_DEFAULT_CURRENCY,
  PRODUCT_DEFAULT_PAGE,
  PRODUCT_DEFAULT_TAX_RATE,
  PRODUCT_DEFAULT_UNIT,
  SKU_PREFIX_MAP,
} from '../constants/product.constant';
import { ProductType } from '../constants/product-type.constant';
import { BulkUpdateProductStatusDto } from '../dto/bulk-update-product-status.dto';
import { CalculateQuotePriceDto } from '../dto/calculate-quote-price.dto';
import { CreateProductDto } from '../dto/create-product.dto';
import { ListProductsQueryDto } from '../dto/list-products-query.dto';
import { ToggleProductStatusDto } from '../dto/toggle-product-status.dto';
import { UpdateBundleItemsDto } from '../dto/update-bundle-items.dto';
import { UpdateProductPricingDto } from '../dto/update-product-pricing.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import {
  PriceHistoryResponseItem,
  ProductMapper,
  ProductResponse,
} from '../mappers/product.mapper';
import { ProductCategoryRepository } from '../repositories/product-category.repository';
import {
  ProductRepository,
  ProductSummaryResult,
} from '../repositories/product.repository';
import {
  BundleItem,
  PriceHistoryEntry,
  PricingTier,
  ProductLean,
} from '../schemas/product.schema';
import {
  PriceCalculatorService,
  QuoteCalculationSummary,
  roundCurrency,
} from './price-calculator.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly productRepository: ProductRepository,
    private readonly categoryRepository: ProductCategoryRepository,
    private readonly roleRepository: RoleRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly priceCalculatorService: PriceCalculatorService,
  ) {}

  async isUserAdminOrManager(user: AuthenticatedUser): Promise<boolean> {
    if (!user || !user.roleIds || user.roleIds.length === 0) return false;
    const activeRoles = await this.roleRepository.findActiveByIds(user.roleIds);
    const privilegedRoles = new Set<string>([
      SystemRole.SUPER_ADMIN,
      SystemRole.ADMIN,
      SystemRole.SALES_MANAGER,
      SystemRole.FINANCE,
    ]);
    return activeRoles.some((r) => privilegedRoles.has(r.key));
  }

  async generateUniqueSku(
    type: ProductType,
    categoryCode: string,
  ): Promise<string> {
    const prefix = SKU_PREFIX_MAP[type] || 'PRD';
    const cleanCode =
      categoryCode
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 4) || DEFAULT_CATEGORY_CODE;

    for (let attempt = 0; attempt < 5; attempt++) {
      const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 chars
      const candidateSku = `${prefix}-${cleanCode}-${randomHex}`;
      const exists = await this.productRepository.findBySku(candidateSku);
      if (!exists) return candidateSku;
    }

    return `${prefix}-${cleanCode}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
  }

  async validateBundleItems(
    bundleId: Types.ObjectId | null,
    items: Array<{
      productId: string;
      quantity: number;
      discountPercent?: number;
    }>,
  ): Promise<BundleItem[]> {
    const childObjectIds: Types.ObjectId[] = [];

    for (const item of items) {
      const childId = new Types.ObjectId(item.productId);
      if (bundleId && childId.equals(bundleId)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'A bundle cannot include itself as a component',
          HttpStatus.BAD_REQUEST,
        );
      }
      childObjectIds.push(childId);
    }

    // Check all child products exist and are active
    const childProducts =
      await this.productRepository.findActiveByIds(childObjectIds);
    if (childProducts.length !== childObjectIds.length) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'One or more bundle component products were not found or are inactive/deleted',
        HttpStatus.NOT_FOUND,
      );
    }

    // Max Depth = 1 enforcement: nested bundles are prohibited
    for (const child of childProducts) {
      if (child.type === ProductType.BUNDLE) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Nested bundles are prohibited (Max Depth = 1): Component '${child.name}' is already a bundle`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return items.map((i) => ({
      productId: new Types.ObjectId(i.productId),
      quantity: i.quantity,
      discountPercent: i.discountPercent || 0,
    }));
  }

  async create(
    dto: CreateProductDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<ProductResponse> {
    const categoryObjectId = new Types.ObjectId(dto.categoryId);
    const category = await this.categoryRepository.findById(categoryObjectId);
    if (!category || !category.isActive) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Category not found or is inactive',
        HttpStatus.NOT_FOUND,
      );
    }

    // Financial validation: floorPrice <= unitPrice
    const unitPrice = roundCurrency(dto.unitPrice);
    const costPrice = roundCurrency(dto.costPrice ?? 0);
    const floorPrice = roundCurrency(dto.floorPrice ?? 0);

    if (floorPrice > unitPrice) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `floorPrice (${floorPrice}) cannot exceed unitPrice (${unitPrice})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Discount guardrails validation: rep <= manager
    const repDiscount = dto.repMaxDiscountPercent ?? 10;
    const managerDiscount = dto.managerMaxDiscountPercent ?? 25;
    if (repDiscount > managerDiscount) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `repMaxDiscountPercent (${repDiscount}%) cannot exceed managerMaxDiscountPercent (${managerDiscount}%)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate pricing tiers if provided
    let pricingTiers: PricingTier[] = [];
    if (dto.pricingTiers && dto.pricingTiers.length > 0) {
      pricingTiers = this.priceCalculatorService.validateAndSortPricingTiers(
        dto.pricingTiers.map((t) => ({
          minQuantity: t.minQuantity,
          maxQuantity: t.maxQuantity ?? null,
          unitPrice: roundCurrency(t.unitPrice),
        })),
      );
    }

    // Bundle validation
    let bundleItems: BundleItem[] = [];
    if (dto.type === ProductType.BUNDLE) {
      if (dto.bundleItems && dto.bundleItems.length > 0) {
        bundleItems = await this.validateBundleItems(null, dto.bundleItems);
      }
    } else if (dto.bundleItems && dto.bundleItems.length > 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Only products of type BUNDLE can specify bundle items',
        HttpStatus.BAD_REQUEST,
      );
    }

    // SKU generation / validation
    let finalSku: string;
    if (dto.sku) {
      finalSku = dto.sku.trim().toUpperCase();
      const existingSku = await this.productRepository.findBySku(finalSku);
      if (existingSku) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Product with SKU '${finalSku}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
    } else {
      finalSku = await this.generateUniqueSku(dto.type, category.code);
    }

    // Initial price ledger entry
    const initialPriceHistoryEntry: PriceHistoryEntry = {
      oldUnitPrice: unitPrice,
      newUnitPrice: unitPrice,
      oldCostPrice: costPrice,
      newCostPrice: costPrice,
      reason: 'Initial product creation',
      changedBy: actorId,
      changedAt: new Date(),
    };

    const created = await this.productRepository.create({
      name: dto.name.trim(),
      sku: finalSku,
      type: dto.type,
      categoryId: categoryObjectId,
      description: dto.description?.trim() || null,
      isActive: true,
      unitPrice,
      costPrice,
      floorPrice,
      currency: (dto.currency || PRODUCT_DEFAULT_CURRENCY).trim().toUpperCase(),
      pricingType: dto.pricingType || PricingType.ONE_TIME,
      billingCycle: dto.billingCycle || BillingCycle.ONE_OFF,
      unit: (dto.unit || PRODUCT_DEFAULT_UNIT).trim().toUpperCase(),
      pricingTiers,
      repMaxDiscountPercent: repDiscount,
      managerMaxDiscountPercent: managerDiscount,
      hsnSacCode: dto.hsnSacCode?.trim().toUpperCase() || null,
      taxRate: dto.taxRate ?? PRODUCT_DEFAULT_TAX_RATE,
      isTaxInclusive: dto.isTaxInclusive ?? false,
      estimatedDeliveryHours: dto.estimatedDeliveryHours ?? null,
      requiredSkillRole: dto.requiredSkillRole?.trim() || null,
      bundleItems,
      priceHistory: [initialPriceHistoryEntry],
      tags: dto.tags || [],
      createdBy: actorId,
    });

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_CREATED,
      targetId: created._id,
      targetModel: AuditTargetModel.PRODUCT,
      details: { name: created.name, sku: created.sku, type: created.type },
      ipAddress: null,
      userAgent: null,
    });

    const populated = await this.productRepository.findById(created._id);
    return ProductMapper.toResponse(
      populated || created,
      callerIsAdminOrManager,
    );
  }

  async findAll(
    queryDto: ListProductsQueryDto,
    callerIsAdminOrManager: boolean,
  ): Promise<PaginatedResult<ProductResponse>> {
    const filter: Record<string, unknown> = { deletedAt: null };

    if (queryDto.type) {
      filter.type = queryDto.type;
    }

    if (queryDto.categoryId) {
      filter.categoryId = new Types.ObjectId(queryDto.categoryId);
    }

    if (queryDto.isActive !== undefined) {
      filter.isActive = queryDto.isActive;
    }

    if (queryDto.billingCycle) {
      filter.billingCycle = queryDto.billingCycle;
    }

    if (queryDto.tag) {
      filter.tags = queryDto.tag.trim();
    }

    if (queryDto.minPrice !== undefined || queryDto.maxPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (queryDto.minPrice !== undefined) priceFilter.$gte = queryDto.minPrice;
      if (queryDto.maxPrice !== undefined) priceFilter.$lte = queryDto.maxPrice;
      filter.unitPrice = priceFilter;
    }

    if (queryDto.search) {
      const regex = new RegExp(queryDto.search.trim(), 'i');
      filter.$or = [
        { name: regex },
        { sku: regex },
        { description: regex },
        { hsnSacCode: regex },
      ];
    }

    const page = queryDto.page || PRODUCT_DEFAULT_PAGE;
    const limit = queryDto.limit || 20;
    const skip = calculateSkip(page, limit);

    const [items, total] = await Promise.all([
      this.productRepository.findAll(filter, skip, limit),
      this.productRepository.count(filter),
    ]);

    const mapped = items.map((doc) =>
      ProductMapper.toResponse(doc, callerIsAdminOrManager),
    );

    return {
      data: mapped,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async findActiveCatalog(
    queryDto: ListProductsQueryDto,
    callerIsAdminOrManager: boolean,
  ): Promise<ProductResponse[]> {
    const filter: Record<string, unknown> = {};

    if (queryDto.type) {
      filter.type = queryDto.type;
    }

    if (queryDto.categoryId) {
      filter.categoryId = new Types.ObjectId(queryDto.categoryId);
    }

    if (queryDto.search) {
      const regex = new RegExp(queryDto.search.trim(), 'i');
      filter.$or = [{ name: regex }, { sku: regex }, { description: regex }];
    }

    const page = queryDto.page || 1;
    const limit = queryDto.limit || 100;
    const skip = calculateSkip(page, limit);

    const items = await this.productRepository.findActiveCatalog(
      filter,
      skip,
      limit,
    );

    return items.map((doc) =>
      ProductMapper.toResponse(doc, callerIsAdminOrManager),
    );
  }

  async findBundles(
    page: number = 1,
    limit: number = 20,
    callerIsAdminOrManager: boolean = false,
  ): Promise<ProductResponse[]> {
    const skip = calculateSkip(page, limit);
    const items = await this.productRepository.findBundles(skip, limit);
    return items.map((doc) =>
      ProductMapper.toResponse(doc, callerIsAdminOrManager),
    );
  }

  async getSummary(): Promise<ProductSummaryResult> {
    return this.productRepository.getSummary();
  }

  async findBySku(
    sku: string,
    callerIsAdminOrManager: boolean,
  ): Promise<ProductResponse> {
    const product = await this.productRepository.findBySku(sku);
    if (!product) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Product with SKU '${sku}' not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return ProductMapper.toResponse(product, callerIsAdminOrManager);
  }

  async findById(
    id: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<ProductResponse> {
    const product = await this.productRepository.findById(id);
    if (!product) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return ProductMapper.toResponse(product, callerIsAdminOrManager);
  }

  async getPriceHistory(
    id: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<PriceHistoryResponseItem[]> {
    const product = await this.productRepository.findById(id);
    if (!product) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const history = (await this.productRepository.getPriceHistory(id)) || [];
    return ProductMapper.toPriceHistoryResponse(
      history,
      callerIsAdminOrManager,
    );
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateProductDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<ProductResponse> {
    const product = await this.productRepository.findById(id);
    if (!product) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found',
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

    if (dto.categoryId !== undefined) {
      const catId = new Types.ObjectId(dto.categoryId);
      const category = await this.categoryRepository.findById(catId);
      if (!category || !category.isActive) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Category not found or is inactive',
          HttpStatus.NOT_FOUND,
        );
      }
      updateFields.categoryId = catId;
    }

    if (dto.unit !== undefined) {
      updateFields.unit = dto.unit.trim().toUpperCase();
    }

    if (dto.hsnSacCode !== undefined) {
      updateFields.hsnSacCode = dto.hsnSacCode?.trim().toUpperCase() || null;
    }

    if (dto.estimatedDeliveryHours !== undefined) {
      updateFields.estimatedDeliveryHours = dto.estimatedDeliveryHours;
    }

    if (dto.requiredSkillRole !== undefined) {
      updateFields.requiredSkillRole = dto.requiredSkillRole?.trim() || null;
    }

    if (dto.tags !== undefined) {
      updateFields.tags = dto.tags;
    }

    const updated = await this.productRepository.updateById(id, updateFields);
    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found after update',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_UPDATED,
      targetId: id,
      targetModel: AuditTargetModel.PRODUCT,
      details: updateFields,
      ipAddress: null,
      userAgent: null,
    });

    return ProductMapper.toResponse(updated, callerIsAdminOrManager);
  }

  async updatePricing(
    id: Types.ObjectId,
    dto: UpdateProductPricingDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<ProductResponse> {
    const product = await this.productRepository.findByIdWithHistory(id);
    if (!product) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const newUnitPrice = roundCurrency(dto.unitPrice);
    const newCostPrice =
      dto.costPrice !== undefined
        ? roundCurrency(dto.costPrice)
        : product.costPrice;
    const newFloorPrice =
      dto.floorPrice !== undefined
        ? roundCurrency(dto.floorPrice)
        : product.floorPrice;

    // Enforce floorPrice <= unitPrice
    if (newFloorPrice > newUnitPrice) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `floorPrice (${newFloorPrice}) cannot exceed unitPrice (${newUnitPrice})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Enforce repMaxDiscountPercent <= managerMaxDiscountPercent
    const newRep =
      dto.repMaxDiscountPercent !== undefined
        ? dto.repMaxDiscountPercent
        : product.repMaxDiscountPercent;
    const newMgr =
      dto.managerMaxDiscountPercent !== undefined
        ? dto.managerMaxDiscountPercent
        : product.managerMaxDiscountPercent;

    if (newRep > newMgr) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `repMaxDiscountPercent (${newRep}%) cannot exceed managerMaxDiscountPercent (${newMgr}%)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate pricing tiers if provided
    let newPricingTiers = product.pricingTiers;
    if (dto.pricingTiers !== undefined) {
      newPricingTiers = this.priceCalculatorService.validateAndSortPricingTiers(
        dto.pricingTiers.map((t) => ({
          minQuantity: t.minQuantity,
          maxQuantity: t.maxQuantity ?? null,
          unitPrice: roundCurrency(t.unitPrice),
        })),
      );
    }

    const updateFields: Record<string, unknown> = {
      unitPrice: newUnitPrice,
      costPrice: newCostPrice,
      floorPrice: newFloorPrice,
      repMaxDiscountPercent: newRep,
      managerMaxDiscountPercent: newMgr,
      pricingTiers: newPricingTiers,
      updatedBy: actorId,
    };

    if (dto.taxRate !== undefined) {
      updateFields.taxRate = dto.taxRate;
    }

    if (dto.isTaxInclusive !== undefined) {
      updateFields.isTaxInclusive = dto.isTaxInclusive;
    }

    const historyEntry: PriceHistoryEntry = {
      oldUnitPrice: product.unitPrice,
      newUnitPrice,
      oldCostPrice: product.costPrice,
      newCostPrice,
      reason: dto.reason.trim(),
      changedBy: actorId,
      changedAt: new Date(),
    };

    const updated = await this.productRepository.updatePricing(
      id,
      updateFields,
      historyEntry,
    );

    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found after pricing update',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_PRICE_UPDATED,
      targetId: id,
      targetModel: AuditTargetModel.PRODUCT,
      details: {
        oldUnitPrice: product.unitPrice,
        newUnitPrice,
        reason: dto.reason,
      },
      ipAddress: null,
      userAgent: null,
    });

    return ProductMapper.toResponse(updated, callerIsAdminOrManager);
  }

  async updateBundleItems(
    id: Types.ObjectId,
    dto: UpdateBundleItemsDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<ProductResponse> {
    const product = await this.productRepository.findById(id);
    if (!product) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (product.type !== ProductType.BUNDLE) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Only products of type BUNDLE can have bundle child items configured',
        HttpStatus.BAD_REQUEST,
      );
    }

    const validatedItems = await this.validateBundleItems(id, dto.bundleItems);

    const updated = await this.productRepository.updateById(id, {
      bundleItems: validatedItems,
      updatedBy: actorId,
    });

    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found after bundle update',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_UPDATED,
      targetId: id,
      targetModel: AuditTargetModel.PRODUCT,
      details: { bundleItemsCount: validatedItems.length },
      ipAddress: null,
      userAgent: null,
    });

    return ProductMapper.toResponse(updated, callerIsAdminOrManager);
  }

  async toggleStatus(
    id: Types.ObjectId,
    dto: ToggleProductStatusDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<ProductResponse> {
    const product = await this.productRepository.findById(id);
    if (!product) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.productRepository.updateById(id, {
      isActive: dto.isActive,
      updatedBy: actorId,
    });

    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found after status change',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_STATUS_CHANGED,
      targetId: id,
      targetModel: AuditTargetModel.PRODUCT,
      details: { isActive: dto.isActive },
      ipAddress: null,
      userAgent: null,
    });

    return ProductMapper.toResponse(updated, callerIsAdminOrManager);
  }

  async bulkUpdateStatus(
    dto: BulkUpdateProductStatusDto,
    actorId: Types.ObjectId,
  ): Promise<{ modifiedCount: number }> {
    const objectIds = dto.productIds.map((id) => new Types.ObjectId(id));
    const result = await this.productRepository.bulkUpdateStatus(
      objectIds,
      dto.isActive,
      actorId,
    );

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_STATUS_CHANGED,
      targetId: null,
      targetModel: AuditTargetModel.PRODUCT,
      details: {
        productIds: dto.productIds,
        isActive: dto.isActive,
        modifiedCount: result.modifiedCount,
      },
      ipAddress: null,
      userAgent: null,
    });

    return result;
  }

  async delete(id: Types.ObjectId, actorId: Types.ObjectId): Promise<void> {
    const product = await this.productRepository.findById(id);
    if (!product) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Product not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Guard rule: check if product is an active component in any bundles
    const bundleRefCount =
      await this.productRepository.countActiveBundleReferences(id);
    if (bundleRefCount > 0) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Cannot delete product: It is referenced as an active component in ${bundleRefCount} bundle(s)`,
        HttpStatus.CONFLICT,
      );
    }

    await this.productRepository.updateById(id, {
      deletedAt: new Date(),
      deletedBy: actorId,
      isActive: false,
    });

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.PRODUCT_DELETED,
      targetId: id,
      targetModel: AuditTargetModel.PRODUCT,
      details: { name: product.name, sku: product.sku },
      ipAddress: null,
      userAgent: null,
    });
  }

  async calculatePrice(
    dto: CalculateQuotePriceDto,
    callerIsAdminOrManager: boolean,
  ): Promise<QuoteCalculationSummary> {
    const productIds = dto.lineItems.map(
      (item) => new Types.ObjectId(item.productId),
    );
    const activeProducts =
      await this.productRepository.findActiveByIds(productIds);

    const productMap = new Map<string, ProductLean>();
    for (const prod of activeProducts) {
      productMap.set(prod._id.toString(), prod);
    }

    // Verify all products were found and are active
    for (const item of dto.lineItems) {
      if (!productMap.has(item.productId)) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Product with ID '${item.productId}' was not found or is inactive/deleted`,
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const itemsForCalculation = dto.lineItems.map((item) => ({
      product: productMap.get(item.productId)!,
      quantity: item.quantity,
      requestedDiscountPercent: item.requestedDiscountPercent || 0,
    }));

    return this.priceCalculatorService.calculateQuote(
      itemsForCalculation,
      dto.sellerState,
      dto.buyerState,
      callerIsAdminOrManager,
    );
  }
}
