/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { LeaveTransactionRepository } from './leave-transaction.repository';
import { LeaveTransaction } from '../schemas/leave-transaction.schema';
import { LeaveTransactionType } from '../constants/leaves.constant';

describe('LeaveTransactionRepository', () => {
  let repository: LeaveTransactionRepository;
  let mockTransactionModel: any;

  beforeEach(async () => {
    // Model instance mock for new this.transactionModel(data)
    const mockModelInstance = {
      save: jest.fn().mockImplementation(() =>
        Promise.resolve({
          toObject: () => ({
            _id: new Types.ObjectId(),
            employeeId: new Types.ObjectId(),
            days: 10,
            transactionType: LeaveTransactionType.ALLOCATION,
            createdAt: new Date(),
          }),
        }),
      ),
    };

    // Constructor function mock
    mockTransactionModel = jest.fn().mockImplementation((data) => ({
      ...mockModelInstance,
      ...data,
    })) as any;

    // Static / query methods
    mockTransactionModel.syncIndexes = jest.fn().mockResolvedValue(undefined);

    const mockFindQuery: any = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          days: 10,
          transactionType: LeaveTransactionType.ALLOCATION,
        },
      ]),
    };
    mockTransactionModel.find = jest.fn().mockReturnValue(mockFindQuery);

    mockTransactionModel.countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    const mockFindOneQuery: any = {
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        transactionType: LeaveTransactionType.APPROVAL_DEBIT,
      }),
    };
    mockTransactionModel.findOne = jest.fn().mockReturnValue(mockFindOneQuery);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveTransactionRepository,
        {
          provide: getModelToken(LeaveTransaction.name),
          useValue: mockTransactionModel,
        },
      ],
    }).compile();

    repository = module.get<LeaveTransactionRepository>(
      LeaveTransactionRepository,
    );
  });

  describe('onModuleInit', () => {
    it('should synchronize indexes with MongoDB WiredTiger', async () => {
      await repository.onModuleInit();
      expect(mockTransactionModel.syncIndexes).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create and persist a new immutable transaction ledger entry', async () => {
      const mockSession = {} as any;
      const empId = new Types.ObjectId();
      const typeId = new Types.ObjectId();

      const result = await repository.create(
        {
          employeeId: empId,
          leaveTypeId: typeId,
          year: 2026,
          transactionType: LeaveTransactionType.ALLOCATION,
          days: 12,
          previousAvailable: 0,
          newAvailable: 12,
        },
        mockSession,
      );

      expect(result).toBeDefined();
      expect(result.transactionType).toBe(LeaveTransactionType.ALLOCATION);
    });
  });

  describe('findByReference', () => {
    it('should query transaction by referenceId and transactionType', async () => {
      const refId = new Types.ObjectId();
      const result = await repository.findByReference(
        refId,
        LeaveTransactionType.APPROVAL_DEBIT,
      );

      expect(mockTransactionModel.findOne).toHaveBeenCalledWith({
        referenceId: refId,
        transactionType: LeaveTransactionType.APPROVAL_DEBIT,
      });
      expect(result).toBeDefined();
    });

    it('should attach session if provided', async () => {
      const refId = new Types.ObjectId();
      const mockSession = {} as any;
      await repository.findByReference(
        refId,
        LeaveTransactionType.APPROVAL_DEBIT,
        mockSession,
      );

      const findOneQuery = mockTransactionModel.findOne.mock.results[0].value;
      expect(findOneQuery.session).toHaveBeenCalledWith(mockSession);
    });
  });

  describe('findCarryForwardTransaction', () => {
    it('should query carry forward transaction by employeeId, leaveTypeId, and toYear', async () => {
      const empId = new Types.ObjectId();
      const typeId = new Types.ObjectId();
      const toYear = 2026;

      const result = await repository.findCarryForwardTransaction(
        empId,
        typeId,
        toYear,
      );

      expect(mockTransactionModel.findOne).toHaveBeenCalledWith({
        employeeId: empId,
        leaveTypeId: typeId,
        year: toYear,
        transactionType: LeaveTransactionType.CARRY_FORWARD,
      });
      expect(result).toBeDefined();
    });

    it('should attach session if provided', async () => {
      const empId = new Types.ObjectId();
      const typeId = new Types.ObjectId();
      const mockSession = {} as any;

      await repository.findCarryForwardTransaction(
        empId,
        typeId,
        2026,
        mockSession,
      );

      const findOneQuery = mockTransactionModel.findOne.mock.results[0].value;
      expect(findOneQuery.session).toHaveBeenCalledWith(mockSession);
    });
  });

  describe('findList', () => {
    it('should paginate and filter with default sort by createdAt desc', async () => {
      const empId = new Types.ObjectId();
      const filter = { employeeId: empId, year: 2026 };

      const result = await repository.findList(filter, 2, 10);

      expect(mockTransactionModel.find).toHaveBeenCalledWith(filter);
      const findQuery = mockTransactionModel.find.mock.results[0].value;
      expect(findQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(findQuery.skip).toHaveBeenCalledWith(10); // (2-1)*10
      expect(findQuery.limit).toHaveBeenCalledWith(10);
      expect(mockTransactionModel.countDocuments).toHaveBeenCalledWith(filter);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 2,
        limit: 10,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });
  });
});
