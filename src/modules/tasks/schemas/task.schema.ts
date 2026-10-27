import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TaskStatus } from '../constants/task-status.constant';
import { TaskPriority } from '../constants/task-priority.constant';

export type TaskDocument = HydratedDocument<Task>;
export type TaskLean = Task & { _id: Types.ObjectId };

export enum TaskRelatedEntityType {
  LEAD = 'Lead',
  CONTACT = 'Contact',
  COMPANY = 'Company',
  DEAL = 'Deal',
}

@Schema({ collection: 'tasks', timestamps: true, versionKey: false })
export class Task {
  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;

  // status is covered by compound indexes; no standalone single-field index
  @Prop({
    type: String,
    enum: Object.values(TaskStatus),
    default: TaskStatus.PENDING,
  })
  status!: TaskStatus;

  // Single-field index: priority-filtered dashboard lookups
  @Prop({
    type: String,
    enum: Object.values(TaskPriority),
    default: TaskPriority.MEDIUM,
    index: true,
  })
  priority!: TaskPriority;

  // Single-field index: creator-scoped auditing
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  // Assignment & Ownership (covered by compound indexes)
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  assignedTo!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Team', default: null })
  teamId?: Types.ObjectId | null;

  // Schedule & Dates
  @Prop({ type: Date, default: null })
  startDate?: Date | null;

  @Prop({ type: Date, required: true })
  dueDate!: Date;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  completedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  cancelledAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  cancelledBy?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  cancelReason?: string | null;

  // Polymorphic CRM Association (Strictly Paired — both or neither)
  @Prop({
    type: String,
    enum: Object.values(TaskRelatedEntityType),
    default: null,
  })
  relatedToType?: TaskRelatedEntityType | null;

  @Prop({ type: Types.ObjectId, default: null })
  relatedToId?: Types.ObjectId | null;

  // In-Database Reminder State
  @Prop({ type: Date, default: null })
  reminderAt?: Date | null;

  @Prop({ type: Boolean, default: false })
  isReminderSent!: boolean;

  // Reserved for P2 BullMQ Worker Queue
  @Prop({ type: Date, default: null })
  reminderClaimedAt?: Date | null;

  // Reserved for P2 BullMQ Worker Queue
  @Prop({ type: String, default: null })
  reminderClaimedBy?: string | null;

  @Prop({ type: Date, default: null })
  snoozedUntil?: Date | null;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

// =========================================================================
// Strict MongoDB ESR (Equality, Sort, Range) Compliant Compound Indexes
// =========================================================================

// 1. User Dashboard: Equality(assignedTo, deletedAt, status) -> Range(dueDate)
TaskSchema.index(
  { assignedTo: 1, deletedAt: 1, status: 1, dueDate: 1 },
  { name: 'idx_tasks_user_status_due' },
);

// 2. Team Dashboard: Equality(teamId, deletedAt, status) -> Range(dueDate)
TaskSchema.index(
  { teamId: 1, deletedAt: 1, status: 1, dueDate: 1 },
  { name: 'idx_tasks_team_status_due' },
);

// 3. CRM Entity Sub-resource: Equality(relatedToType, relatedToId, deletedAt) -> Sort(createdAt: -1)
TaskSchema.index(
  { relatedToType: 1, relatedToId: 1, deletedAt: 1, createdAt: -1 },
  { name: 'idx_tasks_related_crm_entity' },
);

// 4. Overdue & Global Due Scans: Equality(deletedAt, status) -> Range(dueDate)
TaskSchema.index(
  { deletedAt: 1, status: 1, dueDate: 1 },
  { name: 'idx_tasks_due_status' },
);

// 5. In-App User Due Reminders: Equality(assignedTo, isReminderSent, deletedAt) -> Range(reminderAt)
TaskSchema.index(
  { assignedTo: 1, isReminderSent: 1, deletedAt: 1, reminderAt: 1 },
  { name: 'idx_tasks_reminder_pending' },
);
