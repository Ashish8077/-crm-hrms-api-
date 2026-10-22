import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { ContactRepository } from '../contacts/repositories/contact.repository';
import { CompanyIndustry } from './constants/company-industry.constant';
import { CompanyType } from './constants/company-type.constant';
import { CompanyStatus } from './constants/company-status.constant';
import { CompanyTier } from './constants/company-tier.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('CompaniesController', () => {
  let controller: CompaniesController;

  const mockCompaniesService = {
    create: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
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

  const mockContactRepository = {
    findByCompanyId: jest.fn(),
    findPrimaryContactByCompanyId: jest.fn().mockResolvedValue(null),
  };

  const actorId = new Types.ObjectId();
  const companyId = new Types.ObjectId();

  const mockReq: AuthenticatedRequest = {
    user: { userId: actorId },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  } as unknown as AuthenticatedRequest;

  const mockCompanyResponse = {
    id: companyId.toString(),
    name: 'Acme Corp',
    domain: 'acme.com',
    industry: CompanyIndustry.TECHNOLOGY,
    type: CompanyType.CUSTOMER,
    tier: CompanyTier.TIER_1,
    status: CompanyStatus.ACTIVE,
    tags: [],
    ownerId: null,
    notes: [],
    documents: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        {
          provide: CompaniesService,
          useValue: mockCompaniesService,
        },
        {
          provide: ContactRepository,
          useValue: mockContactRepository,
        },
      ],
    }).compile();

    controller = module.get<CompaniesController>(CompaniesController);
    jest.clearAllMocks();
  });

  it('POST /companies -> create company', async () => {
    mockCompaniesService.create.mockResolvedValue(mockCompanyResponse);

    const dto = {
      name: 'Acme Corp',
      domain: 'acme.com',
    };

    const res = await controller.create(dto as any, mockReq);
    expect(res).toEqual({ success: true, data: mockCompanyResponse });
    expect(mockCompaniesService.create).toHaveBeenCalledWith(dto, actorId, {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('GET /companies -> list companies', async () => {
    const listResult = {
      data: [mockCompanyResponse],
      meta: {
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
    mockCompaniesService.list.mockResolvedValue(listResult);

    const res = await controller.list({ page: 1, limit: 20 } as any);
    expect(res).toEqual({
      success: true,
      data: [mockCompanyResponse],
      meta: listResult.meta,
    });
  });

  it('GET /companies/:id -> get company by ID', async () => {
    mockCompaniesService.getById.mockResolvedValue(mockCompanyResponse);

    const res = await controller.getById(companyId);
    expect(res).toEqual({ success: true, data: mockCompanyResponse });
    expect(mockCompaniesService.getById).toHaveBeenCalledWith(companyId);
  });

  it('DELETE /companies/:id -> soft delete company', async () => {
    mockCompaniesService.softDelete.mockResolvedValue(undefined);

    const res = await controller.delete(companyId, mockReq);
    expect(res).toEqual({ success: true, message: 'Company successfully deleted' });
  });
});
