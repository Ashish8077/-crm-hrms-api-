import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  ApprovalTimelineEntry,
  LeaveRequest,
  LeaveRequestDocument,
} from '../schemas/leave-request.schema';
import { LeaveRequestStatus } from '../constants/leaves.constant';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';

export type LeaveRequestLean = LeaveRequest & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class LeaveRequestRepository implements OnModuleInit {
  private readonly logger = new Logger(LeaveRequestRepository.name);

  constructor(
    @InjectModel(LeaveRequest.name)
    private readonly leaveRequestModel: Model<LeaveRequestDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.leaveRequestModel.syncIndexes();
      this.logger.log(
        'LeaveRequest indexes synchronized with MongoDB WiredTiger',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to synchronize LeaveRequest indexes: ${(error as Error).message}`,
      );
    }
  }

  async create(
    data: Partial<LeaveRequest> & { _id?: Types.ObjectId },
    session?: ClientSession,
  ): Promise<LeaveRequestLean> {
    const doc = new this.leaveRequestModel(data);
    const saved = await doc.save({ session });
    return saved.toObject() as LeaveRequestLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<LeaveRequestLean | null> {
    const query = this.leaveRequestModel.findOne({
      _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<LeaveRequestLean>().exec();
  }

  /**
   * Finds active overlapping leave requests for an employee.
   * Standard interval overlap condition: (startDate <= targetEnd) && (endDate >= targetStart).
   */
  async findOverlappingRequests(
    employeeId: Types.ObjectId | string,
    startDate: string,
    endDate: string,
    excludeId?: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<LeaveRequestLean[]> {
    const eId =
      typeof employeeId === 'string'
        ? new Types.ObjectId(employeeId)
        : employeeId;

    const filter: Record<string, unknown> = {
      employeeId: eId,
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
      status: {
        $in: [
          LeaveRequestStatus.PENDING,
          LeaveRequestStatus.APPROVED,
          LeaveRequestStatus.CANCELLATION_REQUESTED,
        ],
      },
      deletedAt: null,
    };

    if (excludeId) {
      filter._id = {
        $ne:
          typeof excludeId === 'string'
            ? new Types.ObjectId(excludeId)
            : excludeId,
      };
    }

    const query = this.leaveRequestModel.find(filter);
    if (session) query.session(session);
    return query.lean<LeaveRequestLean[]>().exec();
  }

  async findList(
    filter: Record<string, unknown> = {},
    page: number = 1,
    limit: number = 20,
    sort: Record<string, 1 | -1> = { createdAt: -1 },
  ): Promise<PaginatedResult<LeaveRequestLean>> {
    const cleanFilter = { ...filter, deletedAt: null };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.leaveRequestModel
        .find(cleanFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<LeaveRequestLean[]>()
        .exec(),
      this.leaveRequestModel.countDocuments(cleanFilter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findPendingApprovalsByManager(
    managerEmployeeId: Types.ObjectId | string,
    page: number = 1,
    limit: number = 20,
    filter: Record<string, unknown> = {},
  ): Promise<PaginatedResult<LeaveRequestLean>> {
    const mId =
      typeof managerEmployeeId === 'string'
        ? new Types.ObjectId(managerEmployeeId)
        : managerEmployeeId;

    return this.findList(
      {
        ...filter,
        reportingManagerId: mId,
        status: LeaveRequestStatus.PENDING,
      },
      page,
      limit,
      { createdAt: -1 },
    );
  }

  /**
   * Atomic State Transition Guard:
   * Only transitions state if the current status strictly matches `fromStatus`.
   * Prevents race conditions like two managers approving simultaneously,
   * approving an already rejected/cancelled request, etc.
   */
  async updateStatus(
    id: Types.ObjectId | string,
    fromStatus: LeaveRequestStatus | LeaveRequestStatus[],
    toStatus: LeaveRequestStatus,
    timelineEntry: ApprovalTimelineEntry,
    extraFields: Record<string, unknown> = {},
    session?: ClientSession,
  ): Promise<LeaveRequestLean | null> {
    const statusFilter = Array.isArray(fromStatus)
      ? { $in: fromStatus }
      : fromStatus;

    const query = this.leaveRequestModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        status: statusFilter,
        deletedAt: null,
      },
      {
        $set: {
          status: toStatus,
          ...extraFields,
        },
        $push: {
          approvalTimeline: timelineEntry,
        },
      },
      { new: true, session },
    );

    return query.lean<LeaveRequestLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId | string,
    deletedBy: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<LeaveRequestLean | null> {
    const query = this.leaveRequestModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
        },
      },
      { new: true, session },
    );
    return query.lean<LeaveRequestLean>().exec();
  }
}
