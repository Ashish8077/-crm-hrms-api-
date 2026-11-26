/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PayrollRecordRepository } from './payroll-record.repository';
import {
  PayrollCalculationSnapshot,
  PayrollRecord,
  PayrollRecordDocument,
  PayrollRecordLean,
} from '../schemas/payroll-record.schema';
import { PayrollRecordStatus } from '../constants/payroll-calculation.constant';

describe('PayrollRecordRepository', () => {
  let repository: PayrollRecordRepository;
  let mockModel: jest.Mocked<Model<PayrollRecordDocument>>;

  const periodId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const recordId = new Types.ObjectId();
  const actorId = new Types.ObjectId();

  const mockLeanDoc: PayrollRecordLean = {
    _id: recordId,
    payrollPeriodId: periodId,
    employeeId,
    salaryAssignmentId: new Types.ObjectId(),
    salaryStructureId: new Types.ObjectId(),
    calculationSnapshot: {} as PayrollCalculationSnapshot,
    grossEarnings: Types.Decimal128.fromString('30000.00'),
    totalDeductions: Types.Decimal128.fromString('200.00'),
    employerContributions: Types.Decimal128.fromString('3600.00'),
    netSalary: Types.Decimal128.fromString('29800.00'),
    status: PayrollRecordStatus.CALCULATED,
    calculatedAt: new Date(),
    calculationVersion: 1,
    deletedAt: null,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
    __v: 0,
  };

  const createQueryChain = (resolvedValue: unknown) => ({
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(resolvedValue),
    }),
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
      findOneAndUpdate: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollRecordRepository,
        {
          provide: getModelToken(PayrollRecord.name),
          useValue: mockModelConstructor,
        },
      ],
    }).compile();

    repository = module.get(PayrollRecordRepository);
    mockModel = module.get(getModelToken(PayrollRecord.name));
  });

  it('findByPeriodAndEmployee filters by payrollPeriodId, employeeId, and deletedAt: null', async () => {
    const chain = createQueryChain(mockLeanDoc);
    (mockModel.findOne as jest.Mock).mockReturnValue(chain);
    const session = {} as ClientSession;

    const res = await repository.findByPeriodAndEmployee(
      periodId,
      employeeId,
      session,
    );

    expect(mockModel.findOne).toHaveBeenCalledWith({
      payrollPeriodId: periodId,
      employeeId,
      deletedAt: null,
    });
    expect(chain.session).toHaveBeenCalledWith(session);
    expect(res).toEqual(mockLeanDoc);
  });

  it('recalculateAtomically enforces CALCULATED status, deletedAt: null, and expectedVersion __v', async () => {
    const updatedDoc = { ...mockLeanDoc, calculationVersion: 2, __v: 1 };
    const chain = createQueryChain(updatedDoc);
    (mockModel.findOneAndUpdate as jest.Mock).mockReturnValue(chain);

    const res = await repository.recalculateAtomically(recordId, 0, {
      salaryAssignmentId: new Types.ObjectId(),
      salaryStructureId: new Types.ObjectId(),
      calculationSnapshot: {} as PayrollCalculationSnapshot,
      grossEarnings: Types.Decimal128.fromString('32000.00'),
      totalDeductions: Types.Decimal128.fromString('200.00'),
      employerContributions: Types.Decimal128.fromString('3600.00'),
      netSalary: Types.Decimal128.fromString('31800.00'),
      calculatedAt: new Date(),
      updatedBy: actorId,
    });

    expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: recordId,
        deletedAt: null,
        status: PayrollRecordStatus.CALCULATED,
        __v: 0,
      },
      expect.objectContaining({
        $inc: { calculationVersion: 1, __v: 1 },
      }),
      expect.objectContaining({ returnDocument: 'after', runValidators: true }),
    );
    expect(res?.calculationVersion).toBe(2);
  });

  it('isDuplicateKeyError identifies MongoDB E11000 errors accurately', () => {
    expect(repository.isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(
      repository.isDuplicateKeyError(new Error('E11000 duplicate key error')),
    ).toBe(true);
    expect(repository.isDuplicateKeyError({ cause: { code: 11000 } })).toBe(
      true,
    );
    expect(repository.isDuplicateKeyError(new Error('Network error'))).toBe(
      false,
    );
    expect(repository.isDuplicateKeyError(null)).toBe(false);
  });
});
