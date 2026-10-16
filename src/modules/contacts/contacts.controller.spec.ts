import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactStatus } from './constants/contact-status.constant';
import { DecisionRole } from './constants/decision-role.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('ContactsController', () => {
  let controller: ContactsController;

  const mockContactsService = {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    linkCompany: jest.fn(),
    unlinkCompany: jest.fn(),
    assignOwner: jest.fn(),
    softDelete: jest.fn(),
    checkDuplicate: jest.fn(),
    addNote: jest.fn(),
    deleteNote: jest.fn(),
    createDocumentUploadUrl: jest.fn(),
    confirmDocumentUploaded: jest.fn(),
    getDocumentDownloadUrl: jest.fn(),
    deleteDocument: jest.fn(),
    logActivity: jest.fn(),
    getActivityTimeline: jest.fn(),
    updateActivity: jest.fn(),
    deleteActivity: jest.fn(),
  };

  const actorId = new Types.ObjectId();
  const contactId = new Types.ObjectId();

  const mockReq: AuthenticatedRequest = {
    user: { userId: actorId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  } as unknown as AuthenticatedRequest;

  const mockContactResponse = {
    id: contactId.toString(),
    firstName: 'Sarah',
    lastName: 'Connor',
    fullName: 'Sarah Connor',
    email: 'sarah@example.com',
    phone: '+1-555-0199',
    additionalPhones: [],
    additionalEmails: [],
    companyId: null,
    isPrimaryContact: false,
    decisionRole: DecisionRole.DECISION_MAKER,
    status: ContactStatus.ACTIVE,
    tags: [],
    notes: [],
    documents: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [
        {
          provide: ContactsService,
          useValue: mockContactsService,
        },
      ],
    }).compile();

    controller = module.get<ContactsController>(ContactsController);
    jest.clearAllMocks();
  });

  it('POST /contacts -> create contact', async () => {
    mockContactsService.create.mockResolvedValue(mockContactResponse);

    const dto = {
      firstName: 'Sarah',
      lastName: 'Connor',
      email: 'sarah@example.com',
      phone: '+1-555-0199',
    };

    const res = await controller.create(dto as any, mockReq);
    expect(res).toEqual({ success: true, data: mockContactResponse });
    expect(mockContactsService.create).toHaveBeenCalledWith(dto, actorId, {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('GET /contacts -> list contacts', async () => {
    const listResult = {
      data: [mockContactResponse],
      meta: {
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
    mockContactsService.list.mockResolvedValue(listResult);

    const res = await controller.list({ page: 1, limit: 20 } as any);
    expect(res).toEqual({
      success: true,
      data: [mockContactResponse],
      meta: listResult.meta,
    });
  });

  it('POST /contacts/:id/link-company -> link contact to company', async () => {
    const companyId = new Types.ObjectId();
    const linkedContact = { ...mockContactResponse, companyId: companyId.toString(), isPrimaryContact: true };
    mockContactsService.linkCompany.mockResolvedValue(linkedContact);

    const dto = {
      companyId: companyId.toString(),
      isPrimaryContact: true,
    };

    const res = await controller.linkCompany(contactId, dto, mockReq);
    expect(res).toEqual({ success: true, data: linkedContact });
    expect(mockContactsService.linkCompany).toHaveBeenCalledWith(
      contactId,
      dto,
      actorId,
      { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
    );
  });

  it('DELETE /contacts/:id -> soft delete contact', async () => {
    mockContactsService.softDelete.mockResolvedValue(undefined);

    const res = await controller.delete(contactId, mockReq);
    expect(res).toEqual({ success: true, message: 'Contact successfully deleted' });
  });
});
