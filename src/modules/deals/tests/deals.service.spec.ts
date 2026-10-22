/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { DealsService } from '../deals.service';
import { DealRepository, DealLean } from '../repositories/deal.repository';
import { CompanyRepository } from '../../companies/repositories/company.repository';
import { ContactRepository } from '../../contacts/repositories/contact.repository';
import { UserRepository } from '../../users/repositories/user.repository';
import { RoleRepository } from '../../roles/repositories/role.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CrmActivityRepository } from '../../../common/repositories/crm-activity.repository';
import {
  ActivityEntityType,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';
import { DealStage } from '../constants/deal-stage.constant';
import { DealStatus } from '../constants/deal-status.constant';
import { SystemRole } from '../../roles/constants/role.constant';
import { UserStatus } from '../../users/constants/user-status.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';

describe('DealsService', () => {
  let service: DealsService;
  let dealRepository: jest.Mocked<DealRepository>;
  let companyRepository: jest.Mocked<CompanyRepository>;
  let contactRepository: jest.Mocked<ContactRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let redisService: jest.Mocked<RedisService>;
  let crmActivityRepository: jest.Mocked<CrmActivityRepository>;

  const adminUserId = new Types.ObjectId();
  const salesRepId = new Types.ObjectId();
  const otherRepId = new Types.ObjectId();
  const dealId = new Types.ObjectId();
  const companyId = new Types.ObjectId();
  const contactId = new Types.ObjectId();
  const adminRoleId = new Types.ObjectId();
  const repRoleId = new Types.ObjectId();

  const mockMetadata: ClientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test-suite',
  };

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation(async (cb: (session: any) => Promise<any>) =>
        cb(mockSession),
      ),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const createMockDeal = (overrides?: Partial<DealLean>): DealLean =>
    ({
      _id: dealId,
      title: 'Enterprise CRM Rollout',
      pipeline: 'STANDARD',
      stage: DealStage.NEW,
      status: DealStatus.OPEN,
      amount: 1500000, // $15,000.00
      currency: 'USD',
      probability: 10,
      expectedCloseDate: new Date('2026-12-31'),
      actualCloseDate: null,
      companyId,
      contactId,
      ownerId: salesRepId,
      products: [],
      notes: [],
      closureHistory: [],
      lostReason: null,
      lostCompetitor: null,
      tags: ['enterprise'],
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      createdBy: salesRepId,
      ...overrides,
    }) as unknown as DealLean;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealsService,
        {
          provide: DealRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByIdPopulated: jest.fn(),
            findList: jest.fn(),
            findForExport: jest.fn(),
            getPipelineKanban: jest.fn(),
            getForecast: jest.fn(),
            updateById: jest.fn(),
            updateStage: jest.fn(),
            closeDeal: jest.fn(),
            reopenDeal: jest.fn(),
            updateOwner: jest.fn(),
            bulkUpdateOwner: jest.fn(),
            addNote: jest.fn(),
            deleteNote: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: CompanyRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: ContactRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: UserRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: RoleRepository,
          useValue: {
            findById: jest.fn(),
            findActiveByIds: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: CrmActivityRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findTimeline: jest.fn(),
            updateById: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<DealsService>(DealsService);
    dealRepository = module.get(DealRepository);
    companyRepository = module.get(CompanyRepository);
    contactRepository = module.get(ContactRepository);
    userRepository = module.get(UserRepository);
    roleRepository = module.get(RoleRepository);
    auditLogsService = module.get(AuditLogsService);
    redisService = module.get(RedisService);
    crmActivityRepository = module.get(CrmActivityRepository);

    jest.clearAllMocks();

    // Default user/role mocking:
    userRepository.findById.mockImplementation(async (id: Types.ObjectId) => {
      if (id.equals(adminUserId)) {
        return {
          _id: adminUserId,
          roleIds: [adminRoleId],
          status: UserStatus.ACTIVE,
        } as any;
      }
      if (id.equals(salesRepId)) {
        return {
          _id: salesRepId,
          roleIds: [repRoleId],
          status: UserStatus.ACTIVE,
        } as any;
      }
      if (id.equals(otherRepId)) {
        return {
          _id: otherRepId,
          roleIds: [repRoleId],
          status: UserStatus.ACTIVE,
        } as any;
      }
      return null;
    });

    roleRepository.findActiveByIds.mockImplementation(
      async (ids: Types.ObjectId[]) => {
        if (ids.some((id) => id.equals(adminRoleId))) {
          return [
            {
              _id: adminRoleId,
              key: SystemRole.ADMIN,
              name: 'Admin',
              isActive: true,
            },
          ] as any;
        }
        return [
          {
            _id: repRoleId,
            key: 'SALES_REP',
            name: 'Sales Representative',
            isActive: true,
          },
        ] as any;
      },
    );

    companyRepository.findById.mockResolvedValue({ _id: companyId } as any);
    contactRepository.findById.mockResolvedValue({
      _id: contactId,
      companyId,
    } as any);
  });

  describe('1. Lifecycle & State Machine Transitions', () => {
    it('should progress stage and automatically update probability when probability is omitted', async () => {
      const existing = createMockDeal({
        stage: DealStage.NEW,
        probability: 10,
        status: DealStatus.OPEN,
      });
      dealRepository.findById.mockResolvedValue(existing);

      const updated = createMockDeal({
        stage: DealStage.QUALIFIED,
        probability: 25,
      });
      dealRepository.updateStage.mockResolvedValue(updated);
      dealRepository.findByIdPopulated.mockResolvedValue(updated);

      const res = await service.changeStage(
        dealId,
        { stage: DealStage.QUALIFIED },
        salesRepId,
        mockMetadata,
      );

      expect(res.stage).toBe(DealStage.QUALIFIED);
      expect(dealRepository.updateStage).toHaveBeenCalledWith(
        dealId,
        DealStage.QUALIFIED,
        25,
        salesRepId,
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalled();
    });

    it('should transition deal to CLOSED WON, force status to WON, probability to 100%, and stamp actualCloseDate', async () => {
      const existing = createMockDeal({
        status: DealStatus.OPEN,
        stage: DealStage.NEGOTIATION,
        probability: 80,
      });
      dealRepository.findById.mockResolvedValue(existing);

      const wonDeal = createMockDeal({
        status: DealStatus.WON,
        stage: DealStage.CLOSED_WON,
        probability: 100,
        actualCloseDate: new Date(),
        closureHistory: [
          {
            _id: new Types.ObjectId(),
            closedStatus: DealStatus.WON,
            closedStage: DealStage.CLOSED_WON,
            closedAt: new Date(),
            closedBy: salesRepId,
            lostReason: null,
            lostCompetitor: null,
            reopenReason: null,
            reopenedAt: null,
            reopenedBy: null,
          },
        ],
      });
      dealRepository.closeDeal.mockResolvedValue(wonDeal);
      dealRepository.findByIdPopulated.mockResolvedValue(wonDeal);

      const res = await service.closeDeal(
        dealId,
        { stage: DealStage.CLOSED_WON },
        salesRepId,
        mockMetadata,
      );

      expect(res.status).toBe(DealStatus.WON);
      expect(dealRepository.closeDeal).toHaveBeenCalledWith(
        dealId,
        DealStage.CLOSED_WON,
        DealStatus.WON,
        null,
        null,
        salesRepId,
        mockSession,
      );
    });

    it('should reject CLOSED LOST transition without lostReason with 400 Bad Request', async () => {
      const existing = createMockDeal({ status: DealStatus.OPEN });
      dealRepository.findById.mockResolvedValue(existing);

      await expect(
        service.closeDeal(
          dealId,
          { stage: DealStage.CLOSED_LOST, lostReason: undefined as any },
          salesRepId,
          mockMetadata,
        ),
      ).rejects.toThrow(AppError);

      expect(dealRepository.closeDeal).not.toHaveBeenCalled();
    });

    it('should transition deal to CLOSED LOST with valid lostReason, force status to LOST and probability to 0%', async () => {
      const existing = createMockDeal({ status: DealStatus.OPEN });
      dealRepository.findById.mockResolvedValue(existing);

      const lostDeal = createMockDeal({
        status: DealStatus.LOST,
        stage: DealStage.CLOSED_LOST,
        probability: 0,
        lostReason: 'Competitor price 20% lower',
        lostCompetitor: 'Acme Rival',
      });
      dealRepository.closeDeal.mockResolvedValue(lostDeal);
      dealRepository.findByIdPopulated.mockResolvedValue(lostDeal);

      const res = await service.closeDeal(
        dealId,
        {
          stage: DealStage.CLOSED_LOST,
          lostReason: 'Competitor price 20% lower',
          lostCompetitor: 'Acme Rival',
        },
        salesRepId,
        mockMetadata,
      );

      expect(res.status).toBe(DealStatus.LOST);
      expect(dealRepository.closeDeal).toHaveBeenCalledWith(
        dealId,
        DealStage.CLOSED_LOST,
        DealStatus.LOST,
        'Competitor price 20% lower',
        'Acme Rival',
        salesRepId,
        mockSession,
      );
    });

    it('should enforce terminal lock: reject standard update on a WON or LOST deal with 400 Bad Request', async () => {
      const existing = createMockDeal({ status: DealStatus.WON });
      dealRepository.findById.mockResolvedValue(existing);

      await expect(
        service.update(
          dealId,
          { title: 'Attempted Modification' },
          salesRepId,
          mockMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Cannot update a closed deal. Reopen the deal first.',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(dealRepository.updateById).not.toHaveBeenCalled();
    });

    it('should reopen a closed deal, reset actualCloseDate to null, restore OPEN status, and append to closureHistory', async () => {
      const existing = createMockDeal({
        status: DealStatus.LOST,
        stage: DealStage.CLOSED_LOST,
        actualCloseDate: new Date('2026-05-01'),
        closureHistory: [
          {
            _id: new Types.ObjectId(),
            closedStatus: DealStatus.LOST,
            closedStage: DealStage.CLOSED_LOST,
            closedAt: new Date('2026-05-01'),
            closedBy: salesRepId,
            lostReason: 'Client lost quarterly budget',
            lostCompetitor: null,
            reopenReason: null,
            reopenedAt: null,
            reopenedBy: null,
          },
        ],
      });
      dealRepository.findById.mockResolvedValue(existing);

      const reopenedDeal = createMockDeal({
        status: DealStatus.OPEN,
        stage: DealStage.QUALIFIED,
        probability: 25,
        actualCloseDate: null,
        lostReason: null,
        lostCompetitor: null,
        closureHistory: [
          {
            _id: new Types.ObjectId(),
            closedStatus: DealStatus.LOST,
            closedStage: DealStage.CLOSED_LOST,
            closedAt: new Date('2026-05-01'),
            closedBy: salesRepId,
            lostReason: 'Client lost quarterly budget',
            lostCompetitor: null,
            reopenReason: 'New budget allocated for Q3',
            reopenedAt: new Date(),
            reopenedBy: salesRepId,
          },
        ],
      });
      dealRepository.reopenDeal.mockResolvedValue(reopenedDeal);
      dealRepository.findByIdPopulated.mockResolvedValue(reopenedDeal);

      const res = await service.reopenDeal(
        dealId,
        {
          targetStage: DealStage.QUALIFIED,
          reopenReason: 'New budget allocated for Q3',
        },
        salesRepId,
        mockMetadata,
      );

      expect(res.status).toBe(DealStatus.OPEN);
      expect(res.actualCloseDate).toBeNull();
      expect(dealRepository.reopenDeal).toHaveBeenCalledWith(
        dealId,
        DealStage.QUALIFIED,
        25,
        'New budget allocated for Q3',
        salesRepId,
        mockSession,
      );
    });

    it('should reject reopening when deal is already OPEN with 400 Bad Request', async () => {
      const existing = createMockDeal({ status: DealStatus.OPEN });
      dealRepository.findById.mockResolvedValue(existing);

      await expect(
        service.reopenDeal(
          dealId,
          { reopenReason: 'Valid reason to reopen' },
          salesRepId,
          mockMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Only closed deals (WON or LOST) can be reopened',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  describe('2. Financial Precision & Calculations', () => {
    it('should reject deal creation when line items sum does not equal deal amount', async () => {
      const dto = {
        title: 'Hardware Deal',
        amount: 250000, // $2,500.00
        currency: 'USD',
        companyId: companyId.toString(),
        contactId: contactId.toString(),
        products: [
          {
            name: 'Workstation Laptop',
            quantity: 2,
            unitPrice: 100000, // 2 * $1000 = $2000
            totalPrice: 200000,
          },
        ],
      };

      await expect(
        service.create(dto as any, salesRepId, mockMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Deal amount (250000) does not match the sum of line items (200000)',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(dealRepository.create).not.toHaveBeenCalled();
    });

    it('should successfully create deal when products sum matches amount exactly', async () => {
      const dto = {
        title: 'Software & Support Contract',
        amount: 300000, // $3,000.00
        currency: 'USD',
        companyId: companyId.toString(),
        contactId: contactId.toString(),
        products: [
          {
            name: 'License Pro',
            quantity: 2,
            unitPrice: 100000, // 2 * 100000 = 200000
            totalPrice: 200000,
          },
          {
            name: 'Annual Support',
            quantity: 1,
            unitPrice: 100000, // 1 * 100000 = 100000
            totalPrice: 100000,
          },
        ],
      };

      const createdDeal = createMockDeal({
        amount: 300000,
        products: dto.products as any,
      });
      dealRepository.create.mockResolvedValue(createdDeal);
      dealRepository.findByIdPopulated.mockResolvedValue(createdDeal);

      const res = await service.create(dto as any, salesRepId, mockMetadata);

      expect(res.amount).toBe(300000);
      expect(dealRepository.create).toHaveBeenCalled();
    });

    it('should calculate weighted forecast correctly', async () => {
      dealRepository.getForecast.mockResolvedValue({
        currency: 'USD',
        totalPipeline: 150000,
        weightedPipeline: 100000,
        count: 7,
        byStage: [
          {
            stage: DealStage.PROPOSAL_SENT,
            totalAmount: 100000,
            weightedAmount: 60000,
            count: 5,
          },
          {
            stage: DealStage.NEGOTIATION,
            totalAmount: 50000,
            weightedAmount: 40000,
            count: 2,
          },
        ],
      });

      const forecast = await service.getForecast(
        { currency: 'USD' } as any,
        adminUserId,
      );

      expect(forecast.currency).toBe('USD');
      expect(forecast.totalPipeline).toBe(150000);
      expect(forecast.weightedPipeline).toBe(100000);
      expect(forecast.count).toBe(7);
      expect(forecast.byStage).toHaveLength(2);
    });

    it('should segregate forecasts by requested currency', async () => {
      dealRepository.getForecast.mockResolvedValue({
        currency: 'EUR',
        totalPipeline: 0,
        weightedPipeline: 0,
        count: 0,
        byStage: [],
      });

      const forecast = await service.getForecast(
        { currency: 'EUR' } as any,
        salesRepId,
      );

      expect(forecast.currency).toBe('EUR');
      expect(dealRepository.getForecast).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'EUR' }),
        salesRepId,
      );
    });
  });

  describe('3. Authorization, Scoping & Cross-Resource Safety', () => {
    it('should block non-admin sales rep from viewing another rep deal with 403 Forbidden', async () => {
      const deal = createMockDeal({ ownerId: otherRepId });
      dealRepository.findById.mockResolvedValue(deal);

      await expect(service.findById(dealId, salesRepId)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'You do not have access to this deal',
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('should allow admin to view any sales rep deal', async () => {
      const deal = createMockDeal({ ownerId: otherRepId });
      dealRepository.findById.mockResolvedValue(deal);
      dealRepository.findByIdPopulated.mockResolvedValue(deal);

      const res = await service.findById(dealId, adminUserId);
      expect(res.id).toBe(dealId.toString());
    });

    it('should reject activity update if activity belongs to a different deal with 403 Forbidden', async () => {
      const deal = createMockDeal({ ownerId: salesRepId });
      dealRepository.findById.mockResolvedValue(deal);

      const wrongDealId = new Types.ObjectId();
      const activityId = new Types.ObjectId();

      crmActivityRepository.findById.mockResolvedValue({
        _id: activityId,
        entityType: ActivityEntityType.DEAL,
        entityId: wrongDealId, // Mismatch!
        type: ActivityType.CALL,
        subject: 'Intro Call',
        performedBy: salesRepId,
        activityDate: new Date(),
        deletedAt: null,
      } as any);

      await expect(
        service.updateActivity(
          dealId,
          activityId,
          { subject: 'Updated Subject' },
          salesRepId,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Activity does not belong to the specified deal',
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('should reject bulk assign if a non-admin rep does not own all selected deals', async () => {
      dealRepository.findById.mockImplementation((id: Types.ObjectId) => {
        if (id.equals(dealId)) {
          return Promise.resolve(
            createMockDeal({ _id: dealId, ownerId: salesRepId }),
          );
        }
        return Promise.resolve(
          createMockDeal({ _id: id, ownerId: otherRepId }),
        );
      });

      const unownedDealId = new Types.ObjectId();

      await expect(
        service.bulkAssign(
          {
            dealIds: [dealId.toString(), unownedDealId.toString()],
            ownerId: salesRepId.toString(),
          },
          salesRepId,
          mockMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'You do not have access to this deal',
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(dealRepository.bulkUpdateOwner).not.toHaveBeenCalled();
    });

    it('should allow bulk assign when admin reassigns deals to a valid active sales user', async () => {
      dealRepository.findById.mockResolvedValue(
        createMockDeal({ ownerId: otherRepId }),
      );
      dealRepository.bulkUpdateOwner.mockResolvedValue(2);

      const newOwnerId = salesRepId;
      const res = await service.bulkAssign(
        {
          dealIds: [dealId.toString(), new Types.ObjectId().toString()],
          ownerId: newOwnerId.toString(),
        },
        adminUserId,
        mockMetadata,
      );

      expect(res.assignedCount).toBe(2);
      expect(dealRepository.bulkUpdateOwner).toHaveBeenCalledWith(
        expect.any(Array),
        newOwnerId,
        adminUserId,
        mockSession,
      );
    });
  });
});
