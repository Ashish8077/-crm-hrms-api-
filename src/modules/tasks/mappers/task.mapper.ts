import { Types } from 'mongoose';
import { Task, TaskLean, TaskRelatedEntityType } from '../schemas/task.schema';
import { TaskStatus } from '../constants/task-status.constant';
import { TaskPriority } from '../constants/task-priority.constant';

export interface UserSummaryResponse {
  id: string;
  name?: string;
  email?: string;
}

export interface TaskResponse {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  createdBy: string;
  creator?: UserSummaryResponse | null;
  assignedTo: string;
  assignee?: UserSummaryResponse | null;
  teamId: string | null;
  startDate: Date | null;
  dueDate: Date;
  completedAt: Date | null;
  completedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  relatedToType: TaskRelatedEntityType | null;
  relatedToId: string | null;
  reminderAt: Date | null;
  isReminderSent: boolean;
  snoozedUntil: Date | null;
  tags: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class TaskMapper {
  private static extractId(val: unknown): string | null {
    if (!val) return null;
    if (typeof val === 'object' && '_id' in val) {
      return (val as { _id: Types.ObjectId })._id.toString();
    }
    return (val as Types.ObjectId).toString();
  }

  private static extractUserSummary(val: unknown): UserSummaryResponse | null {
    if (!val || typeof val !== 'object') return null;
    if ('_id' in val) {
      const u = val as {
        _id: Types.ObjectId;
        firstName?: string;
        lastName?: string;
        email?: string;
        name?: string;
      };
      const name =
        u.name ??
        ([u.firstName, u.lastName].filter(Boolean).join(' ') || undefined);
      return {
        id: u._id.toString(),
        name,
        email: u.email,
      };
    }
    return null;
  }

  static toResponse(task: TaskLean | Task): TaskResponse {
    const taskId = (task as TaskLean)._id
      ? (task as TaskLean)._id.toString()
      : (task as unknown as { id: string }).id;

    const createdById = this.extractId(task.createdBy) ?? '';
    const creatorSummary = this.extractUserSummary(task.createdBy);

    const assignedToId = this.extractId(task.assignedTo) ?? '';
    const assigneeSummary = this.extractUserSummary(task.assignedTo);

    const teamIdStr = this.extractId(task.teamId);
    const completedById = this.extractId(task.completedBy);
    const cancelledById = this.extractId(task.cancelledBy);
    const relatedToIdStr = this.extractId(task.relatedToId);

    return {
      id: taskId,
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      priority: task.priority,
      createdBy: createdById,
      creator: creatorSummary,
      assignedTo: assignedToId,
      assignee: assigneeSummary,
      teamId: teamIdStr,
      startDate: task.startDate ?? null,
      dueDate: task.dueDate,
      completedAt: task.completedAt ?? null,
      completedBy: completedById,
      cancelledAt: task.cancelledAt ?? null,
      cancelledBy: cancelledById,
      cancelReason: task.cancelReason ?? null,
      relatedToType: task.relatedToType ?? null,
      relatedToId: relatedToIdStr,
      reminderAt: task.reminderAt ?? null,
      isReminderSent: task.isReminderSent ?? false,
      snoozedUntil: task.snoozedUntil ?? null,
      tags: task.tags ?? [],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  static toResponseList(tasks: (TaskLean | Task)[]): TaskResponse[] {
    return tasks.map((task) => this.toResponse(task));
  }
}
