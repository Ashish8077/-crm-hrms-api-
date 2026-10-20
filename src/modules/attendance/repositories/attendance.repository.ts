import { Injectable } from '@nestjs/common';
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

export interface MonthlyAttendanceSummary {
  totalRecords: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  lateDays: number;
  earlyDepartures: number;
  totalWorkingMinutes: number;
  totalOvertimeMinutes: number;
  totalBreakMinutes: number;
}

@Injectable()
export class AttendanceRepository {
  constructor(
    @InjectModel(Attendance.name)
    private readonly attendanceModel: Model<AttendanceDocument>,
  ) {}

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
  ): Promise<AttendanceLean | null> {
    const query = this.attendanceModel.findOneAndUpdate(
      {
        _id: typeof id === 'string' ? new Types.ObjectId(id) : id,
        status: AttendanceStatus.ON_BREAK,
        deletedAt: null,
      },
      {
        $set: {
          'breaks.$[elem].endTime': endTime,
          'breaks.$[elem].durationMinutes': durationMinutes,
          totalBreakMinutes,
          status: AttendanceStatus.CHECKED_IN,
        },
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
      lateDays: item.lateDays ?? 0,
      earlyDepartures: item.earlyDepartures ?? 0,
      totalWorkingMinutes: item.totalWorkingMinutes ?? 0,
      totalOvertimeMinutes: item.totalOvertimeMinutes ?? 0,
      totalBreakMinutes: item.totalBreakMinutes ?? 0,
    };
  }
}
