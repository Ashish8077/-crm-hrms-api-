/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PayrollPeriodRepository } from './payroll-period.repository';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
  PayrollPeriodLean,
} from '../schemas/payroll-period.schema';
import { PayrollPeriodStatus } from '../constants/payroll-period.constant';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';

describe('PayrollPeriodRepository', () => {
  let repository: PayrollPeriodRepository;
  let mockModel: jest.Mocked<Model<PayrollPeriodDocument>>;

  const mockActorId = new Types.ObjectId();
  const mockPeriodId = new Types.ObjectId();

  const mockLeanDoc: PayrollPeriodLean = {
    _id: mockPeriodId,
    periodName: 'April 2026 Monthly Payroll',
    periodCode: 'PR-2026-04',
    payrollFrequency: PayrollFrequency.MONTHLY,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-04-30T23:59:59.999Z'),
    paymentDate: new Date('2026-05-01T00:00:00.000Z'),
    month: 4,
    year: 2026,
    status: PayrollPeriodStatus.DRAFT,
    notes: 'Regular cycle',
    deletedAt: null,
    createdBy: mockActorId,
    updatedBy: mockActorId,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
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
          toObject: () => ({ ...mockLeanDoc, ...(data as object) }),
        }),
      }));

    Object.assign(mockModelConstructor, {
      findOne: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      countDocuments: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollPeriodRepository,
        {
          provide: getModelToken(PayrollPeriod.name),
          useValue: mockModelConstructor,
        },
      ],
    }).compile();

    repository = module.get<PayrollPeriodRepository>(PayrollPeriodRepository);
    mockModel = module.get(getModelToken(PayrollPeriod.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByCode', () => {
    it('normalizes code to uppercase and applies case-insensitive collation { locale: "en", strength: 2 }', async () => {
      const chain = createQueryChain(mockLeanDoc);
      (mockModel.findOne as jest.Mock).mockReturnValue(chain);

      const result = await repository.findByCode('pr-2026-04');

      expect(mockModel.findOne).toHaveBeenCalledWith({
        periodCode: 'PR-2026-04',
        deletedAt: null,
      });
      expect(chain.collation).toHaveBeenCalledWith({
        locale: 'en',
        strength: 2,
      });
      expect(result).toEqual(mockLeanDoc);
    });

    it('attaches session when provided', async () => {
      const chain = createQueryChain(mockLeanDoc);
      (mockModel.findOne as jest.Mock).mockReturnValue(chain);
      const mockSession = {} as unknown as ClientSession;

      await repository.findByCode('PR-2026-04', mockSession);

      expect(chain.session).toHaveBeenCalledWith(mockSession);
    });
  });

  describe('isDuplicateKeyError', () => {
    it('detects standard E11000 duplicate key errors', () => {
      const error = new Error(
        'E11000 duplicate key error collection: payroll_periods index: uq_payroll_periods_code',
      );
      expect(repository.isDuplicateKeyError(error)).toBe(true);
    });

    it('detects duplicate key error by code 11000 or nested cause', () => {
      expect(repository.isDuplicateKeyError({ code: 11000 })).toBe(true);
      expect(
        repository.isDuplicateKeyError({
          cause: { code: 11000 },
        }),
      );
      expect(
        repository.isDuplicateKeyError({
          cause: { message: 'E11000 duplicate key' },
        }),
      ).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      const error = new Error('Connection timeout');
      expect(repository.isDuplicateKeyError(error)).toBe(false);
      expect(repository.isDuplicateKeyError(null)).toBe(false);
      expect(repository.isDuplicateKeyError('string error')).toBe(false);
    });
  });

  describe('findById', () => {
    it('queries with _id and deletedAt: null filter', async () => {
      const chain = createQueryChain(mockLeanDoc);
      (mockModel.findOne as jest.Mock).mockReturnValue(chain);

      const result = await repository.findById(mockPeriodId);

      expect(mockModel.findOne).toHaveBeenCalledWith({
        _id: mockPeriodId,
        deletedAt: null,
      });
      expect(result).toEqual(mockLeanDoc);
    });
  });

  describe('findOverlapping', () => {
    it('queries with date range and deletedAt: null, excluding specified ID', async () => {
      const chain = createQueryChain(mockLeanDoc);
      (mockModel.findOne as jest.Mock).mockReturnValue(chain);

      const start = new Date('2026-04-01');
      const end = new Date('2026-04-30');
      const excludeId = new Types.ObjectId();

      await repository.findOverlapping(start, end, excludeId);

      expect(mockModel.findOne).toHaveBeenCalledWith({
        deletedAt: null,
        startDate: { $lte: end },
        endDate: { $gte: start },
        _id: { $ne: excludeId },
      });
    });
  });

  describe('findDuplicateCycle', () => {
    it('queries with cycle criteria and deletedAt: null', async () => {
      const chain = createQueryChain(mockLeanDoc);
      (mockModel.findOne as jest.Mock).mockReturnValue(chain);

      await repository.findDuplicateCycle(
        2026,
        4,
        PayrollFrequency.MONTHLY,
        mockPeriodId,
      );

      expect(mockModel.findOne).toHaveBeenCalledWith({
        deletedAt: null,
        year: 2026,
        month: 4,
        payrollFrequency: PayrollFrequency.MONTHLY,
        _id: { $ne: mockPeriodId },
      });
    });
  });

  describe('updateById', () => {
    it('includes expectedVersion __v in query filter for optimistic concurrency', async () => {
      const chain = createQueryChain({ ...mockLeanDoc, __v: 1 });
      (mockModel.findOneAndUpdate as jest.Mock).mockReturnValue(chain);

      const result = await repository.updateById(
        mockPeriodId,
        { periodName: 'Updated Period' },
        0,
      );

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: mockPeriodId, deletedAt: null, __v: 0 },
        {
          $set: { periodName: 'Updated Period' },
          $inc: { __v: 1 },
        },
        expect.objectContaining({ returnDocument: 'after' }),
      );
      expect(result?.__v).toBe(1);
    });
  });

  describe('updateStatus', () => {
    it('includes expectedVersion __v in query filter for optimistic concurrency', async () => {
      const chain = createQueryChain({
        ...mockLeanDoc,
        status: PayrollPeriodStatus.PROCESSING,
        __v: 1,
      });
      (mockModel.findOneAndUpdate as jest.Mock).mockReturnValue(chain);

      const result = await repository.updateStatus(
        mockPeriodId,
        PayrollPeriodStatus.PROCESSING,
        mockActorId,
        0,
      );

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: mockPeriodId, deletedAt: null, __v: 0 },
        {
          $set: {
            status: PayrollPeriodStatus.PROCESSING,
            updatedBy: mockActorId,
          },
          $inc: { __v: 1 },
        },
        expect.objectContaining({ returnDocument: 'after' }),
      );
      expect(result?.status).toBe(PayrollPeriodStatus.PROCESSING);
    });

    it('enforces expectedFromStatus and approval metadata when finalizing', async () => {
      const chain = createQueryChain({
        ...mockLeanDoc,
        status: PayrollPeriodStatus.FINALIZED,
        __v: 2,
      });
      (mockModel.findOneAndUpdate as jest.Mock).mockReturnValue(chain);

      const result = await repository.updateStatus(
        mockPeriodId,
        PayrollPeriodStatus.FINALIZED,
        mockActorId,
        1,
        undefined,
        {
          expectedFromStatus: PayrollPeriodStatus.APPROVED,
          requireApprovalMetadata: true,
        },
      );

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: mockPeriodId,
          deletedAt: null,
          __v: 1,
          status: PayrollPeriodStatus.APPROVED,
          'approval.approvedBy': { $exists: true, $ne: null },
          'approval.approvedAt': { $exists: true, $ne: null },
        },
        {
          $set: {
            status: PayrollPeriodStatus.FINALIZED,
            updatedBy: mockActorId,
          },
          $inc: { __v: 1 },
        },
        expect.objectContaining({ returnDocument: 'after' }),
      );
      expect(result?.status).toBe(PayrollPeriodStatus.FINALIZED);
    });
  });

  describe('concurrency & mutability guards', () => {
    it('verifyPeriodMutableAndBumpVersion checks editable period statuses and increments __v inside session', async () => {
      (mockModel.updateOne as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      });
      const mockSession = {} as unknown as ClientSession;

      const ok = await repository.verifyPeriodMutableAndBumpVersion(
        mockPeriodId,
        [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.PROCESSING],
        mockSession,
      );

      expect(ok).toBe(true);
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        {
          _id: mockPeriodId,
          deletedAt: null,
          status: {
            $in: [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.PROCESSING],
          },
        },
        { $inc: { __v: 1 } },
        { session: mockSession },
      );
    });

    it('touchActiveRunLock guards on DRAFT/PROCESSING and increments __v inside session', async () => {
      (mockModel.updateOne as jest.Mock).mockReturnValue({
        exec: jest.fn().mockResolvedValue({ matchedCount: 0 }),
      });
      const mockSession = {} as unknown as ClientSession;
      const now = new Date();

      const ok = await repository.touchActiveRunLock(
        { periodId: mockPeriodId, runId: 'run-1', now },
        mockSession,
      );

      expect(ok).toBe(false);
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        {
          _id: mockPeriodId,
          deletedAt: null,
          status: {
            $in: [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.PROCESSING],
          },
          'processing.activeRunId': 'run-1',
        },
        {
          $set: { 'processing.heartbeatAt': now },
          $inc: { __v: 1 },
        },
        { session: mockSession },
      );
    });
  });
});
