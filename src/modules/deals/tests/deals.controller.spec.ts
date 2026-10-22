/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { DealsController } from '../deals.controller';
import { DealsService } from '../deals.service';
import { DealStage } from '../constants/deal-stage.constant';
import { DealStatus } from '../constants/deal-status.constant';
import type { AuthenticatedRequest } from '../../auth/types/auth-request.type';
import {
  ActivityOutcome,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';

describe('DealsController', () => {
  let controller: DealsController;

  const mockDealsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    getPipeline: jest.fn(),
    getForecast: jest.fn(),
    exportDeals: jest.fn(),
    bulkAssign: jest.fn(),
    update: jest.fn(),
    assignOwner: jest.fn(),
    changeStage: jest.fn(),
    closeDeal: jest.fn(),
    reopenDeal: jest.fn(),
    softDelete: jest.fn(),
    addNote: jest.fn(),
    deleteNote: jest.fn(),
    logActivity: jest.fn(),
    listActivities: jest.fn(),
    updateActivity: jest.fn(),
    deleteActivity: jest.fn(),
  };

  const actorId = new Types.ObjectId();
  const dealId = new Types.ObjectId();
  const companyId = new Types.ObjectId();
  const contactId = new Types.ObjectId();
  const activityId = new Types.ObjectId();
  const noteId = new Types.ObjectId();

  const mockReq: AuthenticatedRequest = {
    user: { userId: actorId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'controller-spec' },
  } as unknown as AuthenticatedRequest;

  const mockDealResponse = {
    id: dealId.toString(),
    title: 'Cloud Migration Opportunity',
    pipeline: 'STANDARD',
    stage: DealStage.NEW,
    status: DealStatus.OPEN,
    amount: 5000000,
    currency: 'USD',
    probability: 10,
    expectedCloseDate: '2026-11-30T00:00:00.000Z',
    actualCloseDate: null,
    companyId: companyId.toString(),
    contactId: contactId.toString(),
    ownerId: actorId.toString(),
    products: [],
    notes: [],
    closureHistory: [],
    lostReason: null,
    lostReasonDetails: null,
    tags: ['cloud'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DealsController],
      providers: [
        {
          provide: DealsService,
          useValue: mockDealsService,
        },
      ],
    }).compile();

    controller = module.get<DealsController>(DealsController);
    jest.clearAllMocks();
  });

  describe('Route Precedence & Static Routes', () => {
    it('GET /deals/pipeline -> invokes getPipeline and returns standard response envelope', async () => {
      const mockPipeline = [
        {
          stage: DealStage.NEW,
          totalAmount: 5000000,
          count: 1,
          deals: [mockDealResponse],
        },
      ];
      mockDealsService.getPipeline.mockResolvedValue(mockPipeline);

      const res = await controller.getPipeline('STANDARD', mockReq);

      expect(res).toEqual({ success: true, data: mockPipeline });
      expect(mockDealsService.getPipeline).toHaveBeenCalledWith(
        'STANDARD',
        actorId,
      );
    });

    it('GET /deals/forecast -> invokes getForecast and returns envelope', async () => {
      const mockForecast = {
        currency: 'USD',
        totalPipeline: 50000,
        weightedPipeline: 5000,
        count: 1,
        byStage: [],
      };
      mockDealsService.getForecast.mockResolvedValue(mockForecast);

      const res = await controller.getForecast(
        { currency: 'USD' } as any,
        mockReq,
      );

      expect(res).toEqual({ success: true, data: mockForecast });
      expect(mockDealsService.getForecast).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD' }),
        actorId,
      );
    });

    it('GET /deals/export -> invokes exportDeals and returns data array', async () => {
      mockDealsService.exportDeals.mockResolvedValue([mockDealResponse]);

      const res = await controller.exportDeals({}, mockReq);

      expect(res).toEqual({ success: true, data: [mockDealResponse] });
      expect(mockDealsService.exportDeals).toHaveBeenCalledWith(
        {},
        actorId,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
    });

    it('POST /deals/bulk-assign -> reassigns multiple deals atomically', async () => {
      const mockBulkResult = { assignedCount: 3 };
      mockDealsService.bulkAssign.mockResolvedValue(mockBulkResult);

      const dto = {
        dealIds: [dealId.toString()],
        ownerId: actorId.toString(),
      };
      const res = await controller.bulkAssign(dto as any, mockReq);

      expect(res).toEqual({
        success: true,
        data: mockBulkResult,
      });
      expect(mockDealsService.bulkAssign).toHaveBeenCalledWith(
        dto,
        actorId,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
    });
  });

  describe('Standard CRUD & Response Envelopes', () => {
    it('POST /deals -> creates a deal and returns 201 Created envelope', async () => {
      mockDealsService.create.mockResolvedValue(mockDealResponse);

      const dto = {
        title: 'Cloud Migration Opportunity',
        amount: 5000000,
        currency: 'USD',
        companyId: companyId.toString(),
        contactId: contactId.toString(),
      };

      const res = await controller.create(dto as any, mockReq);

      expect(res).toEqual({
        success: true,
        data: mockDealResponse,
      });
      expect(mockDealsService.create).toHaveBeenCalledWith(
        dto,
        actorId,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
    });

    it('GET /deals -> lists deals with pagination metadata', async () => {
      const mockPaginated = {
        data: [mockDealResponse],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      mockDealsService.findAll.mockResolvedValue(mockPaginated);

      const res = await controller.list({ page: 1, limit: 20 } as any, mockReq);

      expect(res).toEqual({
        success: true,
        data: [mockDealResponse],
        meta: mockPaginated.meta,
      });
    });

    it('GET /deals/:id -> returns single deal by ID', async () => {
      mockDealsService.findById.mockResolvedValue(mockDealResponse);

      const res = await controller.findById(dealId, mockReq);

      expect(res).toEqual({ success: true, data: mockDealResponse });
      expect(mockDealsService.findById).toHaveBeenCalledWith(dealId, actorId);
    });

    it('PATCH /deals/:id -> updates deal fields', async () => {
      mockDealsService.update.mockResolvedValue({
        ...mockDealResponse,
        title: 'Updated Deal Title',
      });

      const dto = { title: 'Updated Deal Title' };
      const res = await controller.update(dealId, dto as any, mockReq);

      expect(res).toEqual({
        success: true,
        data: expect.objectContaining({ title: 'Updated Deal Title' }),
      });
    });

    it('DELETE /deals/:id -> soft deletes deal and returns success message', async () => {
      mockDealsService.softDelete.mockResolvedValue(undefined);

      const res = await controller.softDelete(dealId, mockReq);

      expect(res).toEqual({
        success: true,
        message: 'Deal successfully deleted',
      });
      expect(mockDealsService.softDelete).toHaveBeenCalledWith(
        dealId,
        actorId,
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
    });
  });

  describe('Lifecycle & State Machine Endpoints', () => {
    it('PATCH /deals/:id/stage -> updates deal stage', async () => {
      const updated = { ...mockDealResponse, stage: DealStage.DEMO_MEETING };
      mockDealsService.changeStage.mockResolvedValue(updated);

      const res = await controller.changeStage(
        dealId,
        { stage: DealStage.DEMO_MEETING } as any,
        mockReq,
      );

      expect(res).toEqual({
        success: true,
        data: updated,
      });
    });

    it('PATCH /deals/:id/close -> closes deal as WON or LOST', async () => {
      const closed = {
        ...mockDealResponse,
        stage: DealStage.CLOSED_WON,
        status: DealStatus.WON,
        probability: 100,
      };
      mockDealsService.closeDeal.mockResolvedValue(closed);

      const res = await controller.closeDeal(
        dealId,
        { stage: DealStage.CLOSED_WON } as any,
        mockReq,
      );

      expect(res).toEqual({
        success: true,
        data: closed,
      });
    });

    it('PATCH /deals/:id/reopen -> reopens closed deal', async () => {
      const reopened = {
        ...mockDealResponse,
        stage: DealStage.QUALIFIED,
        status: DealStatus.OPEN,
      };
      mockDealsService.reopenDeal.mockResolvedValue(reopened);

      const res = await controller.reopenDeal(
        dealId,
        { reopenReason: 'New budget approved' } as any,
        mockReq,
      );

      expect(res).toEqual({
        success: true,
        data: reopened,
      });
    });
  });

  describe('Sub-resource: Notes & Activities', () => {
    it('POST /deals/:id/notes -> adds a note to the deal', async () => {
      const note = {
        _id: noteId,
        content: 'Client requested revised quotation',
        createdBy: actorId,
        createdAt: new Date(),
      };
      mockDealsService.addNote.mockResolvedValue(note);

      const res = await controller.addNote(
        dealId,
        { content: 'Client requested revised quotation' } as any,
        mockReq,
      );

      expect(res).toEqual({
        success: true,
        data: note,
      });
    });

    it('DELETE /deals/:id/notes/:noteId -> deletes a note', async () => {
      mockDealsService.deleteNote.mockResolvedValue(mockDealResponse);

      const res = await controller.deleteNote(dealId, noteId, mockReq);

      expect(res).toEqual({
        success: true,
        data: mockDealResponse,
      });
    });

    it('POST /deals/:id/activities -> logs an activity', async () => {
      const activity = {
        _id: activityId,
        entityType: 'Deal',
        entityId: dealId,
        type: ActivityType.MEETING,
        subject: 'Product Demo',
        performedBy: actorId,
      };
      mockDealsService.logActivity.mockResolvedValue(activity);

      const res = await controller.logActivity(
        dealId,
        {
          type: ActivityType.MEETING,
          subject: 'Product Demo',
          activityDate: new Date().toISOString(),
          durationMinutes: 45,
          outcome: ActivityOutcome.COMPLETED,
        } as any,
        mockReq,
      );

      expect(res).toEqual({
        success: true,
        data: activity,
      });
    });

    it('DELETE /deals/:id/activities/:activityId -> deletes an activity', async () => {
      mockDealsService.deleteActivity.mockResolvedValue(undefined);

      const res = await controller.deleteActivity(dealId, activityId, mockReq);

      expect(res).toEqual({
        success: true,
        message: 'Activity deleted successfully',
      });
    });
  });
});
