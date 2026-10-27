import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { DealsController } from '../deals.controller';
import { DealsService } from '../deals.service';
import { DealStage } from '../constants/deal-stage.constant';
import { DealStatus } from '../constants/deal-status.constant';
import { DealPriority } from '../constants/deal.constant';
import {
  ActivityOutcome,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';
import type { AuthenticatedRequest } from '../../auth/types/auth-request.type';
import { CreateDealDto } from '../dto/create-deal.dto';
import { UpdateDealDto } from '../dto/update-deal.dto';
import { ListDealsQueryDto } from '../dto/list-deals-query.dto';
import { ForecastQueryDto } from '../dto/forecast-query.dto';
import { BulkAssignDealsDto } from '../dto/bulk-assign-deals.dto';
import { AssignDealDto } from '../dto/assign-deal.dto';
import { ChangeDealStageDto } from '../dto/change-deal-stage.dto';
import { CloseDealDto } from '../dto/close-deal.dto';
import { ReopenDealDto } from '../dto/reopen-deal.dto';
import { AddDealNoteDto } from '../dto/add-deal-note.dto';
import { LogDealActivityDto } from '../dto/log-deal-activity.dto';
import { UpdateDealActivityDto } from '../dto/update-deal-activity.dto';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';

describe('Deals & Opportunities - Complete Swagger API Test Suite (All Fields)', () => {
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
  const ownerId = new Types.ObjectId();
  const leadId = new Types.ObjectId();
  const noteId = new Types.ObjectId();
  const activityId = new Types.ObjectId();
  const secondaryDealId = new Types.ObjectId();

  const mockReq: AuthenticatedRequest = {
    user: { userId: actorId },
    ip: '192.168.1.100',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
    },
  } as unknown as AuthenticatedRequest;

  // Complete mock response with all optional & populated fields present
  const mockComprehensiveDealResponse = {
    id: dealId.toString(),
    title: 'Enterprise Multi-Cloud Architecture Modernization',
    description:
      'Full architectural migration and platform re-engineering contract across cloud environments.',
    pipeline: 'STANDARD',
    stage: DealStage.NEW,
    status: DealStatus.OPEN,
    amount: 15000000, // $150,000.00 in minor units
    currency: 'USD',
    probability: 20,
    weightedAmount: 3000000,
    expectedCloseDate: '2026-12-31T23:59:59.000Z',
    actualCloseDate: null,
    companyId: companyId.toString(),
    company: {
      id: companyId.toString(),
      name: 'Global MegaCorp Technologies Inc.',
    },
    contactId: contactId.toString(),
    contact: {
      id: contactId.toString(),
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@megacorp.com',
      phone: '+1-555-0199',
    },
    ownerId: ownerId.toString(),
    owner: {
      id: ownerId.toString(),
      email: 'sales.lead@company.com',
    },
    leadId: leadId.toString(),
    products: [
      {
        id: new Types.ObjectId().toString(),
        name: 'Enterprise Cloud License Tier 1',
        sku: 'CLD-LIC-001',
        quantity: 10,
        unitPrice: 1000000,
        discount: 10,
        total: 9000000,
        description: 'Primary software licensing seats with 10% volume rebate',
      },
      {
        id: new Types.ObjectId().toString(),
        name: 'Architecture Advisory & Integration Services',
        sku: 'ADV-SRV-200',
        quantity: 1,
        unitPrice: 6000000,
        discount: 0,
        total: 6000000,
        description: 'Dedicated cloud architect on-site for 60 working days',
      },
    ],
    notesCount: 1,
    notes: [
      {
        id: noteId.toString(),
        content: 'Executive sponsor confirmed Q4 budget approval.',
        createdBy: actorId.toString(),
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
      },
    ],
    closureHistory: [],
    lostReason: null,
    lostCompetitor: null,
    tags: ['enterprise', 'multi-cloud', 'high-priority', 'q4-target'],
    priority: DealPriority.HIGH,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
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

  // ──────────────────────────────────────────────────────────────────────────
  // 1. POST /deals — Create Deal with ALL Fields
  // ──────────────────────────────────────────────────────────────────────────
  it('1. POST /deals -> creates a new deal with ALL schema fields populated', async () => {
    mockDealsService.create.mockResolvedValue(mockComprehensiveDealResponse);

    const fullCreateDto: CreateDealDto = {
      title: 'Enterprise Multi-Cloud Architecture Modernization',
      description:
        'Full architectural migration and platform re-engineering contract across cloud environments.',
      pipeline: 'STANDARD',
      stage: DealStage.NEW,
      amount: 15000000,
      currency: 'USD',
      probability: 20,
      expectedCloseDate: '2026-12-31T23:59:59.000Z',
      companyId: companyId.toString(),
      contactId: contactId.toString(),
      ownerId: ownerId.toString(),
      leadId: leadId.toString(),
      products: [
        {
          name: 'Enterprise Cloud License Tier 1',
          sku: 'CLD-LIC-001',
          quantity: 10,
          unitPrice: 1000000,
          discount: 10,
          description:
            'Primary software licensing seats with 10% volume rebate',
        },
        {
          name: 'Architecture Advisory & Integration Services',
          sku: 'ADV-SRV-200',
          quantity: 1,
          unitPrice: 6000000,
          discount: 0,
          description: 'Dedicated cloud architect on-site for 60 working days',
        },
      ],
      tags: ['enterprise', 'multi-cloud', 'high-priority', 'q4-target'],
      priority: DealPriority.HIGH,
    };

    const result = await controller.create(fullCreateDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: mockComprehensiveDealResponse,
    });
    expect(mockDealsService.create).toHaveBeenCalledWith(
      fullCreateDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. GET /deals — List Deals with ALL Query Filters
  // ──────────────────────────────────────────────────────────────────────────
  it('2. GET /deals -> lists deals with ALL filter query parameters populated', async () => {
    const paginatedResponse = {
      data: [mockComprehensiveDealResponse],
      meta: {
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
    mockDealsService.findAll.mockResolvedValue(paginatedResponse);

    const fullQueryDto: ListDealsQueryDto = {
      page: 1,
      limit: 25,
      sortBy: 'amount',
      sortOrder: 'desc',
      search: 'Modernization',
      pipeline: 'STANDARD',
      stage: DealStage.NEW,
      status: DealStatus.OPEN,
      companyId: companyId.toString(),
      contactId: contactId.toString(),
      ownerId: ownerId.toString(),
      minAmount: 1000000,
      maxAmount: 20000000,
      currency: 'USD',
      priority: DealPriority.HIGH,
      tag: 'enterprise',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    };

    const result = await controller.list(fullQueryDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: paginatedResponse.data,
      meta: paginatedResponse.meta,
    });
    expect(mockDealsService.findAll).toHaveBeenCalledWith(
      fullQueryDto,
      actorId,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. GET /deals/pipeline — Kanban Stages with pipeline filter
  // ──────────────────────────────────────────────────────────────────────────
  it('3. GET /deals/pipeline -> retrieves grouped Kanban columns with deals and stage aggregates', async () => {
    const mockKanban = [
      {
        stage: DealStage.NEW,
        count: 1,
        totalAmount: 15000000,
        deals: [mockComprehensiveDealResponse],
      },
      {
        stage: DealStage.QUALIFIED,
        count: 0,
        totalAmount: 0,
        deals: [],
      },
    ];
    mockDealsService.getPipeline.mockResolvedValue(mockKanban);

    const result = await controller.getPipeline('STANDARD', mockReq);

    expect(result).toEqual({
      success: true,
      data: mockKanban,
    });
    expect(mockDealsService.getPipeline).toHaveBeenCalledWith(
      'STANDARD',
      actorId,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. GET /deals/forecast — Weighted Forecast with ALL Query Fields
  // ──────────────────────────────────────────────────────────────────────────
  it('4. GET /deals/forecast -> computes revenue forecast with ALL query filters', async () => {
    const mockForecast = {
      currency: 'USD',
      totalPipeline: 15000000,
      weightedPipeline: 3000000,
      count: 1,
      byStage: [
        {
          stage: DealStage.NEW,
          count: 1,
          totalAmount: 15000000,
          weightedAmount: 3000000,
        },
      ],
    };
    mockDealsService.getForecast.mockResolvedValue(mockForecast);

    const fullForecastQuery: ForecastQueryDto = {
      currency: 'USD',
      pipeline: 'STANDARD',
      ownerId: ownerId.toString(),
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    };

    const result = await controller.getForecast(fullForecastQuery, mockReq);

    expect(result).toEqual({
      success: true,
      data: mockForecast,
    });
    expect(mockDealsService.getForecast).toHaveBeenCalledWith(
      fullForecastQuery,
      actorId,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. GET /deals/export — Export Deals with ALL Query Filters
  // ──────────────────────────────────────────────────────────────────────────
  it('5. GET /deals/export -> exports filtered deals with ALL filter query parameters', async () => {
    mockDealsService.exportDeals.mockResolvedValue([
      mockComprehensiveDealResponse,
    ]);

    const fullExportQuery: ListDealsQueryDto = {
      pipeline: 'STANDARD',
      stage: DealStage.NEW,
      status: DealStatus.OPEN,
      priority: DealPriority.HIGH,
      currency: 'USD',
      minAmount: 5000000,
      maxAmount: 25000000,
    };

    const result = await controller.exportDeals(fullExportQuery, mockReq);

    expect(result).toEqual({
      success: true,
      data: [mockComprehensiveDealResponse],
    });
    expect(mockDealsService.exportDeals).toHaveBeenCalledWith(
      fullExportQuery,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. POST /deals/bulk-assign — Batch Reassign Deals
  // ──────────────────────────────────────────────────────────────────────────
  it('6. POST /deals/bulk-assign -> reassigns multiple deals with ALL fields', async () => {
    const mockBulkAssignResult = { assignedCount: 2 };
    mockDealsService.bulkAssign.mockResolvedValue(mockBulkAssignResult);

    const fullBulkAssignDto: BulkAssignDealsDto = {
      dealIds: [dealId.toString(), secondaryDealId.toString()],
      ownerId: ownerId.toString(),
    };

    const result = await controller.bulkAssign(fullBulkAssignDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: mockBulkAssignResult,
    });
    expect(mockDealsService.bulkAssign).toHaveBeenCalledWith(
      fullBulkAssignDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. GET /deals/:id — Retrieve Single Deal Details
  // ──────────────────────────────────────────────────────────────────────────
  it('7. GET /deals/:id -> retrieves full deal details by ID', async () => {
    mockDealsService.findById.mockResolvedValue(mockComprehensiveDealResponse);

    const result = await controller.findById(dealId, mockReq);

    expect(result).toEqual({
      success: true,
      data: mockComprehensiveDealResponse,
    });
    expect(mockDealsService.findById).toHaveBeenCalledWith(dealId, actorId);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. PATCH /deals/:id — Update Deal with ALL Editable Fields
  // ──────────────────────────────────────────────────────────────────────────
  it('8. PATCH /deals/:id -> updates deal with ALL editable fields', async () => {
    const updatedDealResponse = {
      ...mockComprehensiveDealResponse,
      title: 'Enterprise Multi-Cloud Architecture Modernization - Phase 2',
      amount: 18000000,
      priority: DealPriority.URGENT,
    };
    mockDealsService.update.mockResolvedValue(updatedDealResponse);

    const fullUpdateDto: UpdateDealDto = {
      title: 'Enterprise Multi-Cloud Architecture Modernization - Phase 2',
      description: 'Extended scope with disaster recovery orchestration.',
      pipeline: 'STANDARD',
      amount: 18000000,
      currency: 'USD',
      probability: 40,
      expectedCloseDate: '2027-03-31T23:59:59.000Z',
      companyId: companyId.toString(),
      contactId: contactId.toString(),
      leadId: leadId.toString(),
      products: [
        {
          name: 'Enterprise Cloud License Tier 1',
          sku: 'CLD-LIC-001',
          quantity: 12,
          unitPrice: 1000000,
          discount: 10,
          description: 'Updated with 2 additional license seats',
        },
        {
          name: 'Architecture Advisory & Integration Services',
          sku: 'ADV-SRV-200',
          quantity: 1,
          unitPrice: 7200000,
          discount: 0,
          description: 'Updated with DR design advisory',
        },
      ],
      tags: ['enterprise', 'multi-cloud', 'phase-2', 'critical'],
      priority: DealPriority.URGENT,
    };

    const result = await controller.update(dealId, fullUpdateDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: updatedDealResponse,
    });
    expect(mockDealsService.update).toHaveBeenCalledWith(
      dealId,
      fullUpdateDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. PATCH /deals/:id/stage — Change Pipeline Stage with Probability
  // ──────────────────────────────────────────────────────────────────────────
  it('9. PATCH /deals/:id/stage -> updates open stage and custom probability override', async () => {
    const stageUpdatedDeal = {
      ...mockComprehensiveDealResponse,
      stage: DealStage.PROPOSAL_SENT,
      probability: 65,
    };
    mockDealsService.changeStage.mockResolvedValue(stageUpdatedDeal);

    const fullStageDto: ChangeDealStageDto = {
      stage: DealStage.PROPOSAL_SENT,
      probability: 65,
    };

    const result = await controller.changeStage(dealId, fullStageDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: stageUpdatedDeal,
    });
    expect(mockDealsService.changeStage).toHaveBeenCalledWith(
      dealId,
      fullStageDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 10. PATCH /deals/:id/owner — Assign Single Deal Owner
  // ──────────────────────────────────────────────────────────────────────────
  it('10. PATCH /deals/:id/owner -> reassigns single deal owner with ALL fields', async () => {
    const reassignedDeal = {
      ...mockComprehensiveDealResponse,
      ownerId: ownerId.toString(),
    };
    mockDealsService.assignOwner.mockResolvedValue(reassignedDeal);

    const fullAssignDto: AssignDealDto = {
      ownerId: ownerId.toString(),
    };

    const result = await controller.assignOwner(dealId, fullAssignDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: reassignedDeal,
    });
    expect(mockDealsService.assignOwner).toHaveBeenCalledWith(
      dealId,
      fullAssignDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 11. PATCH /deals/:id/close — Close Deal with WON & LOST fields
  // ──────────────────────────────────────────────────────────────────────────
  it('11. PATCH /deals/:id/close -> closes deal as CLOSED_LOST with mandatory lostReason and competitor', async () => {
    const closedDeal = {
      ...mockComprehensiveDealResponse,
      stage: DealStage.CLOSED_LOST,
      status: DealStatus.LOST,
      probability: 0,
      lostReason: 'Competitor provided 25% lower pricing on software licensing',
      lostCompetitor: 'Contoso Cloud Systems Ltd.',
      actualCloseDate: new Date('2026-07-01T15:00:00.000Z'),
    };
    mockDealsService.closeDeal.mockResolvedValue(closedDeal);

    const fullCloseDto: CloseDealDto = {
      stage: DealStage.CLOSED_LOST,
      lostReason: 'Competitor provided 25% lower pricing on software licensing',
      lostCompetitor: 'Contoso Cloud Systems Ltd.',
    };

    const result = await controller.closeDeal(dealId, fullCloseDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: closedDeal,
    });
    expect(mockDealsService.closeDeal).toHaveBeenCalledWith(
      dealId,
      fullCloseDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 12. PATCH /deals/:id/reopen — Reopen Closed Deal with ALL Fields
  // ──────────────────────────────────────────────────────────────────────────
  it('12. PATCH /deals/:id/reopen -> reopens closed deal with ALL reopening fields', async () => {
    const reopenedDeal = {
      ...mockComprehensiveDealResponse,
      stage: DealStage.NEGOTIATION,
      status: DealStatus.OPEN,
      probability: 85,
      actualCloseDate: null,
      lostReason: null,
      lostCompetitor: null,
      closureHistory: [
        {
          id: new Types.ObjectId().toString(),
          closedAt: new Date('2026-07-01T15:00:00.000Z'),
          closedBy: actorId.toString(),
          closedStatus: DealStatus.LOST,
          closedStage: DealStage.CLOSED_LOST,
          lostReason: 'Budget constraints',
          lostCompetitor: 'Contoso Cloud Systems Ltd.',
          reopenedAt: new Date('2026-08-01T10:00:00.000Z'),
          reopenedBy: actorId.toString(),
          reopenReason:
            'Client board approved additional fiscal contingency budget for Q3',
        },
      ],
    };
    mockDealsService.reopenDeal.mockResolvedValue(reopenedDeal);

    const fullReopenDto: ReopenDealDto = {
      reopenReason:
        'Client board approved additional fiscal contingency budget for Q3',
      targetStage: DealStage.NEGOTIATION,
      probability: 85,
    };

    const result = await controller.reopenDeal(dealId, fullReopenDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: reopenedDeal,
    });
    expect(mockDealsService.reopenDeal).toHaveBeenCalledWith(
      dealId,
      fullReopenDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 13. DELETE /deals/:id — Soft Delete Deal
  // ──────────────────────────────────────────────────────────────────────────
  it('13. DELETE /deals/:id -> soft deletes deal and returns confirmation message', async () => {
    mockDealsService.softDelete.mockResolvedValue(undefined);

    const result = await controller.softDelete(dealId, mockReq);

    expect(result).toEqual({
      success: true,
      message: 'Deal successfully deleted',
    });
    expect(mockDealsService.softDelete).toHaveBeenCalledWith(dealId, actorId, {
      ipAddress: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 14. POST /deals/:id/notes — Add Deal Note with ALL Fields
  // ──────────────────────────────────────────────────────────────────────────
  it('14. POST /deals/:id/notes -> adds collaboration note to deal', async () => {
    const mockNoteResult = {
      _id: noteId,
      content:
        'Legal counsel has reviewed Master Services Agreement. Standard terms accepted.',
      createdBy: actorId,
      createdAt: new Date('2026-06-15T09:30:00.000Z'),
    };
    mockDealsService.addNote.mockResolvedValue(mockNoteResult);

    const fullNoteDto: AddDealNoteDto = {
      content:
        'Legal counsel has reviewed Master Services Agreement. Standard terms accepted.',
    };

    const result = await controller.addNote(dealId, fullNoteDto, mockReq);

    expect(result).toEqual({
      success: true,
      data: mockNoteResult,
    });
    expect(mockDealsService.addNote).toHaveBeenCalledWith(
      dealId,
      fullNoteDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 15. DELETE /deals/:id/notes/:noteId — Delete Deal Note
  // ──────────────────────────────────────────────────────────────────────────
  it('15. DELETE /deals/:id/notes/:noteId -> soft deletes specified note from deal', async () => {
    mockDealsService.deleteNote.mockResolvedValue(
      mockComprehensiveDealResponse,
    );

    const result = await controller.deleteNote(dealId, noteId, mockReq);

    expect(result).toEqual({
      success: true,
      data: mockComprehensiveDealResponse,
    });
    expect(mockDealsService.deleteNote).toHaveBeenCalledWith(
      dealId,
      noteId,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 16. POST /deals/:id/activities — Log CRM Activity with ALL Fields
  // ──────────────────────────────────────────────────────────────────────────
  it('16. POST /deals/:id/activities -> logs deal activity with ALL schema fields', async () => {
    const mockLoggedActivity = {
      _id: activityId,
      entityType: 'Deal',
      entityId: dealId,
      type: ActivityType.MEETING,
      subject: 'Executive Steering Committee Demo & Q&A',
      description:
        'Presented multi-cloud architecture demonstration to CIO and procurement committee.',
      activityDate: new Date('2026-06-20T14:00:00.000Z'),
      durationMinutes: 90,
      outcome: ActivityOutcome.COMPLETED,
      performedBy: actorId,
    };
    mockDealsService.logActivity.mockResolvedValue(mockLoggedActivity);

    const fullLogActivityDto: LogDealActivityDto = {
      type: ActivityType.MEETING,
      subject: 'Executive Steering Committee Demo & Q&A',
      description:
        'Presented multi-cloud architecture demonstration to CIO and procurement committee.',
      activityDate: '2026-06-20T14:00:00.000Z',
      durationMinutes: 90,
      outcome: ActivityOutcome.COMPLETED,
    };

    const result = await controller.logActivity(
      dealId,
      fullLogActivityDto,
      mockReq,
    );

    expect(result).toEqual({
      success: true,
      data: mockLoggedActivity,
    });
    expect(mockDealsService.logActivity).toHaveBeenCalledWith(
      dealId,
      fullLogActivityDto,
      actorId,
      {
        ipAddress: '192.168.1.100',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Swagger-Client/1.0',
      },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17. GET /deals/:id/activities — Timeline Pagination with ALL Query Fields
  // ──────────────────────────────────────────────────────────────────────────
  it('17. GET /deals/:id/activities -> retrieves paginated activity timeline with ALL query parameters', async () => {
    const mockTimelineResult = {
      data: [
        {
          _id: activityId,
          entityType: 'Deal',
          entityId: dealId,
          type: ActivityType.MEETING,
          subject: 'Executive Steering Committee Demo & Q&A',
          durationMinutes: 90,
          outcome: ActivityOutcome.COMPLETED,
          performedBy: actorId,
          activityDate: new Date('2026-06-20T14:00:00.000Z'),
        },
      ],
      meta: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
    mockDealsService.listActivities.mockResolvedValue(mockTimelineResult);

    const fullPaginationQuery: PaginationQueryDto = {
      page: 1,
      limit: 10,
    };

    const result = await controller.listActivities(
      dealId,
      fullPaginationQuery,
      mockReq,
    );

    expect(result).toEqual({
      success: true,
      data: mockTimelineResult.data,
      meta: mockTimelineResult.meta,
    });
    expect(mockDealsService.listActivities).toHaveBeenCalledWith(
      dealId,
      fullPaginationQuery,
      actorId,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 18. PATCH /deals/:id/activities/:activityId — Update Activity with ALL Fields
  // ──────────────────────────────────────────────────────────────────────────
  it('18. PATCH /deals/:id/activities/:activityId -> updates logged activity with ALL editable fields', async () => {
    const mockUpdatedActivity = {
      _id: activityId,
      entityType: 'Deal',
      entityId: dealId,
      type: ActivityType.MEETING,
      subject: 'Executive Steering Committee Demo & Q&A (Extended Session)',
      description:
        'Covered security accreditation and SOC2 compliance alongside architecture overview.',
      activityDate: new Date('2026-06-20T14:00:00.000Z'),
      durationMinutes: 120,
      outcome: ActivityOutcome.INTERESTED,
      performedBy: actorId,
    };
    mockDealsService.updateActivity.mockResolvedValue(mockUpdatedActivity);

    const fullUpdateActivityDto: UpdateDealActivityDto = {
      subject: 'Executive Steering Committee Demo & Q&A (Extended Session)',
      description:
        'Covered security accreditation and SOC2 compliance alongside architecture overview.',
      activityDate: '2026-06-20T14:00:00.000Z',
      durationMinutes: 120,
      outcome: ActivityOutcome.INTERESTED,
    };

    const result = await controller.updateActivity(
      dealId,
      activityId,
      fullUpdateActivityDto,
      mockReq,
    );

    expect(result).toEqual({
      success: true,
      data: mockUpdatedActivity,
    });
    expect(mockDealsService.updateActivity).toHaveBeenCalledWith(
      dealId,
      activityId,
      fullUpdateActivityDto,
      actorId,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 19. DELETE /deals/:id/activities/:activityId — Delete Activity
  // ──────────────────────────────────────────────────────────────────────────
  it('19. DELETE /deals/:id/activities/:activityId -> deletes logged activity from deal', async () => {
    mockDealsService.deleteActivity.mockResolvedValue(undefined);

    const result = await controller.deleteActivity(dealId, activityId, mockReq);

    expect(result).toEqual({
      success: true,
      message: 'Activity deleted successfully',
    });
    expect(mockDealsService.deleteActivity).toHaveBeenCalledWith(
      dealId,
      activityId,
      actorId,
    );
  });
});
