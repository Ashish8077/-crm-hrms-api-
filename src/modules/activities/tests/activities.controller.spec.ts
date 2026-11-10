import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ActivitiesController } from '../activities.controller';
import { ActivitiesService } from '../activities.service';
import {
  ActivityEntityType,
  ActivityOutcome,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';
import type { AuthenticatedRequest } from '../../auth/types/auth-request.type';

describe('ActivitiesController', () => {
  let controller: ActivitiesController;

  const mockActivitiesService = {
    logActivity: jest.fn(),
    findAll: jest.fn(),
    findCalendar: jest.fn(),
    getSummary: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    recordOutcome: jest.fn(),
    delete: jest.fn(),
  };

  const actorId = new Types.ObjectId();
  const activityId = new Types.ObjectId();
  const leadId = new Types.ObjectId();

  const mockReq = {
    user: { userId: actorId, sessionId: new Types.ObjectId(), roleIds: [] },
  } as unknown as AuthenticatedRequest;

  const mockActivityResponse = {
    id: activityId.toString(),
    entityType: ActivityEntityType.LEAD,
    entityId: leadId.toString(),
    type: ActivityType.CALL,
    subject: 'Client call',
    description: null,
    activityDate: new Date(),
    durationMinutes: 15,
    outcome: ActivityOutcome.CONNECTED,
    performedBy: actorId.toString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivitiesController],
      providers: [
        {
          provide: ActivitiesService,
          useValue: mockActivitiesService,
        },
      ],
    }).compile();

    controller = module.get<ActivitiesController>(ActivitiesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call logActivity on service', async () => {
    mockActivitiesService.logActivity.mockResolvedValue(mockActivityResponse);
    const dto = {
      entityType: ActivityEntityType.LEAD,
      entityId: leadId.toString(),
      type: ActivityType.CALL,
      subject: 'Client call',
    };

    const result = await controller.logActivity(dto, mockReq);
    expect(result).toEqual(mockActivityResponse);
    expect(mockActivitiesService.logActivity).toHaveBeenCalledWith(
      dto,
      actorId,
    );
  });

  it('should call findAll on service', async () => {
    const mockList = { data: [mockActivityResponse], meta: { total: 1 } };
    mockActivitiesService.findAll.mockResolvedValue(mockList);

    const result = await controller.findAll({}, mockReq);
    expect(result).toEqual(mockList);
    expect(mockActivitiesService.findAll).toHaveBeenCalledWith(
      {},
      mockReq.user,
    );
  });

  it('should call recordOutcome on service', async () => {
    mockActivitiesService.recordOutcome.mockResolvedValue({
      activity: { ...mockActivityResponse, outcome: ActivityOutcome.COMPLETED },
    });
    const dto = { outcome: ActivityOutcome.COMPLETED };

    const result = await controller.recordOutcome(
      activityId.toString(),
      dto,
      mockReq,
    );
    expect(result.activity.outcome).toBe(ActivityOutcome.COMPLETED);
    expect(mockActivitiesService.recordOutcome).toHaveBeenCalledWith(
      activityId.toString(),
      dto,
      mockReq.user,
    );
  });

  it('should call delete on service', async () => {
    mockActivitiesService.delete.mockResolvedValue({ success: true });

    const result = await controller.delete(activityId.toString(), mockReq);
    expect(result).toEqual({ success: true });
    expect(mockActivitiesService.delete).toHaveBeenCalledWith(
      activityId.toString(),
      mockReq.user,
    );
  });
});
