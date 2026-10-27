/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ActivitiesService } from '../activities.service';
import {
  CrmActivityRepository,
  CrmActivityLean,
} from '../../../common/repositories/crm-activity.repository';
import {
  ActivityEntityType,
  ActivityOutcome,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';
import { TasksService } from '../../tasks/tasks.service';
import { TaskRepository } from '../../tasks/repositories/task.repository';
import { LeadRepository } from '../../leads/repositories/lead.repository';
import { ContactRepository } from '../../contacts/repositories/contact.repository';
import { CompanyRepository } from '../../companies/repositories/company.repository';
import { DealRepository } from '../../deals/repositories/deal.repository';
import { UserRepository } from '../../users/repositories/user.repository';
import { RoleRepository } from '../../roles/repositories/role.repository';
import { EmployeeRepository } from '../../employees/repositories/employee.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AppError } from '../../../common/errors/app-error';
import { AuthenticatedUser } from '../../auth/types/auth-request.type';
import { SystemRole } from '../../roles/constants/role.constant';
import { TaskStatus } from '../../tasks/constants/task-status.constant';
import { TaskPriority } from '../../tasks/constants/task-priority.constant';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let crmActivityRepository: jest.Mocked<CrmActivityRepository>;
  let tasksService: jest.Mocked<TasksService>;
  let leadRepository: jest.Mocked<LeadRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const adminUserId = new Types.ObjectId();
  const salesRepId = new Types.ObjectId();
  const activityId = new Types.ObjectId();
  const leadId = new Types.ObjectId();
  const adminRoleId = new Types.ObjectId();
  const repRoleId = new Types.ObjectId();

  const repUser: AuthenticatedUser = {
    userId: salesRepId,
    sessionId: new Types.ObjectId(),
    roleIds: [repRoleId],
  };

  const mockSession = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const createMockActivity = (
    overrides?: Partial<CrmActivityLean>,
  ): CrmActivityLean => ({
    _id: activityId,
    entityType: ActivityEntityType.LEAD,
    entityId: leadId,
    type: ActivityType.CALL,
    subject: 'Discovery Call',
    description: 'Initial requirements gathering',
    activityDate: new Date(),
    durationMinutes: 20,
    outcome: ActivityOutcome.CONNECTED,
    performedBy: salesRepId,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        {
          provide: CrmActivityRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findAll: jest.fn(),
            findTimeline: jest.fn(),
            findCalendar: jest.fn(),
            getSummary: jest.fn(),
            updateById: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: TasksService,
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: TaskRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: LeadRepository,
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
          provide: CompanyRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: DealRepository,
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
          provide: EmployeeRepository,
          useValue: {
            findByUserId: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
    crmActivityRepository = module.get(CrmActivityRepository);
    tasksService = module.get(TasksService);
    leadRepository = module.get(LeadRepository);
    userRepository = module.get(UserRepository);
    roleRepository = module.get(RoleRepository);
    auditLogsService = module.get(AuditLogsService);

    userRepository.findById.mockImplementation(async (id) => {
      if (id.equals(adminUserId)) {
        return { _id: adminUserId, roleIds: [adminRoleId] } as any;
      }
      return { _id: id, roleIds: [repRoleId] } as any;
    });

    roleRepository.findActiveByIds.mockImplementation(async (roleIds) => {
      if (roleIds.some((r) => r.equals(adminRoleId))) {
        return [
          { _id: adminRoleId, key: SystemRole.SUPER_ADMIN, isActive: true },
        ] as any;
      }
      return [
        { _id: repRoleId, key: SystemRole.SALES_EXECUTIVE, isActive: true },
      ] as any;
    });
  });

  describe('logActivity', () => {
    it('should verify parent entity exists and log CRM activity', async () => {
      leadRepository.findById.mockResolvedValue({ _id: leadId } as any);
      const mockActivity = createMockActivity();
      crmActivityRepository.create.mockResolvedValue(mockActivity);

      const result = await service.logActivity(
        {
          entityType: ActivityEntityType.LEAD,
          entityId: leadId.toString(),
          type: ActivityType.CALL,
          subject: 'Discovery Call',
          outcome: ActivityOutcome.CONNECTED,
          durationMinutes: 20,
        },
        salesRepId,
      );

      expect(result.id).toBe(activityId.toString());
      expect(leadRepository.findById).toHaveBeenCalledWith(leadId, undefined);
      expect(crmActivityRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: ActivityEntityType.LEAD,
          entityId: leadId,
          type: ActivityType.CALL,
          subject: 'Discovery Call',
          performedBy: salesRepId,
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('should throw 404 when target CRM entity does not exist', async () => {
      leadRepository.findById.mockResolvedValue(null);

      await expect(
        service.logActivity(
          {
            entityType: ActivityEntityType.LEAD,
            entityId: leadId.toString(),
            type: ActivityType.CALL,
            subject: 'Discovery Call',
          },
          salesRepId,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('recordOutcome', () => {
    it('should record outcome and spawn follow-up task in a transaction', async () => {
      const mockActivity = createMockActivity({ outcome: null });
      crmActivityRepository.findById.mockResolvedValue(mockActivity);
      crmActivityRepository.updateById.mockResolvedValue({
        ...mockActivity,
        outcome: ActivityOutcome.FOLLOW_UP,
      });

      const spawnedTask = {
        id: new Types.ObjectId().toString(),
        title: 'Follow-up: Discovery Call',
        status: TaskStatus.PENDING,
        priority: TaskPriority.HIGH,
        dueDate: new Date(),
        assignedTo: salesRepId.toString(),
        createdBy: repUser.userId.toString(),
        isReminderSent: false,
        tags: [],
        teamId: null,
        description: null,
        startDate: null,
        completedAt: null,
        completedBy: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        relatedToType: null,
        relatedToId: null,
        reminderAt: null,
        snoozedUntil: null,
      };

      tasksService.create.mockResolvedValue(spawnedTask);

      const result = await service.recordOutcome(
        activityId.toString(),
        {
          outcome: ActivityOutcome.FOLLOW_UP,
          notes: 'Prepare revised proposal for customer review',
          spawnFollowUpTask: true,
          followUpDueDate: new Date(Date.now() + 86400000).toISOString(),
          followUpPriority: TaskPriority.HIGH,
        },
        repUser,
      );

      expect(result.activity.outcome).toBe(ActivityOutcome.FOLLOW_UP);
      expect(result.followUpTask).toBeDefined();
      expect(mockSession.startTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(tasksService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dueDate: expect.any(String),
          assignedTo: salesRepId.toString(),
          priority: TaskPriority.HIGH,
        }),
        repUser.userId,
        mockSession,
      );
    });
  });

  describe('findCalendar', () => {
    it('should reject date window exceeding 90 days', async () => {
      const now = new Date();
      const past95Days = new Date(now.getTime() + 95 * 24 * 60 * 60 * 1000);

      await expect(
        service.findCalendar(
          {
            startDate: now.toISOString(),
            endDate: past95Days.toISOString(),
          },
          repUser,
        ),
      ).rejects.toThrow(AppError);
    });
  });
});
