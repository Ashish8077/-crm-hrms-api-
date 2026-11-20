/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { RoleRepository } from '../../roles/repositories/role.repository';
import { BillingCycle } from '../constants/billing-cycle.constant';
import { PricingType } from '../constants/pricing-type.constant';
import { ProductType } from '../constants/product-type.constant';
import { ProductCategoryRepository } from '../repositories/product-category.repository';
import { ProductRepository } from '../repositories/product.repository';
import { ProductLean } from '../schemas/product.schema';
import { PriceCalculatorService } from '../services/price-calculator.service';
import { ProductsService } from '../services/products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepository: jest.Mocked<ProductRepository>;
  let categoryRepository: jest.Mocked<ProductCategoryRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const actorId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();
  const productId = new Types.ObjectId();

  const mockCategory = {
    _id: categoryId,
    name: 'SaaS',
    code: 'SAAS',
    isActive: true,
  };

  const mockProductLean: ProductLean = {
    _id: productId,
    name: 'CRM License',
    sku: 'PRD-SAAS-101A',
    type: ProductType.PRODUCT,
    categoryId,
    description: 'Enterprise CRM user license',
    isActive: true,
    unitPrice: 1200,
    costPrice: 400,
    floorPrice: 800,
    currency: 'INR',
    pricingType: PricingType.RECURRING,
    billingCycle: BillingCycle.ANNUALLY,
    unit: 'USER',
    pricingTiers: [],
    repMaxDiscountPercent: 10,
    managerMaxDiscountPercent: 25,
    hsnSacCode: '997331',
    taxRate: 18,
    isTaxInclusive: false,
    bundleItems: [],
    priceHistory: [
      {
        oldUnitPrice: 1200,
        newUnitPrice: 1200,
        oldCostPrice: 400,
        newCostPrice: 400,
        reason: 'Initial product creation',
        changedBy: actorId,
        changedAt: new Date(),
      },
    ],
    tags: ['crm', 'saas'],
    createdBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockProductRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdWithHistory: jest.fn(),
      findBySku: jest.fn(),
      findActiveByIds: jest.fn(),
      findActiveCatalog: jest.fn(),
      findBundles: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn(),
      countActiveByCategoryId: jest.fn(),
      countActiveBundleReferences: jest.fn(),
      updateById: jest.fn(),
      updatePricing: jest.fn(),
      bulkUpdateStatus: jest.fn(),
      getPriceHistory: jest.fn(),
      getSummary: jest.fn(),
    };

    const mockCategoryRepo = {
      findById: jest.fn(),
    };

    const mockRoleRepo = {
      findActiveByIds: jest.fn(),
    };

    const mockAuditService = {
      createAuditLog: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        PriceCalculatorService,
        { provide: ProductRepository, useValue: mockProductRepo },
        { provide: ProductCategoryRepository, useValue: mockCategoryRepo },
        { provide: RoleRepository, useValue: mockRoleRepo },
        { provide: AuditLogsService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    productRepository = module.get(ProductRepository);
    categoryRepository = module.get(ProductCategoryRepository);
    auditLogsService = module.get(AuditLogsService);
  });

  describe('create', () => {
    it('should create product with auto-generated collision-proof SKU', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategory as never);
      productRepository.findBySku.mockResolvedValue(null);
      productRepository.create.mockResolvedValue(mockProductLean);
      productRepository.findById.mockResolvedValue(mockProductLean);

      const result = await service.create(
        {
          name: 'CRM License',
          type: ProductType.PRODUCT,
          categoryId: categoryId.toString(),
          unitPrice: 1200,
          costPrice: 400,
          floorPrice: 800,
        },
        actorId,
        true,
      );

      expect(result.id).toBe(productId.toString());
      expect(result.costPrice).toBe(400); // Admin caller sees costPrice
      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: expect.stringMatching(/^PRD-SAAS-[A-Z0-9]+$/),
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should reject if floorPrice exceeds unitPrice with 400 Bad Request', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategory as never);

      await expect(
        service.create(
          {
            name: 'Invalid Price',
            type: ProductType.PRODUCT,
            categoryId: categoryId.toString(),
            unitPrice: 500,
            floorPrice: 600, // floor > unit
          },
          actorId,
          true,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should reject if repMaxDiscountPercent exceeds managerMaxDiscountPercent with 400 Bad Request', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategory as never);

      await expect(
        service.create(
          {
            name: 'Invalid Discount',
            type: ProductType.PRODUCT,
            categoryId: categoryId.toString(),
            unitPrice: 1000,
            repMaxDiscountPercent: 30,
            managerMaxDiscountPercent: 20,
          },
          actorId,
          true,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should reject duplicate manual SKU with 409 Conflict', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategory as never);
      productRepository.findBySku.mockResolvedValue(mockProductLean);

      await expect(
        service.create(
          {
            name: 'Duplicate SKU',
            sku: 'PRD-SAAS-101A',
            type: ProductType.PRODUCT,
            categoryId: categoryId.toString(),
            unitPrice: 1000,
          },
          actorId,
          true,
        ),
      ).rejects.toThrow(AppError);

      try {
        await service.create(
          {
            name: 'Duplicate SKU',
            sku: 'PRD-SAAS-101A',
            type: ProductType.PRODUCT,
            categoryId: categoryId.toString(),
            unitPrice: 1000,
          },
          actorId,
          true,
        );
      } catch (err) {
        expect((err as AppError).statusCode).toBe(HttpStatus.CONFLICT);
      }
    });

    it('should mask costPrice, floorPrice, and grossMarginPercent for Sales Reps', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategory as never);
      productRepository.findBySku.mockResolvedValue(null);
      productRepository.create.mockResolvedValue(mockProductLean);
      productRepository.findById.mockResolvedValue(mockProductLean);

      const result = await service.create(
        {
          name: 'CRM License',
          type: ProductType.PRODUCT,
          categoryId: categoryId.toString(),
          unitPrice: 1200,
          costPrice: 400,
          floorPrice: 800,
        },
        actorId,
        false, // Sales Rep caller
      );

      expect(result.costPrice).toBeUndefined();
      expect(result.floorPrice).toBeUndefined();
      expect(result.grossMarginPercent).toBeUndefined();
    });
  });

  describe('updatePricing', () => {
    it('should append to priceHistory and enforce floorPrice <= unitPrice', async () => {
      productRepository.findByIdWithHistory.mockResolvedValue(mockProductLean);
      const updatedProduct = {
        ...mockProductLean,
        unitPrice: 1500,
        priceHistory: [
          ...mockProductLean.priceHistory,
          {
            oldUnitPrice: 1200,
            newUnitPrice: 1500,
            oldCostPrice: 400,
            newCostPrice: 400,
            reason: 'Annual increase',
            changedBy: actorId,
            changedAt: new Date(),
          },
        ],
      };
      productRepository.updatePricing.mockResolvedValue(updatedProduct);

      const result = await service.updatePricing(
        productId,
        {
          unitPrice: 1500,
          reason: 'Annual increase',
        },
        actorId,
        true,
      );

      expect(result.unitPrice).toBe(1500);
      expect(productRepository.updatePricing).toHaveBeenCalledWith(
        productId,
        expect.objectContaining({ unitPrice: 1500 }),
        expect.objectContaining({
          oldUnitPrice: 1200,
          newUnitPrice: 1500,
          reason: 'Annual increase',
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should reject pricing update if floorPrice exceeds unitPrice', async () => {
      productRepository.findByIdWithHistory.mockResolvedValue(mockProductLean);

      await expect(
        service.updatePricing(
          productId,
          {
            unitPrice: 700, // unitPrice below existing floorPrice 800
            reason: 'Price drop',
          },
          actorId,
          true,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('Bundle Management & Max Depth = 1 Enforcement', () => {
    it('should reject nested bundles (Max Depth = 1)', async () => {
      const bundleComponentId = new Types.ObjectId();
      const existingBundle = {
        ...mockProductLean,
        type: ProductType.BUNDLE,
      };
      productRepository.findById.mockResolvedValue(existingBundle);

      // Component is also a bundle!
      const nestedBundleComponent: ProductLean = {
        _id: bundleComponentId,
        name: 'Nested Bundle',
        sku: 'BDL-SUB-01',
        type: ProductType.BUNDLE,
        categoryId,
        isActive: true,
        unitPrice: 2000,
        costPrice: 800,
        floorPrice: 1500,
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
        priceHistory: [],
        tags: [],
        createdBy: actorId,
      };

      productRepository.findActiveByIds.mockResolvedValue([
        nestedBundleComponent,
      ]);

      await expect(
        service.updateBundleItems(
          productId,
          {
            bundleItems: [
              {
                productId: bundleComponentId.toString(),
                quantity: 1,
              },
            ],
          },
          actorId,
          true,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should reject self-referencing in bundle', async () => {
      const existingBundle = {
        ...mockProductLean,
        type: ProductType.BUNDLE,
      };
      productRepository.findById.mockResolvedValue(existingBundle);

      await expect(
        service.updateBundleItems(
          productId,
          {
            bundleItems: [
              {
                productId: productId.toString(), // Self!
                quantity: 1,
              },
            ],
          },
          actorId,
          true,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('delete', () => {
    it('should reject delete with 409 Conflict if product is an active component in any bundles', async () => {
      productRepository.findById.mockResolvedValue(mockProductLean);
      productRepository.countActiveBundleReferences.mockResolvedValue(2);

      await expect(service.delete(productId, actorId)).rejects.toThrow(
        AppError,
      );

      try {
        await service.delete(productId, actorId);
      } catch (err) {
        expect((err as AppError).statusCode).toBe(HttpStatus.CONFLICT);
      }
    });

    it('should soft delete product when not referenced in bundles', async () => {
      productRepository.findById.mockResolvedValue(mockProductLean);
      productRepository.countActiveBundleReferences.mockResolvedValue(0);
      productRepository.updateById.mockResolvedValue(mockProductLean);

      await service.delete(productId, actorId);

      expect(productRepository.updateById).toHaveBeenCalledWith(
        productId,
        expect.objectContaining({
          isActive: false,
          deletedBy: actorId,
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('bulkUpdateStatus', () => {
    it('should atomically update active status for up to 50 products', async () => {
      const ids = [
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
      ];
      productRepository.bulkUpdateStatus.mockResolvedValue({
        modifiedCount: 2,
      });

      const result = await service.bulkUpdateStatus(
        { productIds: ids, isActive: false },
        actorId,
      );

      expect(result.modifiedCount).toBe(2);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });
});
