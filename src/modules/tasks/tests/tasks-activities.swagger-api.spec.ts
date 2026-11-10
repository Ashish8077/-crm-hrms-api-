import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { ActivitiesController } from '../../activities/activities.controller';
import { ActivitiesService } from '../../activities/activities.service';
import { TaskStatus } from '../constants/task-status.constant';
import { TaskPriority } from '../constants/task-priority.constant';
import {
  ActivityEntityType,
  ActivityOutcome,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';
import type { AuthenticatedRequest } from '../../auth/types/auth-request.type';

describe('Tasks & Activities - Complete Swagger API Master Suite (All 26 Endpoints)', () => {
  let tasksController: TasksController;
  let activitiesController: ActivitiesController;

  const mockTasksService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findMy: jest.fn(),
    findTeam: jest.fn(),
    findOverdue: jest.fn(),
    findUpcoming: jest.fn(),
    findCalendar: jest.fn(),
    getSummary: jest.fn(),
    findDueReminders: jest.fn(),
    bulkAssign: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    changeStatus: jest.fn(),
    assign: jest.fn(),
    complete: jest.fn(),
    cancel: jest.fn(),
    snooze: jest.fn(),
    delete: jest.fn(),
  };

  const mockActivitiesService = {
    logActivity: jest.fn(),
    findAll: jest.fn(),
    findCalendar: jest.fn(),
    getSummary: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    recordOutcome: jest.fn(),
    delete: jest.fn(),
  };

  const actorId = new Types.ObjectId();
  const taskId = new Types.ObjectId();
  const activityId = new Types.ObjectId();
  const dealId = new Types.ObjectId();
  const assigneeId = new Types.ObjectId();

  const mockReq = {
    user: {
      userId: actorId,
      sessionId: new Types.ObjectId(),
      roleIds: [new Types.ObjectId()],
    },
  } as unknown as AuthenticatedRequest;

  const mockTaskResponse = {
    id: taskId.toString(),
    title: 'Prepare Technical Migration Proposal',
    description: 'Draft cloud architecture blueprint',
    status: TaskStatus.PENDING,
    priority: TaskPriority.HIGH,
    createdBy: actorId.toString(),
    assignedTo: assigneeId.toString(),
    teamId: new Types.ObjectId().toString(),
    startDate: new Date('2026-11-01T09:00:00.000Z'),
    dueDate: new Date('2026-11-05T17:00:00.000Z'),
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    relatedToType: 'Deal',
    relatedToId: dealId.toString(),
    reminderAt: new Date('2026-11-05T09:00:00.000Z'),
    isReminderSent: false,
    snoozedUntil: null,
    tags: ['migration', 'proposal'],
  };

  const mockActivityResponse = {
    id: activityId.toString(),
    entityType: ActivityEntityType.DEAL,
    entityId: dealId.toString(),
    type: ActivityType.CALL,
    subject: 'Discovery & Architecture Alignment Call',
    description: 'Reviewed cloud infrastructure requirements',
    activityDate: new Date('2026-10-23T11:00:00.000Z'),
    durationMinutes: 35,
    outcome: ActivityOutcome.CONNECTED,
    performedBy: actorId.toString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController, ActivitiesController],
      providers: [
        { provide: TasksService, useValue: mockTasksService },
        { provide: ActivitiesService, useValue: mockActivitiesService },
      ],
    }).compile();

    tasksController = module.get<TasksController>(TasksController);
    activitiesController =
      module.get<ActivitiesController>(ActivitiesController);
  });

  describe('Tasks API Endpoints (18 Endpoints)', () => {
    it('API 01: POST /tasks - Create task with full fields', async () => {
      mockTasksService.create.mockResolvedValue(mockTaskResponse);
      const dto = {
        title: 'Prepare Technical Migration Proposal',
        priority: TaskPriority.HIGH,
        assignedTo: assigneeId.toString(),
        dueDate: '2026-11-05T17:00:00.000Z',
      };
      const res = await tasksController.create(dto, mockReq);
      expect(res).toEqual(mockTaskResponse);
      expect(mockTasksService.create).toHaveBeenCalledWith(dto, actorId);
    });

    it('API 02: GET /tasks - List and filter tasks', async () => {
      const listRes = { data: [mockTaskResponse], meta: { total: 1 } };
      mockTasksService.findAll.mockResolvedValue(listRes);
      const res = await tasksController.findAll(
        { page: 1, limit: 20 },
        mockReq,
      );
      expect(res).toEqual(listRes);
    });

    it('API 03: GET /tasks/my - Current user tasks', async () => {
      mockTasksService.findMy.mockResolvedValue({ data: [mockTaskResponse] });
      const res = await tasksController.findMy({}, mockReq);
      expect(res.data).toHaveLength(1);
    });

    it('API 04: GET /tasks/team - Team tasks', async () => {
      mockTasksService.findTeam.mockResolvedValue({ data: [mockTaskResponse] });
      const res = await tasksController.findTeam({}, mockReq);
      expect(res.data).toHaveLength(1);
    });

    it('API 05: GET /tasks/overdue - Overdue tasks', async () => {
      mockTasksService.findOverdue.mockResolvedValue({
        data: [mockTaskResponse],
      });
      const res = await tasksController.findOverdue({}, mockReq);
      expect(res.data).toHaveLength(1);
    });

    it('API 06: GET /tasks/upcoming - Upcoming tasks', async () => {
      mockTasksService.findUpcoming.mockResolvedValue({
        data: [mockTaskResponse],
      });
      const res = await tasksController.findUpcoming({}, mockReq);
      expect(res.data).toHaveLength(1);
    });

    it('API 07: GET /tasks/calendar - Calendar feed', async () => {
      mockTasksService.findCalendar.mockResolvedValue([mockTaskResponse]);
      const res = await tasksController.findCalendar(
        {
          startDate: '2026-11-01T00:00:00.000Z',
          endDate: '2026-11-30T23:59:59.999Z',
        },
        mockReq,
      );
      expect(res).toHaveLength(1);
    });

    it('API 08: GET /tasks/summary - Task metrics & completion stats', async () => {
      const summary = {
        total: 10,
        byStatus: { PENDING: 5, COMPLETED: 5 },
        byPriority: { HIGH: 5, MEDIUM: 5 },
        completionRate: 50,
        overdueCount: 1,
      };
      mockTasksService.getSummary.mockResolvedValue(summary);
      const res = await tasksController.getSummary(mockReq);
      expect(res.completionRate).toBe(50);
    });

    it('API 09: GET /tasks/reminders/due - Due reminders polling', async () => {
      mockTasksService.findDueReminders.mockResolvedValue([mockTaskResponse]);
      const res = await tasksController.findDueReminders(mockReq);
      expect(res).toHaveLength(1);
    });

    it('API 10: POST /tasks/bulk-assign - O(1) bulk reassignment', async () => {
      mockTasksService.bulkAssign.mockResolvedValue({ modifiedCount: 2 });
      const res = await tasksController.bulkAssign(
        {
          taskIds: [taskId.toString()],
          assignedTo: assigneeId.toString(),
        },
        mockReq,
      );
      expect(res.modifiedCount).toBe(2);
    });

    it('API 11: GET /tasks/:id - Get task by ID', async () => {
      mockTasksService.findById.mockResolvedValue(mockTaskResponse);
      const res = await tasksController.findById(taskId.toString(), mockReq);
      expect(res.id).toBe(taskId.toString());
    });

    it('API 12: PATCH /tasks/:id - Update task details', async () => {
      mockTasksService.update.mockResolvedValue({
        ...mockTaskResponse,
        title: 'Updated title',
      });
      const res = await tasksController.update(
        taskId.toString(),
        { title: 'Updated title' },
        mockReq,
      );
      expect(res.title).toBe('Updated title');
    });

    it('API 13: PATCH /tasks/:id/status - Status transition', async () => {
      mockTasksService.changeStatus.mockResolvedValue({
        ...mockTaskResponse,
        status: TaskStatus.IN_PROGRESS,
      });
      const res = await tasksController.changeStatus(
        taskId.toString(),
        { status: TaskStatus.IN_PROGRESS },
        mockReq,
      );
      expect(res.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('API 14: PATCH /tasks/:id/assign - Reassign single task', async () => {
      mockTasksService.assign.mockResolvedValue({
        ...mockTaskResponse,
        assignedTo: assigneeId.toString(),
      });
      const res = await tasksController.assign(
        taskId.toString(),
        { assignedTo: assigneeId.toString() },
        mockReq,
      );
      expect(res.assignedTo).toBe(assigneeId.toString());
    });

    it('API 15: PATCH /tasks/:id/complete - Complete task', async () => {
      mockTasksService.complete.mockResolvedValue({
        ...mockTaskResponse,
        status: TaskStatus.COMPLETED,
        isReminderSent: true,
      });
      const res = await tasksController.complete(taskId.toString(), mockReq);
      expect(res.status).toBe(TaskStatus.COMPLETED);
    });

    it('API 16: PATCH /tasks/:id/cancel - Cancel task', async () => {
      mockTasksService.cancel.mockResolvedValue({
        ...mockTaskResponse,
        status: TaskStatus.CANCELLED,
        cancelReason: 'Reason for cancellation',
      });
      const res = await tasksController.cancel(
        taskId.toString(),
        { reason: 'Reason for cancellation' },
        mockReq,
      );
      expect(res.status).toBe(TaskStatus.CANCELLED);
    });

    it('API 17: PATCH /tasks/:id/snooze - Snooze reminder', async () => {
      mockTasksService.snooze.mockResolvedValue(mockTaskResponse);
      const res = await tasksController.snooze(
        taskId.toString(),
        { snoozedUntil: '2026-11-06T10:00:00.000Z' },
        mockReq,
      );
      expect(res.id).toBe(taskId.toString());
    });

    it('API 18: DELETE /tasks/:id - Soft delete task', async () => {
      mockTasksService.delete.mockResolvedValue({ success: true });
      const res = await tasksController.delete(taskId.toString(), mockReq);
      expect(res.success).toBe(true);
    });
  });

  describe('Activities API Endpoints (8 Endpoints)', () => {
    it('API 19: POST /activities - Log global CRM activity', async () => {
      mockActivitiesService.logActivity.mockResolvedValue(mockActivityResponse);
      const dto = {
        entityType: ActivityEntityType.DEAL,
        entityId: dealId.toString(),
        type: ActivityType.CALL,
        subject: 'Discovery Call',
      };
      const res = await activitiesController.logActivity(dto, mockReq);
      expect(res.id).toBe(activityId.toString());
    });

    it('API 20: GET /activities - List & filter activities', async () => {
      mockActivitiesService.findAll.mockResolvedValue({
        data: [mockActivityResponse],
        meta: { total: 1 },
      });
      const res = await activitiesController.findAll({}, mockReq);
      expect(res.data).toHaveLength(1);
    });

    it('API 21: GET /activities/calendar - Calendar view', async () => {
      mockActivitiesService.findCalendar.mockResolvedValue([
        mockActivityResponse,
      ]);
      const res = await activitiesController.findCalendar(
        {
          startDate: '2026-10-01T00:00:00.000Z',
          endDate: '2026-10-31T23:59:59.999Z',
        },
        mockReq,
      );
      expect(res).toHaveLength(1);
    });

    it('API 22: GET /activities/summary - Summary metrics', async () => {
      const summary = {
        total: 15,
        byType: { CALL: 10, MEETING: 5 },
        byOutcome: { CONNECTED: 8, SCHEDULED: 7 },
      };
      mockActivitiesService.getSummary.mockResolvedValue(summary);
      const res = await activitiesController.getSummary(mockReq);
      expect(res.total).toBe(15);
    });

    it('API 23: GET /activities/:id - Get activity by ID', async () => {
      mockActivitiesService.findById.mockResolvedValue(mockActivityResponse);
      const res = await activitiesController.findById(
        activityId.toString(),
        mockReq,
      );
      expect(res.id).toBe(activityId.toString());
    });

    it('API 24: PATCH /activities/:id - Update activity details', async () => {
      mockActivitiesService.update.mockResolvedValue({
        ...mockActivityResponse,
        subject: 'Updated subject',
      });
      const res = await activitiesController.update(
        activityId.toString(),
        { subject: 'Updated subject' },
        mockReq,
      );
      expect(res.subject).toBe('Updated subject');
    });

    it('API 25: PATCH /activities/:id/outcome - Record outcome & spawn task', async () => {
      mockActivitiesService.recordOutcome.mockResolvedValue({
        activity: {
          ...mockActivityResponse,
          outcome: ActivityOutcome.FOLLOW_UP,
        },
        followUpTask: mockTaskResponse,
      });
      const res = await activitiesController.recordOutcome(
        activityId.toString(),
        {
          outcome: ActivityOutcome.FOLLOW_UP,
          spawnFollowUpTask: true,
          followUpDueDate: '2026-10-30T17:00:00.000Z',
        },
        mockReq,
      );
      expect(res.activity.outcome).toBe(ActivityOutcome.FOLLOW_UP);
      expect(res.followUpTask).toBeDefined();
    });

    it('API 26: DELETE /activities/:id - Soft delete activity', async () => {
      mockActivitiesService.delete.mockResolvedValue({ success: true });
      const res = await activitiesController.delete(
        activityId.toString(),
        mockReq,
      );
      expect(res.success).toBe(true);
    });
  });
});
