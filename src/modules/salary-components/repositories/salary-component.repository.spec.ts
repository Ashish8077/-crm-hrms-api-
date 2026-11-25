/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateSalaryComponentInput,
  SalaryComponentRepository,
  UpdateSalaryComponentInput,
} from './salary-component.repository';
import {
  SalaryComponent,
  SalaryComponentDocument,
  SalaryComponentLean,
} from '../schemas/salary-component.schema';
import {
  SalaryComponentCalculationType,
  SalaryComponentType,
} from '../constants/salary-component.constant';

describe('SalaryComponentRepository', () => {
  let repository: SalaryComponentRepository;
  let mockModel: jest.Mocked<Model<SalaryComponentDocument>>;

  const mockActorId = new Types.ObjectId();
  const mockComponentId = new Types.ObjectId();

  const mockLeanDoc: SalaryComponentLean = {
    _id: mockComponentId,
    name: 'Basic Salary',
    code: 'BASIC',
    type: SalaryComponentType.EARNING,
    calculationType: SalaryComponentCalculationType.FIXED,
    percentageOf: null,
    isTaxable: true,
    isStatutory: false,
    description: 'Basic component',
    isActive: true,
    createdBy: mockActorId,
    updatedBy: mockActorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const createQueryChain = (resolvedValue: unknown) => ({
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(resolvedValue),
    }),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(resolvedValue),
  });

  beforeEach(async () => {
    const mockModelConstructor = jest
      .fn()
      .mockImplementation((data: unknown) => ({
        ...(data as object),
        save: jest.fn().mockResolvedValue({
          toObject: () => ({ ...mockLeanDoc, ...(data as object) }),
        }),
      }));

    Object.assign(mockModelConstructor, {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryComponentRepository,
        {
          provide: getModelToken(SalaryComponent.name),
          useValue: mockModelConstructor,
        },
      ],
    }).compile();

    repository = module.get<SalaryComponentRepository>(
      SalaryComponentRepository,
    );
    mockModel = module.get(getModelToken(SalaryComponent.name));
  });

  describe('create', () => {
    it('creates and returns a lean salary component document', async () => {
      const input: CreateSalaryComponentInput = {
        name: 'Basic Salary',
        code: 'BASIC',
        type: SalaryComponentType.EARNING,
        calculationType: SalaryComponentCalculationType.FIXED,
        percentageOf: null,
        isTaxable: true,
        isStatutory: false,
        description: 'Basic component',
        isActive: true,
        createdBy: mockActorId,
        updatedBy: mockActorId,
      };

      const result = await repository.create(input);

      expect(result).toBeDefined();
      expect(result._id).toEqual(mockComponentId);
      expect(result.code).toBe('BASIC');
      expect(mockModel).toHaveBeenCalledWith(input);
    });
  });

  describe('findById', () => {
    it('finds by Types.ObjectId and returns lean document', async () => {
      const chain = createQueryChain(mockLeanDoc);
      mockModel.findById.mockReturnValue(chain as never);

      const result = await repository.findById(mockComponentId);

      expect(result).toEqual(mockLeanDoc);
      expect(mockModel.findById).toHaveBeenCalledWith(mockComponentId);
      expect(chain.lean).toHaveBeenCalled();
    });

    it('finds by string ID and converts to Types.ObjectId', async () => {
      const chain = createQueryChain(mockLeanDoc);
      mockModel.findById.mockReturnValue(chain as never);

      const result = await repository.findById(mockComponentId.toHexString());

      expect(result).toEqual(mockLeanDoc);
      expect(mockModel.findById).toHaveBeenCalledWith(mockComponentId);
    });
  });

  describe('findByCode', () => {
    it('normalizes code and excludes ID when provided', async () => {
      const chain = createQueryChain(mockLeanDoc);
      mockModel.findOne.mockReturnValue(chain as never);

      const result = await repository.findByCode(' basic ', mockComponentId);

      expect(result).toEqual(mockLeanDoc);
      expect(mockModel.findOne).toHaveBeenCalledWith({
        code: 'BASIC',
        _id: { $ne: mockComponentId },
      });
    });
  });

  describe('findList', () => {
    it('constructs correct search filter, sort options, and pagination meta', async () => {
      const findChain = createQueryChain([mockLeanDoc]);
      mockModel.find.mockReturnValue(findChain as never);
      mockModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      } as never);

      const result = await repository.findList({
        page: 1,
        limit: 10,
        search: 'Basic (Core)',
        type: SalaryComponentType.EARNING,
        calculationType: SalaryComponentCalculationType.FIXED,
        isActive: true,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(result.data).toEqual([mockLeanDoc]);
      expect(result.meta.total).toBe(1);
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SalaryComponentType.EARNING,
          calculationType: SalaryComponentCalculationType.FIXED,
          isActive: true,
          $or: [
            { name: { $regex: 'Basic \\(Core\\)', $options: 'i' } },
            { code: { $regex: 'Basic \\(Core\\)', $options: 'i' } },
          ],
        }),
      );
      expect(findChain.sort).toHaveBeenCalledWith({ name: 1 });
      expect(findChain.skip).toHaveBeenCalledWith(0);
      expect(findChain.limit).toHaveBeenCalledWith(10);
    });
  });

  describe('updateById', () => {
    it('sanitizes input by stripping undefined values before passing to $set', async () => {
      const chain = createQueryChain({ ...mockLeanDoc, name: 'New Basic' });
      mockModel.findByIdAndUpdate.mockReturnValue(chain as never);

      const updateInput: UpdateSalaryComponentInput = {
        name: 'New Basic',
        description: undefined,
        updatedBy: mockActorId,
      };

      const result = await repository.updateById(mockComponentId, updateInput);

      expect(result).toBeDefined();
      expect(result?.name).toBe('New Basic');
      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockComponentId,
        {
          $set: {
            name: 'New Basic',
            updatedBy: mockActorId,
          },
        },
        { new: true, runValidators: true },
      );
    });
  });

  describe('updateStatus', () => {
    it('updates status and updatedBy correctly', async () => {
      const chain = createQueryChain({ ...mockLeanDoc, isActive: false });
      mockModel.findByIdAndUpdate.mockReturnValue(chain as never);

      const result = await repository.updateStatus(
        mockComponentId,
        false,
        mockActorId,
      );

      expect(result?.isActive).toBe(false);
      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockComponentId,
        { $set: { isActive: false, updatedBy: mockActorId } },
        { new: true, runValidators: true },
      );
    });
  });

  describe('isDuplicateKeyError', () => {
    it('detects MongoDB 11000 duplicate key error in various shapes', () => {
      expect(repository.isDuplicateKeyError({ code: 11000 })).toBe(true);
      expect(
        repository.isDuplicateKeyError({
          message: 'E11000 duplicate key error collection',
        }),
      ).toBe(true);
      expect(
        repository.isDuplicateKeyError({
          name: 'MongoServerError',
          code: 11000,
        }),
      ).toBe(true);
      expect(
        repository.isDuplicateKeyError({
          name: 'MongoBulkWriteError',
          code: 11000,
        }),
      ).toBe(true);
      expect(
        repository.isDuplicateKeyError({
          cause: { code: 11000 },
        }),
      ).toBe(true);
      expect(
        repository.isDuplicateKeyError({
          cause: { message: 'E11000 error' },
        }),
      ).toBe(true);
      expect(repository.isDuplicateKeyError(null)).toBe(false);
      expect(repository.isDuplicateKeyError(undefined)).toBe(false);
      expect(repository.isDuplicateKeyError({ code: 12000 })).toBe(false);
    });
  });
});
