/* eslint-disable @typescript-eslint/no-unsafe-member-access */

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
import { AttendanceStatus } from '../attendance/constants/attendance.constant';
import {
  AttendanceRegularization,
  AttendanceRegularizationDocument,
} from '../attendance/schemas/attendance-regularization.schema';
import {
  Attendance,
  AttendanceDocument,
} from '../attendance/schemas/attendance.schema';
import { AttendanceRepository } from '../attendance/repositories/attendance.repository';
import { AttendanceRegularizationRepository } from '../attendance/repositories/attendance-regularization.repository';
import { Shift, ShiftDocument } from '../attendance/schemas/shift.schema';
import { AuthModule } from '../auth/auth.module';
import { ACCESS_TOKEN_COOKIE } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Session, SessionDocument } from '../auth/schemas/session.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { BranchRepository } from '../branches/repositories/branch.repository';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import { EmployeeRepository } from '../employees/repositories/employee.repository';
import {
  HolidayType,
  LeaveRequestStatus,
} from '../leaves/constants/leaves.constant';
import { Holiday, HolidayDocument } from '../leaves/schemas/holiday.schema';
import { HolidayRepository } from '../leaves/repositories/holiday.repository';
import {
  LeaveRequest,
  LeaveRequestDocument,
} from '../leaves/schemas/leave-request.schema';
import { LeaveRequestRepository } from '../leaves/repositories/leave-request.repository';
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
import { WeeklyOffConfigRepository } from '../work-schedules/repositories/weekly-off-config.repository';
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

describe('Payroll Attendance Summary — 1,000-Employee / 31,000-Record MVP Benchmark (Real MongoDB)', () => {
  jest.setTimeout(300000);

  let app: INestApplication<App> | null = null;
  let moduleRef: TestingModule | null = null;
  let connection: Connection | null = null;
  let models: RealDbModels;
  let tracker: TestCleanupTracker;
  let factory: PayrollAttendanceRealDbFactory;
  let isConnected = false;

  const runTag = `BENCH${Date.now().toString(36).toUpperCase()}`;

  let testYear!: number;
  let periodStartStr!: string;
  let periodEndStr!: string;
  let benchPeriod!: PayrollPeriodDocument;
  let benchDeptIds: Types.ObjectId[] = [];
  let benchEmpIds: Types.ObjectId[] = [];
  let authCookie!: string;

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
      models.leaveRequestModel.syncIndexes(),
    ]);

    tracker = new TestCleanupTracker();
    factory = new PayrollAttendanceRealDbFactory(runTag, models, tracker);
    isConnected = true;

    const jwtService = new JwtService({
      secret: moduleRef.get(ConfigService).getOrThrow<string>('jwt.secret'),
      signOptions: { algorithm: 'HS256' },
    });
    const actor = await factory.createUserWithRole([
      PermissionKeys.PAYROLL_PERIODS_VIEW,
    ]);
    const token = await jwtService.signAsync({
      sub: actor.user._id.toHexString(),
      sid: actor.session._id.toHexString(),
      type: 'access',
    });
    authCookie = `${ACCESS_TOKEN_COOKIE}=${token}`;

    testYear = await factory.findUnusedFutureYear(2085, 2099);
    periodStartStr = `${testYear}-01-01`;
    periodEndStr = `${testYear}-01-31`;

    benchPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 1,
      startDate: new Date(`${periodStartStr}T00:00:00.000Z`),
      endDate: new Date(`${periodEndStr}T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-02-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });

    const branches = await Promise.all([
      factory.createBranch({ timezone: 'Asia/Kolkata' }),
      factory.createBranch({ timezone: 'America/New_York' }),
      factory.createBranch({ timezone: 'Europe/London' }),
    ]);
    benchDeptIds = Array.from({ length: 5 }, () => new Types.ObjectId());
    const desigId = new Types.ObjectId();

    const dayShift = await factory.createShift({
      startTime: '09:00',
      endTime: '18:00',
      isOvernight: false,
    });
    const nightShift = await factory.createShift({
      startTime: '22:00',
      endTime: '07:00',
      isOvernight: true,
    });

    await factory.createWeeklyOffConfig({
      branchId: null,
      effectiveFrom: periodStartStr,
      effectiveTo: periodEndStr,
      days: [{ dayOfWeek: 0 }],
    });
    await factory.createWeeklyOffConfig({
      branchId: branches[0]._id,
      effectiveFrom: periodStartStr,
      effectiveTo: periodEndStr,
      days: [{ dayOfWeek: 0 }, { dayOfWeek: 6 }],
    });
    await factory.createHoliday({
      date: `${testYear}-01-26`,
      year: testYear,
      type: HolidayType.PUBLIC,
      branchId: null,
    });
    await factory.createHoliday({
      date: `${testYear}-01-15`,
      year: testYear,
      type: HolidayType.REGIONAL,
      branchId: branches[1]._id,
    });

    const paidLeave = await factory.createLeaveType({ isPaid: true });
    const unpaidLeave = await factory.createLeaveType({ isPaid: false });

    // 1,000 employees (mix of ACTIVE, PROBATION, mid-month joiners, overlapping RESIGNED/TERMINATED)
    const employeePayloads = Array.from({ length: 1000 }, (_, i) => {
      const code = `${runTag}-M${String(i).padStart(4, '0')}`;
      const isResigned = i >= 950 && i < 975;
      const isTerminated = i >= 975;
      return {
        userId: null,
        employeeCode: code,
        firstName: `Emp${i}`,
        lastName: 'Benchmark',
        workEmail: `${code.toLowerCase()}@bench.example.com`,
        dateOfJoining:
          i >= 920 && i < 950
            ? new Date(`${testYear}-01-10T00:00:00.000Z`)
            : new Date('2025-01-01T00:00:00.000Z'),
        lastWorkingDate: isResigned
          ? new Date(`${testYear}-01-25T00:00:00.000Z`)
          : null,
        terminationDate: isTerminated
          ? new Date(`${testYear}-01-20T00:00:00.000Z`)
          : null,
        departmentId: benchDeptIds[i % benchDeptIds.length],
        designationId: desigId,
        branchId: branches[i % branches.length]._id,
        shiftId: i % 5 === 0 ? nightShift._id : dayShift._id,
        employmentType: EmploymentType.FULL_TIME,
        employmentStatus: isResigned
          ? EmploymentStatus.RESIGNED
          : isTerminated
            ? EmploymentStatus.TERMINATED
            : i % 10 === 0
              ? EmploymentStatus.PROBATION
              : EmploymentStatus.ACTIVE,
        isRemoteAllowed: false,
        deletedAt: null,
      };
    });

    const insertedEmployees =
      await models.employeeModel.insertMany(employeePayloads);
    benchEmpIds = insertedEmployees.map((e) => {
      tracker.track('employeeIds', e._id);
      return e._id;
    });

    // Seed 31 attendance records per employee (31,000 total attendance documents) in 5k-doc chunks
    const janDates = Array.from(
      { length: 31 },
      (_, d) => `${testYear}-01-${String(d + 1).padStart(2, '0')}`,
    );

    const statusCycle = [
      AttendanceStatus.PRESENT,
      AttendanceStatus.PRESENT,
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.HALF_DAY,
      AttendanceStatus.ABSENT,
      AttendanceStatus.ON_LEAVE,
    ];

    const daySnap = {
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
    };

    const chunkSizeEmployees = 500; // 500 * 31 = 15,500 docs per native driver batch
    const seedNow = new Date();
    for (
      let offset = 0;
      offset < insertedEmployees.length;
      offset += chunkSizeEmployees
    ) {
      const slice = insertedEmployees.slice(
        offset,
        offset + chunkSizeEmployees,
      );
      const batch = slice.flatMap((emp, empIdxOffset) => {
        const globalIdx = offset + empIdxOffset;
        return janDates.map((dStr, dayIdx) => {
          const st =
            dayIdx === 0 && globalIdx % 25 === 0
              ? AttendanceStatus.INCOMPLETE
              : statusCycle[(globalIdx + dayIdx) % statusCycle.length];
          return {
            employeeId: emp._id,
            attendanceDate: dStr,
            date: new Date(`${dStr}T00:00:00.000Z`),
            shiftId: emp.shiftId ?? dayShift._id,
            shiftSnapshot: daySnap,
            status: st,
            workMode: 'OFFICE',
            checkInSource: 'WEB',
            totalBreakMinutes: 60,
            totalWorkMinutes: st === AttendanceStatus.HALF_DAY ? 240 : 480,
            isLate: st === AttendanceStatus.LATE,
            lateMinutes: st === AttendanceStatus.LATE ? 15 : 0,
            isEarlyDeparture: false,
            earlyDepartureMinutes: 0,
            overtimeMinutes: 0,
            regularizationId: null,
            leaveRequestId: null,
            deletedAt: null,
            deletedBy: null,
            breaks: [],
            createdAt: seedNow,
            updatedAt: seedNow,
          };
        });
      });
      await models.attendanceModel.collection.insertMany(batch, {
        ordered: false,
      });
    }

    // Seed 100 realistic approved/cancellation-requested leaves across the 1,000 employees
    const leaveBatch = Array.from({ length: 100 }, (_, i) => {
      const lt = i % 3 === 0 ? unpaidLeave : paidLeave;
      const d = `${testYear}-01-${String((i % 20) + 2).padStart(2, '0')}`;
      return {
        employeeId: benchEmpIds[i * 10],
        leaveTypeId: lt._id,
        leaveTypeSnapshot: {
          name: lt.name,
          code: lt.code,
          isPaid: lt.isPaid,
          allowHalfDay: lt.allowHalfDay,
          deductWeekends: lt.deductWeekends,
          deductHolidays: lt.deductHolidays,
        },
        startDate: d,
        endDate: d,
        totalDays: 1,
        isHalfDay: false,
        halfDaySession: null,
        excludedDates: [],
        yearBreakdown: [],
        reason: 'Benchmark leave',
        reportingManagerId: null,
        status:
          i % 10 === 0
            ? LeaveRequestStatus.CANCELLATION_REQUESTED
            : LeaveRequestStatus.APPROVED,
        deletedAt: null,
      };
    });
    const insertedLeaves =
      await models.leaveRequestModel.insertMany(leaveBatch);
    for (const l of insertedLeaves) {
      tracker.track('leaveRequestIds', l._id);
    }
  }, 300000);

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
  }, 300000);

  it('executes 1,000-employee / 31,000-record attendance summary with constant batch queries, zero COLLSCAN, and measured executionStats', async () => {
    // 1. Inspect explain("executionStats") on the 3 core batch MongoDB queries
    const attendanceExplain = await models.attendanceModel
      .aggregate([
        {
          $match: {
            employeeId: { $in: benchEmpIds },
            attendanceDate: { $gte: periodStartStr, $lte: periodEndStr },
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
          },
        },
      ])
      .explain('executionStats');

    const employeeExplain = await models.employeeModel
      .find({
        deletedAt: null,
        departmentId: { $in: benchDeptIds },
        dateOfJoining: { $lte: new Date(`${periodEndStr}T23:59:59.999Z`) },
      })
      .select(
        '_id employeeCode firstName lastName dateOfJoining lastWorkingDate terminationDate employmentStatus branchId departmentId designationId',
      )
      .explain('executionStats');

    const leaveExplain = await models.leaveRequestModel
      .find({
        status: {
          $in: [
            LeaveRequestStatus.APPROVED,
            LeaveRequestStatus.CANCELLATION_REQUESTED,
          ],
        },
        startDate: { $lte: periodEndStr },
        endDate: { $gte: periodStartStr },
        deletedAt: null,
        employeeId: { $in: benchEmpIds },
      })
      .explain('executionStats');

    const extractStats = (plan: any): Record<string, unknown> =>
      (plan?.stages?.[0]?.$cursor?.executionStats ??
        plan?.executionStats ??
        {}) as Record<string, unknown>;

    const collectIndexes = (
      node: unknown,
      out = new Set<string>(),
    ): string[] => {
      if (!node || typeof node !== 'object') return Array.from(out);
      const rec = node as Record<string, unknown>;
      if (typeof rec.indexName === 'string') {
        out.add(rec.indexName);
      }
      for (const v of Object.values(rec)) {
        if (Array.isArray(v)) {
          v.forEach((item) => collectIndexes(item, out));
        } else if (v && typeof v === 'object') {
          collectIndexes(v, out);
        }
      }
      return Array.from(out);
    };

    const attStats = extractStats(attendanceExplain);
    const empStats = extractStats(employeeExplain);
    const leaveStats = extractStats(leaveExplain);
    const attIndexes = collectIndexes(attendanceExplain);
    const empIndexes = collectIndexes(employeeExplain);
    const leaveIndexes = collectIndexes(leaveExplain);

    expect(JSON.stringify(attendanceExplain)).not.toContain(
      '"stage":"COLLSCAN"',
    );
    expect(attStats.nReturned).toBe(31000);
    expect(Number(attStats.totalDocsExamined)).toBeGreaterThanOrEqual(31000);

    // 2. Spy on repository methods to verify O(1) batch calls (zero N+1 queries)
    const empRepo = moduleRef!.get(EmployeeRepository);
    const branchRepo = moduleRef!.get(BranchRepository);
    const holidayRepo = moduleRef!.get(HolidayRepository);
    const weeklyOffRepo = moduleRef!.get(WeeklyOffConfigRepository);
    const attRepo = moduleRef!.get(AttendanceRepository);
    const leaveRepo = moduleRef!.get(LeaveRequestRepository);
    const regRepo = moduleRef!.get(AttendanceRegularizationRepository);

    const spies = [
      jest.spyOn(empRepo, 'findForPayrollAttendanceSummary'),
      jest.spyOn(branchRepo, 'findByIds'),
      jest.spyOn(holidayRepo, 'findActiveInRange'),
      jest.spyOn(weeklyOffRepo, 'findActiveEffectiveInRange'),
      jest.spyOn(attRepo, 'aggregateForPayrollPeriod'),
      jest.spyOn(leaveRepo, 'findOverlappingForEmployees'),
      jest.spyOn(regRepo, 'findByIds'),
    ];

    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    jest.setSystemTime(new Date(`${testYear}-02-05T10:00:00.000Z`));

    const heapBeforeMb = process.memoryUsage().heapUsed / (1024 * 1024);
    const t0 = performance.now();

    const res = await request(app!.getHttpServer())
      .get(
        `/api/v1/payroll/periods/${benchPeriod._id.toHexString()}/attendance-summary`,
      )
      .set('Cookie', authCookie)
      .expect(HttpStatus.OK);

    const totalExecutionMs = Math.round(performance.now() - t0);
    const heapAfterMb = process.memoryUsage().heapUsed / (1024 * 1024);

    const bodyData = res.body.data as PayrollPeriodAttendanceSummaryResponseDto;
    expect(bodyData.summary.totalEligibleEmployees).toBeGreaterThanOrEqual(
      1000,
    );

    const benchEmployeeResults = bodyData.employees.filter((e) =>
      e.employeeCode.startsWith(`${runTag}-M`),
    );
    expect(benchEmployeeResults).toHaveLength(1000);

    // Every repository batch method must be called AT MOST ONCE (zero N+1)
    for (const spy of spies) {
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    }

    console.info(
      JSON.stringify({
        benchmark: '1000_employees_31000_attendance_records',
        employeesSeeded: benchEmpIds.length,
        attendanceRecordsSeeded: 31000,
        totalEmployeesReturned: bodyData.employees.length,
        totalHttpExecutionMs: totalExecutionMs,
        heapDeltaMb: Number((heapAfterMb - heapBeforeMb).toFixed(2)),
        repositoryCallCounts: {
          employeeQuery: spies[0].mock.calls.length,
          branchQuery: spies[1].mock.calls.length,
          holidayQuery: spies[2].mock.calls.length,
          weeklyOffQuery: spies[3].mock.calls.length,
          attendanceAggregate: spies[4].mock.calls.length,
          leaveQuery: spies[5].mock.calls.length,
          regularizationQuery: spies[6].mock.calls.length,
        },
        mongodbExplain: {
          attendanceAggregate: {
            indexesUsed: attIndexes,
            hasCollScan:
              JSON.stringify(attendanceExplain).includes('"stage":"COLLSCAN"'),
            executionTimeMillis: attStats.executionTimeMillis,
            totalDocsExamined: attStats.totalDocsExamined,
            totalKeysExamined: attStats.totalKeysExamined,
            nReturned: attStats.nReturned,
          },
          employeeQuery: {
            indexesUsed: empIndexes,
            hasCollScan:
              JSON.stringify(employeeExplain).includes('"stage":"COLLSCAN"'),
            executionTimeMillis: empStats.executionTimeMillis,
            totalDocsExamined: empStats.totalDocsExamined,
            totalKeysExamined: empStats.totalKeysExamined,
            nReturned: empStats.nReturned,
          },
          leaveQuery: {
            indexesUsed: leaveIndexes,
            hasCollScan:
              JSON.stringify(leaveExplain).includes('"stage":"COLLSCAN"'),
            executionTimeMillis: leaveStats.executionTimeMillis,
            totalDocsExamined: leaveStats.totalDocsExamined,
            totalKeysExamined: leaveStats.totalKeysExamined,
            nReturned: leaveStats.nReturned,
          },
        },
      }),
    );

    spies.forEach((s) => s.mockRestore());
  });
});
