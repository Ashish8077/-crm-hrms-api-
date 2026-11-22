/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { CompOffController } from './comp-off.controller';
import { CompOffService } from './services/comp-off.service';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { CompOffStatus } from './constants/leaves.constant';
import { CompOffRecordLean } from './repositories/comp-off-record.repository';

describe('CompOffController', () => {
  let controller: CompOffController;
  let compOffService: jest.Mocked<CompOffService>;

  const userId = new Types.ObjectId();
  const mockRequest = {
    user: { userId, sessionId: new Types.ObjectId() },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestRunner/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockRecord: CompOffRecordLean = {
    _id: new Types.ObjectId(),
    employeeId: new Types.ObjectId(),
    attendanceDate: '2026-05-10',
    overtimeMinutes: 480,
    earnedDays: 1,
    status: CompOffStatus.PENDING,
    expiryDate: '2026-08-10',
    redeemedAt: null,
    redeemedLeaveRequestId: null,
    reason: 'Worked on Sunday deployment',
    reviewedBy: null,
    reviewedAt: null,
    reviewRemarks: undefined,
    deletedAt: null,
    createdBy: userId,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompOffController],
      providers: [
        {
          provide: CompOffService,
          useValue: {
            claimCompOff: jest.fn().mockResolvedValue(mockRecord),
            getMyCompOff: jest.fn().mockResolvedValue({
              data: [mockRecord],
              meta: {
                total: 1,
                page: 1,
                limit: 20,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            }),
            listCompOff: jest.fn().mockResolvedValue({
              data: [mockRecord],
              meta: {
                total: 1,
                page: 1,
                limit: 20,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            }),
            getCompOffById: jest.fn().mockResolvedValue(mockRecord),
            reviewCompOff: jest.fn().mockResolvedValue({
              ...mockRecord,
              status: CompOffStatus.APPROVED,
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<CompOffController>(CompOffController);
    compOffService = module.get(CompOffService);
  });

  it('should claim compensatory off', async () => {
    const result = await controller.claimCompOff(
      {
        attendanceDate: '2026-05-10',
        reason: 'Worked on Sunday deployment',
      },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.attendanceDate).toBe('2026-05-10');
    expect(compOffService.claimCompOff).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ attendanceDate: '2026-05-10' }),
      expect.anything(),
    );
  });

  it('should get own comp-off records', async () => {
    const result = await controller.getMyCompOff(
      { page: 1, limit: 10 },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.length).toBe(1);
    expect(compOffService.getMyCompOff).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ page: 1, limit: 10 }),
    );
  });

  it('should list comp-off records with manager/HR scoping', async () => {
    const result = await controller.listCompOff(
      { page: 1, limit: 10 },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.length).toBe(1);
    expect(compOffService.listCompOff).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ page: 1, limit: 10 }),
    );
  });

  it('should get comp-off record details by ID', async () => {
    const result = await controller.getCompOffById(mockRecord._id, mockRequest);

    expect(result.success).toBe(true);
    expect(result.data.id).toBe(mockRecord._id.toString());
    expect(compOffService.getCompOffById).toHaveBeenCalledWith(
      userId,
      mockRecord._id,
    );
  });

  it('should review comp-off claim (approve)', async () => {
    const result = await controller.reviewCompOff(
      mockRecord._id,
      {
        status: CompOffStatus.APPROVED,
        remarks: 'Approved weekend shift work',
      },
      mockRequest,
    );

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(CompOffStatus.APPROVED);
    expect(compOffService.reviewCompOff).toHaveBeenCalledWith(
      userId,
      mockRecord._id,
      expect.objectContaining({ status: CompOffStatus.APPROVED }),
      expect.anything(),
    );
  });
});
