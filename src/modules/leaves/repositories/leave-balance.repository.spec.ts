/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { LeaveBalanceRepository } from './leave-balance.repository';
import { LeaveBalance } from '../schemas/leave-balance.schema';

describe('LeaveBalanceRepository - updatedBy audit field', () => {
  let repository: LeaveBalanceRepository;
  let mockBalanceModel: any;

  const mockEmployeeId = new Types.ObjectId();
  const mockLeaveTypeId = new Types.ObjectId();
  const mockActorUserId = new Types.ObjectId();
  const mockSession: any = {
    startTransaction: jest.fn(),
  };

  beforeEach(async () => {
    mockBalanceModel = jest.fn().mockImplementation((data) => ({
      ...data,
      save: jest.fn().mockResolvedValue({
        toObject: () => ({ ...data, _id: new Types.ObjectId() }),
      }),
    })) as any;

    mockBalanceModel.syncIndexes = jest.fn().mockResolvedValue(undefined);
    mockBalanceModel.findOne = jest.fn().mockReturnValue({
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    mockBalanceModel.findOneAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        employeeId: mockEmployeeId,
        leaveTypeId: mockLeaveTypeId,
        year: 2026,
        allocatedDays: 12,
        availableBalance: 12,
        updatedBy: mockActorUserId,
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveBalanceRepository,
        {
          provide: getModelToken(LeaveBalance.name),
          useValue: mockBalanceModel,
        },
      ],
    }).compile();

    repository = module.get<LeaveBalanceRepository>(LeaveBalanceRepository);
  });

  describe('reserveBalance', () => {
    it('should set updatedBy to actor user ID and keep employeeId intact', async () => {
      await repository.reserveBalance(
        mockEmployeeId,
        mockLeaveTypeId,
        2026,
        2,
        false,
        mockActorUserId,
        mockSession,
      );

      expect(mockBalanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: mockEmployeeId,
          leaveTypeId: mockLeaveTypeId,
          year: 2026,
        }),
        expect.objectContaining({
          $inc: { pendingDays: 2, availableBalance: -2 },
          $set: { updatedBy: mockActorUserId },
        }),
        expect.objectContaining({ session: mockSession }),
      );
    });

    it('should handle session passed without updatedBy (backwards-compatibility)', async () => {
      await repository.reserveBalance(
        mockEmployeeId,
        mockLeaveTypeId,
        2026,
        2,
        false,
        mockSession,
      );

      expect(mockBalanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ $set: expect.anything() }),
        expect.objectContaining({ session: mockSession }),
      );
    });
  });

  describe('releaseReservation', () => {
    it('should set updatedBy to manager/actor user ID during rejection or cancellation', async () => {
      await repository.releaseReservation(
        mockEmployeeId,
        mockLeaveTypeId,
        2026,
        2,
        mockActorUserId,
        mockSession,
      );

      expect(mockBalanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: mockEmployeeId,
          leaveTypeId: mockLeaveTypeId,
          year: 2026,
        }),
        expect.objectContaining({
          $inc: { pendingDays: -2, availableBalance: 2 },
          $set: { updatedBy: mockActorUserId },
        }),
        expect.objectContaining({ session: mockSession }),
      );
    });
  });

  describe('debitApprovedBalance', () => {
    it('should set updatedBy to approver user ID while employeeId identifies balance owner', async () => {
      await repository.debitApprovedBalance(
        mockEmployeeId,
        mockLeaveTypeId,
        2026,
        2,
        mockActorUserId,
        mockSession,
      );

      expect(mockBalanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: mockEmployeeId,
          leaveTypeId: mockLeaveTypeId,
          year: 2026,
        }),
        expect.objectContaining({
          $inc: { pendingDays: -2, usedDays: 2 },
          $set: { updatedBy: mockActorUserId },
        }),
        expect.objectContaining({ session: mockSession }),
      );
    });
  });

  describe('creditCancelledBalance', () => {
    it('should set updatedBy to actor user ID restoring balance', async () => {
      await repository.creditCancelledBalance(
        mockEmployeeId,
        mockLeaveTypeId,
        2026,
        2,
        mockActorUserId,
        mockSession,
      );

      expect(mockBalanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: mockEmployeeId,
          leaveTypeId: mockLeaveTypeId,
          year: 2026,
        }),
        expect.objectContaining({
          $inc: { usedDays: -2, availableBalance: 2 },
          $set: { updatedBy: mockActorUserId },
        }),
        expect.objectContaining({ session: mockSession }),
      );
    });
  });

  describe('upsertAllocation', () => {
    it('should set updatedBy on new allocation creation', async () => {
      jest.spyOn(repository, 'findByEmployeeTypeYear').mockResolvedValue(null);
      const createSpy = jest.spyOn(repository, 'create').mockResolvedValue({
        _id: new Types.ObjectId(),
        employeeId: mockEmployeeId,
        leaveTypeId: mockLeaveTypeId,
        year: 2026,
        allocatedDays: 10,
        availableBalance: 10,
        updatedBy: mockActorUserId,
      } as any);

      await repository.upsertAllocation(
        mockEmployeeId,
        mockLeaveTypeId,
        2026,
        10,
        0,
        mockActorUserId,
        mockSession,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: mockEmployeeId,
          leaveTypeId: mockLeaveTypeId,
          year: 2026,
          allocatedDays: 10,
          updatedBy: mockActorUserId,
        }),
        mockSession,
      );
    });

    it('should set updatedBy on existing allocation update', async () => {
      jest.spyOn(repository, 'findByEmployeeTypeYear').mockResolvedValue({
        _id: new Types.ObjectId(),
        employeeId: mockEmployeeId,
        leaveTypeId: mockLeaveTypeId,
        year: 2026,
        allocatedDays: 10,
        carriedForwardDays: 0,
        creditedDays: 0,
        debitedDays: 0,
        pendingDays: 0,
        usedDays: 0,
        availableBalance: 10,
      } as any);

      await repository.upsertAllocation(
        mockEmployeeId,
        mockLeaveTypeId,
        2026,
        15,
        0,
        mockActorUserId,
        mockSession,
      );

      expect(mockBalanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        {
          $set: expect.objectContaining({
            allocatedDays: 15,
            updatedBy: mockActorUserId,
          }),
        },
        expect.objectContaining({ session: mockSession }),
      );
    });
  });

  describe('manualAdjust', () => {
    it('should set updatedBy on manual CREDIT adjustment', async () => {
      await repository.manualAdjust(
        mockEmployeeId,
        mockLeaveTypeId,
        2026,
        'CREDIT',
        3,
        mockActorUserId,
        false,
        mockSession,
      );

      expect(mockBalanceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: mockEmployeeId,
          leaveTypeId: mockLeaveTypeId,
          year: 2026,
        }),
        expect.objectContaining({
          $set: { updatedBy: mockActorUserId },
          $inc: { creditedDays: 3, availableBalance: 3 },
        }),
        expect.objectContaining({ session: mockSession }),
      );
    });
  });
});
