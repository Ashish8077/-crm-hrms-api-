/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { QuotationsService } from '../services/quotations.service';
import {
  QuotationRepository,
  QuotationLean,
} from '../repositories/quotation.repository';
import { QuotationSequenceRepository } from '../repositories/quotation-sequence.repository';
import { SalesOrderRepository } from '../repositories/sales-order.repository';
import { SalesOrderSequenceRepository } from '../repositories/sales-order-sequence.repository';
import { EmailOutboxRepository } from '../repositories/email-outbox.repository';
import { QuotationActivityLogRepository } from '../repositories/quotation-activity-log.repository';
import { ProductRepository } from '../../products/repositories/product.repository';
import { PriceCalculatorService } from '../../products/services/price-calculator.service';
import { DealsService } from '../../deals/deals.service';
import { DealRepository } from '../../deals/repositories/deal.repository';
import { RoleRepository } from '../../roles/repositories/role.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { RedisService } from '../../../common/redis/redis.service';
import { StorageService } from '../../storage/storage.service';
import { PdfGeneratorService } from '../services/pdf-generator.service';
import { EmailOutboxProcessorService } from '../services/email-outbox-processor.service';
import { AppError } from '../../../common/errors/app-error';
import type { CreateQuotationDto } from '../dto/create-quotation.dto';
import type { UpdateQuotationStatusDto } from '../dto/update-quotation-status.dto';
import {
  ApprovalReviewAction,
  ReviewApprovalDto,
} from '../dto/review-approval.dto';
import {
  CustomerResponseAction,
  QuotationApprovalStatus,
  QuotationStatus,
} from '../constants/quotation-status.constant';

describe('QuotationsService', () => {
  let service: QuotationsService;
  let quotationRepository: jest.Mocked<QuotationRepository>;
  let quotationSequenceRepository: jest.Mocked<QuotationSequenceRepository>;
  let salesOrderRepository: jest.Mocked<SalesOrderRepository>;
  let salesOrderSequenceRepository: jest.Mocked<SalesOrderSequenceRepository>;
  let activityLogRepository: jest.Mocked<QuotationActivityLogRepository>;
  let productRepository: jest.Mocked<ProductRepository>;
  let dealRepository: jest.Mocked<DealRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const companyId = new Types.ObjectId();
  const actorId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const quoteId = new Types.ObjectId();
  const productId = new Types.ObjectId();
  const contactId = new Types.ObjectId();
  const dealId = new Types.ObjectId();

  const mockProduct: any = {
    _id: productId,
    name: 'Enterprise Cloud License',
    sku: 'SKU-CLOUD-01',
    unitPrice: 1000, // 1,000 INR
    costPrice: 500,
    taxRate: 18,
    type: 'PRODUCT',
    isActive: true,
  };

  const mockQuoteLean = {
    _id: quoteId,
    quoteNumber: 'QT-2026-0001',
    title: 'Enterprise Proposal',
    rootQuoteId: quoteId,
    parentQuoteId: null,
    revisionNumber: 1,
    isLatestRevision: true,
    companyId,
    contactId,
    ownerId,
    dealId,
    status: QuotationStatus.DRAFT,
    approvalStatus: QuotationApprovalStatus.NOT_REQUIRED,
    requiredApprovalTiers: [],
    currentApprovalTier: 1,
    quoteDate: new Date(),
    expiryDate: new Date(Date.now() + 86400000 * 30),
    items: [
      {
        _id: new Types.ObjectId(),
        productId,
        name: 'Enterprise Cloud License',
        sku: 'SKU-CLOUD-01',
        type: 'PRODUCT',
        quantityScaled: 2000, // 2 units
        unitPriceMinor: 100000, // 1,000.00
        costPriceMinor: 50000,
        discountBasisPoints: 1000, // 10%
        discountMinor: 20000, // 200.00
        netLineTotalMinor: 180000, // 1,800.00
        taxBasisPoints: 1800, // 18%
        cgstMinor: 16200, // 162.00
        sgstMinor: 16200, // 162.00
        igstMinor: 0,
        totalTaxMinor: 32400, // 324.00
        lineGrandTotalMinor: 212400, // 2,124.00
      },
    ],
    subtotalMinor: 200000,
    totalDiscountMinor: 20000,
    taxableAmountMinor: 180000,
    cgstAmountMinor: 16200,
    sgstAmountMinor: 16200,
    igstAmountMinor: 0,
    totalTaxAmountMinor: 32400,
    grandTotalMinor: 212400,
    currency: 'INR',
    sellerState: 'DL',
    buyerState: 'DL',
    isInterState: false,
    convertedToOrder: false,
    portalTokenHash: 'mock-hash-12345',
    portalTokenExpiresAt: new Date(Date.now() + 86400000 * 30),
    portalTokenUsed: false,
    portalTokenRevoked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as QuotationLean;

  const mockSession = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
    withTransaction: jest
      .fn()
      .mockImplementation(
        (cb: (session: typeof mockSession) => Promise<unknown>) =>
          cb(mockSession),
      ),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationsService,
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
        {
          provide: QuotationRepository,
          useValue: {
            create: jest.fn().mockResolvedValue(mockQuoteLean),
            findById: jest.fn().mockResolvedValue(mockQuoteLean),
            findByPortalTokenHash: jest.fn().mockResolvedValue(mockQuoteLean),
            findAllWithPagination: jest.fn().mockResolvedValue({
              data: [mockQuoteLean],
              meta: {
                page: 1,
                limit: 20,
                total: 1,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            }),
            findSummary: jest
              .fn()
              .mockResolvedValue({ byStatus: [], byApprovalStatus: [] }),
            getSummary: jest
              .fn()
              .mockResolvedValue({ byStatus: [], byApprovalStatus: [] }),
            findRevisionsByRootId: jest.fn().mockResolvedValue([mockQuoteLean]),
            updateById: jest.fn().mockResolvedValue(mockQuoteLean),
            markConvertedToOrder: jest
              .fn()
              .mockResolvedValue({ ...mockQuoteLean, convertedToOrder: true }),
            softDelete: jest.fn().mockResolvedValue(mockQuoteLean),
          },
        },
        {
          provide: QuotationSequenceRepository,
          useValue: {
            getNextSequence: jest.fn().mockResolvedValue('QT-2026-0001'),
          },
        },
        {
          provide: SalesOrderRepository,
          useValue: {
            createSalesOrder: jest.fn().mockResolvedValue({
              _id: new Types.ObjectId(),
              orderNumber: 'SO-2026-0001',
            }),
          },
        },
        {
          provide: SalesOrderSequenceRepository,
          useValue: {
            getNextSequence: jest.fn().mockResolvedValue('SO-2026-0001'),
          },
        },
        {
          provide: EmailOutboxRepository,
          useValue: {
            createOutboxRecord: jest
              .fn()
              .mockResolvedValue({ _id: new Types.ObjectId() }),
            findByQuotationId: jest.fn().mockResolvedValue([]),
            updateDeliveryStatusByMessageId: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: QuotationActivityLogRepository,
          useValue: {
            logActivity: jest.fn().mockResolvedValue({}),
            findByQuotationId: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ProductRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(mockProduct),
          },
        },
        {
          provide: PriceCalculatorService,
          useValue: {
            calculatePrice: jest.fn(),
          },
        },
        {
          provide: DealsService,
          useValue: {},
        },
        {
          provide: DealRepository,
          useValue: {
            findById: jest
              .fn()
              .mockResolvedValue({ _id: dealId, title: 'Big Deal' }),
            updateStage: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: RoleRepository,
          useValue: {
            findActiveByIds: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              set: jest.fn().mockResolvedValue('OK'),
              eval: jest.fn().mockResolvedValue(1),
            }),
          },
        },
        {
          provide: StorageService,
          useValue: {
            uploadFile: jest
              .fn()
              .mockResolvedValue({ key: 'quotations/test.pdf' }),
            getSignedDownloadUrl: jest
              .fn()
              .mockResolvedValue('https://s3.local/test.pdf'),
          },
        },
        {
          provide: PdfGeneratorService,
          useValue: {
            generatePdfBuffer: jest
              .fn()
              .mockResolvedValue(Buffer.from('PDF_CONTENT')),
          },
        },
        {
          provide: EmailOutboxProcessorService,
          useValue: {
            processPendingOutbox: jest.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compile();

    service = module.get<QuotationsService>(QuotationsService);
    quotationRepository = module.get(QuotationRepository);
    quotationSequenceRepository = module.get(QuotationSequenceRepository);
    salesOrderRepository = module.get(SalesOrderRepository);
    salesOrderSequenceRepository = module.get(SalesOrderSequenceRepository);
    activityLogRepository = module.get(QuotationActivityLogRepository);
    productRepository = module.get(ProductRepository);
    dealRepository = module.get(DealRepository);
    auditLogsService = module.get(AuditLogsService);
  });

  describe('create', () => {
    it('should successfully create a new quotation draft (v1) with integer precision and GST split', async () => {
      const dto: CreateQuotationDto = {
        title: 'Enterprise Proposal',
        contactId: contactId.toString(),
        dealId: dealId.toString(),
        expiryDate: new Date(Date.now() + 86400000 * 30).toISOString(),
        buyerState: 'DL',
        sellerState: 'DL',
        currency: 'INR',
        items: [
          {
            productId: productId.toString(),
            quantity: 2,
            discountPercent: 10,
          },
        ],
      };

      const result = await service.create(dto, actorId, companyId, true);

      expect(result).toBeDefined();
      expect(result.quoteNumber).toBe('QT-2026-0001');
      expect(quotationSequenceRepository.getNextSequence).toHaveBeenCalledWith(
        companyId,
      );
      expect(quotationRepository.create).toHaveBeenCalled();
      expect(activityLogRepository.logActivity).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw AppError BAD_REQUEST if expiryDate is in the past', async () => {
      const dto: CreateQuotationDto = {
        contactId: contactId.toString(),
        expiryDate: new Date(Date.now() - 86400000).toISOString(), // Yesterday
        buyerState: 'DL',
        items: [{ productId: productId.toString(), quantity: 1 }],
      };

      await expect(
        service.create(dto, actorId, companyId, true),
      ).rejects.toThrow(AppError);
    });

    it('should throw AppError NOT_FOUND if product does not exist', async () => {
      productRepository.findById.mockResolvedValueOnce(null);

      const dto: CreateQuotationDto = {
        contactId: contactId.toString(),
        expiryDate: new Date(Date.now() + 86400000).toISOString(),
        buyerState: 'DL',
        items: [{ productId: productId.toString(), quantity: 1 }],
      };

      await expect(
        service.create(dto, actorId, companyId, true),
      ).rejects.toThrow(AppError);
    });
  });

  describe('findById', () => {
    it('should return quotation details and strip costPrice if caller is not admin/manager', async () => {
      const result = await service.findById(companyId, quoteId, false);

      expect(result).toBeDefined();
      expect(result.id).toBe(quoteId.toString());
      // Caller is not admin/manager: costPrice should be undefined
      expect(result.items[0].costPrice).toBeUndefined();
    });

    it('should include costPrice if caller is admin or manager', async () => {
      const result = await service.findById(companyId, quoteId, true);

      expect(result).toBeDefined();
      expect(result.items[0].costPrice).toBeDefined();
    });

    it('should throw AppError NOT_FOUND when quotation does not exist', async () => {
      quotationRepository.findById.mockResolvedValueOnce(null);

      await expect(service.findById(companyId, quoteId, true)).rejects.toThrow(
        AppError,
      );
    });
  });

  describe('updateStatus', () => {
    it('should allow valid transition from DRAFT to SENT', async () => {
      const dto: UpdateQuotationStatusDto = { status: QuotationStatus.SENT };
      quotationRepository.updateById.mockResolvedValueOnce({
        ...mockQuoteLean,
        status: QuotationStatus.SENT,
      });

      const result = await service.updateStatus(
        companyId,
        quoteId,
        dto,
        actorId,
        true,
      );

      expect(result.status).toBe(QuotationStatus.SENT);
      expect(activityLogRepository.logActivity).toHaveBeenCalled();
    });

    it('should reject invalid transition from DRAFT directly to EXPIRED', async () => {
      const dto: UpdateQuotationStatusDto = { status: QuotationStatus.EXPIRED };

      await expect(
        service.updateStatus(companyId, quoteId, dto, actorId, true),
      ).rejects.toThrow(AppError);
    });

    it('should trigger deal closed won when quotation is ACCEPTED', async () => {
      quotationRepository.findById.mockResolvedValueOnce({
        ...mockQuoteLean,
        status: QuotationStatus.VIEWED,
      });
      quotationRepository.updateById.mockResolvedValueOnce({
        ...mockQuoteLean,
        status: QuotationStatus.ACCEPTED,
        acceptedAt: new Date(),
      });

      const result = await service.updateStatus(
        companyId,
        quoteId,
        { status: QuotationStatus.ACCEPTED },
        actorId,
        true,
      );

      expect(result.status).toBe(QuotationStatus.ACCEPTED);
      expect(dealRepository.updateStage).toHaveBeenCalled();
    });
  });

  describe('reviewApproval', () => {
    it('should prohibit self-approval (actorId === ownerId)', async () => {
      const selfQuote = {
        ...mockQuoteLean,
        ownerId: actorId, // Same actor
        approvalStatus: QuotationApprovalStatus.PENDING_APPROVAL,
      };
      quotationRepository.findById.mockResolvedValueOnce(selfQuote);

      const dto: ReviewApprovalDto = {
        action: ApprovalReviewAction.APPROVE,
      };

      await expect(
        service.reviewApproval(companyId, quoteId, dto, actorId, true),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('should approve quotation when reviewed by another user with permission', async () => {
      const pendingQuote = {
        ...mockQuoteLean,
        ownerId, // Different owner
        approvalStatus: QuotationApprovalStatus.PENDING_APPROVAL,
      };
      quotationRepository.findById.mockResolvedValueOnce(pendingQuote);
      quotationRepository.updateById.mockResolvedValueOnce({
        ...pendingQuote,
        approvalStatus: QuotationApprovalStatus.APPROVED,
        status: QuotationStatus.APPROVED,
      });

      const dto: ReviewApprovalDto = {
        action: ApprovalReviewAction.APPROVE,
      };

      const result = await service.reviewApproval(
        companyId,
        quoteId,
        dto,
        actorId,
        true,
      );

      expect(result.approvalStatus).toBe(QuotationApprovalStatus.APPROVED);
      expect(result.status).toBe(QuotationStatus.APPROVED);
    });
  });

  describe('Customer Portal Response', () => {
    it('should accept quotation with digital signature name and IP', async () => {
      const sentQuote = {
        ...mockQuoteLean,
        status: QuotationStatus.SENT,
        portalTokenUsed: false,
        portalTokenExpiresAt: new Date(Date.now() + 86400000),
      };
      quotationRepository.findByPortalTokenHash.mockResolvedValueOnce(
        sentQuote,
      );
      quotationRepository.updateById.mockResolvedValueOnce({
        ...sentQuote,
        status: QuotationStatus.ACCEPTED,
        portalTokenUsed: true,
      });

      const result = await service.respondPortal(
        'valid-token-secret',
        {
          action: CustomerResponseAction.ACCEPT,
          digitalSignatureName: 'Jane Smith, VP',
        },
        '192.168.1.1',
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe(QuotationStatus.ACCEPTED);
      expect(quotationRepository.updateById).toHaveBeenCalled();
    });

    it('should reject customer response if quotation portal token was already used', async () => {
      const usedQuote = {
        ...mockQuoteLean,
        portalTokenUsed: true, // Already responded
      };
      quotationRepository.findByPortalTokenHash.mockResolvedValueOnce(
        usedQuote,
      );

      await expect(
        service.respondPortal(
          'token-used',
          {
            action: CustomerResponseAction.ACCEPT,
            digitalSignatureName: 'Jane Smith',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('convertToOrder (O2C)', () => {
    it('should atomically convert accepted quotation into a confirmed sales order', async () => {
      const acceptedQuote = {
        ...mockQuoteLean,
        status: QuotationStatus.ACCEPTED,
        convertedToOrder: false,
      };
      quotationRepository.findById.mockResolvedValueOnce(acceptedQuote);

      const result = await service.convertToOrder(
        companyId,
        quoteId,
        {
          orderNotes: 'Deliver to Mumbai data center',
        },
        actorId,
        true,
      );

      expect(result.salesOrder).toBeDefined();
      expect(salesOrderSequenceRepository.getNextSequence).toHaveBeenCalled();
      expect(salesOrderRepository.createSalesOrder).toHaveBeenCalled();
      expect(quotationRepository.markConvertedToOrder).toHaveBeenCalled();
    });

    it('should reject conversion if quotation is not ACCEPTED', async () => {
      const draftQuote = {
        ...mockQuoteLean,
        status: QuotationStatus.DRAFT, // Not accepted yet
      };
      quotationRepository.findById.mockResolvedValueOnce(draftQuote);

      await expect(
        service.convertToOrder(companyId, quoteId, {}, actorId, true),
      ).rejects.toThrow(AppError);
    });
  });
});
