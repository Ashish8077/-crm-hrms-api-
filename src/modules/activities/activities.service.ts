import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import {
  CrmActivityLean,
  CrmActivityRepository,
} from '../../common/repositories/crm-activity.repository';
import { ActivityEntityType } from '../../common/schemas/crm-activity.schema';
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
import { TaskRelatedEntityType } from '../tasks/schemas/task.schema';
import { TaskRepository } from '../tasks/repositories/task.repository';
import { TasksService } from '../tasks/tasks.service';
import { ACTIVITY_CALENDAR_MAX_DAYS } from './activities.constants';
import { ActivityCalendarQueryDto } from './dto/activity-calendar-query.dto';
import { ListActivitiesQueryDto } from './dto/list-activities-query.dto';
import { LogActivityDto } from './dto/log-activity.dto';
import { RecordActivityOutcomeDto } from './dto/record-activity-outcome.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { ActivityMapper, ActivityResponse } from './mappers/activity.mapper';
import { TaskResponse } from '../tasks/mappers/task.mapper';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly crmActivityRepository: CrmActivityRepository,
    private readonly tasksService: TasksService,
    private readonly taskRepository: TaskRepository,
    private readonly leadRepository: LeadRepository,
    private readonly contactRepository: ContactRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly dealRepository: DealRepository,
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly auditLogsService: AuditLogsService,
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
    return { performedBy: user.userId };
  }

  private async verifyActivityAccess(
    activity: CrmActivityLean,
    user: AuthenticatedUser,
  ): Promise<void> {
    const isAdmin = await this.isUserAdmin(user.userId);
    if (isAdmin) return;

    if (activity.performedBy?.toString() === user.userId.toString()) {
      return;
    }

    throw new AppError(
      ErrorCode.FORBIDDEN,
      'You do not have access to this activity record',
      HttpStatus.FORBIDDEN,
    );
  }

  private async validateParentEntity(
    entityType: ActivityEntityType,
    entityId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    let exists = false;
    switch (entityType) {
      case ActivityEntityType.LEAD: {
        const lead = await this.leadRepository.findById(entityId, session);
        exists = !!lead;
        break;
      }
      case ActivityEntityType.CONTACT: {
        const contact = await this.contactRepository.findById(
          entityId,
          session,
        );
        exists = !!contact;
        break;
      }
      case ActivityEntityType.COMPANY: {
        const company = await this.companyRepository.findById(
          entityId,
          session,
        );
        exists = !!company;
        break;
      }
      case ActivityEntityType.DEAL: {
        const deal = await this.dealRepository.findById(entityId, session);
        exists = !!deal;
        break;
      }
      case ActivityEntityType.TASK: {
        const task = await this.taskRepository.findById(entityId, session);
        exists = !!task;
        break;
      }
      default:
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid entity type: ${String(entityType)}`,
          HttpStatus.BAD_REQUEST,
        );
    }

    if (!exists) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Target CRM ${entityType} entity not found`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async logActivity(
    dto: LogActivityDto,
    actorId: Types.ObjectId,
  ): Promise<ActivityResponse> {
    const entityId = new Types.ObjectId(dto.entityId);
    await this.validateParentEntity(dto.entityType, entityId);

    const activityDate = dto.activityDate
      ? new Date(dto.activityDate)
      : new Date();

    const activityData = {
      entityType: dto.entityType,
      entityId,
      type: dto.type,
      subject: dto.subject.trim(),
      description: dto.description?.trim() ?? null,
      activityDate,
      durationMinutes: dto.durationMinutes ?? 0,
      outcome: dto.outcome ?? null,
      performedBy: actorId,
    };

    const created = await this.crmActivityRepository.create(activityData);

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.ACTIVITY_LOGGED,
      targetModel: AuditTargetModel.CRM_ACTIVITY,
      targetId: created._id,
      details: {
        entityType: created.entityType,
        entityId: created.entityId.toString(),
        type: created.type,
        subject: created.subject,
      },
      ipAddress: null,
      userAgent: null,
    });

    return ActivityMapper.toResponse(created);
  }

  async findAll(
    queryDto: ListActivitiesQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<ActivityResponse>> {
    const accessFilter = await this.buildAccessFilter(user);
    const filter: Record<string, unknown> = { ...accessFilter };

    if (queryDto.entityType) filter.entityType = queryDto.entityType;
    if (queryDto.entityId)
      filter.entityId = new Types.ObjectId(queryDto.entityId);
    if (queryDto.type) filter.type = queryDto.type;
    if (queryDto.outcome) filter.outcome = queryDto.outcome;
    if (queryDto.performedBy)
      filter.performedBy = new Types.ObjectId(queryDto.performedBy);

    if (queryDto.dateFrom || queryDto.dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (queryDto.dateFrom) dateFilter.$gte = new Date(queryDto.dateFrom);
      if (queryDto.dateTo) dateFilter.$lte = new Date(queryDto.dateTo);
      filter.activityDate = dateFilter;
    }

    if (queryDto.search) {
      const regex = { $regex: queryDto.search.trim(), $options: 'i' };
      filter.$or = [{ subject: regex }, { description: regex }];
    }

    const result = await this.crmActivityRepository.findAll(
      filter,
      queryDto,
      queryDto.sortField,
      queryDto.sortOrder,
    );

    return {
      data: ActivityMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  async findCalendar(
    queryDto: ActivityCalendarQueryDto,
    user: AuthenticatedUser,
  ): Promise<ActivityResponse[]> {
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
    if (diffDays > ACTIVITY_CALENDAR_MAX_DAYS) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Calendar window cannot exceed ${ACTIVITY_CALENDAR_MAX_DAYS} days`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const accessFilter = await this.buildAccessFilter(user);
    const filter: Record<string, unknown> = { ...accessFilter };

    if (queryDto.performedBy) {
      filter.performedBy = new Types.ObjectId(queryDto.performedBy);
    }

    const activities = await this.crmActivityRepository.findCalendar(
      filter,
      startDate,
      endDate,
    );

    return ActivityMapper.toResponseList(activities);
  }

  async getSummary(user: AuthenticatedUser): Promise<{
    total: number;
    byType: Record<string, number>;
    byOutcome: Record<string, number>;
  }> {
    const accessFilter = await this.buildAccessFilter(user);
    return this.crmActivityRepository.getSummary(accessFilter);
  }

  async findById(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ActivityResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid activity ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const activityId = new Types.ObjectId(id);
    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyActivityAccess(activity, user);
    return ActivityMapper.toResponse(activity);
  }

  async update(
    id: string,
    dto: UpdateActivityDto,
    user: AuthenticatedUser,
  ): Promise<ActivityResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid activity ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const activityId = new Types.ObjectId(id);
    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyActivityAccess(activity, user);

    const updatePayload: Record<string, unknown> = {};
    if (dto.type !== undefined) updatePayload.type = dto.type;
    if (dto.subject !== undefined) updatePayload.subject = dto.subject.trim();
    if (dto.description !== undefined)
      updatePayload.description = dto.description?.trim() ?? null;
    if (dto.activityDate !== undefined)
      updatePayload.activityDate = new Date(dto.activityDate);
    if (dto.durationMinutes !== undefined)
      updatePayload.durationMinutes = dto.durationMinutes;
    if (dto.outcome !== undefined) updatePayload.outcome = dto.outcome;

    const updated = await this.crmActivityRepository.updateById(
      activityId,
      updatePayload,
    );
    if (!updated) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity update failed',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId: user.userId,
      action: AuditAction.ACTIVITY_UPDATED,
      targetModel: AuditTargetModel.CRM_ACTIVITY,
      targetId: activityId,
      details: updatePayload,
      ipAddress: null,
      userAgent: null,
    });

    return ActivityMapper.toResponse(updated);
  }

  async recordOutcome(
    id: string,
    dto: RecordActivityOutcomeDto,
    user: AuthenticatedUser,
  ): Promise<{ activity: ActivityResponse; followUpTask?: TaskResponse }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid activity ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const activityId = new Types.ObjectId(id);
    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyActivityAccess(activity, user);

    if (dto.spawnFollowUpTask) {
      if (!dto.followUpDueDate) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'followUpDueDate is required when spawnFollowUpTask is true',
          HttpStatus.BAD_REQUEST,
        );
      }

      const session = await this.connection.startSession();
      try {
        session.startTransaction();

        const updatePayload: Record<string, unknown> = {
          outcome: dto.outcome,
        };
        if (dto.notes) {
          const prevDesc = activity.description
            ? `${activity.description}\n\n`
            : '';
          updatePayload.description = `${prevDesc}[Outcome Notes]: ${dto.notes.trim()}`;
        }

        const updatedActivity = await this.crmActivityRepository.updateById(
          activityId,
          updatePayload,
          session,
        );

        const targetAssigneeId = dto.followUpAssignedTo
          ? dto.followUpAssignedTo
          : activity.performedBy.toString();

        let relatedToType: TaskRelatedEntityType | undefined;
        let relatedToId: string | undefined;

        if (
          activity.entityType === ActivityEntityType.LEAD ||
          activity.entityType === ActivityEntityType.CONTACT ||
          activity.entityType === ActivityEntityType.COMPANY ||
          activity.entityType === ActivityEntityType.DEAL
        ) {
          relatedToType =
            activity.entityType as unknown as TaskRelatedEntityType;
          relatedToId = activity.entityId.toString();
        }

        const followUpTask = await this.tasksService.create(
          {
            title:
              dto.followUpTitle?.trim() || `Follow-up: ${activity.subject}`,
            description: dto.notes
              ? `Follow-up from activity "${activity.subject}": ${dto.notes.trim()}`
              : `Follow-up spawned from activity "${activity.subject}"`,
            dueDate: dto.followUpDueDate,
            assignedTo: targetAssigneeId,
            priority: dto.followUpPriority,
            relatedToType,
            relatedToId,
          },
          user.userId,
          session,
        );

        await session.commitTransaction();

        await this.auditLogsService.createAuditLog({
          actorId: user.userId,
          action: AuditAction.ACTIVITY_UPDATED,
          targetModel: AuditTargetModel.CRM_ACTIVITY,
          targetId: activityId,
          details: {
            outcome: dto.outcome,
            spawnedTaskId: followUpTask.id,
          },
          ipAddress: null,
          userAgent: null,
        });

        return {
          activity: ActivityMapper.toResponse(updatedActivity!),
          followUpTask,
        };
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        await session.endSession();
      }
    } else {
      const updatePayload: Record<string, unknown> = {
        outcome: dto.outcome,
      };
      if (dto.notes) {
        const prevDesc = activity.description
          ? `${activity.description}\n\n`
          : '';
        updatePayload.description = `${prevDesc}[Outcome Notes]: ${dto.notes.trim()}`;
      }

      const updated = await this.crmActivityRepository.updateById(
        activityId,
        updatePayload,
      );

      await this.auditLogsService.createAuditLog({
        actorId: user.userId,
        action: AuditAction.ACTIVITY_UPDATED,
        targetModel: AuditTargetModel.CRM_ACTIVITY,
        targetId: activityId,
        details: { outcome: dto.outcome },
        ipAddress: null,
        userAgent: null,
      });

      return { activity: ActivityMapper.toResponse(updated!) };
    }
  }

  async delete(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid activity ID format',
        HttpStatus.BAD_REQUEST,
      );
    }
    const activityId = new Types.ObjectId(id);
    const activity = await this.crmActivityRepository.findById(activityId);
    if (!activity) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Activity not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.verifyActivityAccess(activity, user);

    const deleted = await this.crmActivityRepository.softDelete(
      activityId,
      user.userId,
    );
    if (!deleted) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Failed to delete activity',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId: user.userId,
      action: AuditAction.ACTIVITY_DELETED,
      targetModel: AuditTargetModel.CRM_ACTIVITY,
      targetId: activityId,
      details: { subject: activity.subject },
      ipAddress: null,
      userAgent: null,
    });

    return { success: true };
  }
}
