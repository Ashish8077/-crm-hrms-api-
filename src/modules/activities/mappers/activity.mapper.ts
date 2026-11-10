import { Types } from 'mongoose';
import {
  ActivityEntityType,
  ActivityOutcome,
  ActivityType,
  CrmActivity,
} from '../../../common/schemas/crm-activity.schema';
import { CrmActivityLean } from '../../../common/repositories/crm-activity.repository';

export interface ActivityPerformerResponse {
  id: string;
  name?: string;
  email?: string;
}

export interface ActivityResponse {
  id: string;
  entityType: ActivityEntityType;
  entityId: string;
  type: ActivityType;
  subject: string;
  description: string | null;
  activityDate: Date;
  durationMinutes: number;
  outcome: ActivityOutcome | null;
  performedBy: string;
  performer?: ActivityPerformerResponse | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class ActivityMapper {
  private static extractId(val: unknown): string | null {
    if (!val) return null;
    if (typeof val === 'object' && '_id' in val) {
      return (val as { _id: Types.ObjectId })._id.toString();
    }
    return (val as Types.ObjectId).toString();
  }

  private static extractPerformerSummary(
    val: unknown,
  ): ActivityPerformerResponse | null {
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

  static toResponse(activity: CrmActivityLean | CrmActivity): ActivityResponse {
    const activityId = (activity as CrmActivityLean)._id
      ? (activity as CrmActivityLean)._id.toString()
      : (activity as unknown as { id: string }).id;

    const performedById = this.extractId(activity.performedBy) ?? '';
    const performerSummary = this.extractPerformerSummary(activity.performedBy);
    const entityIdStr = this.extractId(activity.entityId) ?? '';

    return {
      id: activityId,
      entityType: activity.entityType,
      entityId: entityIdStr,
      type: activity.type,
      subject: activity.subject,
      description: activity.description ?? null,
      activityDate: activity.activityDate,
      durationMinutes: activity.durationMinutes ?? 0,
      outcome: activity.outcome ?? null,
      performedBy: performedById,
      performer: performerSummary,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
    };
  }

  static toResponseList(
    activities: (CrmActivityLean | CrmActivity)[],
  ): ActivityResponse[] {
    return activities.map((act) => this.toResponse(act));
  }
}
