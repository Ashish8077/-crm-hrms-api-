/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TasksService } from '../tasks.service';
import { TaskRepository } from '../repositories/task.repository';
import { EmployeeRepository } from '../../employees/repositories/employee.repository';
import { UserRepository } from '../../users/repositories/user.repository';
import { RoleRepository } from '../../roles/repositories/role.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { LeadRepository } from '../../leads/repositories/lead.repository';
import { ContactRepository } from '../../contacts/repositories/contact.repository';
import { CompanyRepository } from '../../companies/repositories/company.repository';
import { DealRepository } from '../../deals/repositories/deal.repository';
import { TaskPriority } from '../constants/task-priority.constant';
import { TaskStatus } from '../constants/task-status.constant';
import { TaskLean, TaskRelatedEntityType } from '../schemas/task.schema';
import { SystemRole } from '../../roles/constants/role.constant';
import { UserStatus } from '../../users/constants/user-status.constant';
import { AppError } from '../../../common/errors/app-error';
import { AuthenticatedUser } from '../../auth/types/auth-request.type';

describe('TasksService', () => {
  let service: TasksService;
  let taskRepository: jest.Mocked<TaskRepository>;
  let employeeRepository: jest.Mocked<EmployeeRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let leadRepository: jest.Mocked<LeadRepository>;

  const adminUserId = new Types.ObjectId();
  const salesRepId = new Types.ObjectId();
  const otherRepId = new Types.ObjectId();
  const teamId = new Types.ObjectId();
  const taskId = new Types.ObjectId();
  const adminRoleId = new Types.ObjectId();
  const repRoleId = new Types.ObjectId();

  const adminUser: AuthenticatedUser = {
    userId: adminUserId,
    sessionId: new Types.ObjectId(),
    roleIds: [adminRoleId],
  };

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

  const createMockTask = (overrides?: Partial<TaskLean>): TaskLean => ({
    _id: taskId,
    title: 'Follow-up with Enterprise client',
    description: 'Schedule onboarding demo',
    status: TaskStatus.PENDING,
    priority: TaskPriority.MEDIUM,
    createdBy: adminUserId,
    assignedTo: salesRepId,
    teamId,
    dueDate: new Date(Date.now() + 86400000),
    isReminderSent: false,
    tags: ['sales'],
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: TaskRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findAll: jest.fn(),
            findList: jest.fn(),
            findMyTasks: jest.fn(),
            findTeamTasks: jest.fn(),
            findOverdue: jest.fn(),
            findUpcoming: jest.fn(),
            findCalendar: jest.fn(),
            findDueReminders: jest.fn(),
            getSummary: jest.fn(),
            atomicStatusTransition: jest.fn(),
            updateById: jest.fn(),
            softDelete: jest.fn(),
            findAccessibleByIds: jest.fn(),
            bulkUpdateAssignee: jest.fn(),
          },
        },
        {
          provide: EmployeeRepository,
          useValue: {
            findByUserId: jest.fn(),
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
            createAuditLog: jest.fn().mockResolvedValue(undefined),
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
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    taskRepository = module.get(TaskRepository);
    employeeRepository = module.get(EmployeeRepository);
    userRepository = module.get(UserRepository);
    roleRepository = module.get(RoleRepository);
    auditLogsService = module.get(AuditLogsService);
    leadRepository = module.get(LeadRepository);

    // Default setup for role check
    userRepository.findById.mockImplementation(async (id) => {
      if (id.equals(adminUserId)) {
        return {
          _id: adminUserId,
          status: UserStatus.ACTIVE,
          roleIds: [adminRoleId],
        } as any;
      }
      return {
        _id: id,
        status: UserStatus.ACTIVE,
        roleIds: [repRoleId],
      } as any;
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

    employeeRepository.findByUserId.mockResolvedValue({
      _id: new Types.ObjectId(),
      teamId,
    } as any);
  });

  describe('create', () => {
    it('should create a task, sync assignee teamId, and record an audit log', async () => {
      const mockTask = createMockTask();
      taskRepository.create.mockResolvedValue(mockTask);

      const result = await service.create(
        {
          title: 'Follow-up with Enterprise client',
          description: 'Schedule onboarding demo',
          assignedTo: salesRepId.toString(),
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          priority: TaskPriority.MEDIUM,
        },
        adminUserId,
      );

      expect(result.id).toBe(taskId.toString());
      expect(result.title).toBe(mockTask.title);
      expect(taskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Follow-up with Enterprise client',
          assignedTo: salesRepId,
          teamId,
          status: TaskStatus.PENDING,
          isReminderSent: false,
        }),
        undefined,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('should throw validation error if relatedToType is provided without relatedToId', async () => {
      await expect(
        service.create(
          {
            title: 'Test Task',
            assignedTo: salesRepId.toString(),
            dueDate: new Date().toISOString(),
            relatedToType: TaskRelatedEntityType.LEAD,
          },
          adminUserId,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should verify parent entity exists when relatedTo is specified', async () => {
      const leadId = new Types.ObjectId();
      leadRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          {
            title: 'Follow up lead',
            assignedTo: salesRepId.toString(),
            dueDate: new Date().toISOString(),
            relatedToType: TaskRelatedEntityType.LEAD,
            relatedToId: leadId.toString(),
          },
          adminUserId,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('concurrency-safe state machine transitions', () => {
    it('should transition from PENDING to IN_PROGRESS atomically', async () => {
      const mockTask = createMockTask({ status: TaskStatus.PENDING });
      const updatedTask = createMockTask({ status: TaskStatus.IN_PROGRESS });

      taskRepository.findById.mockResolvedValue(mockTask);
      taskRepository.atomicStatusTransition.mockResolvedValue(updatedTask);

      const result = await service.changeStatus(
        taskId.toString(),
        { status: TaskStatus.IN_PROGRESS },
        repUser,
      );

      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
      expect(taskRepository.atomicStatusTransition).toHaveBeenCalledWith(
        taskId,
        [TaskStatus.PENDING, TaskStatus.DEFERRED],
        { status: TaskStatus.IN_PROGRESS },
      );
    });

    it('should complete a task and suppress reminders (isReminderSent: true)', async () => {
      const mockTask = createMockTask({ status: TaskStatus.IN_PROGRESS });
      const completedTask = createMockTask({
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
        isReminderSent: true,
      });

      taskRepository.findById.mockResolvedValue(mockTask);
      taskRepository.atomicStatusTransition.mockResolvedValue(completedTask);

      const result = await service.complete(taskId.toString(), repUser);

      expect(result.status).toBe(TaskStatus.COMPLETED);
      expect(taskRepository.atomicStatusTransition).toHaveBeenCalledWith(
        taskId,
        [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.DEFERRED],
        expect.objectContaining({
          status: TaskStatus.COMPLETED,
          isReminderSent: true,
        }),
      );
    });

    it('should require minimum 3 characters reason to cancel a task', async () => {
      const mockTask = createMockTask({ status: TaskStatus.PENDING });
      taskRepository.findById.mockResolvedValue(mockTask);

      await expect(
        service.cancel(taskId.toString(), { reason: 'no' }, repUser),
      ).rejects.toThrow(AppError);
    });

    it('should require minimum 5 characters reason to reopen a COMPLETED task', async () => {
      const completedTask = createMockTask({ status: TaskStatus.COMPLETED });
      taskRepository.findById.mockResolvedValue(completedTask);

      await expect(
        service.changeStatus(
          taskId.toString(),
          { status: TaskStatus.IN_PROGRESS, reason: 'reop' },
          repUser,
        ),
      ).rejects.toThrow(AppError);
    });

    it('should prevent cancelling an already completed task via precondition', async () => {
      const completedTask = createMockTask({ status: TaskStatus.COMPLETED });
      taskRepository.findById.mockResolvedValue(completedTask);
      taskRepository.atomicStatusTransition.mockResolvedValue(null);

      await expect(
        service.cancel(
          taskId.toString(),
          { reason: 'Client changed requirements' },
          repUser,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('snooze reminder separation', () => {
    it('should update reminderAt & snoozedUntil without changing task status', async () => {
      const mockTask = createMockTask({ status: TaskStatus.IN_PROGRESS });
      const futureDate = new Date(Date.now() + 3600000);
      const snoozedTask = createMockTask({
        status: TaskStatus.IN_PROGRESS,
        reminderAt: futureDate,
        snoozedUntil: futureDate,
        isReminderSent: false,
      });

      taskRepository.findById.mockResolvedValue(mockTask);
      taskRepository.updateById.mockResolvedValue(snoozedTask);

      const result = await service.snooze(
        taskId.toString(),
        { snoozedUntil: futureDate.toISOString() },
        repUser,
      );

      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
      expect(taskRepository.updateById).toHaveBeenCalledWith(
        taskId,
        expect.objectContaining({
          reminderAt: futureDate,
          snoozedUntil: futureDate,
          isReminderSent: false,
        }),
      );
    });
  });

  describe('bulk-assign O(1) query execution', () => {
    it('should reassign tasks in exactly 3 constant-time operations', async () => {
      const task1Id = new Types.ObjectId();
      const task2Id = new Types.ObjectId();
      const newAssigneeId = new Types.ObjectId();
      const newTeamId = new Types.ObjectId();

      userRepository.findById.mockResolvedValue({
        _id: newAssigneeId,
        status: UserStatus.ACTIVE,
      } as any);

      employeeRepository.findByUserId.mockResolvedValue({
        _id: new Types.ObjectId(),
        teamId: newTeamId,
      } as any);

      taskRepository.findAccessibleByIds.mockResolvedValue([
        { _id: task1Id } as any,
        { _id: task2Id } as any,
      ]);

      taskRepository.bulkUpdateAssignee.mockResolvedValue(2);

      const result = await service.bulkAssign(
        {
          taskIds: [task1Id.toString(), task2Id.toString()],
          assignedTo: newAssigneeId.toString(),
        },
        adminUser,
      );

      expect(result.modifiedCount).toBe(2);
      expect(taskRepository.findAccessibleByIds).toHaveBeenCalledTimes(1);
      expect(taskRepository.bulkUpdateAssignee).toHaveBeenCalledWith(
        [task1Id, task2Id],
        newAssigneeId,
        newTeamId,
      );
    });
  });

  describe('record-level authorization', () => {
    it('should deny non-admin user access to another rep task', async () => {
      const mockTask = createMockTask({
        assignedTo: otherRepId,
        createdBy: otherRepId,
        teamId: new Types.ObjectId(),
      });
      taskRepository.findById.mockResolvedValue(mockTask);

      await expect(
        service.findById(taskId.toString(), repUser),
      ).rejects.toThrow(AppError);
    });

    it('should allow admin unrestricted access', async () => {
      const mockTask = createMockTask({
        assignedTo: otherRepId,
        createdBy: otherRepId,
      });
      taskRepository.findById.mockResolvedValue(mockTask);

      const result = await service.findById(taskId.toString(), adminUser);
      expect(result.id).toBe(taskId.toString());
    });
  });
});
