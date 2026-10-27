/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ContactsService } from './contacts.service';
import {
  ContactRepository,
  ContactLean,
} from './repositories/contact.repository';
import {
  CompanyRepository,
  CompanyLean,
} from '../companies/repositories/company.repository';
import {
  UserRepository,
  UserLean,
} from '../users/repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { RoleLean } from '../roles/types/role.repository.types';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { StorageService } from '../storage/storage.service';
import { RedisService } from '../../common/redis/redis.service';
import {
  CrmActivityLean,
  CrmActivityRepository,
} from '../../common/repositories/crm-activity.repository';
import { ActivityEntityType } from '../../common/schemas/crm-activity.schema';
import { FailedStorageOperation } from '../storage/schemas/failed-storage-operation.schema';
import { ContactStatus } from './constants/contact-status.constant';
import { DecisionRole } from './constants/decision-role.constant';
import { UserStatus } from '../users/constants/user-status.constant';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { SystemRole } from '../roles/constants/role.constant';

describe('ContactsService', () => {
  let service: ContactsService;
  let contactRepository: jest.Mocked<ContactRepository>;
  let companyRepository: jest.Mocked<CompanyRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
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
  const contactId = new Types.ObjectId();

  const clientMetadata: ClientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test-agent',
  };

  const mockContactLean: ContactLean = {
    _id: contactId,
    firstName: 'Sarah',
    lastName: 'Connor',
    email: 'sarah.connor@cyberdyne.com',
    phone: '+1-555-0199',
    mobilePhone: '+1-555-0198',
    workPhone: '+1-555-0100',
    additionalPhones: [],
    alternateEmail: 'sarah.personal@gmail.com',
    additionalEmails: [],
    companyId: companyId,
    jobTitle: 'Chief of Security',
    department: 'Operations',
    isPrimaryContact: true,
    decisionRole: DecisionRole.DECISION_MAKER,
    address: {},
    socialLinks: {},
    ownerId: ownerId,
    leadId: null,
    status: ContactStatus.ACTIVE,
    tags: ['vip'],
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
        ContactsService,
        {
          provide: ContactRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
            softDelete: jest.fn(),
            findByEmail: jest.fn(),
            checkDuplicate: jest.fn(),
            checkEmailCollision: jest.fn(),
            transferCompanyAndPrimary: jest.fn(),
            unlinkCompany: jest.fn(),
            addNote: jest.fn(),
            deleteNote: jest.fn(),
            softDeleteNote: jest.fn(),
            addDocument: jest.fn(),
            deleteDocument: jest.fn(),
          },
        },
        {
          provide: CompanyRepository,
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

    service = module.get<ContactsService>(ContactsService);
    contactRepository = module.get(ContactRepository);
    companyRepository = module.get(CompanyRepository);
    userRepository = module.get(UserRepository);
    roleRepository = module.get(RoleRepository);
    auditLogsService = module.get(AuditLogsService);
    redisService = module.get(RedisService);
    crmActivityRepository = module.get(CrmActivityRepository);

    jest.clearAllMocks();
  });

  describe('create contact', () => {
    it('creates contact successfully with company linkage', async () => {
      userRepository.findById.mockResolvedValue({
        _id: ownerId,
        status: UserStatus.ACTIVE,
      } as unknown as UserLean);
      companyRepository.findById.mockResolvedValue({
        _id: companyId,
        deletedAt: null,
      } as unknown as CompanyLean);
      contactRepository.checkEmailCollision.mockResolvedValue(null);
      contactRepository.checkDuplicate.mockResolvedValue(null);
      contactRepository.create.mockResolvedValue(mockContactLean);

      const dto = {
        firstName: 'Sarah',
        lastName: 'Connor',
        email: 'SARAH.CONNOR@CYBERDYNE.COM',
        phone: '+1-555-0199',
        companyId: companyId.toString(),
        ownerId: ownerId.toString(),
      };

      const result = await service.create(dto, actorId, clientMetadata);
      expect(result.id).toBe(contactId.toString());
      expect(contactRepository.create).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalled();
    });

    it('rejects duplicate contact when email matches an active contact', async () => {
      contactRepository.checkEmailCollision.mockResolvedValue(mockContactLean);

      const dto = {
        firstName: 'Duplicate',
        lastName: 'Contact',
        email: 'sarah.connor@cyberdyne.com',
        phone: '+1-555-9999',
      };

      await expect(
        service.create(dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });
  });

  describe('primary contact and company transfer', () => {
    it('calls transferCompanyAndPrimary inside transaction when linking company', async () => {
      const newCompanyId = new Types.ObjectId();
      contactRepository.findById.mockResolvedValue(mockContactLean);
      companyRepository.findById.mockResolvedValue({
        _id: newCompanyId,
        deletedAt: null,
      } as unknown as CompanyLean);
      contactRepository.transferCompanyAndPrimary.mockResolvedValue({
        ...mockContactLean,
        companyId: newCompanyId,
        isPrimaryContact: true,
      });

      const result = await service.linkCompany(
        contactId,
        {
          companyId: newCompanyId.toString(),
          isPrimaryContact: true,
        },
        actorId,
        clientMetadata,
      );

      expect(contactRepository.transferCompanyAndPrimary).toHaveBeenCalledWith(
        contactId,
        expect.any(Types.ObjectId),
        true,
        undefined,
        undefined,
        actorId,
        mockSession,
      );
      expect(result.companyId).toBe(newCompanyId.toString());
    });

    it('unlinks company atomically', async () => {
      contactRepository.findById.mockResolvedValue(mockContactLean);
      contactRepository.unlinkCompany.mockResolvedValue({
        ...mockContactLean,
        companyId: null,
        isPrimaryContact: false,
      });

      const result = await service.unlinkCompany(
        contactId,
        actorId,
        clientMetadata,
      );
      expect(result.companyId).toBeNull();
      expect(contactRepository.unlinkCompany).toHaveBeenCalledWith(
        contactId,
        actorId,
        mockSession,
      );
    });
  });

  describe('notes limits', () => {
    it('throws VALIDATION_ERROR when contact already has 100 notes', async () => {
      const hundredNotes = Array.from({ length: 100 }, (_, i) => ({
        _id: new Types.ObjectId(),
        content: `Note ${i}`,
        createdBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      contactRepository.findById.mockResolvedValue({
        ...mockContactLean,
        notes: hundredNotes as unknown as NonNullable<ContactLean['notes']>,
      });

      await expect(
        service.addNote(
          contactId,
          { content: 'Exceeding note' },
          actorId,
          clientMetadata,
        ),
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
        entityType: ActivityEntityType.CONTACT,
        entityId: contactId,
        performedBy: actorId,
      } as unknown as CrmActivityLean);
      userRepository.findById.mockResolvedValue({
        _id: actorId,
        roleIds: [],
      } as unknown as UserLean);
      crmActivityRepository.updateById.mockResolvedValue({
        _id: activityId,
        subject: 'Updated subject',
      } as unknown as CrmActivityLean);

      const result = await service.updateActivity(
        contactId,
        activityId,
        { subject: 'Updated subject' },
        actorId,
      );

      expect(result.subject).toBe('Updated subject');
    });

    it('allows admin to delete another user activity', async () => {
      crmActivityRepository.findById.mockResolvedValue({
        _id: activityId,
        entityType: ActivityEntityType.CONTACT,
        entityId: contactId,
        performedBy: otherUserId,
      } as unknown as CrmActivityLean);
      const adminRoleId = new Types.ObjectId();
      userRepository.findById.mockResolvedValue({
        _id: actorId,
        roleIds: [adminRoleId],
      } as unknown as UserLean);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: adminRoleId, key: SystemRole.ADMIN },
      ] as unknown as RoleLean[]);

      await expect(
        service.deleteActivity(contactId, activityId, actorId),
      ).resolves.not.toThrow();

      expect(crmActivityRepository.softDelete).toHaveBeenCalledWith(
        activityId,
        actorId,
      );
    });

    it('rejects non-author non-admin from updating activity', async () => {
      crmActivityRepository.findById.mockResolvedValue({
        _id: activityId,
        entityType: ActivityEntityType.CONTACT,
        entityId: contactId,
        performedBy: otherUserId,
      } as unknown as CrmActivityLean);
      userRepository.findById.mockResolvedValue({
        _id: actorId,
        roleIds: [],
      } as unknown as UserLean);

      await expect(
        service.updateActivity(
          contactId,
          activityId,
          { subject: 'Malicious update' },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });
  });
});
