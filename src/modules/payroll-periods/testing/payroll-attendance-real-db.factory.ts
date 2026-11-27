import * as dns from 'node:dns/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Connection, Model, Types } from 'mongoose';
import {
  Attendance,
  AttendanceDocument,
} from '../../attendance/schemas/attendance.schema';
import {
  AttendanceRegularization,
  AttendanceRegularizationDocument,
} from '../../attendance/schemas/attendance-regularization.schema';
import {
  ATTENDANCE_CONSTANTS,
  AttendanceSource,
  AttendanceStatus,
  RegularizationStatus,
  RegularizationType,
  WorkMode,
} from '../../attendance/constants/attendance.constant';
import { Shift, ShiftDocument } from '../../attendance/schemas/shift.schema';
import { Branch, BranchDocument } from '../../branches/schemas/branch.schema';
import {
  EmploymentStatus,
  EmploymentType,
} from '../../employees/constants/employee.constant';
import {
  Employee,
  EmployeeDocument,
} from '../../employees/schemas/employee.schema';
import {
  HolidayType,
  LeaveRequestStatus,
} from '../../leaves/constants/leaves.constant';
import { Holiday, HolidayDocument } from '../../leaves/schemas/holiday.schema';
import {
  LeaveRequest,
  LeaveRequestDocument,
} from '../../leaves/schemas/leave-request.schema';
import {
  LeaveType,
  LeaveTypeDocument,
} from '../../leaves/schemas/leave-type.schema';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollPeriodStatus } from '../constants/payroll-period.constant';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
} from '../schemas/payroll-period.schema';
import {
  WeeklyOffConfig,
  WeeklyOffConfigDocument,
} from '../../work-schedules/schemas/weekly-off-config.schema';
import { PermissionDocument } from '../../permissions/schemas/permission.schema';
import { PermissionAction } from '../../permissions/constants/permission.constant';
import { RoleDocument } from '../../roles/schemas/role.schema';
import { UserDocument } from '../../users/schemas/user.schema';
import { UserStatus } from '../../users/constants/user-status.constant';
import { SessionDocument } from '../../auth/schemas/session.schema';

export const EXPECTED_TEST_DATABASE = 'crm_hrms_test';

/**
 * Resolves the dedicated test database URI exclusively from `.env.test`.
 * Never reads `.env` or `process.env.MONGODB_URI` so development/production DBs are unreachable.
 */
export function resolveTestMongoUri(): string | null {
  const testEnvPath = path.resolve(process.cwd(), '.env.test');
  if (!fs.existsSync(testEnvPath)) {
    return null;
  }

  const content = fs.readFileSync(testEnvPath, 'utf8');
  const match = /^MONGODB_URI=(.+)$/m.exec(content);
  const uri = match?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!uri) {
    return null;
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(uri).pathname.slice(1));
  } catch {
    throw new Error('Invalid test MongoDB URI in .env.test.');
  }

  if (databaseName !== EXPECTED_TEST_DATABASE) {
    throw new Error(
      `Unsafe test database "${databaseName}". Expected "${EXPECTED_TEST_DATABASE}".`,
    );
  }

  return uri;
}

export async function assertMongoSrvReachable(uri: string): Promise<void> {
  const srvHost = uri.includes('mongodb+srv://')
    ? uri.split('@')[1]?.split('/')[0]
    : null;
  if (!srvHost) return;

  await Promise.race([
    dns.resolveSrv(`_mongodb._tcp.${srvHost}`),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`DNS lookup timeout for ${srvHost}`)),
        2500,
      ),
    ),
  ]);
}

export function assertTestDatabaseConnection(connection: Connection): void {
  const dbName = connection.name || connection.db?.databaseName;
  if (dbName !== EXPECTED_TEST_DATABASE) {
    throw new Error(
      `Refusing destructive test operation on database "${String(dbName)}". Expected "${EXPECTED_TEST_DATABASE}".`,
    );
  }
}

export interface RealDbModels {
  branchModel: Model<BranchDocument>;
  shiftModel: Model<ShiftDocument>;
  employeeModel: Model<EmployeeDocument>;
  payrollPeriodModel: Model<PayrollPeriodDocument>;
  attendanceModel: Model<AttendanceDocument>;
  regularizationModel: Model<AttendanceRegularizationDocument>;
  leaveTypeModel: Model<LeaveTypeDocument>;
  leaveRequestModel: Model<LeaveRequestDocument>;
  holidayModel: Model<HolidayDocument>;
  weeklyOffModel: Model<WeeklyOffConfigDocument>;
  permissionModel?: Model<PermissionDocument>;
  roleModel?: Model<RoleDocument>;
  userModel?: Model<UserDocument>;
  sessionModel?: Model<SessionDocument>;
}

export class TestCleanupTracker {
  readonly branchIds: Types.ObjectId[] = [];
  readonly shiftIds: Types.ObjectId[] = [];
  readonly employeeIds: Types.ObjectId[] = [];
  readonly payrollPeriodIds: Types.ObjectId[] = [];
  readonly attendanceIds: Types.ObjectId[] = [];
  readonly regularizationIds: Types.ObjectId[] = [];
  readonly leaveTypeIds: Types.ObjectId[] = [];
  readonly leaveRequestIds: Types.ObjectId[] = [];
  readonly holidayIds: Types.ObjectId[] = [];
  readonly weeklyOffIds: Types.ObjectId[] = [];
  readonly permissionIds: Types.ObjectId[] = [];
  readonly roleIds: Types.ObjectId[] = [];
  readonly userIds: Types.ObjectId[] = [];
  readonly sessionIds: Types.ObjectId[] = [];

  track(
    bucket: keyof Omit<TestCleanupTracker, 'track' | 'cleanupAll'>,
    id: Types.ObjectId,
  ): Types.ObjectId {
    this[bucket].push(id);
    return id;
  }

  async cleanupAll(
    connection: Connection,
    models: RealDbModels,
  ): Promise<void> {
    assertTestDatabaseConnection(connection);

    if (this.attendanceIds.length > 0) {
      await models.attendanceModel.deleteMany({
        _id: { $in: this.attendanceIds },
      });
    }
    if (this.employeeIds.length > 0) {
      await models.attendanceModel.deleteMany({
        employeeId: { $in: this.employeeIds },
      });
    }
    if (this.regularizationIds.length > 0) {
      await models.regularizationModel.deleteMany({
        _id: { $in: this.regularizationIds },
      });
    }
    if (this.leaveRequestIds.length > 0) {
      await models.leaveRequestModel.deleteMany({
        _id: { $in: this.leaveRequestIds },
      });
    }
    if (this.leaveTypeIds.length > 0) {
      await models.leaveTypeModel.deleteMany({
        _id: { $in: this.leaveTypeIds },
      });
    }
    if (this.holidayIds.length > 0) {
      await models.holidayModel.deleteMany({
        _id: { $in: this.holidayIds },
      });
    }
    if (this.weeklyOffIds.length > 0) {
      await models.weeklyOffModel.deleteMany({
        _id: { $in: this.weeklyOffIds },
      });
    }
    if (this.payrollPeriodIds.length > 0) {
      await models.payrollPeriodModel.deleteMany({
        _id: { $in: this.payrollPeriodIds },
      });
    }
    if (this.employeeIds.length > 0) {
      await models.employeeModel.deleteMany({
        _id: { $in: this.employeeIds },
      });
    }
    if (this.shiftIds.length > 0) {
      await models.shiftModel.deleteMany({
        _id: { $in: this.shiftIds },
      });
    }
    if (this.branchIds.length > 0) {
      await models.branchModel.deleteMany({
        _id: { $in: this.branchIds },
      });
    }
    if (this.sessionIds.length > 0 && models.sessionModel) {
      await models.sessionModel.deleteMany({
        _id: { $in: this.sessionIds },
      });
    }
    if (this.userIds.length > 0 && models.userModel) {
      await models.userModel.deleteMany({
        _id: { $in: this.userIds },
      });
    }
    if (this.roleIds.length > 0 && models.roleModel) {
      await models.roleModel.deleteMany({
        _id: { $in: this.roleIds },
      });
    }
    if (this.permissionIds.length > 0 && models.permissionModel) {
      await models.permissionModel.deleteMany({
        _id: { $in: this.permissionIds },
      });
    }

    const actorTargets = [...this.userIds, ...this.employeeIds];
    if (actorTargets.length > 0) {
      const auditCol = connection.collection('audit_logs');
      await auditCol.deleteMany({
        $or: [
          { actorId: { $in: actorTargets } },
          { targetId: { $in: [...this.employeeIds, ...this.attendanceIds] } },
        ],
      });
    }
  }
}

export class PayrollAttendanceRealDbFactory {
  private seq = 0;

  constructor(
    private readonly runTag: string,
    private readonly models: RealDbModels,
    private readonly tracker: TestCleanupTracker,
  ) {}

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  async createBranch(overrides: Partial<Branch> = {}): Promise<BranchDocument> {
    const idx = this.nextSeq();
    const doc = await this.models.branchModel.create({
      name: `${this.runTag}-Branch-${idx}`,
      timezone: ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
      allowedIps: ['192.168.10.10', '10.10.0.0/16'],
      enforceIpCheck: true,
      latitude: 19.076,
      longitude: 72.8777,
      radiusMeters: 200,
      isActive: true,
      deletedAt: null,
      ...overrides,
    });
    this.tracker.track('branchIds', doc._id);
    return doc;
  }

  async createShift(overrides: Partial<Shift> = {}): Promise<ShiftDocument> {
    const idx = this.nextSeq();
    const cleanTag = this.runTag
      .replace(/[^A-Z0-9]/gi, '')
      .toUpperCase()
      .slice(-8);
    const doc = await this.models.shiftModel.create({
      name: `${this.runTag} Shift ${idx}`,
      code: `${cleanTag}S${idx}`,
      startTime: '09:00',
      endTime: '18:00',
      isOvernight: false,
      gracePeriodMinutes: 15,
      breakDurationMinutes: 60,
      minWorkMinutesForFullDay: 480,
      minWorkMinutesForHalfDay: 240,
      overtimeThresholdMinutes: 480,
      isDefault: false,
      isActive: true,
      deletedAt: null,
      ...overrides,
    });
    this.tracker.track('shiftIds', doc._id);
    return doc;
  }

  async createEmployee(
    overrides: Partial<Employee> & {
      branchId: Types.ObjectId;
      departmentId?: Types.ObjectId;
      designationId?: Types.ObjectId;
    },
  ): Promise<EmployeeDocument> {
    const idx = this.nextSeq();
    const code =
      overrides.employeeCode ??
      `${this.runTag}-E${String(idx).padStart(3, '0')}`;
    const doc = await this.models.employeeModel.create({
      userId: null,
      employeeCode: code,
      firstName: `First${idx}`,
      lastName: `Last${idx}`,
      workEmail: `${code.toLowerCase()}@test-payroll.example.com`,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
      lastWorkingDate: null,
      terminationDate: null,
      departmentId: overrides.departmentId ?? new Types.ObjectId(),
      designationId: overrides.designationId ?? new Types.ObjectId(),
      shiftId: null,
      employmentType: EmploymentType.FULL_TIME,
      employmentStatus: EmploymentStatus.ACTIVE,
      isRemoteAllowed: false,
      deletedAt: null,
      ...overrides,
    });
    this.tracker.track('employeeIds', doc._id);
    return doc;
  }

  async findUnusedFutureYear(
    startYear: number = 2080,
    endYear: number = 2099,
  ): Promise<number> {
    for (let y = startYear; y <= endYear; y++) {
      const existing = await this.models.payrollPeriodModel
        .findOne({ year: y, deletedAt: null })
        .lean()
        .exec();
      if (!existing) {
        return y;
      }
    }
    throw new Error(
      `No unused test year available between ${startYear} and ${endYear}`,
    );
  }

  async createPayrollPeriod(
    overrides: Partial<PayrollPeriod> & {
      year: number;
      month: number;
      startDate: Date;
      endDate: Date;
      paymentDate: Date;
    },
  ): Promise<PayrollPeriodDocument> {
    const idx = this.nextSeq();
    const code = (overrides.periodCode ?? `${this.runTag}-P${idx}`)
      .replace(/[^A-Z0-9_-]/gi, '')
      .toUpperCase();
    const doc = await this.models.payrollPeriodModel.create({
      periodName: `${this.runTag} Period ${idx}`,
      periodCode: code,
      payrollFrequency: PayrollFrequency.MONTHLY,
      status: PayrollPeriodStatus.PROCESSING,
      notes: null,
      deletedAt: null,
      ...overrides,
    });
    this.tracker.track('payrollPeriodIds', doc._id);
    return doc;
  }

  async createAttendance(
    overrides: Partial<Attendance> & {
      employeeId: Types.ObjectId;
      attendanceDate: string;
      shift: ShiftDocument;
    },
  ): Promise<AttendanceDocument> {
    const { shift, attendanceDate, employeeId, ...rest } = overrides;
    const status = rest.status ?? AttendanceStatus.PRESENT;
    const isPresentLike =
      status === AttendanceStatus.PRESENT ||
      status === AttendanceStatus.LATE ||
      status === AttendanceStatus.REGULARIZED;

    const doc = await this.models.attendanceModel.create({
      employeeId,
      attendanceDate,
      date: new Date(`${attendanceDate}T00:00:00.000Z`),
      shiftId: shift._id,
      shiftSnapshot: {
        name: shift.name,
        code: shift.code,
        startTime: shift.startTime,
        endTime: shift.endTime,
        isOvernight: shift.isOvernight,
        gracePeriodMinutes: shift.gracePeriodMinutes,
        breakDurationMinutes: shift.breakDurationMinutes,
        minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
        minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
        overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
      },
      status,
      workMode: WorkMode.OFFICE,
      checkInSource: AttendanceSource.WEB,
      checkInTime:
        rest.checkInTime !== undefined
          ? rest.checkInTime
          : isPresentLike || status === AttendanceStatus.HALF_DAY
            ? new Date(`${attendanceDate}T03:30:00.000Z`)
            : null,
      checkOutTime:
        rest.checkOutTime !== undefined
          ? rest.checkOutTime
          : isPresentLike || status === AttendanceStatus.HALF_DAY
            ? new Date(`${attendanceDate}T12:30:00.000Z`)
            : null,
      breaks: [],
      totalBreakMinutes: 60,
      totalWorkMinutes:
        rest.totalWorkMinutes ??
        (isPresentLike ? 480 : status === AttendanceStatus.HALF_DAY ? 240 : 0),
      isLate: rest.isLate ?? status === AttendanceStatus.LATE,
      lateMinutes:
        rest.lateMinutes ?? (status === AttendanceStatus.LATE ? 20 : 0),
      isEarlyDeparture: rest.isEarlyDeparture ?? false,
      earlyDepartureMinutes: rest.earlyDepartureMinutes ?? 0,
      overtimeMinutes: rest.overtimeMinutes ?? 0,
      regularizationId: rest.regularizationId ?? null,
      leaveRequestId: rest.leaveRequestId ?? null,
      deletedAt: rest.deletedAt ?? null,
      deletedBy: null,
      ...rest,
    });
    this.tracker.track('attendanceIds', doc._id);
    return doc;
  }

  async createRegularization(
    overrides: Partial<AttendanceRegularization> & {
      employeeId: Types.ObjectId;
      attendanceDate: string;
    },
  ): Promise<AttendanceRegularizationDocument> {
    const doc = await this.models.regularizationModel.create({
      attendanceId: null,
      type: RegularizationType.FORGOT_PUNCH,
      originalCheckInTime: null,
      originalCheckOutTime: null,
      requestedCheckInTime: new Date(
        `${overrides.attendanceDate}T03:30:00.000Z`,
      ),
      requestedCheckOutTime: new Date(
        `${overrides.attendanceDate}T12:30:00.000Z`,
      ),
      reason: 'Forgot punch out during client call',
      status: RegularizationStatus.APPROVED,
      appliedAt: new Date(),
      reviewedBy: new Types.ObjectId(),
      reviewedAt: new Date(),
      deletedAt: null,
      ...overrides,
    });
    this.tracker.track('regularizationIds', doc._id);
    return doc;
  }

  async createLeaveType(
    overrides: Partial<LeaveType> = {},
  ): Promise<LeaveTypeDocument> {
    const idx = this.nextSeq();
    const cleanTag = this.runTag
      .replace(/[^A-Z0-9]/gi, '')
      .toUpperCase()
      .slice(-8);
    const doc = await this.models.leaveTypeModel.create({
      name: `${this.runTag} Leave ${idx}`,
      code: `${cleanTag}LT${idx}`,
      isPaid: true,
      annualAllocation: 12,
      allowHalfDay: true,
      allowNegativeBalance: false,
      allowDuringNoticePeriod: true,
      deductWeekends: false,
      deductHolidays: false,
      isActive: true,
      deletedAt: null,
      ...overrides,
    });
    this.tracker.track('leaveTypeIds', doc._id);
    return doc;
  }

  async createLeaveRequest(
    overrides: Partial<LeaveRequest> & {
      employeeId: Types.ObjectId;
      leaveType: LeaveTypeDocument;
      startDate: string;
      endDate: string;
    },
  ): Promise<LeaveRequestDocument> {
    const { leaveType, employeeId, startDate, endDate, ...rest } = overrides;
    const doc = await this.models.leaveRequestModel.create({
      employeeId,
      leaveTypeId: leaveType._id,
      leaveTypeSnapshot: {
        name: leaveType.name,
        code: leaveType.code,
        isPaid: leaveType.isPaid,
        allowHalfDay: leaveType.allowHalfDay,
        deductWeekends: leaveType.deductWeekends,
        deductHolidays: leaveType.deductHolidays,
      },
      startDate,
      endDate,
      totalDays: rest.totalDays ?? 1,
      isHalfDay: rest.isHalfDay ?? false,
      halfDaySession: rest.halfDaySession ?? null,
      excludedDates: rest.excludedDates ?? [],
      yearBreakdown: [],
      reason: rest.reason ?? 'Personal leave',
      reportingManagerId: null,
      status: rest.status ?? LeaveRequestStatus.APPROVED,
      deletedAt: null,
      ...rest,
    });
    this.tracker.track('leaveRequestIds', doc._id);
    return doc;
  }

  async createHoliday(
    overrides: Partial<Holiday> & { date: string; year: number },
  ): Promise<HolidayDocument> {
    const idx = this.nextSeq();
    const doc = await this.models.holidayModel.create({
      name: `${this.runTag} Holiday ${idx}`,
      type: HolidayType.PUBLIC,
      branchId: null,
      isActive: true,
      deletedAt: null,
      ...overrides,
    });
    this.tracker.track('holidayIds', doc._id);
    return doc;
  }

  async createWeeklyOffConfig(
    overrides: Omit<Partial<WeeklyOffConfig>, 'days'> & {
      effectiveFrom: string;
      days: Array<{ dayOfWeek: number; occurrences?: number[] }>;
    },
  ): Promise<WeeklyOffConfigDocument> {
    const idx = this.nextSeq();
    const doc = await this.models.weeklyOffModel.create({
      name: `${this.runTag} WeeklyOff ${idx}`,
      description: null,
      branchId: null,
      effectiveTo: null,
      isActive: true,
      deletedAt: null,
      ...overrides,
      days: overrides.days.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        occurrences: d.occurrences ?? [1, 2, 3, 4, 5],
      })),
    });
    this.tracker.track('weeklyOffIds', doc._id);
    return doc;
  }

  async ensurePermission(key: string): Promise<PermissionDocument> {
    if (!this.models.permissionModel) {
      throw new Error('PermissionModel not configured');
    }
    const existing = await this.models.permissionModel.findOne({ key }).exec();
    if (existing) {
      return existing;
    }
    const [moduleName, actionRaw] = key.split('.');
    const doc = await this.models.permissionModel.create({
      module: moduleName || 'payroll',
      action:
        Object.values(PermissionAction).find((a) => String(a) === actionRaw) ??
        PermissionAction.VIEW,
      key,
      isActive: true,
    });
    this.tracker.track('permissionIds', doc._id);
    return doc;
  }

  async createUserWithRole(permissionKeys: string[]): Promise<{
    user: UserDocument;
    session: SessionDocument;
    role: RoleDocument;
  }> {
    if (
      !this.models.roleModel ||
      !this.models.userModel ||
      !this.models.sessionModel
    ) {
      throw new Error('Auth models not configured');
    }
    const permIds: Types.ObjectId[] = [];
    for (const key of permissionKeys) {
      const perm = await this.ensurePermission(key);
      permIds.push(perm._id);
    }

    const idx = this.nextSeq();
    const roleKey = `${this.runTag.toLowerCase()}_role_${idx}`;
    const role = await this.models.roleModel.create({
      name: `${this.runTag} Role ${idx}`,
      key: roleKey,
      permissionIds: permIds,
      isSystemRole: false,
      isActive: true,
    });
    this.tracker.track('roleIds', role._id);

    const user = await this.models.userModel.create({
      email: `${this.runTag.toLowerCase()}.user${idx}@test-payroll.example.com`,
      passwordHash:
        '$argon2id$v=19$m=65536,t=3,p=1$fakehashforintegrationtestonly',
      roleIds: [role._id],
      status: UserStatus.ACTIVE,
      deletedAt: null,
    });
    this.tracker.track('userIds', user._id);

    const session = await this.models.sessionModel.create({
      userId: user._id,
      refreshTokenHash: `${this.runTag}-rt-${idx}`,
      expiresAt: new Date('2099-12-31T23:59:59.000Z'),
      revokedAt: null,
    });
    this.tracker.track('sessionIds', session._id);

    return { user, session, role };
  }
}
