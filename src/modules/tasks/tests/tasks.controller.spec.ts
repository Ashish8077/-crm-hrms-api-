import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { TaskStatus } from '../constants/task-status.constant';
import { TaskPriority } from '../constants/task-priority.constant';
import type { AuthenticatedRequest } from '../../auth/types/auth-request.type';

describe('TasksController', () => {
  let controller: TasksController;

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

  const actorId = new Types.ObjectId();
  const taskId = new Types.ObjectId();

  const mockReq = {
    user: { userId: actorId, sessionId: new Types.ObjectId(), roleIds: [] },
  } as unknown as AuthenticatedRequest;

  const mockTaskResponse = {
    id: taskId.toString(),
    title: 'Review contract',
    description: null,
    status: TaskStatus.PENDING,
    priority: TaskPriority.MEDIUM,
    createdBy: actorId.toString(),
    assignedTo: actorId.toString(),
    teamId: null,
    startDate: null,
    dueDate: new Date(),
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    relatedToType: null,
    relatedToId: null,
    reminderAt: null,
    isReminderSent: false,
    snoozedUntil: null,
    tags: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        {
          provide: TasksService,
          useValue: mockTasksService,
        },
      ],
    }).compile();

    controller = module.get<TasksController>(TasksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call create on tasksService', async () => {
    mockTasksService.create.mockResolvedValue(mockTaskResponse);
    const dto = {
      title: 'Review contract',
      assignedTo: actorId.toString(),
      dueDate: new Date().toISOString(),
    };

    const result = await controller.create(dto, mockReq);
    expect(result).toEqual(mockTaskResponse);
    expect(mockTasksService.create).toHaveBeenCalledWith(dto, actorId);
  });

  it('should call findAll on tasksService', async () => {
    const mockList = { data: [mockTaskResponse], meta: { total: 1 } };
    mockTasksService.findAll.mockResolvedValue(mockList);

    const result = await controller.findAll({}, mockReq);
    expect(result).toEqual(mockList);
    expect(mockTasksService.findAll).toHaveBeenCalledWith({}, mockReq.user);
  });

  it('should call findMy on tasksService', async () => {
    const mockList = { data: [mockTaskResponse], meta: { total: 1 } };
    mockTasksService.findMy.mockResolvedValue(mockList);

    const result = await controller.findMy({}, mockReq);
    expect(result).toEqual(mockList);
    expect(mockTasksService.findMy).toHaveBeenCalledWith({}, mockReq.user);
  });

  it('should call bulkAssign on tasksService', async () => {
    mockTasksService.bulkAssign.mockResolvedValue({ modifiedCount: 3 });
    const dto = {
      taskIds: [taskId.toString()],
      assignedTo: actorId.toString(),
    };

    const result = await controller.bulkAssign(dto, mockReq);
    expect(result).toEqual({ modifiedCount: 3 });
    expect(mockTasksService.bulkAssign).toHaveBeenCalledWith(dto, mockReq.user);
  });

  it('should call complete on tasksService', async () => {
    mockTasksService.complete.mockResolvedValue({
      ...mockTaskResponse,
      status: TaskStatus.COMPLETED,
    });

    const result = await controller.complete(taskId.toString(), mockReq);
    expect(result.status).toBe(TaskStatus.COMPLETED);
    expect(mockTasksService.complete).toHaveBeenCalledWith(
      taskId.toString(),
      mockReq.user,
    );
  });

  it('should call snooze on tasksService', async () => {
    mockTasksService.snooze.mockResolvedValue(mockTaskResponse);
    const dto = { snoozedUntil: new Date(Date.now() + 3600000).toISOString() };

    const result = await controller.snooze(taskId.toString(), dto, mockReq);
    expect(result).toEqual(mockTaskResponse);
    expect(mockTasksService.snooze).toHaveBeenCalledWith(
      taskId.toString(),
      dto,
      mockReq.user,
    );
  });
});
