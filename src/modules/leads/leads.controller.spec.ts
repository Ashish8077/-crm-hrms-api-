import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadSource } from './constants/lead-source.constant';
import { LeadStatus } from './constants/lead-status.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('LeadsController', () => {
  let controller: LeadsController;

  const mockLeadsService = {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    updateScore: jest.fn(),
    assignOwner: jest.fn(),
    transferOwner: jest.fn(),
    bulkAssign: jest.fn(),
    softDelete: jest.fn(),
    checkDuplicate: jest.fn(),
    addNote: jest.fn(),
    deleteNote: jest.fn(),
    addFollowUp: jest.fn(),
    updateFollowUp: jest.fn(),
    addDocument: jest.fn(),
    deleteDocument: jest.fn(),
    importLeads: jest.fn(),
    exportLeads: jest.fn(),
    getTimeline: jest.fn(),
  };

  const actorId = new Types.ObjectId();
  const leadId = new Types.ObjectId();

  const mockReq: AuthenticatedRequest = {
    user: { userId: actorId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  } as unknown as AuthenticatedRequest;

  const mockLeadResponse = {
    id: leadId.toString(),
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    phone: '+1234567890',
    source: LeadSource.WEBSITE,
    status: LeadStatus.NEW,
    score: 0,
    tags: [],
    ownerId: null,
    notes: [],
    followUps: [],
    documents: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadsController],
      providers: [
        {
          provide: LeadsService,
          useValue: mockLeadsService,
        },
      ],
    }).compile();

    controller = module.get<LeadsController>(LeadsController);
    jest.clearAllMocks();
  });

  it('POST /leads -> create lead', async () => {
    mockLeadsService.create.mockResolvedValue(mockLeadResponse);

    const dto = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      phone: '+1234567890',
    };

    const res = await controller.create(dto, mockReq);
    expect(res).toEqual({ success: true, data: mockLeadResponse });
    expect(mockLeadsService.create).toHaveBeenCalledWith(dto, actorId, {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('GET /leads -> list leads', async () => {
    const listResult = {
      data: [mockLeadResponse],
      meta: {
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
    mockLeadsService.list.mockResolvedValue(listResult);

    const res = await controller.list({ page: 1, limit: 20 });
    expect(res).toEqual({
      success: true,
      data: [mockLeadResponse],
      meta: listResult.meta,
    });
  });

  it('GET /leads/:id -> get lead by ID', async () => {
    mockLeadsService.findById.mockResolvedValue(mockLeadResponse);

    const res = await controller.getById(leadId);
    expect(res).toEqual({ success: true, data: mockLeadResponse });
    expect(mockLeadsService.findById).toHaveBeenCalledWith(leadId);
  });

  it('DELETE /leads/:id -> soft delete lead', async () => {
    mockLeadsService.softDelete.mockResolvedValue(undefined);

    const res = await controller.delete(leadId, mockReq);
    expect(res).toEqual({
      success: true,
      message: 'Lead successfully deleted',
    });
  });

  it('POST /leads/check-duplicate -> duplicate check', async () => {
    mockLeadsService.checkDuplicate.mockResolvedValue({
      isDuplicate: false,
      duplicate: null,
    });

    const res = await controller.checkDuplicate({ email: 'test@example.com' });
    expect(res).toEqual({
      success: true,
      data: { isDuplicate: false, duplicate: null },
    });
  });

  it('GET /leads/:id/timeline -> activity timeline', async () => {
    mockLeadsService.getTimeline.mockResolvedValue([
      { action: 'LEAD_CREATED' },
    ]);

    const res = await controller.getTimeline(leadId);
    expect(res).toEqual({ success: true, data: [{ action: 'LEAD_CREATED' }] });
  });
});
