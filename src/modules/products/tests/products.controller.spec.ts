/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthenticatedRequest } from '../../auth/types/auth-request.type';
import { BillingCycle } from '../constants/billing-cycle.constant';
import { PricingType } from '../constants/pricing-type.constant';
import { ProductType } from '../constants/product-type.constant';
import { ProductsController } from '../products.controller';
import { ProductCategoriesService } from '../services/product-categories.service';
import { ProductsService } from '../services/products.service';

describe('ProductsController', () => {
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

  describe('Part A: Product Categories (5 APIs)', () => {
    it('1. POST /products/categories (createCategory)', async () => {
      categoriesService.create.mockResolvedValue({
        id: categoryId.toString(),
        name: 'SaaS',
        code: 'SAAS',
        isActive: true,
      });

      const result = await controller.createCategory(
        { name: 'SaaS', code: 'SAAS' },
        mockReq,
      );

      expect(categoriesService.create).toHaveBeenCalledWith(
        { name: 'SaaS', code: 'SAAS' },
        actorId,
      );
      expect(result.id).toBe(categoryId.toString());
    });

    it('2. GET /products/categories (listCategories)', async () => {
      categoriesService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });

      await controller.listCategories({ page: 1, limit: 10 });
      expect(categoriesService.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
    });

    it('3. GET /products/categories/:id (getCategoryById)', async () => {
      categoriesService.findById.mockResolvedValue({
        id: categoryId.toString(),
        name: 'SaaS',
        code: 'SAAS',
        isActive: true,
        productCount: 4,
      });

      const result = await controller.getCategoryById(categoryId.toString());
      expect(categoriesService.findById).toHaveBeenCalledWith(categoryId);
      expect(result.productCount).toBe(4);
    });

    it('4. PATCH /products/categories/:id (updateCategory)', async () => {
      categoriesService.update.mockResolvedValue({
        id: categoryId.toString(),
        name: 'Updated SaaS',
        code: 'SAAS',
        isActive: true,
      });

      const result = await controller.updateCategory(
        categoryId.toString(),
        { name: 'Updated SaaS' },
        mockReq,
      );
      expect(categoriesService.update).toHaveBeenCalledWith(
        categoryId,
        { name: 'Updated SaaS' },
        actorId,
      );
      expect(result.name).toBe('Updated SaaS');
    });

    it('5. DELETE /products/categories/:id (deleteCategory)', async () => {
      categoriesService.delete.mockResolvedValue(undefined);
      await controller.deleteCategory(categoryId.toString(), mockReq);
      expect(categoriesService.delete).toHaveBeenCalledWith(
        categoryId,
        actorId,
      );
    });
  });

  describe('Part B: Static Product Endpoints & Collections (8 APIs)', () => {
    it('6. POST /products (createProduct)', async () => {
      productsService.create.mockResolvedValue({
        id: productId.toString(),
        name: 'CRM',
        sku: 'PRD-SAAS-101A',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 1000,
        currency: 'INR',
        pricingType: PricingType.RECURRING,
        billingCycle: BillingCycle.MONTHLY,
        unit: 'USER',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const result = await controller.createProduct(
        {
          name: 'CRM',
          type: ProductType.PRODUCT,
          categoryId: categoryId.toString(),
          unitPrice: 1000,
        },
        mockReq,
      );
      expect(productsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'CRM' }),
        actorId,
        true,
      );
      expect(result.id).toBe(productId.toString());
    });

    it('7. GET /products (listProducts)', async () => {
      productsService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });

      await controller.listProducts({ page: 1, limit: 20 }, mockReq);
      expect(productsService.findAll).toHaveBeenCalledWith(
        { page: 1, limit: 20 },
        true,
      );
    });

    it('8. GET /products/active (listActiveCatalog)', async () => {
      productsService.findActiveCatalog.mockResolvedValue([]);
      await controller.listActiveCatalog({}, mockReq);
      expect(productsService.findActiveCatalog).toHaveBeenCalledWith({}, true);
    });

    it('9. GET /products/bundles (listBundles)', async () => {
      productsService.findBundles.mockResolvedValue([]);
      await controller.listBundles({ page: 1, limit: 10 }, mockReq);
      expect(productsService.findBundles).toHaveBeenCalledWith(1, 10, true);
    });

    it('10. GET /products/summary (getCatalogSummary)', async () => {
      productsService.getSummary.mockResolvedValue({
        totalProducts: 10,
        activeCount: 8,
        inactiveCount: 2,
        byType: { product: 5, service: 3, bundle: 2 },
        byBillingCycle: { oneOff: 2, monthly: 5, quarterly: 2, annually: 1 },
        averageGrossMarginPercent: 62.5,
      });

      const result = await controller.getCatalogSummary();
      expect(result.totalProducts).toBe(10);
      expect(result.averageGrossMarginPercent).toBe(62.5);
    });

    it('11. GET /products/sku/:sku (getProductBySku)', async () => {
      productsService.findBySku.mockResolvedValue({
        id: productId.toString(),
        name: 'CRM',
        sku: 'PRD-SAAS-101A',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 1000,
        currency: 'INR',
        pricingType: PricingType.RECURRING,
        billingCycle: BillingCycle.MONTHLY,
        unit: 'USER',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const result = await controller.getProductBySku('PRD-SAAS-101A', mockReq);
      expect(productsService.findBySku).toHaveBeenCalledWith(
        'PRD-SAAS-101A',
        true,
      );
      expect(result.sku).toBe('PRD-SAAS-101A');
    });

    it('12. POST /products/calculate-price (calculateQuotePrice - CPQ)', async () => {
      productsService.calculatePrice.mockResolvedValue({
        lineItems: [],
        totalBaseAmount: 1000,
        totalDiscountAmount: 100,
        totalTaxableAmount: 900,
        totalCgstAmount: 81,
        totalSgstAmount: 81,
        totalIgstAmount: 0,
        totalTaxAmount: 162,
        grandTotal: 1062,
        totalMrr: 900,
        totalArr: 10800,
        requiresManagerApproval: false,
        hasRejections: false,
      });

      const result = await controller.calculateQuotePrice(
        {
          lineItems: [{ productId: productId.toString(), quantity: 1 }],
          sellerState: 'MH',
          buyerState: 'MH',
        },
        mockReq,
      );

      expect(productsService.calculatePrice).toHaveBeenCalledWith(
        expect.objectContaining({ sellerState: 'MH' }),
        true,
      );
      expect(result.grandTotal).toBe(1062);
    });

    it('13. POST /products/bulk-status (bulkUpdateStatus)', async () => {
      productsService.bulkUpdateStatus.mockResolvedValue({ modifiedCount: 3 });

      const result = await controller.bulkUpdateStatus(
        { productIds: [productId.toString()], isActive: false },
        mockReq,
      );
      expect(productsService.bulkUpdateStatus).toHaveBeenCalledWith(
        { productIds: [productId.toString()], isActive: false },
        actorId,
      );
      expect(result.modifiedCount).toBe(3);
    });
  });

  describe('Part C: Dynamic Parameter Routes (7 APIs)', () => {
    it('14. GET /products/:id (getProductById)', async () => {
      productsService.findById.mockResolvedValue({
        id: productId.toString(),
        name: 'CRM',
        sku: 'PRD-SAAS-101A',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 1000,
        currency: 'INR',
        pricingType: PricingType.RECURRING,
        billingCycle: BillingCycle.MONTHLY,
        unit: 'USER',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const result = await controller.getProductById(
        productId.toString(),
        mockReq,
      );
      expect(productsService.findById).toHaveBeenCalledWith(productId, true);
      expect(result.id).toBe(productId.toString());
    });

    it('15. GET /products/:id/price-history (getPriceHistory)', async () => {
      productsService.getPriceHistory.mockResolvedValue([]);
      await controller.getPriceHistory(productId.toString(), mockReq);
      expect(productsService.getPriceHistory).toHaveBeenCalledWith(
        productId,
        true,
      );
    });

    it('16. PATCH /products/:id (updateProduct)', async () => {
      productsService.update.mockResolvedValue({
        id: productId.toString(),
        name: 'Updated CRM',
        sku: 'PRD-SAAS-101A',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 1000,
        currency: 'INR',
        pricingType: PricingType.RECURRING,
        billingCycle: BillingCycle.MONTHLY,
        unit: 'USER',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const result = await controller.updateProduct(
        productId.toString(),
        { name: 'Updated CRM' },
        mockReq,
      );
      expect(productsService.update).toHaveBeenCalledWith(
        productId,
        { name: 'Updated CRM' },
        actorId,
        true,
      );
      expect(result.name).toBe('Updated CRM');
    });

    it('17. PATCH /products/:id/pricing (updateProductPricing)', async () => {
      productsService.updatePricing.mockResolvedValue({
        id: productId.toString(),
        name: 'CRM',
        sku: 'PRD-SAAS-101A',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 1500,
        currency: 'INR',
        pricingType: PricingType.RECURRING,
        billingCycle: BillingCycle.MONTHLY,
        unit: 'USER',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const result = await controller.updateProductPricing(
        productId.toString(),
        { unitPrice: 1500, reason: 'Annual review' },
        mockReq,
      );
      expect(productsService.updatePricing).toHaveBeenCalledWith(
        productId,
        { unitPrice: 1500, reason: 'Annual review' },
        actorId,
        true,
      );
      expect(result.unitPrice).toBe(1500);
    });

    it('18. PATCH /products/:id/bundle-items (updateBundleItems)', async () => {
      productsService.updateBundleItems.mockResolvedValue({
        id: productId.toString(),
        name: 'CRM Bundle',
        sku: 'BDL-CRM-01',
        type: ProductType.BUNDLE,
        categoryId: categoryId.toString(),
        isActive: true,
        unitPrice: 3000,
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

      await controller.updateBundleItems(
        productId.toString(),
        {
          bundleItems: [
            { productId: new Types.ObjectId().toString(), quantity: 1 },
          ],
        },
        mockReq,
      );
      expect(productsService.updateBundleItems).toHaveBeenCalledWith(
        productId,
        expect.objectContaining({ bundleItems: expect.any(Array) }),
        actorId,
        true,
      );
    });

    it('19. PATCH /products/:id/status (toggleProductStatus)', async () => {
      productsService.toggleStatus.mockResolvedValue({
        id: productId.toString(),
        name: 'CRM',
        sku: 'PRD-SAAS-101A',
        type: ProductType.PRODUCT,
        categoryId: categoryId.toString(),
        isActive: false,
        unitPrice: 1000,
        currency: 'INR',
        pricingType: PricingType.RECURRING,
        billingCycle: BillingCycle.MONTHLY,
        unit: 'USER',
        pricingTiers: [],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        tags: [],
      });

      const result = await controller.toggleProductStatus(
        productId.toString(),
        { isActive: false },
        mockReq,
      );
      expect(productsService.toggleStatus).toHaveBeenCalledWith(
        productId,
        { isActive: false },
        actorId,
        true,
      );
      expect(result.isActive).toBe(false);
    });

    it('20. DELETE /products/:id (deleteProduct)', async () => {
      productsService.delete.mockResolvedValue(undefined);
      await controller.deleteProduct(productId.toString(), mockReq);
      expect(productsService.delete).toHaveBeenCalledWith(productId, actorId);
    });
  });
});
