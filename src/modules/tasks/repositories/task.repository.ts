import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Task, TaskDocument } from '../schemas/task.schema';
import {
  TaskStatus,
  OPEN_TASK_STATUSES,
} from '../constants/task-status.constant';
import { ListTasksQueryDto } from '../dto/list-tasks-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import {
  calculateSkip,
  buildPaginationMeta,
} from '../../../common/pagination/pagination.util';

export type TaskLean = Task & { _id: Types.ObjectId };

@Injectable()
export class TaskRepository {
  constructor(
    @InjectModel(Task.name)
    private readonly taskModel: Model<TaskDocument>,
  ) {}

  async create(
    data: Partial<Task>,
    session?: ClientSession,
  ): Promise<TaskLean> {
    const docs = await this.taskModel.create([data], { session });
    return docs[0].toObject();
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<TaskLean | null> {
    const query = this.taskModel.findOne({ _id: id, deletedAt: null });
    if (session) query.session(session);
    return query.lean<TaskLean>().exec();
  }

  async findByIdPopulated(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<TaskLean | null> {
    const query = this.taskModel
      .findOne({ _id: id, deletedAt: null })
      .populate('assignedTo', 'email')
      .populate('createdBy', 'email')
      .populate('completedBy', 'email')
      .populate('cancelledBy', 'email');
    if (session) query.session(session);
    return query.lean<TaskLean>().exec();
  }

  buildFilterQuery(
    dto: ListTasksQueryDto,
    callerFilter?: Record<string, unknown>,
  ): Record<string, unknown> {
    const query: Record<string, unknown> = { deletedAt: null };

    if (callerFilter) {
      Object.assign(query, callerFilter);
    }

    if (dto.status) {
      query.status = dto.status;
    }

    if (dto.priority) {
      query.priority = dto.priority;
    }

    if (dto.assignedTo) {
      query.assignedTo = new Types.ObjectId(dto.assignedTo);
    }

    if (dto.relatedToType) {
      query.relatedToType = dto.relatedToType;
    }

    if (dto.relatedToId) {
      query.relatedToId = new Types.ObjectId(dto.relatedToId);
    }

    const dueDateFilter: Record<string, Date> = {};
    if (dto.dueBefore) dueDateFilter.$lte = new Date(dto.dueBefore);
    if (dto.dueAfter) dueDateFilter.$gte = new Date(dto.dueAfter);
    if (Object.keys(dueDateFilter).length > 0) {
      query.dueDate = dueDateFilter;
    }

    if (dto.search) {
      const searchRegex = new RegExp(dto.search.trim(), 'i');
      query.$or = [{ title: searchRegex }, { description: searchRegex }];
    }

    return query;
  }

  async findList(
    dto: ListTasksQueryDto,
    callerFilter?: Record<string, unknown>,
  ): Promise<PaginatedResult<TaskLean>> {
    const query = this.buildFilterQuery(dto, callerFilter);
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = calculateSkip(page, limit);

    const sortField = dto.sortField ?? 'dueDate';
    const sortOrder = dto.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortField]: sortOrder };

    const [data, total] = await Promise.all([
      this.taskModel
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('assignedTo', 'email')
        .populate('createdBy', 'email')
        .lean<TaskLean[]>()
        .exec(),
      this.taskModel.countDocuments(query).exec(),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findAll(
    filter: Record<string, unknown>,
    queryDto: { page?: number; limit?: number },
    sortField = 'dueDate',
    sortOrder: 'asc' | 'desc' = 'asc',
  ): Promise<PaginatedResult<TaskLean>> {
    const page = queryDto.page ?? 1;
    const limit = queryDto.limit ?? 20;
    const skip = calculateSkip(page, limit);
    const sort: Record<string, 1 | -1> = {
      [sortField]: sortOrder === 'asc' ? 1 : -1,
    };

    const query = {
      deletedAt: null,
      ...filter,
    };

    const [data, total] = await Promise.all([
      this.taskModel
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('assignedTo', 'email')
        .populate('createdBy', 'email')
        .lean<TaskLean[]>()
        .exec(),
      this.taskModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findMyTasks(
    userId: Types.ObjectId,
    dto: ListTasksQueryDto,
  ): Promise<PaginatedResult<TaskLean>> {
    return this.findList(dto, { assignedTo: userId });
  }

  async findTeamTasks(
    teamId: Types.ObjectId,
    dto: ListTasksQueryDto,
  ): Promise<PaginatedResult<TaskLean>> {
    return this.findList(dto, { teamId });
  }

  async findOverdue(
    callerFilter?: Record<string, unknown>,
    queryDto?: { page?: number; limit?: number },
  ): Promise<PaginatedResult<TaskLean>> {
    const page = queryDto?.page ?? 1;
    const limit = queryDto?.limit ?? 20;
    const skip = calculateSkip(page, limit);
    const query: Record<string, unknown> = {
      deletedAt: null,
      status: { $in: OPEN_TASK_STATUSES },
      dueDate: { $lt: new Date() },
      ...callerFilter,
    };
    const [data, total] = await Promise.all([
      this.taskModel
        .find(query)
        .sort({ dueDate: 1 })
        .skip(skip)
        .limit(limit)
        .lean<TaskLean[]>()
        .exec(),
      this.taskModel.countDocuments(query).exec(),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findUpcoming(
    callerFilter?: Record<string, unknown>,
    queryDto?: { page?: number; limit?: number },
    daysAhead = 7,
  ): Promise<PaginatedResult<TaskLean>> {
    const page = queryDto?.page ?? 1;
    const limit = queryDto?.limit ?? 20;
    const skip = calculateSkip(page, limit);
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const query: Record<string, unknown> = {
      deletedAt: null,
      status: { $in: OPEN_TASK_STATUSES },
      dueDate: { $gte: now, $lte: future },
      ...callerFilter,
    };
    const [data, total] = await Promise.all([
      this.taskModel
        .find(query)
        .sort({ dueDate: 1 })
        .skip(skip)
        .limit(limit)
        .lean<TaskLean[]>()
        .exec(),
      this.taskModel.countDocuments(query).exec(),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findCalendar(
    callerFilter: Record<string, unknown>,
    startDate: Date,
    endDate: Date,
  ): Promise<TaskLean[]> {
    const query: Record<string, unknown> = {
      deletedAt: null,
      dueDate: { $gte: startDate, $lte: endDate },
      ...callerFilter,
    };
    return this.taskModel
      .find(query)
      .sort({ dueDate: 1 })
      .lean<TaskLean[]>()
      .exec();
  }

  async findDueReminders(userId: Types.ObjectId): Promise<TaskLean[]> {
    const now = new Date();
    return this.taskModel
      .find({
        assignedTo: userId,
        isReminderSent: false,
        deletedAt: null,
        status: { $in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        reminderAt: { $lte: now },
        $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: now } }],
      })
      .sort({ reminderAt: 1 })
      .lean<TaskLean[]>()
      .exec();
  }

  async getSummary(callerFilter?: Record<string, unknown>): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    completionRate: number;
    overdueCount: number;
  }> {
    const baseMatch: Record<string, unknown> = {
      deletedAt: null,
      ...callerFilter,
    };
    const now = new Date();

    interface TaskAggResult {
      _id: string;
      count: number;
    }

    const [statusAgg, priorityAgg, overdueAgg] = await Promise.all([
      this.taskModel
        .aggregate<TaskAggResult>([
          { $match: baseMatch },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
        .exec(),
      this.taskModel
        .aggregate<TaskAggResult>([
          { $match: baseMatch },
          { $group: { _id: '$priority', count: { $sum: 1 } } },
        ])
        .exec(),
      this.taskModel
        .countDocuments({
          ...baseMatch,
          status: { $in: OPEN_TASK_STATUSES },
          dueDate: { $lt: now },
        })
        .exec(),
    ]);

    const byStatus: Record<string, number> = {};
    let total = 0;
    let completed = 0;
    for (const row of statusAgg) {
      byStatus[row._id] = row.count;
      total += row.count;
      if (row._id === (TaskStatus.COMPLETED as string)) completed = row.count;
    }

    const byPriority: Record<string, number> = {};
    for (const row of priorityAgg) {
      byPriority[row._id] = row.count;
    }

    const completionRate =
      total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      total,
      byStatus,
      byPriority,
      completionRate,
      overdueCount: overdueAgg,
    };
  }

  async atomicStatusTransition(
    id: Types.ObjectId,
    validPriorStatuses: TaskStatus[],
    updatePayload: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<TaskLean | null> {
    const query = this.taskModel.findOneAndUpdate(
      { _id: id, status: { $in: validPriorStatuses }, deletedAt: null },
      { $set: updatePayload },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<TaskLean>().exec();
  }

  async updateById(
    id: Types.ObjectId,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<TaskLean | null> {
    const query = this.taskModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<TaskLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<TaskLean | null> {
    const query = this.taskModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy } },
      { new: true },
    );
    if (session) query.session(session);
    return query.lean<TaskLean>().exec();
  }

  async findAccessibleByIds(
    taskIds: Types.ObjectId[],
    callerFilter: Record<string, unknown>,
  ): Promise<TaskLean[]> {
    return this.taskModel
      .find({
        _id: { $in: taskIds },
        deletedAt: null,
        ...callerFilter,
      })
      .select('_id')
      .lean<TaskLean[]>()
      .exec();
  }

  async bulkUpdateAssignee(
    taskIds: Types.ObjectId[],
    assignedTo: Types.ObjectId,
    teamId: Types.ObjectId | null,
  ): Promise<number> {
    const result = await this.taskModel
      .updateMany(
        { _id: { $in: taskIds }, deletedAt: null },
        { $set: { assignedTo, teamId } },
      )
      .exec();
    return result.modifiedCount;
  }
}
