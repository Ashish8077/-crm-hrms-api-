/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  HttpStatus,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import configuration from '../../config/configuration';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { RedisModule } from '../../common/redis/redis.module';
import { RedisService } from '../../common/redis/redis.service';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import {
  AttendanceStatus,
  RegularizationStatus,
} from '../attendance/constants/attendance.constant';
import {
  AttendanceRegularization,
  AttendanceRegularizationDocument,
} from '../attendance/schemas/attendance-regularization.schema';
import {
  Attendance,
  AttendanceDocument,
} from '../attendance/schemas/attendance.schema';
import { Shift, ShiftDocument } from '../attendance/schemas/shift.schema';
import { AttendanceCalculationUtil } from '../attendance/utils/attendance-calculation.util';
import { AuthModule } from '../auth/auth.module';
import { ACCESS_TOKEN_COOKIE } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Session, SessionDocument } from '../auth/schemas/session.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import {
  HolidayType,
  LeaveRequestStatus,
} from '../leaves/constants/leaves.constant';
import { Holiday, HolidayDocument } from '../leaves/schemas/holiday.schema';
import {
  LeaveRequest,
  LeaveRequestDocument,
} from '../leaves/schemas/leave-request.schema';
import {
  LeaveType,
  LeaveTypeDocument,
} from '../leaves/schemas/leave-type.schema';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  Permission,
  PermissionDocument,
} from '../permissions/schemas/permission.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  WeeklyOffConfig,
  WeeklyOffConfigDocument,
} from '../work-schedules/schemas/weekly-off-config.schema';
import { PayrollPeriodStatus } from './constants/payroll-period.constant';
import { PayrollPeriodAttendanceSummaryResponseDto } from './dto/payroll-attendance-summary-response.dto';
import { PayrollPeriodsModule } from './payroll-periods.module';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
} from './schemas/payroll-period.schema';
import {
  assertMongoSrvReachable,
  assertTestDatabaseConnection,
  PayrollAttendanceRealDbFactory,
  RealDbModels,
  resolveTestMongoUri,
  TestCleanupTracker,
} from './testing/payroll-attendance-real-db.factory';

const FAKE_TIMERS_OPTIONS = {
  doNotFake: [
    'nextTick',
    'setImmediate',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'performance',
    'hrtime',
    'queueMicrotask',
  ] as Array<
    | 'nextTick'
    | 'setImmediate'
    | 'setTimeout'
    | 'clearTimeout'
    | 'setInterval'
    | 'clearInterval'
    | 'performance'
    | 'hrtime'
    | 'queueMicrotask'
  >,
};

function enumerateUtcDates(startStr: string, endStr: string): string[] {
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  const out: string[] = [];
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

describe('GET /api/v1/payroll/periods/:periodId/attendance-summary (Real MongoDB + HTTP + RBAC)', () => {
  jest.setTimeout(90000);

  let app: INestApplication<App> | null = null;
  let moduleRef: TestingModule | null = null;
  let connection: Connection | null = null;
  let models: RealDbModels;
  let tracker: TestCleanupTracker;
  let factory: PayrollAttendanceRealDbFactory;
  let jwtService: JwtService;
  let isConnected = false;

  const runTag = `PAS${Date.now().toString(36).toUpperCase()}`;

  let testYear!: number;
  let novStart!: string;
  let novEnd!: string;
  let decStart!: string;
  let decEnd!: string;

  let authorizedCookie!: string;
  let insufficientCookie!: string;

  let deptMainId!: Types.ObjectId;
  let deptBenchId!: Types.ObjectId;
  let branchA!: BranchDocument;
  let branchB!: BranchDocument;
  let branchEmpty!: BranchDocument;
  let dayShift!: ShiftDocument;
  let nightShift!: ShiftDocument;
  let novPeriod!: PayrollPeriodDocument;
  let decPeriod!: PayrollPeriodDocument;
  let cleanCompletePeriod!: PayrollPeriodDocument;
  let deletedPeriod!: PayrollPeriodDocument;

  let paidLeaveType!: LeaveTypeDocument;
  let unpaidLeaveType!: LeaveTypeDocument;
  let empMap!: Record<string, EmployeeDocument>;

  // Reference sets computed independently from calendar dates for assertion checks
  let branchAWeeklyOffs!: Set<string>;
  let branchAHolidaysNonWeeklyOff!: Set<string>;
  let branchAScheduledWorkDates!: string[];
  let branchBWeeklyOffs!: Set<string>;
  let branchBHolidaysNonWeeklyOff!: Set<string>;
  let branchBScheduledWorkDates!: string[];

  async function signAuthCookie(
    user: UserDocument,
    session: SessionDocument,
  ): Promise<string> {
    const token = await jwtService.signAsync({
      sub: user._id.toHexString(),
      sid: session._id.toHexString(),
      type: 'access',
    });
    return `${ACCESS_TOKEN_COOKIE}=${token}`;
  }

  beforeAll(async () => {
    const uri = resolveTestMongoUri();
    if (!uri) {
      throw new Error(
        'Test MongoDB URI not configured in .env.test (expected crm_hrms_test).',
      );
    }

    await assertMongoSrvReachable(uri);

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          envFilePath: '.env.test',
        }),
        MongooseModule.forRoot(uri, {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000,
        }),
        RedisModule,
        StorageModule,
        AuthModule,
        AuthorizationModule,
        PayrollPeriodsModule,
      ],
      providers: [
        Reflector,
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: PermissionsGuard },
      ],
    })
      .overrideProvider(RedisService)
      .useValue({
        exists: jest.fn().mockResolvedValue(false),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(0),
      })
      .overrideProvider(StorageService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) =>
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Request validation failed',
            HttpStatus.BAD_REQUEST,
            mapValidationErrors(errors),
          ),
      }),
    );
    app.use(cookieParser());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    connection = moduleRef.get<Connection>(getConnectionToken());
    assertTestDatabaseConnection(connection);

    jwtService = new JwtService({
      secret: moduleRef.get(ConfigService).getOrThrow<string>('jwt.secret'),
      signOptions: { algorithm: 'HS256' },
    });

    models = {
      branchModel: moduleRef.get<Model<BranchDocument>>(
        getModelToken(Branch.name),
      ),
      shiftModel: moduleRef.get<Model<ShiftDocument>>(
        getModelToken(Shift.name),
      ),
      employeeModel: moduleRef.get<Model<EmployeeDocument>>(
        getModelToken(Employee.name),
      ),
      payrollPeriodModel: moduleRef.get<Model<PayrollPeriodDocument>>(
        getModelToken(PayrollPeriod.name),
      ),
      attendanceModel: moduleRef.get<Model<AttendanceDocument>>(
        getModelToken(Attendance.name),
      ),
      regularizationModel: moduleRef.get<
        Model<AttendanceRegularizationDocument>
      >(getModelToken(AttendanceRegularization.name)),
      leaveTypeModel: moduleRef.get<Model<LeaveTypeDocument>>(
        getModelToken(LeaveType.name),
      ),
      leaveRequestModel: moduleRef.get<Model<LeaveRequestDocument>>(
        getModelToken(LeaveRequest.name),
      ),
      holidayModel: moduleRef.get<Model<HolidayDocument>>(
        getModelToken(Holiday.name),
      ),
      weeklyOffModel: moduleRef.get<Model<WeeklyOffConfigDocument>>(
        getModelToken(WeeklyOffConfig.name),
      ),
      permissionModel: moduleRef.get<Model<PermissionDocument>>(
        getModelToken(Permission.name),
      ),
      roleModel: moduleRef.get<Model<RoleDocument>>(getModelToken(Role.name)),
      userModel: moduleRef.get<Model<UserDocument>>(getModelToken(User.name)),
      sessionModel: moduleRef.get<Model<SessionDocument>>(
        getModelToken(Session.name),
      ),
    };

    await Promise.all([
      models.attendanceModel.syncIndexes(),
      models.payrollPeriodModel.syncIndexes(),
      models.holidayModel.syncIndexes(),
    ]);

    tracker = new TestCleanupTracker();
    factory = new PayrollAttendanceRealDbFactory(runTag, models, tracker);
    isConnected = true;

    // Seed RBAC actors
    const authActor = await factory.createUserWithRole([
      PermissionKeys.PAYROLL_PERIODS_VIEW,
    ]);
    const calcOnlyActor = await factory.createUserWithRole([
      PermissionKeys.PAYROLL_CALCULATIONS_VIEW,
    ]);
    authorizedCookie = await signAuthCookie(authActor.user, authActor.session);
    insufficientCookie = await signAuthCookie(
      calcOnlyActor.user,
      calcOnlyActor.session,
    );

    // Pick unused future year so unique cycle indexes & global holidays never collide
    testYear = await factory.findUnusedFutureYear(2080, 2099);
    novStart = `${testYear}-11-01`;
    novEnd = `${testYear}-11-30`;
    decStart = `${testYear}-12-01`;
    decEnd = `${testYear}-12-31`;

    deptMainId = new Types.ObjectId();
    deptBenchId = new Types.ObjectId();

    branchA = await factory.createBranch({ timezone: 'Asia/Kolkata' });
    branchB = await factory.createBranch({ timezone: 'America/New_York' });
    branchEmpty = await factory.createBranch({ timezone: 'Asia/Kolkata' });

    dayShift = await factory.createShift({
      startTime: '09:00',
      endTime: '18:00',
      isOvernight: false,
    });
    nightShift = await factory.createShift({
      startTime: '22:00',
      endTime: '07:00',
      isOvernight: true,
    });

    novPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 11,
      startDate: new Date(`${novStart}T00:00:00.000Z`),
      endDate: new Date(`${novEnd}T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-12-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });

    decPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 12,
      startDate: new Date(`${decStart}T00:00:00.000Z`),
      endDate: new Date(`${decEnd}T00:00:00.000Z`),
      paymentDate: new Date(`${testYear + 1}-01-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.DRAFT,
    });

    // Dedicated finalized 5-day period in previous month (Oct 1..5) for completeness true check
    cleanCompletePeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 10,
      startDate: new Date(`${testYear}-10-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-10-05T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-10-06T00:00:00.000Z`),
      status: PayrollPeriodStatus.FINALIZED,
    });

    deletedPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 9,
      startDate: new Date(`${testYear}-09-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-09-30T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-10-01T00:00:00.000Z`),
      deletedAt: new Date(),
    });

    // Weekly-off configuration:
    // - Company default for Y-11 & Y-12: Sunday (0)
    // - Branch A override for Y-11-01..Y-11-15: Sat (6) + Sun (0) -> reverts to Sun only for Y-11-16..30!
    await factory.createWeeklyOffConfig({
      branchId: null,
      effectiveFrom: `${testYear}-10-01`,
      effectiveTo: `${testYear}-12-31`,
      days: [{ dayOfWeek: 0 }],
    });
    await factory.createWeeklyOffConfig({
      branchId: branchA._id,
      effectiveFrom: `${testYear}-11-01`,
      effectiveTo: `${testYear}-11-15`,
      days: [{ dayOfWeek: 0 }, { dayOfWeek: 6 }],
    });

    // Pick deterministic holiday dates in Y-11
    const allNovDates = enumerateUtcDates(novStart, novEnd);
    const novSundays = allNovDates.filter(
      (d) => new Date(`${d}T00:00:00.000Z`).getUTCDay() === 0,
    );
    const novWeekdays = allNovDates.filter((d) => {
      const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
      return dow !== 0 && dow !== 6;
    });

    const globalHolidayDate = novWeekdays[2]; // 3rd weekday of Nov
    const branchAHolidayDate = novWeekdays[10]; // 11th weekday of Nov
    const branchAHolidayOnSunday = novSundays[2]; // 3rd Sunday of Nov (overlaps weekly off!)
    const branchBHolidayDate = novWeekdays[14]; // 15th weekday of Nov

    await factory.createHoliday({
      date: globalHolidayDate,
      year: testYear,
      type: HolidayType.PUBLIC,
      branchId: null,
    });
    await factory.createHoliday({
      date: branchAHolidayDate,
      year: testYear,
      type: HolidayType.REGIONAL,
      branchId: branchA._id,
    });
    await factory.createHoliday({
      date: branchAHolidayOnSunday,
      year: testYear,
      type: HolidayType.COMPANY,
      branchId: branchA._id,
    });
    await factory.createHoliday({
      date: branchBHolidayDate,
      year: testYear,
      type: HolidayType.REGIONAL,
      branchId: branchB._id,
    });

    // Compute independent reference calendar sets
    branchAWeeklyOffs = new Set(
      allNovDates.filter((d) => {
        const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
        if (d <= `${testYear}-11-15`) {
          return dow === 0 || dow === 6;
        }
        return dow === 0;
      }),
    );
    branchAHolidaysNonWeeklyOff = new Set(
      [globalHolidayDate, branchAHolidayDate, branchAHolidayOnSunday].filter(
        (d) => !branchAWeeklyOffs.has(d),
      ),
    );
    branchAScheduledWorkDates = allNovDates.filter(
      (d) => !branchAWeeklyOffs.has(d) && !branchAHolidaysNonWeeklyOff.has(d),
    );

    branchBWeeklyOffs = new Set(novSundays);
    branchBHolidaysNonWeeklyOff = new Set(
      [globalHolidayDate, branchBHolidayDate].filter(
        (d) => !branchBWeeklyOffs.has(d),
      ),
    );
    branchBScheduledWorkDates = allNovDates.filter(
      (d) => !branchBWeeklyOffs.has(d) && !branchBHolidaysNonWeeklyOff.has(d),
    );

    paidLeaveType = await factory.createLeaveType({
      isPaid: true,
      allowHalfDay: true,
      deductWeekends: false,
      deductHolidays: false,
    });
    unpaidLeaveType = await factory.createLeaveType({
      isPaid: false,
      allowHalfDay: true,
      deductWeekends: false,
      deductHolidays: false,
    });

    // Create 11 deterministic employees in deptMainId
    empMap = {
      E01_ALL_PRESENT: await factory.createEmployee({
        employeeCode: `${runTag}-01`,
        branchId: branchA._id,
        departmentId: deptMainId,
        shiftId: dayShift._id,
        dateOfJoining: new Date(`${testYear - 1}-01-01T00:00:00.000Z`),
      }),
      E02_MIXED: await factory.createEmployee({
        employeeCode: `${runTag}-02`,
        branchId: branchA._id,
        departmentId: deptMainId,
        shiftId: dayShift._id,
        dateOfJoining: new Date(`${testYear - 1}-01-01T00:00:00.000Z`),
      }),
      E03_NO_DATA: await factory.createEmployee({
        employeeCode: `${runTag}-03`,
        branchId: branchA._id,
        departmentId: deptMainId,
        employmentStatus: EmploymentStatus.PROBATION,
        dateOfJoining: new Date(`${testYear}-10-01T00:00:00.000Z`),
      }),
      E04_MID_JOINER: await factory.createEmployee({
        employeeCode: `${runTag}-04`,
        branchId: branchA._id,
        departmentId: deptMainId,
        shiftId: dayShift._id,
        dateOfJoining: new Date(`${testYear}-11-16T00:00:00.000Z`),
      }),
      E05_POST_JOINER: await factory.createEmployee({
        employeeCode: `${runTag}-05`,
        branchId: branchA._id,
        departmentId: deptMainId,
        dateOfJoining: new Date(`${testYear}-12-01T00:00:00.000Z`),
      }),
      E06_RESIGNED_LWD: await factory.createEmployee({
        employeeCode: `${runTag}-06`,
        branchId: branchA._id,
        departmentId: deptMainId,
        shiftId: dayShift._id,
        employmentStatus: EmploymentStatus.RESIGNED,
        dateOfJoining: new Date(`${testYear - 1}-01-01T00:00:00.000Z`),
        lastWorkingDate: new Date(`${testYear}-11-18T00:00:00.000Z`),
      }),
      E07_TERMINATED_EARLY: await factory.createEmployee({
        employeeCode: `${runTag}-07`,
        branchId: branchB._id,
        departmentId: deptMainId,
        shiftId: dayShift._id,
        employmentStatus: EmploymentStatus.TERMINATED,
        dateOfJoining: new Date(`${testYear - 1}-01-01T00:00:00.000Z`),
        terminationDate: new Date(`${testYear}-11-10T00:00:00.000Z`),
        lastWorkingDate: new Date(`${testYear}-11-12T00:00:00.000Z`),
      }),
      E08_RESIGNED_NO_EXIT: await factory.createEmployee({
        employeeCode: `${runTag}-08`,
        branchId: branchA._id,
        departmentId: deptMainId,
        employmentStatus: EmploymentStatus.RESIGNED,
        dateOfJoining: new Date(`${testYear - 1}-01-01T00:00:00.000Z`),
        lastWorkingDate: null,
        terminationDate: null,
      }),
      E09_SOFT_DELETED: await factory.createEmployee({
        employeeCode: `${runTag}-09`,
        branchId: branchA._id,
        departmentId: deptMainId,
        deletedAt: new Date(),
      }),
      E10_LEAVES_BRANCH_B: await factory.createEmployee({
        employeeCode: `${runTag}-10`,
        branchId: branchB._id,
        departmentId: deptMainId,
        shiftId: dayShift._id,
        dateOfJoining: new Date(`${testYear - 1}-01-01T00:00:00.000Z`),
      }),
      E11_NIGHT_BOUNDARY: await factory.createEmployee({
        employeeCode: `${runTag}-11`,
        branchId: branchB._id,
        departmentId: deptMainId,
        shiftId: nightShift._id,
        dateOfJoining: new Date(`${testYear - 1}-01-01T00:00:00.000Z`),
      }),
    };

    // Inject dynamic resignationDate onto E08 in raw collection to verify it is NEVER used as exit date
    await models.employeeModel.collection.updateOne(
      { _id: empMap.E08_RESIGNED_NO_EXIT._id },
      {
        $set: { resignationDate: new Date(`${testYear}-11-20T00:00:00.000Z`) },
      },
    );

    // E01_ALL_PRESENT: 100% present across all branchA scheduled work dates (and Oct 1..5 for completeness check)
    for (const d of branchAScheduledWorkDates) {
      await factory.createAttendance({
        employeeId: empMap.E01_ALL_PRESENT._id,
        attendanceDate: d,
        shift: dayShift,
        status: AttendanceStatus.PRESENT,
      });
    }
    for (const d of enumerateUtcDates(
      `${testYear}-10-01`,
      `${testYear}-10-05`,
    )) {
      if (new Date(`${d}T00:00:00.000Z`).getUTCDay() !== 0) {
        await factory.createAttendance({
          employeeId: empMap.E01_ALL_PRESENT._id,
          attendanceDate: d,
          shift: dayShift,
          status: AttendanceStatus.PRESENT,
        });
      }
    }

    // E02_MIXED: populate first 10 scheduled work dates with diverse statuses + regularizations + soft-deleted duplicate
    const mDates = branchAScheduledWorkDates;
    const approvedReg = await factory.createRegularization({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[2],
      status: RegularizationStatus.APPROVED,
    });
    const pendingReg = await factory.createRegularization({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[9],
      status: RegularizationStatus.PENDING,
    });

    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[0],
      shift: dayShift,
      status: AttendanceStatus.PRESENT,
    });
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[1],
      shift: dayShift,
      status: AttendanceStatus.LATE,
      lateMinutes: 30,
    });
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[2],
      shift: dayShift,
      status: AttendanceStatus.REGULARIZED,
      regularizationId: approvedReg._id,
    });
    // Soft-deleted duplicate for mDates[0] must be ignored by $match { deletedAt: null }
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[0],
      shift: dayShift,
      status: AttendanceStatus.ABSENT,
      deletedAt: new Date(),
    });
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[3],
      shift: dayShift,
      status: AttendanceStatus.HALF_DAY,
    });
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[4],
      shift: dayShift,
      status: AttendanceStatus.ABSENT,
    });
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[5],
      shift: dayShift,
      status: AttendanceStatus.CHECKED_IN,
      checkOutTime: null,
      totalWorkMinutes: 0,
    });
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[6],
      shift: dayShift,
      status: AttendanceStatus.ON_BREAK,
      checkOutTime: null,
      totalWorkMinutes: 0,
    });
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[7],
      shift: dayShift,
      status: AttendanceStatus.INCOMPLETE,
      checkOutTime: null,
      totalWorkMinutes: 100,
    });
    // mDates[8] deliberately left unrecorded -> missingDays >= 1
    await factory.createAttendance({
      employeeId: empMap.E02_MIXED._id,
      attendanceDate: mDates[9],
      shift: dayShift,
      status: AttendanceStatus.REGULARIZED,
      regularizationId: pendingReg._id,
    });

    // E04_MID_JOINER: outside-tenure record before Nov 16 + valid present records on remaining scheduled days
    const outsideBeforeJoin = branchAScheduledWorkDates.find(
      (d) => d < `${testYear}-11-16`,
    )!;
    await factory.createAttendance({
      employeeId: empMap.E04_MID_JOINER._id,
      attendanceDate: outsideBeforeJoin,
      shift: dayShift,
      status: AttendanceStatus.PRESENT,
    });
    for (const d of branchAScheduledWorkDates.filter(
      (x) => x >= `${testYear}-11-16`,
    )) {
      await factory.createAttendance({
        employeeId: empMap.E04_MID_JOINER._id,
        attendanceDate: d,
        shift: dayShift,
        status: AttendanceStatus.PRESENT,
      });
    }

    // E06_RESIGNED_LWD: valid attendance up to Nov 18 + outside-tenure record after Nov 18
    for (const d of branchAScheduledWorkDates.filter(
      (x) => x <= `${testYear}-11-18`,
    )) {
      await factory.createAttendance({
        employeeId: empMap.E06_RESIGNED_LWD._id,
        attendanceDate: d,
        shift: dayShift,
        status: AttendanceStatus.PRESENT,
      });
    }
    const outsideAfterExit = branchAScheduledWorkDates.find(
      (d) => d > `${testYear}-11-18`,
    )!;
    await factory.createAttendance({
      employeeId: empMap.E06_RESIGNED_LWD._id,
      attendanceDate: outsideAfterExit,
      shift: dayShift,
      status: AttendanceStatus.PRESENT,
    });

    // E07_TERMINATED_EARLY: present across tenure Nov 1..10
    for (const d of branchBScheduledWorkDates.filter(
      (x) => x <= `${testYear}-11-10`,
    )) {
      await factory.createAttendance({
        employeeId: empMap.E07_TERMINATED_EARLY._id,
        attendanceDate: d,
        shift: dayShift,
        status: AttendanceStatus.PRESENT,
      });
    }

    // E10_LEAVES_BRANCH_B:
    // - Cross-month paid leave: Oct 30 .. Nov 04 (with Sunday excluded)
    // - Unpaid leave overlapping globalHolidayDate (legacy no excludedDates -> deductHolidays=false skips holiday)
    // - Half-day paid leave on a clean scheduled day + HALF_DAY attendance
    // - CANCELLATION_REQUESTED unpaid leave on a clean scheduled day + ON_LEAVE attendance
    // - PENDING, REJECTED, CANCELLED leaves (excluded!)
    // - ABSENT attendance on an approved paid leave date -> leaveAttendanceMismatchDates
    // - ON_LEAVE attendance with NO leave request -> leaveAttendanceMismatchDates
    const bWork = branchBScheduledWorkDates;
    const crossStart = `${testYear}-10-30`;
    const crossEnd = `${testYear}-11-04`;
    const crossNovSundays = enumerateUtcDates(crossStart, crossEnd).filter(
      (d) => new Date(`${d}T00:00:00.000Z`).getUTCDay() === 0,
    );
    await factory.createLeaveRequest({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      leaveType: paidLeaveType,
      startDate: crossStart,
      endDate: crossEnd,
      totalDays: 5,
      excludedDates: crossNovSundays,
      status: LeaveRequestStatus.APPROVED,
    });
    for (const d of enumerateUtcDates(novStart, crossEnd).filter(
      (x) =>
        !crossNovSundays.includes(x) && !branchBHolidaysNonWeeklyOff.has(x),
    )) {
      await factory.createAttendance({
        employeeId: empMap.E10_LEAVES_BRANCH_B._id,
        attendanceDate: d,
        shift: dayShift,
        status: AttendanceStatus.ON_LEAVE,
      });
    }

    // Legacy unpaid leave crossing globalHolidayDate (Nov day after globalHolidayDate)
    const nextWorkAfterGlobal = bWork.find((d) => d > globalHolidayDate)!;
    await factory.createLeaveRequest({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      leaveType: unpaidLeaveType,
      startDate: globalHolidayDate,
      endDate: nextWorkAfterGlobal,
      totalDays: 1,
      excludedDates: undefined,
      status: LeaveRequestStatus.APPROVED,
    });
    await factory.createAttendance({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      attendanceDate: nextWorkAfterGlobal,
      shift: dayShift,
      status: AttendanceStatus.ON_LEAVE,
    });

    // Pick unused later branchB work dates
    const usedSetE10 = new Set<string>([
      ...enumerateUtcDates(novStart, crossEnd),
      globalHolidayDate,
      nextWorkAfterGlobal,
    ]);
    const freeBWork = bWork.filter((d) => !usedSetE10.has(d));
    const halfDayDate = freeBWork[0];
    const cancelReqDate = freeBWork[1];
    const conflictAbsentLeaveDate = freeBWork[2];
    const orphanOnLeaveAttDate = freeBWork[3];
    const pendingLeaveDate = freeBWork[4];
    const rejectedLeaveDate = freeBWork[5];
    const cancelledLeaveDate = freeBWork[6];

    await factory.createLeaveRequest({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      leaveType: paidLeaveType,
      startDate: halfDayDate,
      endDate: halfDayDate,
      totalDays: 0.5,
      isHalfDay: true,
      status: LeaveRequestStatus.APPROVED,
    });
    await factory.createAttendance({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      attendanceDate: halfDayDate,
      shift: dayShift,
      status: AttendanceStatus.HALF_DAY,
    });

    await factory.createLeaveRequest({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      leaveType: unpaidLeaveType,
      startDate: cancelReqDate,
      endDate: cancelReqDate,
      totalDays: 1,
      status: LeaveRequestStatus.CANCELLATION_REQUESTED,
    });
    await factory.createAttendance({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      attendanceDate: cancelReqDate,
      shift: dayShift,
      status: AttendanceStatus.ON_LEAVE,
    });

    await factory.createLeaveRequest({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      leaveType: paidLeaveType,
      startDate: conflictAbsentLeaveDate,
      endDate: conflictAbsentLeaveDate,
      totalDays: 1,
      status: LeaveRequestStatus.APPROVED,
    });
    await factory.createAttendance({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      attendanceDate: conflictAbsentLeaveDate,
      shift: dayShift,
      status: AttendanceStatus.ABSENT,
    });

    await factory.createAttendance({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      attendanceDate: orphanOnLeaveAttDate,
      shift: dayShift,
      status: AttendanceStatus.ON_LEAVE,
    });

    await factory.createLeaveRequest({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      leaveType: paidLeaveType,
      startDate: pendingLeaveDate,
      endDate: pendingLeaveDate,
      totalDays: 1,
      status: LeaveRequestStatus.PENDING,
    });
    await factory.createLeaveRequest({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      leaveType: paidLeaveType,
      startDate: rejectedLeaveDate,
      endDate: rejectedLeaveDate,
      totalDays: 1,
      status: LeaveRequestStatus.REJECTED,
    });
    await factory.createLeaveRequest({
      employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      leaveType: paidLeaveType,
      startDate: cancelledLeaveDate,
      endDate: cancelledLeaveDate,
      totalDays: 1,
      status: LeaveRequestStatus.CANCELLED,
    });

    // E11_NIGHT_BOUNDARY: overnight shift on Nov 30 (22:00 NY Nov 30 -> 07:00 NY Dec 01) attributed to Nov 30
    const nov30CheckInUtc = AttendanceCalculationUtil.parseZonedDateTime(
      `${testYear}-11-30`,
      '22:00',
      'America/New_York',
    );
    const dec01CheckOutUtc = AttendanceCalculationUtil.parseZonedDateTime(
      `${testYear}-12-01`,
      '07:00',
      'America/New_York',
    );
    await factory.createAttendance({
      employeeId: empMap.E11_NIGHT_BOUNDARY._id,
      attendanceDate: `${testYear}-11-30`,
      shift: nightShift,
      status: AttendanceStatus.PRESENT,
      checkInTime: nov30CheckInUtc,
      checkOutTime: dec01CheckOutUtc,
      totalWorkMinutes: 540,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(async () => {
    try {
      if (isConnected && connection) {
        await tracker.cleanupAll(connection, models);
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('enforces authentication, PAYROLL_PERIODS_VIEW RBAC, ObjectId pipes, 404 checks, and ValidationPipe on query params over real HTTP', async () => {
    const server = app!.getHttpServer();

    // 1. Missing authentication
    await request(server)
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary`,
      )
      .expect(HttpStatus.UNAUTHORIZED);

    // 2. Insufficient permission (PAYROLL_CALCULATIONS_VIEW only)
    await request(server)
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary`,
      )
      .set('Cookie', insufficientCookie)
      .expect(HttpStatus.FORBIDDEN);

    // 3. Invalid period ObjectId
    await request(server)
      .get('/api/v1/payroll/periods/not-a-valid-id/attendance-summary')
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.BAD_REQUEST);

    // 4. Nonexistent payroll period
    await request(server)
      .get(
        `/api/v1/payroll/periods/${new Types.ObjectId().toHexString()}/attendance-summary`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.NOT_FOUND);

    // 5. Soft-deleted payroll period
    await request(server)
      .get(
        `/api/v1/payroll/periods/${deletedPeriod._id.toHexString()}/attendance-summary`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.NOT_FOUND);

    // 6. Invalid query filters / unknown pagination query param rejected
    await request(server)
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary?branchId=bad`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.BAD_REQUEST);

    await request(server)
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary?page=1`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.BAD_REQUEST);

    // 7. Empty eligible employee list via empty branch filter
    const emptyRes = await request(server)
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary?branchId=${branchEmpty._id.toHexString()}`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.OK);

    expect(emptyRes.body.success).toBe(true);
    expect(emptyRes.body.data.summary.totalEligibleEmployees).toBe(0);
    expect(emptyRes.body.data.employees).toEqual([]);
  });

  it('aggregates all 11 real-DB employee scenarios accurately against independent reference calculations with zero DB mutations', async () => {
    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    // Evaluate after testYear-11 has concluded
    jest.setSystemTime(new Date(`${testYear}-12-05T10:00:00.000Z`));

    const countBefore = {
      employees: await models.employeeModel.countDocuments({
        departmentId: deptMainId,
      }),
      attendances: await models.attendanceModel.countDocuments({
        employeeId: { $in: Object.values(empMap).map((e) => e._id) },
      }),
      leaves: await models.leaveRequestModel.countDocuments({
        employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      }),
    };

    const res = await request(app!.getHttpServer())
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary?departmentId=${deptMainId.toHexString()}`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.OK);

    const data = res.body.data as PayrollPeriodAttendanceSummaryResponseDto;
    expect(res.body.success).toBe(true);
    expect(data.period.calendarDays).toBe(30);

    // Included: E01, E02, E03, E04, E06, E07, E10, E11 (8 employees)
    // Excluded: E05 (post-period joiner), E08 (resigned without reliable exit date), E09 (soft-deleted)
    const returnedCodes = data.employees.map((e) => e.employeeCode);
    expect(returnedCodes).toEqual([
      empMap.E01_ALL_PRESENT.employeeCode,
      empMap.E02_MIXED.employeeCode,
      empMap.E03_NO_DATA.employeeCode,
      empMap.E04_MID_JOINER.employeeCode,
      empMap.E06_RESIGNED_LWD.employeeCode,
      empMap.E07_TERMINATED_EARLY.employeeCode,
      empMap.E10_LEAVES_BRANCH_B.employeeCode,
      empMap.E11_NIGHT_BOUNDARY.employeeCode,
    ]);

    const byCode = Object.fromEntries(
      data.employees.map((e) => [e.employeeCode, e]),
    );

    // E01_ALL_PRESENT: full branchA calendar & zero missing/anomalies
    const e1 = byCode[empMap.E01_ALL_PRESENT.employeeCode];
    expect(e1.weeklyOffDays).toBe(branchAWeeklyOffs.size);
    expect(e1.holidayDays).toBe(branchAHolidaysNonWeeklyOff.size);
    expect(e1.scheduledWorkingDays).toBe(branchAScheduledWorkDates.length);
    expect(e1.weeklyOffDays + e1.holidayDays + e1.scheduledWorkingDays).toBe(
      30,
    );
    expect(e1.presentDays).toBe(branchAScheduledWorkDates.length);
    expect(e1.missingDays).toBe(0);
    expect(e1.anomalies.hasAnomalies).toBe(false);

    // E02_MIXED: PRESENT + LATE + approved REGULARIZED = 3 presentDays; PENDING regularization excluded!
    const e2 = byCode[empMap.E02_MIXED.employeeCode];
    expect(e2.presentDays).toBe(3);
    expect(e2.halfDays).toBe(1);
    expect(e2.absentDays).toBe(1);
    expect(e2.incompleteDays).toBe(3); // CHECKED_IN + ON_BREAK + INCOMPLETE
    expect(e2.statusBreakdown.late).toBe(1);
    expect(e2.statusBreakdown.regularized).toBe(1);
    expect(e2.anomalies.unapprovedRegularizedDates).toEqual([
      branchAScheduledWorkDates[9],
    ]);
    expect(e2.anomalies.openSessionDates).toHaveLength(2);
    expect(e2.anomalies.incompleteDates).toHaveLength(1);
    expect(e2.missingDays).toBe(branchAScheduledWorkDates.length - 9);

    // E03_NO_DATA: unrecorded working days stay in missingDays, NEVER absentDays!
    const e3 = byCode[empMap.E03_NO_DATA.employeeCode];
    expect(e3.presentDays).toBe(0);
    expect(e3.absentDays).toBe(0);
    expect(e3.missingDays).toBe(branchAScheduledWorkDates.length);

    // E04_MID_JOINER: joined Nov 16, pre-joining attendance excluded & flagged
    const e4 = byCode[empMap.E04_MID_JOINER.employeeCode];
    const e4ExpectedWork = branchAScheduledWorkDates.filter(
      (d) => d >= `${testYear}-11-16`,
    ).length;
    expect(e4.isMidPeriodJoiner).toBe(true);
    expect(e4.effectiveStartDate).toBe(`${testYear}-11-16`);
    expect(e4.presentDays).toBe(e4ExpectedWork);
    expect(e4.anomalies.outsideTenureAttendanceDates).toHaveLength(1);

    // E06_RESIGNED_LWD: lastWorkingDate Nov 18, post-exit attendance excluded & flagged
    const e6 = byCode[empMap.E06_RESIGNED_LWD.employeeCode];
    const e6ExpectedWork = branchAScheduledWorkDates.filter(
      (d) => d <= `${testYear}-11-18`,
    ).length;
    expect(e6.isMidPeriodLeaver).toBe(true);
    expect(e6.effectiveEndDate).toBe(`${testYear}-11-18`);
    expect(e6.presentDays).toBe(e6ExpectedWork);
    expect(e6.anomalies.outsideTenureAttendanceDates).toHaveLength(1);

    // E07_TERMINATED_EARLY: min(terminationDate Nov 10, lastWorkingDate Nov 12) = Nov 10
    const e7 = byCode[empMap.E07_TERMINATED_EARLY.employeeCode];
    expect(e7.effectiveExitDate).toBe(`${testYear}-11-10`);
    expect(e7.tenureCalendarDays).toBe(10);

    // E10_LEAVES_BRANCH_B: verify paid & unpaid leaves + CANCELLATION_REQUESTED + mismatches
    const e10 = byCode[empMap.E10_LEAVES_BRANCH_B.employeeCode];
    const expectedCrossPaidDays = enumerateUtcDates(
      novStart,
      `${testYear}-11-04`,
    ).filter((d) => new Date(`${d}T00:00:00.000Z`).getUTCDay() !== 0).length;
    // Paid leaves: cross-month (Nov 1..4 non-Sun) + 0.5 half-day + 1 conflictAbsentLeaveDate
    expect(e10.leaveSummary.paidLeaveDays).toBe(
      expectedCrossPaidDays + 0.5 + 1,
    );
    // Unpaid leaves: 1 day (legacy skipping globalHolidayDate) + 1 day (CANCELLATION_REQUESTED) = 2
    expect(e10.leaveSummary.unpaidLeaveDays).toBe(2);
    expect(e10.leaveSummary.pendingCancellationLeaveDays).toBe(1);
    expect(e10.anomalies.warnings).toEqual(
      expect.arrayContaining([
        'PENDING_LEAVE_CANCELLATION_RECONCILIATION',
        'LEAVE_ATTENDANCE_MISMATCH',
      ]),
    );
    expect(e10.anomalies.leaveAttendanceMismatchDates).toHaveLength(2);

    // E11_NIGHT_BOUNDARY: overnight Nov 30 attributed to Nov 30 (presentDays: 1) and NOT leaked into Dec period
    const e11 = byCode[empMap.E11_NIGHT_BOUNDARY.employeeCode];
    expect(e11.presentDays).toBe(1);

    const decRes = await request(app!.getHttpServer())
      .get(
        `/api/v1/payroll/periods/${decPeriod._id.toHexString()}/attendance-summary?employeeId=${empMap.E11_NIGHT_BOUNDARY._id.toHexString()}`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.OK);
    expect(decRes.body.data.employees[0].presentDays).toBe(0);

    // Verify filters: branchId, employeeId, anomaliesOnly
    const branchBRes = await request(app!.getHttpServer())
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary?departmentId=${deptMainId.toHexString()}&branchId=${branchB._id.toHexString()}`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.OK);
    const branchBData = branchBRes.body
      .data as PayrollPeriodAttendanceSummaryResponseDto;
    expect(branchBData.employees.map((e) => e.employeeCode)).toEqual([
      empMap.E07_TERMINATED_EARLY.employeeCode,
      empMap.E10_LEAVES_BRANCH_B.employeeCode,
      empMap.E11_NIGHT_BOUNDARY.employeeCode,
    ]);

    const anomalyRes = await request(app!.getHttpServer())
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary?departmentId=${deptMainId.toHexString()}&anomaliesOnly=true`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.OK);
    const anomalyData = anomalyRes.body
      .data as PayrollPeriodAttendanceSummaryResponseDto;
    expect(anomalyData.summary.totalEligibleEmployees).toBe(8);
    expect(anomalyData.employees.every((e) => e.anomalies.hasAnomalies)).toBe(
      true,
    );
    expect(
      anomalyData.employees.some(
        (e) => e.employeeCode === empMap.E01_ALL_PRESENT.employeeCode,
      ),
    ).toBe(false);

    // Verify ZERO unexpected DB mutations occurred during GET requests
    const countAfter = {
      employees: await models.employeeModel.countDocuments({
        departmentId: deptMainId,
      }),
      attendances: await models.attendanceModel.countDocuments({
        employeeId: { $in: Object.values(empMap).map((e) => e._id) },
      }),
      leaves: await models.leaveRequestModel.countDocuments({
        employeeId: empMap.E10_LEAVES_BRANCH_B._id,
      }),
    };
    expect(countAfter).toEqual(countBefore);
  });

  it('handles ongoing periods without marking future working days as missing and reports attendanceFinalized=true on complete past period', async () => {
    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    // Mid-month testYear-11-15 10:00 UTC -> Nov 16..30 are future scheduled days!
    jest.setSystemTime(new Date(`${testYear}-11-15T10:00:00.000Z`));

    const ongoingRes = await request(app!.getHttpServer())
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary?employeeId=${empMap.E03_NO_DATA._id.toHexString()}`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.OK);

    const e3 = ongoingRes.body.data.employees[0];
    const expectedEvaluatableNov15 = branchAScheduledWorkDates.filter(
      (d) => d <= `${testYear}-11-15`,
    ).length;
    const expectedFutureNov15 = branchAScheduledWorkDates.filter(
      (d) => d > `${testYear}-11-15`,
    ).length;

    expect(e3.evaluatableWorkingDays).toBe(expectedEvaluatableNov15);
    expect(e3.futureScheduledWorkingDays).toBe(expectedFutureNov15);
    expect(e3.missingDays).toBe(expectedEvaluatableNov15);
    expect(e3.absentDays).toBe(0);
    expect(ongoingRes.body.data.finalization.periodEnded).toBe(false);
    expect(ongoingRes.body.data.finalization.attendanceFinalized).toBe(false);

    // Complete past 5-day Oct period for E01_ALL_PRESENT
    jest.setSystemTime(new Date(`${testYear}-12-05T10:00:00.000Z`));
    const completeRes = await request(app!.getHttpServer())
      .get(
        `/api/v1/payroll/periods/${cleanCompletePeriod._id.toHexString()}/attendance-summary?employeeId=${empMap.E01_ALL_PRESENT._id.toHexString()}`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.OK);

    expect(completeRes.body.data.finalization.periodEnded).toBe(true);
    expect(completeRes.body.data.finalization.hasUnresolvedGaps).toBe(false);
    expect(completeRes.body.data.finalization.attendanceFinalized).toBe(true);
  });

  it('enforces uq_attendance_emp_date uniqueness in real MongoDB and verifies aggregation explain plan + 100-employee benchmark', async () => {
    // 1. Verify active duplicate insert is rejected at storage engine level (E11000)
    await expect(
      models.attendanceModel.collection.insertOne({
        employeeId: empMap.E01_ALL_PRESENT._id,
        attendanceDate: branchAScheduledWorkDates[0],
        date: new Date(`${branchAScheduledWorkDates[0]}T00:00:00.000Z`),
        shiftId: dayShift._id,
        status: AttendanceStatus.PRESENT,
        deletedAt: null,
      }),
    ).rejects.toMatchObject({ code: 11000 });

    // 2. Modest-volume benchmark & explain('executionStats'): 100 employees x 20 working days = 2,000 docs
    const benchPayloads = Array.from({ length: 100 }, (_, i) => {
      const code = `${runTag}-B${String(i).padStart(3, '0')}`;
      return {
        userId: null,
        employeeCode: code,
        firstName: `Bench${i}`,
        lastName: 'Tester',
        workEmail: `${code.toLowerCase()}@test-payroll.example.com`,
        dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
        lastWorkingDate: null,
        terminationDate: null,
        departmentId: deptBenchId,
        designationId: new Types.ObjectId(),
        branchId: branchA._id,
        shiftId: dayShift._id,
        employmentType: EmploymentType.FULL_TIME,
        employmentStatus: EmploymentStatus.ACTIVE,
        isRemoteAllowed: false,
        deletedAt: null,
      };
    });
    const benchEmployees = await models.employeeModel.insertMany(benchPayloads);
    for (const emp of benchEmployees) {
      tracker.track('employeeIds', emp._id);
    }

    const sampleWorkDates = branchAScheduledWorkDates.slice(0, 20);
    const bulkDocs = benchEmployees.flatMap((emp) =>
      sampleWorkDates.map((d) => ({
        employeeId: emp._id,
        attendanceDate: d,
        date: new Date(`${d}T00:00:00.000Z`),
        shiftId: dayShift._id,
        shiftSnapshot: {
          name: dayShift.name,
          code: dayShift.code,
          startTime: dayShift.startTime,
          endTime: dayShift.endTime,
          isOvernight: false,
          gracePeriodMinutes: 15,
          breakDurationMinutes: 60,
          minWorkMinutesForFullDay: 480,
          minWorkMinutesForHalfDay: 240,
          overtimeThresholdMinutes: 480,
        },
        status: AttendanceStatus.PRESENT,
        workMode: 'OFFICE',
        checkInSource: 'WEB',
        totalBreakMinutes: 60,
        totalWorkMinutes: 480,
        isLate: false,
        lateMinutes: 0,
        isEarlyDeparture: false,
        earlyDepartureMinutes: 0,
        overtimeMinutes: 0,
        regularizationId: null,
        leaveRequestId: null,
        deletedAt: null,
      })),
    );
    await models.attendanceModel.insertMany(bulkDocs);

    const benchIds = benchEmployees.map((e) => e._id);
    const explainResult = await models.attendanceModel
      .aggregate([
        {
          $match: {
            employeeId: { $in: benchIds },
            attendanceDate: { $gte: novStart, $lte: novEnd },
            deletedAt: null,
          },
        },
        { $sort: { employeeId: 1, attendanceDate: 1, createdAt: -1, _id: -1 } },
        {
          $group: {
            _id: {
              employeeId: '$employeeId',
              attendanceDate: '$attendanceDate',
            },
            recordCount: { $sum: 1 },
            status: { $first: '$status' },
          },
        },
      ])
      .explain('executionStats');

    const execStats =
      explainResult?.stages?.[0]?.$cursor?.executionStats ??
      explainResult?.executionStats;
    const planString = JSON.stringify(explainResult);
    expect(planString).not.toContain('"stage":"COLLSCAN"');
    if (execStats) {
      expect(execStats.nReturned).toBe(2000);
      expect(execStats.totalDocsExamined).toBe(2000);
    }

    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    jest.setSystemTime(new Date(`${testYear}-12-05T10:00:00.000Z`));

    const startMs = performance.now();
    const benchRes = await request(app!.getHttpServer())
      .get(
        `/api/v1/payroll/periods/${novPeriod._id.toHexString()}/attendance-summary?departmentId=${deptBenchId.toHexString()}`,
      )
      .set('Cookie', authorizedCookie)
      .expect(HttpStatus.OK);
    const elapsedMs = Math.round(performance.now() - startMs);

    expect(benchRes.body.data.summary.totalEligibleEmployees).toBe(100);
    expect(benchRes.body.data.summary.totals.totalPresentDays).toBe(2000);
    console.info(
      `[BENCHMARK 100 employees / 2000 attendance docs] totalDocsExamined=${String(execStats?.totalDocsExamined ?? 'N/A')} nReturned=${String(execStats?.nReturned ?? 'N/A')} httpDurationMs=${elapsedMs}`,
    );
  });
});
