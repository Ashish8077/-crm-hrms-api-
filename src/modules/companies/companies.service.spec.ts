/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CompaniesService } from './companies.service';
import { CompanyRepository, CompanyLean } from './repositories/company.repository';
import { UserRepository } from '../users/repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { StorageService } from '../storage/storage.service';
import { RedisService } from '../../common/redis/redis.service';
import { CrmActivityRepository } from '../../common/repositories/crm-activity.repository';
import { FailedStorageOperation } from '../storage/schemas/failed-storage-operation.schema';
import { CompanyIndustry } from './constants/company-industry.constant';
import { CompanyType } from './constants/company-type.constant';
import { CompanyStatus } from './constants/company-status.constant';
import { CompanyTier } from './constants/company-tier.constant';
import { UserStatus } from '../users/constants/user-status.constant';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { SystemRole } from '../roles/constants/role.constant';

describe('CompaniesService', () => {
  let service: CompaniesService;
  let companyRepository: jest.Mocked<CompanyRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let storageService: jest.Mocked<StorageService>;
  let redisService: jest.Mocked<RedisService>;
  let crmActivityRepository: jest.Mocked<CrmActivityRepository>;

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation(async <T>(cb: (session: unknown) => Promise<T>) => {
        return cb(mockSession);
      }),
    endSession: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const actorId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const companyId = new Types.ObjectId();

  const clientMetadata: ClientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test-agent',
  };

  const mockCompanyLean: CompanyLean = {
    _id: companyId,
    name: 'Acme Technologies Inc.',
    legalName: 'Acme Technologies Incorporated',
    domain: 'acme.com',
    website: 'https://acme.com',
    industry: CompanyIndustry.TECHNOLOGY,
    type: CompanyType.CUSTOMER,
    tier: CompanyTier.TIER_1,
    status: CompanyStatus.ACTIVE,
    annualRevenue: 5000000,
    currency: 'USD',
    employeeCount: 150,
    registrationNumber: 'US12345678',
    taxId: 'TX-998877',
    email: 'contact@acme.com',
    phone: '+1-555-0100',
    additionalPhones: [],
    additionalEmails: [],
    address: {},
    socialLinks: {},
    parentCompanyId: null,
    ownerId: ownerId,
    tags: ['enterprise'],
    notes: [],
    documents: [],
    deletedAt: null,
    createdBy: actorId,
    updatedBy: actorId,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        {
          provide: CompanyRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
            softDelete: jest.fn(),
            checkDuplicate: jest.fn(),
            findByRegistrationNumber: jest.fn(),
            findDescendantIds: jest.fn(),
            addNote: jest.fn(),
            deleteNote: jest.fn(),
            softDeleteNote: jest.fn(),
            addDocument: jest.fn(),
            deleteDocument: jest.fn(),
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
            findActiveByIds: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            getPresignedUploadUrl: jest.fn(),
            getPresignedDownloadUrl: jest.fn(),
            deleteFile: jest.fn(),
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
          provide: getModelToken(FailedStorageOperation.name),
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<CompaniesService>(CompaniesService);
    companyRepository = module.get(CompanyRepository);
    userRepository = module.get(UserRepository);
    roleRepository = module.get(RoleRepository);
    auditLogsService = module.get(AuditLogsService);
    storageService = module.get(StorageService);
    redisService = module.get(RedisService);
    crmActivityRepository = module.get(CrmActivityRepository);

    jest.clearAllMocks();
  });

  describe('create company', () => {
    it('creates company successfully when registration number is unique', async () => {
      userRepository.findById.mockResolvedValue({
        _id: ownerId,
        status: UserStatus.ACTIVE,
      } as any);
      companyRepository.checkDuplicate.mockResolvedValue(null);
      companyRepository.create.mockResolvedValue(mockCompanyLean);

      const dto = {
        name: 'Acme Technologies Inc.',
        registrationNumber: 'US-1234 5678',
        ownerId: ownerId.toString(),
      };

      const result = await service.create(dto, actorId, clientMetadata);
      expect(result.id).toBe(companyId.toString());
      expect(companyRepository.create).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('throws CONFLICT when registration number already exists', async () => {
      companyRepository.checkDuplicate.mockResolvedValue(mockCompanyLean);

      const dto = {
        name: 'Another Company',
        registrationNumber: 'US 1234-5678',
      };

      await expect(service.create(dto, actorId, clientMetadata)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('throws RESOURCE_NOT_FOUND when parent company does not exist', async () => {
      const parentId = new Types.ObjectId();
      companyRepository.checkDuplicate.mockResolvedValue(null);
      companyRepository.findById.mockResolvedValue(null);

      const dto = {
        name: 'Child Company',
        parentCompanyId: parentId.toString(),
      };

      await expect(service.create(dto, actorId, clientMetadata)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });
  });

  describe('update company hierarchy validation', () => {
    it('prevents company from being its own parent', async () => {
      companyRepository.findById.mockResolvedValue(mockCompanyLean);

      const dto = {
        parentCompanyId: companyId.toString(),
      };

      await expect(service.update(companyId, dto, actorId, clientMetadata)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('prevents setting an ancestor company as parent to avoid cycles', async () => {
      const parentId = new Types.ObjectId();
      companyRepository.findById.mockResolvedValueOnce(mockCompanyLean); // for update target
      companyRepository.findById.mockResolvedValueOnce({
        _id: parentId,
        name: 'Parent',
        parentCompanyId: companyId,
      } as any); // for proposed parent check

      const dto = {
        parentCompanyId: parentId.toString(),
      };

      await expect(service.update(companyId, dto, actorId, clientMetadata)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('notes limits', () => {
    it('throws when company already reached max notes cap (100)', async () => {
      const hundredNotes = Array.from({ length: 100 }, (_, i) => ({
        _id: new Types.ObjectId(),
        content: `Note ${i}`,
        createdBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      companyRepository.findById.mockResolvedValue({
        ...mockCompanyLean,
        notes: hundredNotes as any,
      });

      await expect(
        service.addNote(companyId, { content: 'Exceeding note' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('activity authorization', () => {
    const activityId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();

    it('allows author to update activity', async () => {
      crmActivityRepository.findById.mockResolvedValue({
        _id: activityId,
        entityType: 'COMPANY' as any,
        entityId: companyId,
        performedBy: actorId,
      } as any);
      userRepository.findById.mockResolvedValue({
        _id: actorId,
        roleIds: [],
      } as any);
      crmActivityRepository.updateById.mockResolvedValue({
        _id: activityId,
        subject: 'Updated subject',
      } as any);

      const result = await service.updateActivity(
        companyId,
        activityId,
        { subject: 'Updated subject' },
        actorId,
      );

      expect(result.subject).toBe('Updated subject');
    });

    it('allows admin to delete another user activity', async () => {
      crmActivityRepository.findById.mockResolvedValue({
        _id: activityId,
        entityType: 'COMPANY' as any,
        entityId: companyId,
        performedBy: otherUserId,
      } as any);
      const adminRoleId = new Types.ObjectId();
      userRepository.findById.mockResolvedValue({
        _id: actorId,
        roleIds: [adminRoleId],
      } as any);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: adminRoleId, key: SystemRole.SUPER_ADMIN },
      ] as any);

      await expect(
        service.deleteActivity(companyId, activityId, actorId),
      ).resolves.not.toThrow();

      expect(crmActivityRepository.softDelete).toHaveBeenCalledWith(activityId, actorId);
    });

    it('rejects non-author non-admin user from deleting activity', async () => {
      crmActivityRepository.findById.mockResolvedValue({
        _id: activityId,
        entityType: 'COMPANY' as any,
        entityId: companyId,
        performedBy: otherUserId,
      } as any);
      userRepository.findById.mockResolvedValue({
        _id: actorId,
        roleIds: [],
      } as any);

      await expect(
        service.deleteActivity(companyId, activityId, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });
  });
});
