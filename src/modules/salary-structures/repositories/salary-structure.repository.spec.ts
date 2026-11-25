/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateSalaryStructureInput,
  SalaryStructureRepository,
  UpdateSalaryStructureInput,
} from './salary-structure.repository';
import {
  SalaryStructure,
  SalaryStructureDocument,
  SalaryStructureLean,
} from '../schemas/salary-structure.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../constants/salary-structure.constant';

describe('SalaryStructureRepository', () => {
  let repository: SalaryStructureRepository;
  let mockModel: jest.Mocked<Model<SalaryStructureDocument>>;

  const mockActorId = new Types.ObjectId();
  const mockStructureId = new Types.ObjectId();
  const mockComponentId = new Types.ObjectId();

  const mockLeanDoc: SalaryStructureLean = {
    _id: mockStructureId,
    name: 'Engineering CTC L2',
    code: 'ENG_L2_CTC',
    description: 'Engineering CTC template',
    salaryBasis: SalaryStructureBasis.CTC,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    salaryAmount: 50000,
    components: [
      {
        componentId: mockComponentId,
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 25000,
        percentage: null,
        percentageOf: null,
      },
    ],
    isActive: true,
    createdBy: mockActorId,
    updatedBy: mockActorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    __v: 0,
  };

  const createQueryChain = (resolvedValue: unknown) => ({
    session: jest.fn().mockReturnThis(),
    collation: jest.fn().mockReturnThis(),
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
          toObject: () => ({ ...mockLeanDoc, ...(data as object), __v: 0 }),
        }),
      }));

    Object.assign(mockModelConstructor, {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryStructureRepository,
        {
          provide: getModelToken(SalaryStructure.name),
          useValue: mockModelConstructor,
        },
      ],
    }).compile();

    repository = module.get<SalaryStructureRepository>(
      SalaryStructureRepository,
    );
    mockModel = module.get(getModelToken(SalaryStructure.name));
  });

  describe('create', () => {
    it('creates and returns a lean salary structure document', async () => {
      const input: CreateSalaryStructureInput = {
        name: 'Engineering CTC L2',
        code: 'ENG_L2_CTC',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: mockComponentId,
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 25000,
          },
        ],
        createdBy: mockActorId,
        updatedBy: mockActorId,
      };

      const result = await repository.create(input);

      expect(result).toBeDefined();
      expect(result._id).toEqual(mockStructureId);
      expect(result.code).toBe('ENG_L2_CTC');
      expect(mockModel).toHaveBeenCalledWith(input);
    });
  });

  describe('findById', () => {
    it('finds by Types.ObjectId and returns lean document', async () => {
      const chain = createQueryChain(mockLeanDoc);
      mockModel.findById.mockReturnValue(chain as never);

      const result = await repository.findById(mockStructureId);

      expect(result).toEqual(mockLeanDoc);
      expect(mockModel.findById).toHaveBeenCalledWith(mockStructureId);
    });
  });

  describe('findByCode', () => {
    it('normalizes code and applies case-insensitive collation', async () => {
      const chain = createQueryChain(mockLeanDoc);
      mockModel.findOne.mockReturnValue(chain as never);

      const result = await repository.findByCode(
        ' eng_l2_ctc ',
        mockStructureId,
      );

      expect(result).toEqual(mockLeanDoc);
      expect(mockModel.findOne).toHaveBeenCalledWith({
        code: 'ENG_L2_CTC',
        _id: { $ne: mockStructureId },
      });
      expect(chain.collation).toHaveBeenCalledWith({
        locale: 'en',
        strength: 2,
      });
    });
  });

  describe('findList', () => {
    it('constructs correct search filter, basis filter, and sort options', async () => {
      const findChain = createQueryChain([mockLeanDoc]);
      mockModel.find.mockReturnValue(findChain as never);
      mockModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      } as never);

      const result = await repository.findList({
        page: 1,
        limit: 10,
        search: 'Engineering',
        salaryBasis: SalaryStructureBasis.CTC,
        isActive: true,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(result.data).toEqual([mockLeanDoc]);
      expect(result.meta.total).toBe(1);
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          salaryBasis: SalaryStructureBasis.CTC,
          isActive: true,
          $or: [
            { name: { $regex: 'Engineering', $options: 'i' } },
            { code: { $regex: 'Engineering', $options: 'i' } },
          ],
        }),
      );
      expect(findChain.sort).toHaveBeenCalledWith({ name: 1 });
      expect(findChain.skip).toHaveBeenCalledWith(0);
      expect(findChain.limit).toHaveBeenCalledWith(10);
    });
  });

  describe('updateById', () => {
    it('strips undefined fields and checks version for optimistic concurrency', async () => {
      const chain = createQueryChain({ ...mockLeanDoc, salaryAmount: 55000 });
      mockModel.findOneAndUpdate.mockReturnValue(chain as never);

      const updateInput: UpdateSalaryStructureInput = {
        salaryAmount: 55000,
        description: undefined,
        updatedBy: mockActorId,
        version: 0,
      };

      const result = await repository.updateById(mockStructureId, updateInput);

      expect(result?.salaryAmount).toBe(55000);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: mockStructureId, __v: 0 },
        {
          $set: {
            salaryAmount: 55000,
            updatedBy: mockActorId,
          },
          $inc: { __v: 1 },
        },
        { new: true, runValidators: true },
      );
    });
  });

  describe('updateStatus', () => {
    it('updates status and increments __v without version filter', async () => {
      const chain = createQueryChain({ ...mockLeanDoc, isActive: false });
      mockModel.findOneAndUpdate.mockReturnValue(chain as never);

      const result = await repository.updateStatus(
        mockStructureId,
        false,
        mockActorId,
      );

      expect(result?.isActive).toBe(false);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: mockStructureId },
        { $set: { isActive: false, updatedBy: mockActorId }, $inc: { __v: 1 } },
        { new: true, runValidators: true },
      );
    });

    it('updates status with version filter for optimistic concurrency', async () => {
      const chain = createQueryChain({
        ...mockLeanDoc,
        isActive: true,
        __v: 3,
      });
      mockModel.findOneAndUpdate.mockReturnValue(chain as never);

      const result = await repository.updateStatus(
        mockStructureId,
        true,
        mockActorId,
        2,
      );

      expect(result?.isActive).toBe(true);
      expect(result?.__v).toBe(3);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: mockStructureId, __v: 2 },
        { $set: { isActive: true, updatedBy: mockActorId }, $inc: { __v: 1 } },
        { new: true, runValidators: true },
      );
    });
  });

  describe('Error checkers', () => {
    it('identifies duplicate key and version error correctly', () => {
      expect(repository.isDuplicateKeyError({ code: 11000 })).toBe(true);
      expect(repository.isDuplicateKeyError({ code: 12000 })).toBe(false);
      expect(repository.isVersionError({ name: 'VersionError' })).toBe(true);
      expect(
        repository.isVersionError({
          message: 'No matching document found for id 123',
        }),
      ).toBe(true);
      expect(repository.isVersionError({ name: 'OtherError' })).toBe(false);
    });
  });
});
