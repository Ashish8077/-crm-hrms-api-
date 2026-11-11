/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../../auth/types/auth-request.type';
import { BillingCycle } from '../constants/billing-cycle.constant';
import { PricingType } from '../constants/pricing-type.constant';
import { ProductType } from '../constants/product-type.constant';
import { BulkUpdateProductStatusDto } from '../dto/bulk-update-product-status.dto';
import { CalculateQuotePriceDto } from '../dto/calculate-quote-price.dto';
import { CreateProductCategoryDto } from '../dto/create-product-category.dto';
import { CreateProductDto } from '../dto/create-product.dto';
import { ListProductCategoriesQueryDto } from '../dto/list-product-categories-query.dto';
import { ListProductsQueryDto } from '../dto/list-products-query.dto';
import { ToggleProductStatusDto } from '../dto/toggle-product-status.dto';
import { UpdateBundleItemsDto } from '../dto/update-bundle-items.dto';
import { UpdateProductCategoryDto } from '../dto/update-product-category.dto';
import { UpdateProductPricingDto } from '../dto/update-product-pricing.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductsController } from '../products.controller';
import { ProductCategoriesService } from '../services/product-categories.service';
import { ProductsService } from '../services/products.service';

describe('Products & Services - Complete Swagger API & Controller Contracts Test Suite', () => {
  let controller: ProductsController;
  let productsService: jest.Mocked<ProductsService>;
  let categoriesService: jest.Mocked<ProductCategoriesService>;

  const actorId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();
  const productId = new Types.ObjectId();

  const mockReq = {
    user: {
      userId: actorId,
      sessionId: new Types.ObjectId(),
      roleIds: [new Types.ObjectId()],
    },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    const mockProductsService = {
      isUserAdminOrManager: jest.fn().mockResolvedValue(true),
      create: jest.fn(),
      findAll: jest.fn(),
      findActiveCatalog: jest.fn(),
      findBundles: jest.fn(),
      getSummary: jest.fn(),
      findBySku: jest.fn(),
      findById: jest.fn(),
      getPriceHistory: jest.fn(),
      update: jest.fn(),
      updatePricing: jest.fn(),
      updateBundleItems: jest.fn(),
      toggleStatus: jest.fn(),
      bulkUpdateStatus: jest.fn(),
      delete: jest.fn(),
      calculatePrice: jest.fn(),
    };

    const mockCategoriesService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: mockProductsService },
        {
          provide: ProductCategoriesService,
          useValue: mockCategoriesService,
        },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    productsService = module.get(ProductsService);
    categoriesService = module.get(ProductCategoriesService);
  });

  describe('Contract Verification for All 20 Endpoints', () => {
    it('01. POST /products/categories - Contract', async () => {
      const dto: CreateProductCategoryDto = {
        name: 'Hardware',
        code: 'HW',
        description: 'Physical equipment and servers',
      };
      categoriesService.create.mockResolvedValue({
        id: categoryId.toString(),
        name: 'Hardware',
        code: 'HW',
        isActive: true,
      });

      const res = await controller.createCategory(dto, mockReq);
      expect(res.code).toBe('HW');
    });

    it('02. GET /products/categories - Contract', async () => {
      const query: ListProductCategoriesQueryDto = { page: 1, limit: 10 };
      categoriesService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });

      const res = await controller.listCategories(query);
      expect(res).toBeDefined();
    });

    it('03. GET /products/categories/:id - Contract', async () => {
      categoriesService.findById.mockResolvedValue({
        id: categoryId.toString(),
        name: 'Hardware',
        code: 'HW',
        isActive: true,
        productCount: 2,
      });

      const res = await controller.getCategoryById(categoryId.toString());
      expect(res.productCount).toBe(2);
    });

    it('04. PATCH /products/categories/:id - Contract', async () => {
      const dto: UpdateProductCategoryDto = { description: 'Updated' };
      categoriesService.update.mockResolvedValue({
        id: categoryId.toString(),
        name: 'Hardware',
        code: 'HW',
        isActive: true,
      });

      const res = await controller.updateCategory(
        categoryId.toString(),
        dto,
        mockReq,
      );
      expect(res.id).toBe(categoryId.toString());
    });

    it('05. DELETE /products/categories/:id - Contract', async () => {
      categoriesService.delete.mockResolvedValue(undefined);
      await controller.deleteCategory(categoryId.toString(), mockReq);
      expect(categoriesService.delete).toHaveBeenCalledWith(
        categoryId,
        actorId,
      );
    });

    it('06. POST /products - Contract', async () => {
      const dto: CreateProductDto = {
        name: 'Dedicated Cloud Server',
        sku: 'SRV-HW-101A',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        unitPrice: 5000,
        costPrice: 2000,
        floorPrice: 3500,
        currency: 'INR',
        pricingType: PricingType.RECURRING,
        billingCycle: BillingCycle.MONTHLY,
        unit: 'SERVER',
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        tags: ['server', 'cloud'],
      };

      productsService.create.mockResolvedValue({
        id: productId.toString(),
        name: dto.name,
        sku: dto.sku!,
        type: dto.type,
        categoryId: dto.categoryId,
        isActive: true,
        unitPrice: dto.unitPrice,
        currency: dto.currency!,
        pricingType: dto.pricingType!,
        billingCycle: dto.billingCycle!,
        unit: dto.unit!,
        pricingTiers: [],
        repMaxDiscountPercent: dto.repMaxDiscountPercent!,
        managerMaxDiscountPercent: dto.managerMaxDiscountPercent!,
        taxRate: dto.taxRate!,
        isTaxInclusive: dto.isTaxInclusive!,
        bundleItems: [],
        tags: dto.tags!,
      });

      const res = await controller.createProduct(dto, mockReq);
      expect(res.sku).toBe('SRV-HW-101A');
    });

    it('07. GET /products - Contract', async () => {
      const query: ListProductsQueryDto = {
        page: 1,
        limit: 20,
        type: ProductType.PRODUCT,
      };
      productsService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });

      const res = await controller.listProducts(query, mockReq);
      expect(res).toBeDefined();
    });

    it('08. GET /products/active - Contract', async () => {
      productsService.findActiveCatalog.mockResolvedValue([]);
      const res = await controller.listActiveCatalog({}, mockReq);
      expect(Array.isArray(res)).toBe(true);
    });

    it('09. GET /products/bundles - Contract', async () => {
      productsService.findBundles.mockResolvedValue([]);
      const res = await controller.listBundles({}, mockReq);
      expect(Array.isArray(res)).toBe(true);
    });

    it('10. GET /products/summary - Contract', async () => {
      productsService.getSummary.mockResolvedValue({
        totalProducts: 10,
        activeCount: 8,
        inactiveCount: 2,
        byType: { product: 5, service: 3, bundle: 2 },
        byBillingCycle: { oneOff: 2, monthly: 5, quarterly: 2, annually: 1 },
        averageGrossMarginPercent: 55,
      });

      const res = await controller.getCatalogSummary();
      expect(res.totalProducts).toBe(10);
    });

    it('11. GET /products/sku/:sku - Contract', async () => {
      productsService.findBySku.mockResolvedValue({
        id: productId.toString(),
        name: 'Item',
        sku: 'PRD-TEST-101',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 100,
        currency: 'INR',
        pricingType: PricingType.ONE_TIME,
        billingCycle: BillingCycle.ONE_OFF,
        unit: 'UNIT',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const res = await controller.getProductBySku('PRD-TEST-101', mockReq);
      expect(res.sku).toBe('PRD-TEST-101');
    });

    it('12. POST /products/calculate-price - Contract', async () => {
      const dto: CalculateQuotePriceDto = {
        lineItems: [{ productId: productId.toString(), quantity: 2 }],
        sellerState: 'MH',
        buyerState: 'KA',
      };

      productsService.calculatePrice.mockResolvedValue({
        lineItems: [],
        totalBaseAmount: 200,
        totalDiscountAmount: 0,
        totalTaxableAmount: 200,
        totalCgstAmount: 0,
        totalSgstAmount: 0,
        totalIgstAmount: 36,
        totalTaxAmount: 36,
        grandTotal: 236,
        totalMrr: 0,
        totalArr: 0,
        requiresManagerApproval: false,
        hasRejections: false,
      });

      const res = await controller.calculateQuotePrice(dto, mockReq);
      expect(res.grandTotal).toBe(236);
    });

    it('13. POST /products/bulk-status - Contract', async () => {
      const dto: BulkUpdateProductStatusDto = {
        productIds: [productId.toString()],
        isActive: true,
      };
      productsService.bulkUpdateStatus.mockResolvedValue({ modifiedCount: 1 });

      const res = await controller.bulkUpdateStatus(dto, mockReq);
      expect(res.modifiedCount).toBe(1);
    });

    it('14. GET /products/:id - Contract', async () => {
      productsService.findById.mockResolvedValue({
        id: productId.toString(),
        name: 'Item',
        sku: 'PRD-TEST-101',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 100,
        currency: 'INR',
        pricingType: PricingType.ONE_TIME,
        billingCycle: BillingCycle.ONE_OFF,
        unit: 'UNIT',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const res = await controller.getProductById(
        productId.toString(),
        mockReq,
      );
      expect(res.id).toBe(productId.toString());
    });

    it('15. GET /products/:id/price-history - Contract', async () => {
      productsService.getPriceHistory.mockResolvedValue([]);
      const res = await controller.getPriceHistory(
        productId.toString(),
        mockReq,
      );
      expect(Array.isArray(res)).toBe(true);
    });

    it('16. PATCH /products/:id - Contract', async () => {
      const dto: UpdateProductDto = { name: 'New Name' };
      productsService.update.mockResolvedValue({
        id: productId.toString(),
        name: 'New Name',
        sku: 'PRD-TEST-101',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 100,
        currency: 'INR',
        pricingType: PricingType.ONE_TIME,
        billingCycle: BillingCycle.ONE_OFF,
        unit: 'UNIT',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const res = await controller.updateProduct(
        productId.toString(),
        dto,
        mockReq,
      );
      expect(res.name).toBe('New Name');
    });

    it('17. PATCH /products/:id/pricing - Contract', async () => {
      const dto: UpdateProductPricingDto = {
        unitPrice: 1500,
        reason: 'Inflation adjustment',
      };
      productsService.updatePricing.mockResolvedValue({
        id: productId.toString(),
        name: 'Item',
        sku: 'PRD-TEST-101',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 1500,
        currency: 'INR',
        pricingType: PricingType.ONE_TIME,
        billingCycle: BillingCycle.ONE_OFF,
        unit: 'UNIT',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const res = await controller.updateProductPricing(
        productId.toString(),
        dto,
        mockReq,
      );
      expect(res.unitPrice).toBe(1500);
    });

    it('18. PATCH /products/:id/bundle-items - Contract', async () => {
      const dto: UpdateBundleItemsDto = {
        bundleItems: [
          { productId: new Types.ObjectId().toString(), quantity: 2 },
        ],
      };
      productsService.updateBundleItems.mockResolvedValue({
        id: productId.toString(),
        name: 'Bundle Item',
        sku: 'BDL-01',
        type: ProductType.BUNDLE,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 200,
        currency: 'INR',
        pricingType: PricingType.ONE_TIME,
        billingCycle: BillingCycle.ONE_OFF,
        unit: 'UNIT',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const res = await controller.updateBundleItems(
        productId.toString(),
        dto,
        mockReq,
      );
      expect(res.id).toBe(productId.toString());
    });

    it('19. PATCH /products/:id/status - Contract', async () => {
      const dto: ToggleProductStatusDto = { isActive: false };
      productsService.toggleStatus.mockResolvedValue({
        id: productId.toString(),
        name: 'Item',
        sku: 'PRD-TEST-101',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: false,
        unitPrice: 100,
        currency: 'INR',
        pricingType: PricingType.ONE_TIME,
        billingCycle: BillingCycle.ONE_OFF,
        unit: 'UNIT',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const res = await controller.toggleProductStatus(
        productId.toString(),
        dto,
        mockReq,
      );
      expect(res.isActive).toBe(false);
    });

    it('20. DELETE /products/:id - Contract', async () => {
      productsService.delete.mockResolvedValue(undefined);
      await controller.deleteProduct(productId.toString(), mockReq);
      expect(productsService.delete).toHaveBeenCalledWith(productId, actorId);
    });
  });
});
