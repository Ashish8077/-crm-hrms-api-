/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { ProductCategoryTreeResponse } from '../mappers/product-category.mapper';
import { ProductCategoryRepository } from '../repositories/product-category.repository';
import { ProductRepository } from '../repositories/product.repository';
import { ProductCategoryLean } from '../schemas/product-category.schema';
import { ProductCategoriesService } from '../services/product-categories.service';

describe('ProductCategoriesService', () => {
  let service: ProductCategoriesService;
  let categoryRepository: jest.Mocked<ProductCategoryRepository>;
  let productRepository: jest.Mocked<ProductRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const actorId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();
  const parentCategoryId = new Types.ObjectId();

  const mockCategoryLean: ProductCategoryLean = {
    _id: categoryId,
    name: 'Cloud Subscriptions',
    code: 'SAAS',
    description: 'SaaS licenses',
    parentCategoryId: null,
    isActive: true,
    createdBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockCategoryRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByCode: jest.fn(),
      findByName: jest.fn(),
      findActiveByIds: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn(),
      updateById: jest.fn(),
      findActiveTree: jest.fn(),
      findChildren: jest.fn(),
    };

    const mockProductRepo = {
      countActiveByCategoryId: jest.fn(),
    };

    const mockAuditService = {
      createAuditLog: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductCategoriesService,
        {
          provide: ProductCategoryRepository,
          useValue: mockCategoryRepo,
        },
        {
          provide: ProductRepository,
          useValue: mockProductRepo,
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = module.get<ProductCategoriesService>(ProductCategoriesService);
    categoryRepository = module.get(ProductCategoryRepository);
    productRepository = module.get(ProductRepository);
    auditLogsService = module.get(AuditLogsService);
  });

  describe('create', () => {
    it('should create a category with uppercase code and log audit', async () => {
      categoryRepository.findByCode.mockResolvedValue(null);
      categoryRepository.create.mockResolvedValue(mockCategoryLean);

      const result = await service.create(
        { name: 'Cloud Subscriptions', code: 'saas', description: 'desc' },
        actorId,
      );

      expect(categoryRepository.findByCode).toHaveBeenCalledWith('SAAS');
      expect(result.code).toBe('SAAS');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should reject duplicate category code with 409 Conflict', async () => {
      categoryRepository.findByCode.mockResolvedValue(mockCategoryLean);

      await expect(
        service.create({ name: 'Duplicate', code: 'SAAS' }, actorId),
      ).rejects.toThrow(AppError);

      try {
        await service.create({ name: 'Duplicate', code: 'SAAS' }, actorId);
      } catch (err) {
        expect((err as AppError).statusCode).toBe(HttpStatus.CONFLICT);
      }
    });

    it('should verify parent category exists when parentCategoryId is provided', async () => {
      categoryRepository.findByCode.mockResolvedValue(null);
      categoryRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          {
            name: 'Sub-cat',
            code: 'SUBSAAS',
            parentCategoryId: parentCategoryId.toString(),
          },
          actorId,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('findAll', () => {
    it('should return hierarchical tree when tree=true is queried', async () => {
      const parentCat: ProductCategoryLean = {
        _id: parentCategoryId,
        name: 'Software',
        code: 'SW',
        isActive: true,
        createdBy: actorId,
      };
      const childCat: ProductCategoryLean = {
        _id: categoryId,
        name: 'SaaS',
        code: 'SAAS',
        parentCategoryId,
        isActive: true,
        createdBy: actorId,
      };

      categoryRepository.findActiveTree.mockResolvedValue([
        parentCat,
        childCat,
      ]);

      const result = (await service.findAll({
        tree: true,
      })) as ProductCategoryTreeResponse[];
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1); // 1 root
      expect(result[0].id).toBe(parentCategoryId.toString());
      expect(result[0].children.length).toBe(1);
      expect(result[0].children[0].id).toBe(categoryId.toString());
    });

    it('should return paginated flat categories with product counts', async () => {
      categoryRepository.findAll.mockResolvedValue([mockCategoryLean]);
      categoryRepository.count.mockResolvedValue(1);
      productRepository.countActiveByCategoryId.mockResolvedValue(5);

      const result = (await service.findAll({
        page: 1,
        limit: 10,
      })) as {
        data: Array<{ productCount?: number }>;
        meta: { total: number };
      };

      expect(result.data.length).toBe(1);
      expect(result.data[0].productCount).toBe(5);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findById', () => {
    it('should return category with active product count', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategoryLean);
      productRepository.countActiveByCategoryId.mockResolvedValue(12);

      const result = await service.findById(categoryId);
      expect(result.id).toBe(categoryId.toString());
      expect(result.productCount).toBe(12);
    });

    it('should throw 404 if category not found', async () => {
      categoryRepository.findById.mockResolvedValue(null);
      await expect(service.findById(categoryId)).rejects.toThrow(AppError);
    });
  });

  describe('update', () => {
    it('should reject assigning category as its own parent with 400 Bad Request', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategoryLean);

      await expect(
        service.update(
          categoryId,
          { parentCategoryId: categoryId.toString() },
          actorId,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should detect circular parent references and throw 400 Bad Request', async () => {
      const childId = new Types.ObjectId();
      categoryRepository.findById
        .mockResolvedValueOnce(mockCategoryLean) // target
        .mockResolvedValueOnce({
          _id: childId,
          name: 'Child',
          code: 'CH',
          parentCategoryId: categoryId, // Child points to target!
          isActive: true,
          createdBy: actorId,
        })
        .mockResolvedValueOnce(mockCategoryLean);

      await expect(
        service.update(
          categoryId,
          { parentCategoryId: childId.toString() },
          actorId,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should update category fields successfully', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategoryLean);
      categoryRepository.updateById.mockResolvedValue({
        ...mockCategoryLean,
        name: 'Updated Name',
      });
      productRepository.countActiveByCategoryId.mockResolvedValue(3);

      const result = await service.update(
        categoryId,
        { name: 'Updated Name' },
        actorId,
      );
      expect(result.name).toBe('Updated Name');
    });
  });

  describe('delete', () => {
    it('should reject deletion with 409 Conflict if active products are linked', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategoryLean);
      productRepository.countActiveByCategoryId.mockResolvedValue(3);

      await expect(service.delete(categoryId, actorId)).rejects.toThrow(
        AppError,
      );

      try {
        await service.delete(categoryId, actorId);
      } catch (err) {
        expect((err as AppError).statusCode).toBe(HttpStatus.CONFLICT);
      }
    });

    it('should soft delete category when no active products are linked', async () => {
      categoryRepository.findById.mockResolvedValue(mockCategoryLean);
      productRepository.countActiveByCategoryId.mockResolvedValue(0);
      categoryRepository.updateById.mockResolvedValue(mockCategoryLean);

      await service.delete(categoryId, actorId);

      expect(categoryRepository.updateById).toHaveBeenCalledWith(
        categoryId,
        expect.objectContaining({
          isActive: false,
          deletedBy: actorId,
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });
});
