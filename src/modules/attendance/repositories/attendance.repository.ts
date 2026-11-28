import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  Attendance,
  AttendanceDocument,
  BreakSession,
} from '../schemas/attendance.schema';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import { AttendanceStatus } from '../constants/attendance.constant';

export type AttendanceLean = Attendance & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export interface CreateAbsentRecordResult {
  created: boolean;
  attendance?: AttendanceLean;
}

export interface MonthlyAttendanceSummary {
  totalRecords: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  incompleteDays: number;
  lateDays: number;
  earlyDepartures: number;
  totalWorkingMinutes: number;
  totalOvertimeMinutes: number;
  totalBreakMinutes: number;
}

export interface PayrollAttendanceBucket {
  employeeId: Types.ObjectId;
  attendanceDate: string;
  recordCount: number;
  status: AttendanceStatus;
  statuses: AttendanceStatus[];
  isLate: boolean;
  lateMinutes: number;
  isEarlyDeparture: boolean;
  earlyDepartureMinutes: number;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  overtimeMinutes: number;
  regularizationId: Types.ObjectId | null;
  leaveRequestId: Types.ObjectId | null;
}

@Injectable()
export class AttendanceRepository implements OnModuleInit {
  private readonly logger = new Logger(AttendanceRepository.name);

  constructor(
    @InjectModel(Attendance.name)
    private readonly attendanceModel: Model<AttendanceDocument>,
  ) {}

  /**
   * Layer 1: Synchronize compound unique index { employeeId: 1, attendanceDate: 1 }
   * into MongoDB WiredTiger storage engine on startup.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.attendanceModel.syncIndexes();
      this.logger.log(
        'Attendance compound unique indexes synchronized with MongoDB WiredTiger',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to synchronize Attendance indexes: ${(error as Error).message}`,
      );
    }
  }

  async create(
    data: Partial<Attendance>,
    session?: ClientSession,
  ): Promise<AttendanceLean> {
    const attendance = new this.attendanceModel(data);
    const saved = await attendance.save({ session });
    return saved.toObject() as AttendanceLean;
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<AttendanceLean | null> {
    const query = this.attendanceModel.findOne({
      _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceLean>().exec();
  }

  async findByEmployeeAndDate(
    employeeId: Types.ObjectId | string,
    attendanceDate: string,
    session?: ClientSession,
  ): Promise<AttendanceLean | null> {
    const query = this.attendanceModel.findOne({
      employeeId:
        typeof employeeId === 'string'
          ? new Types.ObjectId(employeeId)
          : employeeId,
      attendanceDate,
      deletedAt: null,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceLean>().exec();
  }

  async findActiveSessionByEmployee(
    employeeId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<AttendanceLean | null> {
    const query = this.attendanceModel
      .findOne({
        employeeId:
          typeof employeeId === 'string'
            ? new Types.ObjectId(employeeId)
            : employeeId,
        status: {
          $in: [AttendanceStatus.CHECKED_IN, AttendanceStatus.ON_BREAK],
        },
        deletedAt: null,
      })
      .sort({ attendanceDate: -1 });
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceLean>().exec();
  }

  async findCalendar(
    employeeId: Types.ObjectId | string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceLean[]> {
    return this.attendanceModel
      .find({
        employeeId:
          typeof employeeId === 'string'
            ? new Types.ObjectId(employeeId)
            : employeeId,
        attendanceDate: { $gte: startDate, $lte: endDate },
        deletedAt: null,
      })
      .sort({ attendanceDate: 1 })
      .lean<AttendanceLean[]>()
      .exec();
  }

  async findList(
    filter: Record<string, unknown>,
    page: number = 1,
    limit: number = 20,
    sort: Record<string, 1 | -1> = { attendanceDate: -1, createdAt: -1 },
  ): Promise<PaginatedResult<AttendanceLean>> {
    const cleanFilter = { ...filter, deletedAt: null };
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.attendanceModel
        .find(cleanFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<AttendanceLean[]>()
        .exec(),
      this.attendanceModel.countDocuments(cleanFilter).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId | string,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<AttendanceLean | null> {
    const query = this.attendanceModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        deletedAt: null,
      },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceLean>().exec();
  }

  /**
   * Layer 3: Atomic check-in transition for pre-created records (e.g. approved half-day leave).
   * Atomically transitions status to CHECKED_IN ONLY if checkInTime is currently null.
   * Prevents race conditions from double check-ins without distributed locks.
   */
  async updateCheckInForExistingLeave(
    id: Types.ObjectId | string,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<AttendanceLean | null> {
    const query = this.attendanceModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        checkInTime: null,
        deletedAt: null,
      },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceLean>().exec();
  }

  /**
   * Layer 3: Atomic check-out transition.
   * Atomically transitions status only if currently CHECKED_IN or ON_BREAK.
   * Prevents double-tap race conditions from overwriting checkout time without distributed locks.
   */
  async checkOutSession(
    id: Types.ObjectId | string,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<AttendanceLean | null> {
    const query = this.attendanceModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        status: {
          $in: [AttendanceStatus.CHECKED_IN, AttendanceStatus.ON_BREAK],
        },
        deletedAt: null,
      },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceLean>().exec();
  }

  async startBreak(
    id: Types.ObjectId | string,
    breakSession: BreakSession,
    session?: ClientSession,
  ): Promise<AttendanceLean | null> {
    const query = this.attendanceModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        status: AttendanceStatus.CHECKED_IN,
        deletedAt: null,
      },
      {
        $push: { breaks: breakSession },
        $set: { status: AttendanceStatus.ON_BREAK },
      },
      { new: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceLean>().exec();
  }

  async endActiveBreak(
    id: Types.ObjectId | string,
    endTime: Date,
    durationMinutes: number,
    totalBreakMinutes: number,
    session?: ClientSession,
    note?: string,
  ): Promise<AttendanceLean | null> {
    const updateSet: Record<string, unknown> = {
      'breaks.$[elem].endTime': endTime,
      'breaks.$[elem].durationMinutes': durationMinutes,
      totalBreakMinutes,
      status: AttendanceStatus.CHECKED_IN,
    };
    if (note) {
      updateSet['breaks.$[elem].note'] = note;
    }

    const query = this.attendanceModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        status: AttendanceStatus.ON_BREAK,
        deletedAt: null,
      },
      {
        $set: updateSet,
      },
      {
        arrayFilters: [{ 'elem.endTime': null }],
        new: true,
      },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AttendanceLean>().exec();
  }

  async getMonthlySummary(
    employeeId: Types.ObjectId | string,
    startDate: string,
    endDate: string,
  ): Promise<MonthlyAttendanceSummary> {
    const empId =
      typeof employeeId === 'string'
        ? new Types.ObjectId(employeeId)
        : employeeId;

    const pipeline = [
      {
        $match: {
          employeeId: empId,
          attendanceDate: { $gte: startDate, $lte: endDate },
          deletedAt: null,
        },
      },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          presentDays: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$status',
                    [AttendanceStatus.PRESENT, AttendanceStatus.REGULARIZED],
                  ],
                },
                1,
                0,
              ],
            },
          },
          halfDays: {
            $sum: {
              $cond: [{ $eq: ['$status', AttendanceStatus.HALF_DAY] }, 1, 0],
            },
          },
          absentDays: {
            $sum: {
              $cond: [{ $eq: ['$status', AttendanceStatus.ABSENT] }, 1, 0],
            },
          },
          incompleteDays: {
            $sum: {
              $cond: [{ $eq: ['$status', AttendanceStatus.INCOMPLETE] }, 1, 0],
            },
          },
          lateDays: {
            $sum: {
              $cond: [{ $eq: ['$isLate', true] }, 1, 0],
            },
          },
          earlyDepartures: {
            $sum: {
              $cond: [{ $eq: ['$isEarlyDeparture', true] }, 1, 0],
            },
          },
          totalWorkingMinutes: { $sum: '$totalWorkMinutes' },
          totalOvertimeMinutes: { $sum: '$overtimeMinutes' },
          totalBreakMinutes: { $sum: '$totalBreakMinutes' },
        },
      },
    ];

    const results = await this.attendanceModel
      .aggregate<MonthlyAttendanceSummary>(pipeline)
      .exec();

    if (!results || results.length === 0) {
      return {
        totalRecords: 0,
        presentDays: 0,
        halfDays: 0,
        absentDays: 0,
        incompleteDays: 0,
        lateDays: 0,
        earlyDepartures: 0,
        totalWorkingMinutes: 0,
        totalOvertimeMinutes: 0,
        totalBreakMinutes: 0,
      };
    }

    const item = results[0];
    return {
      totalRecords: item.totalRecords ?? 0,
      presentDays: item.presentDays ?? 0,
      halfDays: item.halfDays ?? 0,
      absentDays: item.absentDays ?? 0,
      incompleteDays: item.incompleteDays ?? 0,
      lateDays: item.lateDays ?? 0,
      earlyDepartures: item.earlyDepartures ?? 0,
      totalWorkingMinutes: item.totalWorkingMinutes ?? 0,
      totalOvertimeMinutes: item.totalOvertimeMinutes ?? 0,
      totalBreakMinutes: item.totalBreakMinutes ?? 0,
    };
  }

  /**
   * Synchronizes an approved leave day with attendance records.
   */
  async syncLeaveAttendance(
    employeeId: Types.ObjectId,
    attendanceDate: string,
    status: AttendanceStatus,
    shiftId: Types.ObjectId,
    shiftSnapshot: Record<string, unknown>,
    leaveRequestId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<AttendanceLean> {
    const existing = await this.findByEmployeeAndDate(
      employeeId,
      attendanceDate,
      session,
    );
    if (existing) {
      const query = this.attendanceModel.findOneAndUpdate(
        { _id: existing._id },
        {
          $set: {
            status,
            leaveRequestId,
          },
        },
        { new: true },
      );
      if (session) {
        query.session(session);
      }
      return (await query.lean<AttendanceLean>().exec())!;
    }

    const doc = new this.attendanceModel({
      employeeId,
      attendanceDate,
      date: new Date(`${attendanceDate}T00:00:00.000Z`),
      shiftId,
      shiftSnapshot,
      status,
      leaveRequestId,
      checkInTime: null,
      checkOutTime: null,
      breaks: [],
    });
    const saved = await doc.save({ session });
    return saved.toObject() as AttendanceLean;
  }

  /**
   * Clears future attendance records linked to a cancelled leave request.
   */
  async removeFutureLeaveAttendance(
    leaveRequestId: Types.ObjectId,
    currentDate: string,
    session?: ClientSession,
  ): Promise<void> {
    await this.attendanceModel.updateMany(
      {
        leaveRequestId,
        attendanceDate: { $gt: currentDate },
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date(),
        },
      },
      { session },
    );
  }

  /**
   * Detects MongoDB unique compound index duplicate key error (code 11000).
   */
  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as Record<string, unknown>;
    if (err.code === 11000) return true;
    if (typeof err.message === 'string' && err.message.includes('E11000'))
      return true;
    if (err.name === 'MongoServerError' && err.code === 11000) return true;
    if (err.name === 'MongoBulkWriteError' && err.code === 11000) return true;
    if (err.cause && typeof err.cause === 'object') {
      const cause = err.cause as Record<string, unknown>;
      if (
        cause.code === 11000 ||
        (typeof cause.message === 'string' && cause.message.includes('E11000'))
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Layer 3: Atomically creates an ABSENT attendance record.
   * Catches duplicate key races (E11000) from concurrent workers safely without failing.
   */
  async createAbsentRecord(
    data: Partial<Attendance>,
    session?: ClientSession,
  ): Promise<CreateAbsentRecordResult> {
    try {
      const doc = new this.attendanceModel(data);
      const saved = await doc.save({ session });
      return { created: true, attendance: saved.toObject() as AttendanceLean };
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        return { created: false };
      }
      throw error;
    }
  }

  /**
   * Batch payroll-period attendance aggregation grouped by (employeeId, attendanceDate).
   * Preserves per-day recordCount to detect duplicate daily records while returning
   * compact employee-day buckets for server-side payroll summary normalization.
   */
  async aggregateForPayrollPeriod(
    employeeIds: Types.ObjectId[],
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      employeeId: Types.ObjectId;
      attendanceDate: string;
      recordCount: number;
      status: AttendanceStatus;
      statuses: AttendanceStatus[];
      isLate: boolean;
      lateMinutes: number;
      isEarlyDeparture: boolean;
      earlyDepartureMinutes: number;
      totalWorkMinutes: number;
      totalBreakMinutes: number;
      overtimeMinutes: number;
      regularizationId: Types.ObjectId | null;
      leaveRequestId: Types.ObjectId | null;
    }>
  > {
    if (employeeIds.length === 0) return [];

    return this.attendanceModel
      .aggregate<{
        employeeId: Types.ObjectId;
        attendanceDate: string;
        recordCount: number;
        status: AttendanceStatus;
        statuses: AttendanceStatus[];
        isLate: boolean;
        lateMinutes: number;
        isEarlyDeparture: boolean;
        earlyDepartureMinutes: number;
        totalWorkMinutes: number;
        totalBreakMinutes: number;
        overtimeMinutes: number;
        regularizationId: Types.ObjectId | null;
        leaveRequestId: Types.ObjectId | null;
      }>([
        {
          $match: {
            employeeId: { $in: employeeIds },
            attendanceDate: { $gte: startDate, $lte: endDate },
            deletedAt: null,
          },
        },
        {
          $sort: {
            employeeId: 1,
            attendanceDate: 1,
            createdAt: -1,
            _id: -1,
          },
        },
        {
          $group: {
            _id: {
              employeeId: '$employeeId',
              attendanceDate: '$attendanceDate',
            },
            recordCount: { $sum: 1 },
            status: { $first: '$status' },
            statuses: { $push: '$status' },
            isLate: { $first: { $ifNull: ['$isLate', false] } },
            lateMinutes: { $first: { $ifNull: ['$lateMinutes', 0] } },
            isEarlyDeparture: {
              $first: { $ifNull: ['$isEarlyDeparture', false] },
            },
            earlyDepartureMinutes: {
              $first: { $ifNull: ['$earlyDepartureMinutes', 0] },
            },
            totalWorkMinutes: { $first: { $ifNull: ['$totalWorkMinutes', 0] } },
            totalBreakMinutes: {
              $first: { $ifNull: ['$totalBreakMinutes', 0] },
            },
            overtimeMinutes: { $first: { $ifNull: ['$overtimeMinutes', 0] } },
            regularizationId: {
              $first: { $ifNull: ['$regularizationId', null] },
            },
            leaveRequestId: { $first: { $ifNull: ['$leaveRequestId', null] } },
          },
        },
        {
          $project: {
            _id: 0,
            employeeId: '$_id.employeeId',
            attendanceDate: '$_id.attendanceDate',
            recordCount: 1,
            status: 1,
            statuses: 1,
            isLate: 1,
            lateMinutes: 1,
            isEarlyDeparture: 1,
            earlyDepartureMinutes: 1,
            totalWorkMinutes: 1,
            totalBreakMinutes: 1,
            overtimeMinutes: 1,
            regularizationId: 1,
            leaveRequestId: 1,
          },
        },
      ])
      .exec();
  }
}
