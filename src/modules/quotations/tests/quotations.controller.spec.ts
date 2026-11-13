/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { QuotationsController } from '../quotations.controller';
import { QuotationsService } from '../services/quotations.service';
import { CustomerResponseAction, QuotationStatus } from '../constants/quotation-status.constant';

describe('QuotationsController', () => {
  let controller: QuotationsController;
  let service: jest.Mocked<QuotationsService>;

  const companyId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const quoteId = new Types.ObjectId();

  const mockAuthenticatedReq: any = {
    user: {
      userId,
      companyId,
      roleIds: [new Types.ObjectId()],
    },
    headers: {
      'x-company-id': companyId.toString(),
    },
  };

  const mockQuoteResponse: any = {
    id: quoteId.toString(),
    quoteNumber: 'QT-2026-0001',
    status: QuotationStatus.DRAFT,
    grandTotal: 1000,
    items: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuotationsController],
      providers: [
        {
          provide: QuotationsService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockQuoteResponse),
            findAll: jest.fn().mockResolvedValue({ data: [mockQuoteResponse], meta: {} }),
            findExpired: jest.fn().mockResolvedValue({ data: [], meta: {} }),
            findSummary: jest.fn().mockResolvedValue({ byStatus: [] }),
            findById: jest.fn().mockResolvedValue(mockQuoteResponse),
            update: jest.fn().mockResolvedValue(mockQuoteResponse),
            updateStatus: jest.fn().mockResolvedValue(mockQuoteResponse),
            generatePdf: jest.fn().mockResolvedValue(Buffer.from('PDF')),
            downloadPdf: jest.fn().mockResolvedValue({ buffer: Buffer.from('PDF'), filename: 'quote.pdf' }),
            sendEmail: jest.fn().mockResolvedValue({ message: 'Sent', outboxId: 'outbox-1' }),
            resendEmail: jest.fn().mockResolvedValue({ message: 'Resent', outboxId: 'outbox-2' }),
            duplicate: jest.fn().mockResolvedValue(mockQuoteResponse),
            findRevisions: jest.fn().mockResolvedValue([mockQuoteResponse]),
            spawnRevision: jest.fn().mockResolvedValue(mockQuoteResponse),
            extendValidity: jest.fn().mockResolvedValue(mockQuoteResponse),
            submitApproval: jest.fn().mockResolvedValue(mockQuoteResponse),
            reviewApproval: jest.fn().mockResolvedValue(mockQuoteResponse),
            getPortalView: jest.fn().mockResolvedValue({ quoteNumber: 'QT-2026-0001' }),
            respondPortal: jest.fn().mockResolvedValue({ success: true, message: 'Accepted' }),
            convertToOrder: jest.fn().mockResolvedValue({ salesOrder: {}, quotation: mockQuoteResponse }),
            getEmailHistory: jest.fn().mockResolvedValue([]),
            getActivityHistory: jest.fn().mockResolvedValue([]),
            softDelete: jest.fn().mockResolvedValue({ message: 'Deleted' }),
            handleEmailWebhook: jest.fn().mockResolvedValue({ success: true }),
            isUserAdminOrManager: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get<QuotationsController>(QuotationsController);
    service = module.get(QuotationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Portal Endpoints', () => {
    it('getPortalView should call service.getPortalView without auth context', async () => {
      const result = await controller.getPortalView('valid-token');
      expect(service.getPortalView).toHaveBeenCalledWith('valid-token');
      expect(result.quoteNumber).toBe('QT-2026-0001');
    });

    it('respondPortal should call service.respondPortal', async () => {
      const dto = { action: CustomerResponseAction.ACCEPT, digitalSignatureName: 'CEO' };
      const result = await controller.respondPortal('valid-token', dto, '127.0.0.1');
      expect(service.respondPortal).toHaveBeenCalledWith('valid-token', dto, '127.0.0.1');
      expect(result.success).toBe(true);
    });
  });

  describe('CRUD Endpoints', () => {
    it('create should call service.create with authenticated user and company', async () => {
      const dto: any = { contactId: new Types.ObjectId().toString(), buyerState: 'DL', items: [] };
      const result = await controller.create(dto, mockAuthenticatedReq);
      expect(service.create).toHaveBeenCalled();
      expect(result.id).toBe(quoteId.toString());
    });

    it('findById should call service.findById', async () => {
      const result = await controller.findById(quoteId, mockAuthenticatedReq);
      expect(service.findById).toHaveBeenCalled();
      expect(result.id).toBe(quoteId.toString());
    });

    it('convertToOrder should call service.convertToOrder', async () => {
      const result = await controller.convertToOrder(quoteId, {}, mockAuthenticatedReq);
      expect(service.convertToOrder).toHaveBeenCalled();
      expect(result.quotation).toBeDefined();
    });

    it('softDelete should call service.softDelete', async () => {
      const result = await controller.softDelete(quoteId, mockAuthenticatedReq);
      expect(service.softDelete).toHaveBeenCalled();
      expect(result.message).toBe('Deleted');
    });
  });
});
