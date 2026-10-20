/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { LeadsService } from './leads.service';
import { LeadRepository, LeadLean } from './repositories/lead.repository';
import {
  UserRepository,
  UserLean,
} from '../users/repositories/user.repository';
import { UserStatus } from '../users/constants/user-status.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { LeadSource } from './constants/lead-source.constant';
import { LeadStatus } from './constants/lead-status.constant';
import { FollowUpStatus } from './constants/lead.constant';
import { PermissionKeys } from '../permissions/constants/permission.constant';

describe('LeadsService', () => {
  let service: LeadsService;
  let leadRepository: jest.Mocked<LeadRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

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
  const leadId = new Types.ObjectId();

  const clientMetadata: ClientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test-agent',
  };

  const mockLeadLean: LeadLean = {
    _id: leadId,
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@example.com',
    phone: '+1234567890',
    companyName: 'Acme Corp',
    jobTitle: 'VP Sales',
    source: LeadSource.WEBSITE,
    status: LeadStatus.NEW,
    score: 50,
    tags: ['hot', 'enterprise'],
    ownerId: ownerId,
    notes: [],
    followUps: [],
    documents: [],
    deletedAt: null,
    createdBy: actorId,
    updatedBy: actorId,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserLean: UserLean = {
    _id: ownerId,
    email: 'owner@example.com',
    status: UserStatus.ACTIVE,
  } as unknown as UserLean;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        {
          provide: LeadRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
            softDelete: jest.fn(),
            checkDuplicate: jest.fn(),
            bulkAssign: jest.fn(),
            addNote: jest.fn(),
            deleteNote: jest.fn(),
            addFollowUp: jest.fn(),
            updateFollowUp: jest.fn(),
            addDocument: jest.fn(),
            deleteDocument: jest.fn(),
            findForExport: jest.fn(),
          },
        },
        {
          provide: UserRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn(),
            findByTarget: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
    leadRepository = module.get(LeadRepository);
    userRepository = module.get(UserRepository);
    auditLogsService = module.get(AuditLogsService);

    jest.clearAllMocks();
  });

  describe('1. CRUD - Create Lead', () => {
    it('should create lead successfully and record audit log', async () => {
      leadRepository.checkDuplicate.mockResolvedValue(null);
      userRepository.findById.mockResolvedValue(mockUserLean);
      leadRepository.create.mockResolvedValue(mockLeadLean);

      const result = await service.create(
        {
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
          phone: '+1234567890',
          source: LeadSource.WEBSITE,
          status: LeadStatus.NEW,
          score: 50,
          ownerId: ownerId.toString(),
        },
        actorId,
        clientMetadata,
      );

      expect(result.id).toBe(leadId.toString());
      expect(result.email).toBe('alice@example.com');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw CONFLICT if duplicate email or phone exists', async () => {
      leadRepository.checkDuplicate.mockResolvedValue(mockLeadLean);

      await expect(
        service.create(
          {
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
            phone: '+1234567890',
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('should throw NOT_FOUND if assigned owner user does not exist', async () => {
      leadRepository.checkDuplicate.mockResolvedValue(null);
      userRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          {
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
            phone: '+1234567890',
            ownerId: ownerId.toString(),
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('should throw VALIDATION_ERROR if assigned owner user is inactive', async () => {
      leadRepository.checkDuplicate.mockResolvedValue(null);
      userRepository.findById.mockResolvedValue({
        ...mockUserLean,
        status: UserStatus.INACTIVE,
      });

      await expect(
        service.create(
          {
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
            phone: '+1234567890',
            ownerId: ownerId.toString(),
          },
          actorId,
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('1. CRUD - Read & List', () => {
    it('should get lead by ID', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);

      const result = await service.findById(leadId);
      expect(result.id).toBe(leadId.toString());
      expect(result.firstName).toBe('Alice');
    });

    it('should throw NOT_FOUND if lead does not exist', async () => {
      leadRepository.findById.mockResolvedValue(null);

      await expect(service.findById(leadId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('should list leads with pagination and filters', async () => {
      leadRepository.findList.mockResolvedValue({
        data: [mockLeadLean],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.list({
        page: 1,
        limit: 20,
        search: 'Alice',
      });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('1. CRUD - Update & Soft Delete', () => {
    it('should update lead and log audit event', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      const updatedLean = { ...mockLeadLean, firstName: 'Alicia' };
      leadRepository.updateById.mockResolvedValue(updatedLean);

      const result = await service.update(
        leadId,
        { firstName: 'Alicia' },
        actorId,
        clientMetadata,
      );

      expect(result.firstName).toBe('Alicia');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should soft delete lead and log audit event', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      leadRepository.softDelete.mockResolvedValue({
        ...mockLeadLean,
        deletedAt: new Date(),
        deletedBy: actorId,
      });

      await service.softDelete(leadId, actorId, clientMetadata);

      expect(leadRepository.softDelete).toHaveBeenCalledWith(
        leadId,
        actorId,
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('2 & 3. Lead Source & Status', () => {
    it('should update status and create status changed audit log', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      leadRepository.updateById.mockResolvedValue({
        ...mockLeadLean,
        status: LeadStatus.QUALIFIED,
      });

      const result = await service.updateStatus(
        leadId,
        LeadStatus.QUALIFIED,
        actorId,
        clientMetadata,
      );

      expect(result.status).toBe(LeadStatus.QUALIFIED);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('4 & 5. Assignment & Transfer', () => {
    const newOwnerId = new Types.ObjectId();
    const newOwnerLean = {
      _id: newOwnerId,
      email: 'newowner@example.com',
      status: UserStatus.ACTIVE,
    } as unknown as UserLean;

    it('should assign owner successfully', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      userRepository.findById.mockResolvedValue(newOwnerLean);
      leadRepository.updateById.mockResolvedValue({
        ...mockLeadLean,
        ownerId: newOwnerId,
      });

      const result = await service.assignOwner(
        leadId,
        newOwnerId,
        actorId,
        clientMetadata,
      );

      expect(result.ownerId).toBe(newOwnerId.toString());
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should transfer ownership with reason preserved in audit', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      userRepository.findById.mockResolvedValue(newOwnerLean);
      leadRepository.updateById.mockResolvedValue({
        ...mockLeadLean,
        ownerId: newOwnerId,
      });

      const result = await service.transferOwner(
        leadId,
        newOwnerId,
        'Territory reassignment',
        actorId,
        clientMetadata,
      );

      expect(result.ownerId).toBe(newOwnerId.toString());
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('6. Lead Scoring', () => {
    it('should update lead score and create audit log', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      leadRepository.updateById.mockResolvedValue({
        ...mockLeadLean,
        score: 95,
      });

      const result = await service.updateScore(
        leadId,
        95,
        actorId,
        clientMetadata,
      );

      expect(result.score).toBe(95);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('7. Tags', () => {
    it('should deduplicate tags when updating lead', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      leadRepository.updateById.mockImplementation((_id, data) => {
        const updateData = data as { tags?: string[] };
        return Promise.resolve({
          ...mockLeadLean,
          tags: updateData.tags ?? [],
        });
      });

      const result = await service.update(
        leadId,
        { tags: ['vip', 'vip', 'priority', 'vip'] },
        actorId,
        clientMetadata,
      );

      expect(result.tags).toEqual(['vip', 'priority']);
    });
  });

  describe('8. Notes', () => {
    const noteId = new Types.ObjectId();

    it('should add note to lead and create audit log', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      leadRepository.addNote.mockResolvedValue({
        ...mockLeadLean,
        notes: [
          {
            _id: noteId,
            content: 'Discussed Q4 roadmap',
            createdBy: actorId,
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const result = await service.addNote(
        leadId,
        { content: 'Discussed Q4 roadmap' },
        actorId,
        clientMetadata,
      );

      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].content).toBe('Discussed Q4 roadmap');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should delete note from lead', async () => {
      const leadWithNote: LeadLean = {
        ...mockLeadLean,
        notes: [
          {
            _id: noteId,
            content: 'Old note',
            createdBy: actorId,
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      leadRepository.findById.mockResolvedValue(leadWithNote);
      leadRepository.deleteNote.mockResolvedValue({
        ...mockLeadLean,
        notes: [],
      });

      const result = await service.deleteNote(
        leadId,
        noteId,
        actorId,
        clientMetadata,
      );

      expect(result.notes).toHaveLength(0);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('9. Follow-ups', () => {
    const followUpId = new Types.ObjectId();

    it('should schedule follow-up and validate assigned user', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      userRepository.findById.mockResolvedValue(mockUserLean);
      leadRepository.addFollowUp.mockResolvedValue({
        ...mockLeadLean,
        followUps: [
          {
            _id: followUpId,
            scheduledAt: new Date(),
            assignedTo: ownerId,
            status: FollowUpStatus.PENDING,
            notes: 'Contract review call',
            createdBy: actorId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const result = await service.addFollowUp(
        leadId,
        {
          scheduledAt: new Date(),
          assignedTo: ownerId.toString(),
          notes: 'Contract review call',
        },
        actorId,
        clientMetadata,
      );

      expect(result.followUps).toHaveLength(1);
      expect(result.followUps[0].notes).toBe('Contract review call');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should update follow-up status to completed', async () => {
      const leadWithFU: LeadLean = {
        ...mockLeadLean,
        followUps: [
          {
            _id: followUpId,
            scheduledAt: new Date(),
            assignedTo: ownerId,
            status: FollowUpStatus.PENDING,
            notes: 'Contract review call',
            createdBy: actorId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      leadRepository.findById.mockResolvedValue(leadWithFU);
      leadRepository.updateFollowUp.mockResolvedValue({
        ...mockLeadLean,
        followUps: [
          {
            ...leadWithFU.followUps[0],
            status: FollowUpStatus.COMPLETED,
          },
        ],
      });

      const result = await service.updateFollowUp(
        leadId,
        followUpId,
        { status: FollowUpStatus.COMPLETED },
        actorId,
        clientMetadata,
      );

      expect(result.followUps[0].status).toBe(FollowUpStatus.COMPLETED);
    });
  });

  describe('10. Documents', () => {
    const documentId = new Types.ObjectId();

    it('should add document metadata reference to lead', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      leadRepository.addDocument.mockResolvedValue({
        ...mockLeadLean,
        documents: [
          {
            _id: documentId,
            fileName: 'agreement.pdf',
            fileUrl: 'https://storage.example.com/agreement.pdf',
            fileType: 'application/pdf',
            fileSize: 1024,
            uploadedBy: actorId,
            uploadedAt: new Date(),
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const result = await service.addDocument(
        leadId,
        {
          fileName: 'agreement.pdf',
          fileUrl: 'https://storage.example.com/agreement.pdf',
        },
        actorId,
        clientMetadata,
      );

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].fileName).toBe('agreement.pdf');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should delete document metadata reference from lead', async () => {
      const leadWithDoc: LeadLean = {
        ...mockLeadLean,
        documents: [
          {
            _id: documentId,
            fileName: 'agreement.pdf',
            fileUrl: 'https://storage.example.com/agreement.pdf',
            uploadedBy: actorId,
            uploadedAt: new Date(),
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      leadRepository.findById.mockResolvedValue(leadWithDoc);
      leadRepository.deleteDocument.mockResolvedValue({
        ...mockLeadLean,
        documents: [],
      });

      const result = await service.deleteDocument(
        leadId,
        documentId,
        actorId,
        clientMetadata,
      );

      expect(result.documents).toHaveLength(0);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('11 & 12. Import & Export', () => {
    it('should import leads batch, skipping or erroring invalid/duplicate items safely', async () => {
      leadRepository.checkDuplicate
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockLeadLean); // second item is duplicate
      leadRepository.create.mockResolvedValue(mockLeadLean);

      const importResult = await service.importLeads(
        {
          leads: [
            {
              firstName: 'Lead1',
              lastName: 'User',
              email: 'lead1@example.com',
              phone: '+1111111111',
            },
            {
              firstName: 'Lead2',
              lastName: 'User',
              email: 'lead2@example.com',
              phone: '+2222222222',
            },
          ],
        },
        actorId,
        clientMetadata,
      );

      expect(importResult.total).toBe(2);
      expect(importResult.successful).toBe(1);
      expect(importResult.failed).toBe(1);
      expect(importResult.errors[0].row).toBe(2);
    });

    it('should export leads matching query filters', async () => {
      leadRepository.findForExport.mockResolvedValue([mockLeadLean]);

      const result = await service.exportLeads({ status: LeadStatus.NEW });
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('alice@example.com');
    });
  });

  describe('13. Bulk Assignment', () => {
    it('should bulk assign leads to active owner', async () => {
      userRepository.findById.mockResolvedValue(mockUserLean);
      leadRepository.bulkAssign.mockResolvedValue(2);

      const leadIds = [
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
      ];

      const result = await service.bulkAssign(
        { leadIds, ownerId: ownerId.toString() },
        actorId,
        clientMetadata,
      );

      expect(result.assignedCount).toBe(2);
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(2);
    });
  });

  describe('14. Duplicate Detection', () => {
    it('should return isDuplicate: true when matching lead exists', async () => {
      leadRepository.checkDuplicate.mockResolvedValue(mockLeadLean);

      const res = await service.checkDuplicate({ email: 'alice@example.com' });
      expect(res.isDuplicate).toBe(true);
      expect(res.duplicate?.email).toBe('alice@example.com');
    });

    it('should return isDuplicate: false when no duplicate found', async () => {
      leadRepository.checkDuplicate.mockResolvedValue(null);

      const res = await service.checkDuplicate({ email: 'unique@example.com' });
      expect(res.isDuplicate).toBe(false);
      expect(res.duplicate).toBeNull();
    });
  });

  describe('15. Activity Timeline', () => {
    it('should return timeline events from audit logs for lead', async () => {
      leadRepository.findById.mockResolvedValue(mockLeadLean);
      auditLogsService.findByTarget.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          action: 'LEAD_CREATED',
          targetId: leadId,
          targetModel: 'Lead',
          actorId,
          details: { email: 'alice@example.com' },
          createdAt: new Date(),
        } as unknown as import('../audit-logs/schemas/audit-log.schema').AuditLogDocument,
      ]);

      const timeline = await service.getTimeline(leadId);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]?.action).toBe('LEAD_CREATED');
    });
  });

  describe('RBAC Permissions', () => {
    it('should verify lead permission keys are defined', () => {
      expect(PermissionKeys.LEADS_VIEW).toBe('leads.view');
      expect(PermissionKeys.LEADS_CREATE).toBe('leads.create');
      expect(PermissionKeys.LEADS_EDIT).toBe('leads.edit');
      expect(PermissionKeys.LEADS_DELETE).toBe('leads.delete');
      expect(PermissionKeys.LEADS_ASSIGN).toBe('leads.assign');
      expect(PermissionKeys.LEADS_EXPORT).toBe('leads.export');
    });
  });
});
