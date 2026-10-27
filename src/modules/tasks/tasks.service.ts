import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { buildPaginationMeta } from '../../common/pagination/pagination.util';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedUser } from '../auth/types/auth-request.type';
import { CompanyRepository } from '../companies/repositories/company.repository';
import { ContactRepository } from '../contacts/repositories/contact.repository';
import { DealRepository } from '../deals/repositories/deal.repository';
import { EmployeeRepository } from '../employees/repositories/employee.repository';
import { LeadRepository } from '../leads/repositories/lead.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { SystemRole } from '../roles/constants/role.constant';
import { UserRepository } from '../users/repositories/user.repository';
import { UserStatus } from '../users/constants/user-status.constant';
import {
  TASK_CALENDAR_MAX_DAYS,
  TASK_CANCEL_MIN_REASON_LEN,
  TASK_MAX_BULK_ASSIGN,
  TASK_REOPEN_MIN_REASON_LEN,
  TASK_UPCOMING_DAYS,
} from './constants/task.constant';
import { TaskStatus } from './constants/task-status.constant';
import { TaskMapper, TaskResponse } from './mappers/task.mapper';
import { TaskRepository } from './repositories/task.repository';
import { TaskLean, TaskRelatedEntityType } from './schemas/task.schema';
import { AssignTaskDto } from './dto/assign-task.dto';
import { BulkAssignTasksDto } from './dto/bulk-assign-tasks.dto';
import { CancelTaskDto } from './dto/cancel-task.dto';
import { ChangeTaskStatusDto } from './dto/change-task-status.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SnoozeTaskDto } from './dto/snooze-task.dto';
import { TaskCalendarQueryDto } from './dto/task-calendar-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly leadRepository: LeadRepository,
    private readonly contactRepository: ContactRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly dealRepository: DealRepository,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private async isUserAdmin(userId: Types.ObjectId): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.roleIds?.length) return false;
    const activeRoles = await this.roleRepository.findActiveByIds(user.roleIds);
    return activeRoles.some(
      (r) =>
        r.key === (SystemRole.SUPER_ADMIN as string) ||
        r.key === (SystemRole.ADMIN as string),
    );
  }

  private async isUserManager(userId: Types.ObjectId): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.roleIds?.length) return false;
    const activeRoles = await this.roleRepository.findActiveByIds(user.roleIds);
    return activeRoles.some(
      (r) =>
        r.key === (SystemRole.SALES_MANAGER as string) ||
        r.key === (SystemRole.HR_MANAGER as string) ||
        r.key.toLowerCase().includes('manager') ||
        r.key.toLowerCase().includes('lead'),
    );
  }

  private async buildAccessFilter(
    user: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const isAdmin = await this.isUserAdmin(user.userId);
    if (isAdmin) {
      return {};
    }

    const employee = await this.employeeRepository.findByUserId(user.userId);
    const isManager = await this.isUserManager(user.userId);

    if (isManager && employee?.teamId) {
      return {
        $or: [
          { assignedTo: user.userId },
          { createdBy: user.userId },
          { teamId: employee.teamId },
        ],
      };
    }

    return {
      $or: [{ assignedTo: user.userId }, { createdBy: user.userId }],
    };
  }

  private async verifyTaskAccess(
    task: TaskLean,
    user: AuthenticatedUser,
  ): Promise<void> {
    const isAdmin = await this.isUserAdmin(user.userId);
    if (isAdmin) return;

    if (
      task.assignedTo?.toString() === user.userId.toString() ||
      task.createdBy?.toString() === user.userId.toString()
    ) {
      return;
    }

    const employee = await this.employeeRepository.findByUserId(user.userId);
    const isManager = await this.isUserManager(user.userId);
    if (
      isManager &&
      employee?.teamId &&
      task.teamId &&
      task.teamId.toString() === employee.teamId.toString()
    ) {
      return;
    }

    throw new AppError(
      ErrorCode.FORBIDDEN,
      'You do not have access to this task',
      HttpStatus.FORBIDDEN,
    );
  }

  private async validateAssigneeUser(
    assignedToId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<Types.ObjectId | null> {
    const user = await this.userRepository.findById(assignedToId, session);
    if (!user) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Assigned user not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Assigned user is not active',
        HttpStatus.BAD_REQUEST,
      );
    }

    const employee = await this.employeeRepository.findByUserId(
      assignedToId,
      session,
    );
    return employee?.teamId ?? null;
  }

  private async validateRelatedEntity(
    relatedToType?: TaskRelatedEntityType | null,
    relatedToId?: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<void> {
    if ((relatedToType && !relatedToId) || (!relatedToType && relatedToId)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'relatedToType and relatedToId must both be provided or both omitted',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!relatedToType || !relatedToId) return;

    let exists = false;
    switch (relatedToType) {
      case TaskRelatedEntityType.LEAD: {
        const lead = await this.leadRepository.findById(relatedToId, session);
        exists = !!lead;
        break;
      }
      case TaskRelatedEntityType.CONTACT: {
        const contact = await this.contactRepository.findById(
          relatedToId,
          session,
        );
        exists = !!contact;
        break;
      }
      case TaskRelatedEntityType.COMPANY: {
        const company = await this.companyRepository.findById(
          relatedToId,
          session,
        );
        exists = !!company;
        break;
      }
      case TaskRelatedEntityType.DEAL: {
        const deal = await this.dealRepository.findById(relatedToId, session);
        exists = !!deal;
        break;
      }
      default:
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid related entity type: ${String(relatedToType)}`,
          HttpStatus.BAD_REQUEST,
        );
    }

    if (!exists) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Associated ${relatedToType} entity not found`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async create(
    dto: CreateTaskDto,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<TaskResponse> {
    const assignedToId = new Types.ObjectId(dto.assignedTo);
    const relatedToId = dto.relatedToId
      ? new Types.ObjectId(dto.relatedToId)
      : undefined;

    await this.validateRelatedEntity(dto.relatedToType, relatedToId, session);
    const teamId = await this.validateAssigneeUser(assignedToId, session);

    const taskData = {
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      status: TaskStatus.PENDING,
      priority: dto.priority,
      createdBy: actorId,
      assignedTo: assignedToId,
      teamId,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      dueDate: new Date(dto.dueDate),
      relatedToType: dto.relatedToType ?? null,
      relatedToId: relatedToId ?? null,
      reminderAt: dto.reminderAt ? new Date(dto.reminderAt) : null,
      isReminderSent: false,
      tags: dto.tags ?? [],
    };

    const created = await this.taskRepository.create(taskData, session);

    await this.auditLogsService.createAuditLog(
      {
        actorId,
        action: AuditAction.TASK_CREATED,
        targetModel: AuditTargetModel.TASK,
        targetId: created._id,
        details: {
          title: created.title,
          assignedTo: created.assignedTo.toString(),
          dueDate: created.dueDate,
        },
        ipAddress: null,
        userAgent: null,
      },
      session,
    );

    return TaskMapper.toResponse(created);
  }

  async findAll(
    queryDto: ListTasksQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<TaskResponse>> {
    const accessFilter = await this.buildAccessFilter(user);
    const filter: Record<string, unknown> = { ...accessFilter };

    if (queryDto.status) filter.status = queryDto.status;
    if (queryDto.priority) filter.priority = queryDto.priority;
    if (queryDto.assignedTo)
      filter.assignedTo = new Types.ObjectId(queryDto.assignedTo);
    if (queryDto.createdBy)
      filter.createdBy = new Types.ObjectId(queryDto.createdBy);
    if (queryDto.teamId) filter.teamId = new Types.ObjectId(queryDto.teamId);
    if (queryDto.relatedToType) filter.relatedToType = queryDto.relatedToType;
    if (queryDto.relatedToId)
      filter.relatedToId = new Types.ObjectId(queryDto.relatedToId);

    if (queryDto.dueBefore || queryDto.dueAfter) {
      const dueFilter: Record<string, Date> = {};
      if (queryDto.dueBefore) dueFilter.$lte = new Date(queryDto.dueBefore);
      if (queryDto.dueAfter) dueFilter.$gte = new Date(queryDto.dueAfter);
      filter.dueDate = dueFilter;
    }

    if (queryDto.search) {
      const regex = { $regex: queryDto.search.trim(), $options: 'i' };
      filter.$or = [{ title: regex }, { description: regex }];
    }

    const result = await this.taskRepository.findAll(
      filter,
      queryDto,
      queryDto.sortField,
      queryDto.sortOrder,
    );

    return {
      data: TaskMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  async findMy(
    queryDto: ListTasksQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<TaskResponse>> {
    const filter: Record<string, unknown> = { assignedTo: user.userId };

    if (queryDto.status) filter.status = queryDto.status;
    if (queryDto.priority) filter.priority = queryDto.priority;
    if (queryDto.dueBefore || queryDto.dueAfter) {
      const dueFilter: Record<string, Date> = {};
      if (queryDto.dueBefore) dueFilter.$lte = new Date(queryDto.dueBefore);
      if (queryDto.dueAfter) dueFilter.$gte = new Date(queryDto.dueAfter);
      filter.dueDate = dueFilter;
    }
    if (queryDto.search) {
      const regex = { $regex: queryDto.search.trim(), $options: 'i' };
      filter.$or = [{ title: regex }, { description: regex }];
    }

    const result = await this.taskRepository.findAll(
      filter,
      queryDto,
      queryDto.sortField,
      queryDto.sortOrder,
    );

    return {
      data: TaskMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  async findTeam(
    queryDto: ListTasksQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<TaskResponse>> {
    const employee = await this.employeeRepository.findByUserId(user.userId);
    if (!employee?.teamId) {
      return {
        data: [],
        meta: buildPaginationMeta(0, queryDto.page ?? 1, queryDto.limit ?? 20),
      };
    }

    const filter: Record<string, unknown> = { teamId: employee.teamId };

    if (queryDto.status) filter.status = queryDto.status;
    if (queryDto.priority) filter.priority = queryDto.priority;
    if (queryDto.assignedTo)
      filter.assignedTo = new Types.ObjectId(queryDto.assignedTo);
    if (queryDto.dueBefore || queryDto.dueAfter) {
      const dueFilter: Record<string, Date> = {};
      if (queryDto.dueBefore) dueFilter.$lte = new Date(queryDto.dueBefore);
      if (queryDto.dueAfter) dueFilter.$gte = new Date(queryDto.dueAfter);
      filter.dueDate = dueFilter;
    }
    if (queryDto.search) {
      const regex = { $regex: queryDto.search.trim(), $options: 'i' };
      filter.$or = [{ title: regex }, { description: regex }];
    }

    const result = await this.taskRepository.findAll(
      filter,
      queryDto,
      queryDto.sortField,
      queryDto.sortOrder,
    );

    return {
      data: TaskMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  async findOverdue(
    user: AuthenticatedUser,
    queryDto: PaginationQueryDto,
  ): Promise<PaginatedResult<TaskResponse>> {
    const accessFilter = await this.buildAccessFilter(user);
    const result = await this.taskRepository.findOverdue(
      accessFilter,
      queryDto,
    );

    return {
      data: TaskMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  async findUpcoming(
    user: AuthenticatedUser,
    queryDto: PaginationQueryDto,
  ): Promise<PaginatedResult<TaskResponse>> {
    const accessFilter = await this.buildAccessFilter(user);
    const result = await this.taskRepository.findUpcoming(
      accessFilter,
      queryDto,
      TASK_UPCOMING_DAYS,
    );

    return {
      data: TaskMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  async findCalendar(
    queryDto: TaskCalendarQueryDto,
    user: AuthenticatedUser,
  ): Promise<TaskResponse[]> {
    const startDate = new Date(queryDto.startDate);
    const endDate = new Date(queryDto.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid start or end date format',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (startDate > endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate cannot be after endDate',
        HttpStatus.BAD_REQUEST,
      );
    }

    const diffDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays > TASK_CALENDAR_MAX_DAYS) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Calendar window cannot exceed ${TASK_CALENDAR_MAX_DAYS} days`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const accessFilter = await this.buildAccessFilter(user);
    const filter: Record<string, unknown> = { ...accessFilter };

    if (queryDto.assignedTo) {
      filter.assignedTo = new Types.ObjectId(queryDto.assignedTo);
    }

    const tasks = await this.taskRepository.findCalendar(
      filter,
      startDate,
      endDate,
    );
    return TaskMapper.toResponseList(tasks);
  }

  async getSummary(user: AuthenticatedUser): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    completionRate: number;
    overdueCount: number;
  }> {
    const accessFilter = await this.buildAccessFilter(user);
    return this.taskRepository.getSummary(accessFilter);
  }

  async findDueReminders(user: AuthenticatedUser): Promise<TaskResponse[]> {
    const tasks = await this.taskRepository.findDueReminders(user.userId);
    return TaskMapper.toResponseList(tasks);
  }

  async findById(id: string, user: AuthenticatedUser): Promise<TaskResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid task ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const taskId = new Types.ObjectId(id);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Task not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyTaskAccess(task, user);
    return TaskMapper.toResponse(task);
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    user: AuthenticatedUser,
  ): Promise<TaskResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid task ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const taskId = new Types.ObjectId(id);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Task not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyTaskAccess(task, user);

    const updatePayload: Record<string, unknown> = {};

    if (dto.title !== undefined) updatePayload.title = dto.title.trim();
    if (dto.description !== undefined)
      updatePayload.description = dto.description?.trim() ?? null;
    if (dto.priority !== undefined) updatePayload.priority = dto.priority;
    if (dto.startDate !== undefined)
      updatePayload.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.dueDate !== undefined)
      updatePayload.dueDate = new Date(dto.dueDate);
    if (dto.tags !== undefined) updatePayload.tags = dto.tags;

    // Polymorphic association update check
    const newRelatedType =
      dto.relatedToType !== undefined ? dto.relatedToType : task.relatedToType;
    const newRelatedId =
      dto.relatedToId !== undefined
        ? dto.relatedToId
          ? new Types.ObjectId(dto.relatedToId)
          : null
        : task.relatedToId;

    if (dto.relatedToType !== undefined || dto.relatedToId !== undefined) {
      await this.validateRelatedEntity(newRelatedType, newRelatedId);
      updatePayload.relatedToType = newRelatedType ?? null;
      updatePayload.relatedToId = newRelatedId ?? null;
    }

    // Reminder update rule
    if (dto.reminderAt !== undefined) {
      if (dto.reminderAt === null) {
        updatePayload.reminderAt = null;
        updatePayload.isReminderSent = false;
        updatePayload.snoozedUntil = null;
      } else {
        const newReminderDate = new Date(dto.reminderAt);
        updatePayload.reminderAt = newReminderDate;
        if (newReminderDate > new Date()) {
          updatePayload.isReminderSent = false;
          updatePayload.snoozedUntil = null;
        }
      }
    }

    const updated = await this.taskRepository.updateById(taskId, updatePayload);
    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Task not found or update failed',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId: user.userId,
      action: AuditAction.TASK_UPDATED,
      targetModel: AuditTargetModel.TASK,
      targetId: taskId,
      details: updatePayload,
      ipAddress: null,
      userAgent: null,
    });

    return TaskMapper.toResponse(updated);
  }

  async changeStatus(
    id: string,
    dto: ChangeTaskStatusDto,
    user: AuthenticatedUser,
  ): Promise<TaskResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid task ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const taskId = new Types.ObjectId(id);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Task not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyTaskAccess(task, user);

    const now = new Date();
    let validPriorStatuses: TaskStatus[] = [];
    const updatePayload: Record<string, unknown> = {
      status: dto.status,
    };

    switch (dto.status) {
      case TaskStatus.IN_PROGRESS: {
        if (task.status === TaskStatus.COMPLETED) {
          // Reopen transition
          if (
            !dto.reason ||
            dto.reason.trim().length < TASK_REOPEN_MIN_REASON_LEN
          ) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Reopening a completed task requires a mandatory reason (minimum ${TASK_REOPEN_MIN_REASON_LEN} characters)`,
              HttpStatus.BAD_REQUEST,
            );
          }
          validPriorStatuses = [TaskStatus.COMPLETED];
          updatePayload.completedAt = null;
          updatePayload.completedBy = null;
          const shouldResetReminder =
            task.reminderAt && new Date(task.reminderAt) > now ? false : true;
          updatePayload.isReminderSent = shouldResetReminder;
        } else {
          validPriorStatuses = [TaskStatus.PENDING, TaskStatus.DEFERRED];
        }
        break;
      }
      case TaskStatus.PENDING: {
        validPriorStatuses = [TaskStatus.IN_PROGRESS, TaskStatus.DEFERRED];
        break;
      }
      case TaskStatus.DEFERRED: {
        validPriorStatuses = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
        break;
      }
      case TaskStatus.COMPLETED: {
        validPriorStatuses = [
          TaskStatus.PENDING,
          TaskStatus.IN_PROGRESS,
          TaskStatus.DEFERRED,
        ];
        updatePayload.completedAt = now;
        updatePayload.completedBy = user.userId;
        updatePayload.isReminderSent = true;
        break;
      }
      case TaskStatus.CANCELLED: {
        if (
          !dto.reason ||
          dto.reason.trim().length < TASK_CANCEL_MIN_REASON_LEN
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Cancellation requires a mandatory reason (minimum ${TASK_CANCEL_MIN_REASON_LEN} characters)`,
            HttpStatus.BAD_REQUEST,
          );
        }
        validPriorStatuses = [
          TaskStatus.PENDING,
          TaskStatus.IN_PROGRESS,
          TaskStatus.DEFERRED,
        ];
        updatePayload.cancelledAt = now;
        updatePayload.cancelledBy = user.userId;
        updatePayload.cancelReason = dto.reason.trim();
        updatePayload.isReminderSent = true;
        break;
      }
      default:
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid target status: ${String(dto.status)}`,
          HttpStatus.BAD_REQUEST,
        );
    }

    const updated = await this.taskRepository.atomicStatusTransition(
      taskId,
      validPriorStatuses,
      updatePayload,
    );

    if (!updated) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot transition task status from ${task.status} to ${dto.status}. Concurrent update detected or invalid state transition.`,
        HttpStatus.CONFLICT,
      );
    }

    const action =
      dto.status === TaskStatus.COMPLETED
        ? AuditAction.TASK_COMPLETED
        : dto.status === TaskStatus.CANCELLED
          ? AuditAction.TASK_CANCELLED
          : AuditAction.TASK_STATUS_CHANGED;

    await this.auditLogsService.createAuditLog({
      actorId: user.userId,
      action,
      targetModel: AuditTargetModel.TASK,
      targetId: taskId,
      details: {
        fromStatus: task.status,
        toStatus: dto.status,
        reason: dto.reason ?? null,
      },
      ipAddress: null,
      userAgent: null,
    });

    return TaskMapper.toResponse(updated);
  }

  async assign(
    id: string,
    dto: AssignTaskDto,
    user: AuthenticatedUser,
  ): Promise<TaskResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid task ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const taskId = new Types.ObjectId(id);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Task not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyTaskAccess(task, user);

    const newAssigneeId = new Types.ObjectId(dto.assignedTo);
    const teamId = await this.validateAssigneeUser(newAssigneeId);

    const updated = await this.taskRepository.updateById(taskId, {
      assignedTo: newAssigneeId,
      teamId,
    });

    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Task update failed',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId: user.userId,
      action: AuditAction.TASK_ASSIGNED,
      targetModel: AuditTargetModel.TASK,
      targetId: taskId,
      details: {
        previousAssignee: task.assignedTo.toString(),
        newAssignee: newAssigneeId.toString(),
        teamId: teamId ? teamId.toString() : null,
      },
      ipAddress: null,
      userAgent: null,
    });

    return TaskMapper.toResponse(updated);
  }

  async bulkAssign(
    dto: BulkAssignTasksDto,
    user: AuthenticatedUser,
  ): Promise<{ modifiedCount: number }> {
    if (dto.taskIds.length > TASK_MAX_BULK_ASSIGN) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot bulk assign more than ${TASK_MAX_BULK_ASSIGN} tasks at once`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const uniqueTaskIds = Array.from(
      new Set(
        dto.taskIds
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      ),
    );

    if (uniqueTaskIds.length !== dto.taskIds.length) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'One or more task IDs are invalid or duplicated',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Assignee & Team Resolution (Query 1)
    const targetAssigneeId = new Types.ObjectId(dto.assignedTo);
    const targetTeamId = await this.validateAssigneeUser(targetAssigneeId);

    // 2. Batch Authorization Check (Query 2)
    const callerAccessFilter = await this.buildAccessFilter(user);
    const accessibleTasks = await this.taskRepository.findAccessibleByIds(
      uniqueTaskIds,
      callerAccessFilter,
    );

    if (accessibleTasks.length !== uniqueTaskIds.length) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'One or more tasks not found or access denied',
        HttpStatus.NOT_FOUND,
      );
    }

    // 3. Atomic Bulk Update (Query 3)
    const modifiedCount = await this.taskRepository.bulkUpdateAssignee(
      uniqueTaskIds,
      targetAssigneeId,
      targetTeamId,
    );

    await this.auditLogsService.createAuditLog({
      actorId: user.userId,
      action: AuditAction.TASK_ASSIGNED,
      targetModel: AuditTargetModel.TASK,
      targetId: uniqueTaskIds[0],
      details: {
        taskIds: uniqueTaskIds.map((id) => id.toString()),
        newAssignee: targetAssigneeId.toString(),
        teamId: targetTeamId ? targetTeamId.toString() : null,
        count: modifiedCount,
      },
      ipAddress: null,
      userAgent: null,
    });

    return { modifiedCount };
  }

  async complete(id: string, user: AuthenticatedUser): Promise<TaskResponse> {
    return this.changeStatus(id, { status: TaskStatus.COMPLETED }, user);
  }

  async cancel(
    id: string,
    dto: CancelTaskDto,
    user: AuthenticatedUser,
  ): Promise<TaskResponse> {
    return this.changeStatus(
      id,
      { status: TaskStatus.CANCELLED, reason: dto.reason },
      user,
    );
  }

  async snooze(
    id: string,
    dto: SnoozeTaskDto,
    user: AuthenticatedUser,
  ): Promise<TaskResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid task ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const taskId = new Types.ObjectId(id);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Task not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyTaskAccess(task, user);

    const snoozeDate = new Date(dto.snoozedUntil);
    if (isNaN(snoozeDate.getTime()) || snoozeDate <= new Date()) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'snoozedUntil must be a valid future date',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.taskRepository.updateById(taskId, {
      reminderAt: snoozeDate,
      snoozedUntil: snoozeDate,
      isReminderSent: false,
    });

    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Failed to snooze reminder',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId: user.userId,
      action: AuditAction.TASK_SNOOZED,
      targetModel: AuditTargetModel.TASK,
      targetId: taskId,
      details: { snoozedUntil: snoozeDate },
      ipAddress: null,
      userAgent: null,
    });

    return TaskMapper.toResponse(updated);
  }

  async delete(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid task ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const taskId = new Types.ObjectId(id);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Task not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyTaskAccess(task, user);

    const deleted = await this.taskRepository.softDelete(taskId, user.userId);
    if (!deleted) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Failed to delete task',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId: user.userId,
      action: AuditAction.TASK_DELETED,
      targetModel: AuditTargetModel.TASK,
      targetId: taskId,
      details: { title: task.title },
      ipAddress: null,
      userAgent: null,
    });

    return { success: true };
  }
}
