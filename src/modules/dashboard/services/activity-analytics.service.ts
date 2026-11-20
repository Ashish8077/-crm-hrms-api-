import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { CrmActivity, CrmActivityDocument, ActivityType } from '../../../common/schemas/crm-activity.schema';
import { Task, TaskDocument } from '../../tasks/schemas/task.schema';
import { TaskStatus, TERMINAL_TASK_STATUSES } from '../../tasks/constants/task-status.constant';
import { DataScope } from '../types/data-scope.types';

@Injectable()
export class ActivityAnalyticsService {
  constructor(
    @InjectModel(CrmActivity.name)
    private readonly activityModel: Model<CrmActivityDocument>,
    @InjectModel(Task.name)
    private readonly taskModel: Model<TaskDocument>,
  ) {}

  private buildDateFilter(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return {};
    const dateFilter: Record<string, unknown> = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }
    return { activityDate: dateFilter };
  }

  async getActivityKpis(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
    activityType?: string,
  ) {
    const matchFilter: Record<string, unknown> = {
      performedBy: { $in: scope.ownerIds },
      deletedAt: null,
      ...this.buildDateFilter(startDate, endDate),
    };

    if (activityType) {
      matchFilter.type = activityType.toUpperCase();
    }

    const pipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
        },
      },
    ];

    const results = await this.activityModel.aggregate<{ _id: string; count: number }>(pipeline).exec();
    const totalActivities = results.reduce((acc, r) => acc + r.count, 0);

    const breakdown = results.map((r) => ({
      type: r._id.toLowerCase(),
      count: r.count,
      percentOfTotal: totalActivities > 0 ? Number(((r.count / totalActivities) * 100).toFixed(2)) : 0,
    }));

    // Tasks metrics
    const now = new Date();
    const tasksOverdue = await this.taskModel.countDocuments({
      assignedTo: { $in: scope.ownerIds },
      deletedAt: null,
      dueDate: { $lt: now },
      status: { $nin: TERMINAL_TASK_STATUSES },
    });

    const tasksCompleted = await this.taskModel.countDocuments({
      assignedTo: { $in: scope.ownerIds },
      deletedAt: null,
      status: TaskStatus.COMPLETED,
    });

    const tasksCompletedOnTime = await this.taskModel.countDocuments({
      assignedTo: { $in: scope.ownerIds },
      deletedAt: null,
      status: TaskStatus.COMPLETED,
      $expr: { $lte: ['$completedAt', '$dueDate'] },
    });

    const totalTasks = await this.taskModel.countDocuments({
      assignedTo: { $in: scope.ownerIds },
      deletedAt: null,
    });

    const taskCompletionRate = totalTasks > 0 ? Number(((tasksCompleted / totalTasks) * 100).toFixed(2)) : 0;

    return {
      activityBreakdown: breakdown,
      totalActivities,
      tasksOverdue,
      tasksCompletedOnTime,
      taskCompletionRate,
    };
  }

  async getOverdueTasksCount(scope: DataScope): Promise<number> {
    const now = new Date();
    return this.taskModel
      .countDocuments({
        assignedTo: { $in: scope.ownerIds },
        deletedAt: null,
        dueDate: { $lt: now },
        status: { $nin: TERMINAL_TASK_STATUSES },
      })
      .exec();
  }

  async getTasksDueTodayCount(scope: DataScope): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    return this.taskModel
      .countDocuments({
        assignedTo: { $in: scope.ownerIds },
        deletedAt: null,
        dueDate: { $gte: todayStart, $lte: todayEnd },
        status: { $nin: TERMINAL_TASK_STATUSES },
      })
      .exec();
  }

  async getFollowUpsDueTodayCount(scope: DataScope): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    return this.activityModel
      .countDocuments({
        performedBy: { $in: scope.ownerIds },
        deletedAt: null,
        type: { $in: [ActivityType.CALL, ActivityType.MEETING] },
        activityDate: { $gte: todayStart, $lte: todayEnd },
      })
      .exec();
  }

  async getRecentActivities(scope: DataScope, limit = 5) {
    return this.activityModel
      .find({
        performedBy: { $in: scope.ownerIds },
        deletedAt: null,
      })
      .sort({ activityDate: -1 })
      .limit(limit)
      .select('type entityType entityId subject activityDate performedBy outcome')
      .lean()
      .exec();
  }

  async getActivitiesByOwnerForLeaderboard(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
  ) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          performedBy: { $in: scope.ownerIds },
          deletedAt: null,
          ...this.buildDateFilter(startDate, endDate),
        },
      },
      {
        $group: {
          _id: '$performedBy',
          count: { $sum: 1 },
        },
      },
    ];

    const results = await this.activityModel.aggregate(pipeline).exec();
    return new Map<string, number>(results.map((r) => [r._id.toString(), r.count]));
  }
}

