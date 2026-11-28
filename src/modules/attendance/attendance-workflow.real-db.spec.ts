import { HttpStatus } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import configuration from '../../config/configuration';
import { RedisModule } from '../../common/redis/redis.module';
import { RedisService } from '../../common/redis/redis.service';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import { EmploymentStatus } from '../employees/constants/employee.constant';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
  PayrollPeriodSchema,
} from '../payroll-periods/schemas/payroll-period.schema';
import { AttendanceModule } from './attendance.module';
import { AttendanceService } from './services/attendance.service';
import { Attendance, AttendanceDocument } from './schemas/attendance.schema';
import { Shift, ShiftDocument } from './schemas/shift.schema';
import {
  AttendanceRegularization,
  AttendanceRegularizationDocument,
} from './schemas/attendance-regularization.schema';
import {
  AttendanceSource,
  AttendanceStatus,
  WorkMode,
} from './constants/attendance.constant';
import { Holiday, HolidayDocument } from '../leaves/schemas/holiday.schema';
import {
  LeaveRequest,
  LeaveRequestDocument,
} from '../leaves/schemas/leave-request.schema';
import {
  LeaveType,
  LeaveTypeDocument,
} from '../leaves/schemas/leave-type.schema';
import {
  WeeklyOffConfig,
  WeeklyOffConfigDocument,
} from '../work-schedules/schemas/weekly-off-config.schema';
import {
  assertMongoSrvReachable,
  assertTestDatabaseConnection,
  PayrollAttendanceRealDbFactory,
  RealDbModels,
  resolveTestMongoUri,
  TestCleanupTracker,
} from '../payroll-periods/testing/payroll-attendance-real-db.factory';
import { ErrorCode } from '../../common/errors/error-codes';

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

describe('AttendanceService Workflow (Real MongoDB + Controlled Clocks)', () => {
  jest.setTimeout(60000);

  let moduleRef: TestingModule | null = null;
  let connection: Connection | null = null;
  let attendanceService: AttendanceService;
  let models: RealDbModels;
  let tracker: TestCleanupTracker;
  let factory: PayrollAttendanceRealDbFactory;
  let isConnected = false;

  const runTag = `AWF${Date.now().toString(36).toUpperCase()}`;

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
        MongooseModule.forFeature([
          { name: PayrollPeriod.name, schema: PayrollPeriodSchema },
        ]),
        RedisModule,
        StorageModule,
        AttendanceModule,
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

    connection = moduleRef.get<Connection>(getConnectionToken());
    assertTestDatabaseConnection(connection);

    attendanceService = moduleRef.get<AttendanceService>(AttendanceService);

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
    };

    await models.attendanceModel.syncIndexes();
    tracker = new TestCleanupTracker();
    factory = new PayrollAttendanceRealDbFactory(runTag, models, tracker);
    isConnected = true;
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
      if (moduleRef) {
        await moduleRef.close();
      }
    }
  });

  it('normal day-shift check-in and check-out updates the single day record accurately', async () => {
    const branch = await factory.createBranch({ timezone: 'Asia/Kolkata' });
    const dayShift = await factory.createShift({
      startTime: '09:00',
      endTime: '18:00',
      isOvernight: false,
      minWorkMinutesForFullDay: 480,
      minWorkMinutesForHalfDay: 240,
    });
    const userId = new Types.ObjectId();
    const emp = await factory.createEmployee({
      branchId: branch._id,
      shiftId: dayShift._id,
      userId,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
    });

    const metadata = { ipAddress: '192.168.10.10', userAgent: 'Mozilla/5.0' };

    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    // 2026-11-10 09:05 IST = 2026-11-10T03:35:00.000Z (within 15 min grace)
    jest.setSystemTime(new Date('2026-11-10T03:35:00.000Z'));

    const checkInRes = await attendanceService.checkIn(
      userId,
      { source: AttendanceSource.WEB, workMode: WorkMode.OFFICE },
      metadata,
    );
    expect(checkInRes.attendanceDate).toBe('2026-11-10');
    expect(checkInRes.status).toBe(AttendanceStatus.CHECKED_IN);
    expect(checkInRes.isLate).toBe(false);

    // 2026-11-10 18:10 IST = 2026-11-10T12:40:00.000Z (545 mins worked >= 480)
    jest.setSystemTime(new Date('2026-11-10T12:40:00.000Z'));

    const checkOutRes = await attendanceService.checkOut(userId, {}, metadata);
    expect(checkOutRes.attendanceDate).toBe('2026-11-10');
    expect(checkOutRes.status).toBe(AttendanceStatus.PRESENT);
    expect(checkOutRes.totalWorkMinutes).toBe(545);

    const docs = await models.attendanceModel
      .find({ employeeId: emp._id, deletedAt: null })
      .lean()
      .exec();
    expect(docs).toHaveLength(1);
    expect(docs[0].attendanceDate).toBe('2026-11-10');
  });

  it('overnight shift (22:00-07:00) attributes check-in to Nov 10 and next-morning check-out does not create a Nov 11 record', async () => {
    const branch = await factory.createBranch({ timezone: 'Asia/Kolkata' });
    const nightShift = await factory.createShift({
      startTime: '22:00',
      endTime: '07:00',
      isOvernight: true,
      gracePeriodMinutes: 15,
      minWorkMinutesForFullDay: 480,
      minWorkMinutesForHalfDay: 240,
      overtimeThresholdMinutes: 480,
    });
    const userId = new Types.ObjectId();
    const emp = await factory.createEmployee({
      branchId: branch._id,
      shiftId: nightShift._id,
      userId,
      dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
    });

    const metadata = { ipAddress: '192.168.10.10', userAgent: 'Mozilla/5.0' };

    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    // Check-in: Nov 10, 2026 22:00 IST = 2026-11-10T16:30:00.000Z
    jest.setSystemTime(new Date('2026-11-10T16:30:00.000Z'));
    const checkInRes = await attendanceService.checkIn(
      userId,
      { source: AttendanceSource.WEB, workMode: WorkMode.OFFICE },
      metadata,
    );
    expect(checkInRes.attendanceDate).toBe('2026-11-10');
    expect(checkInRes.status).toBe(AttendanceStatus.CHECKED_IN);

    // Check-out: Nov 11, 2026 07:00 IST = 2026-11-11T01:30:00.000Z (9 hours = 540 mins)
    jest.setSystemTime(new Date('2026-11-11T01:30:00.000Z'));
    const checkOutRes = await attendanceService.checkOut(userId, {}, metadata);
    expect(checkOutRes.attendanceDate).toBe('2026-11-10');
    expect(checkOutRes.status).toBe(AttendanceStatus.PRESENT);
    expect(checkOutRes.totalWorkMinutes).toBe(540);
    expect(checkOutRes.overtimeMinutes).toBe(60);

    const docs = await models.attendanceModel
      .find({ employeeId: emp._id, deletedAt: null })
      .lean()
      .exec();
    expect(docs).toHaveLength(1);
    expect(docs[0].attendanceDate).toBe('2026-11-10');
  });

  it('overnight shift crossing payroll month boundary attributes Nov 30 22:00 -> Dec 01 07:00 strictly to 2026-11-30', async () => {
    const branch = await factory.createBranch({ timezone: 'Asia/Kolkata' });
    const nightShift = await factory.createShift({
      startTime: '22:00',
      endTime: '07:00',
      isOvernight: true,
    });
    const userId = new Types.ObjectId();
    const emp = await factory.createEmployee({
      branchId: branch._id,
      shiftId: nightShift._id,
      userId,
    });
    const metadata = { ipAddress: '192.168.10.10', userAgent: 'Mozilla/5.0' };

    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    // Nov 30 22:00 IST = 2026-11-30T16:30:00.000Z
    jest.setSystemTime(new Date('2026-11-30T16:30:00.000Z'));
    await attendanceService.checkIn(
      userId,
      { source: AttendanceSource.WEB, workMode: WorkMode.OFFICE },
      metadata,
    );

    // Dec 01 07:00 IST = 2026-12-01T01:30:00.000Z
    jest.setSystemTime(new Date('2026-12-01T01:30:00.000Z'));
    const out = await attendanceService.checkOut(userId, {}, metadata);
    expect(out.attendanceDate).toBe('2026-11-30');
    expect(out.status).toBe(AttendanceStatus.PRESENT);

    const decRecord = await models.attendanceModel
      .findOne({ employeeId: emp._id, attendanceDate: '2026-12-01' })
      .lean()
      .exec();
    expect(decRecord).toBeNull();
  });

  it('overnight check-in after midnight (00:30 next day) resolves back to previous shift anchor date and checkout closes it cleanly', async () => {
    const branch = await factory.createBranch({ timezone: 'Asia/Kolkata' });
    const nightShift = await factory.createShift({
      startTime: '22:00',
      endTime: '07:00',
      isOvernight: true,
      gracePeriodMinutes: 15,
      minWorkMinutesForFullDay: 360,
      minWorkMinutesForHalfDay: 180,
    });
    const userId = new Types.ObjectId();
    const emp = await factory.createEmployee({
      branchId: branch._id,
      shiftId: nightShift._id,
      userId,
    });
    const metadata = { ipAddress: '192.168.10.10', userAgent: 'Mozilla/5.0' };

    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    // Nov 11 00:30 IST = 2026-11-10T19:00:00.000Z -> still belongs to Nov 10 overnight shift!
    jest.setSystemTime(new Date('2026-11-10T19:00:00.000Z'));
    const lateIn = await attendanceService.checkIn(
      userId,
      { source: AttendanceSource.WEB, workMode: WorkMode.OFFICE },
      metadata,
    );
    expect(lateIn.attendanceDate).toBe('2026-11-10');
    expect(lateIn.isLate).toBe(true);
    expect(lateIn.lateMinutes).toBe(150);

    // Checkout at Nov 11 07:00 IST = 2026-11-11T01:30:00.000Z (390 mins >= 360)
    jest.setSystemTime(new Date('2026-11-11T01:30:00.000Z'));
    const out = await attendanceService.checkOut(userId, {}, metadata);
    expect(out.attendanceDate).toBe('2026-11-10');
    expect(out.status).toBe(AttendanceStatus.PRESENT);

    const count = await models.attendanceModel.countDocuments({
      employeeId: emp._id,
      deletedAt: null,
    });
    expect(count).toBe(1);
  });

  it('prevents duplicate check-in while an overnight session remains open (CHECKED_IN)', async () => {
    const branch = await factory.createBranch({ timezone: 'Asia/Kolkata' });
    const nightShift = await factory.createShift({
      startTime: '22:00',
      endTime: '07:00',
      isOvernight: true,
    });
    const userId = new Types.ObjectId();
    await factory.createEmployee({
      branchId: branch._id,
      shiftId: nightShift._id,
      userId,
    });
    const metadata = { ipAddress: '192.168.10.10', userAgent: 'Mozilla/5.0' };

    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    jest.setSystemTime(new Date('2026-11-10T16:30:00.000Z')); // Nov 10 22:00 IST
    await attendanceService.checkIn(
      userId,
      { source: AttendanceSource.WEB, workMode: WorkMode.OFFICE },
      metadata,
    );

    // Attempt second check-in next night without checking out first
    jest.setSystemTime(new Date('2026-11-11T16:30:00.000Z')); // Nov 11 22:00 IST
    await expect(
      attendanceService.checkIn(
        userId,
        { source: AttendanceSource.WEB, workMode: WorkMode.OFFICE },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      statusCode: HttpStatus.CONFLICT,
    });
  });

  it('attributes attendanceDate according to each employee branch timezone at UTC midnight crossover', async () => {
    const branchKol = await factory.createBranch({ timezone: 'Asia/Kolkata' });
    const branchNy = await factory.createBranch({
      timezone: 'America/New_York',
    });
    const nightShift = await factory.createShift({
      startTime: '21:00',
      endTime: '06:00',
      isOvernight: true,
    });
    const dayShift = await factory.createShift({
      startTime: '07:00',
      endTime: '16:00',
      isOvernight: false,
    });

    const userKol = new Types.ObjectId();
    const userNy = new Types.ObjectId();

    await factory.createEmployee({
      branchId: branchKol._id,
      shiftId: dayShift._id,
      userId: userKol,
      employmentStatus: EmploymentStatus.ACTIVE,
    });
    await factory.createEmployee({
      branchId: branchNy._id,
      shiftId: nightShift._id,
      userId: userNy,
      employmentStatus: EmploymentStatus.ACTIVE,
    });

    const metadata = { ipAddress: '192.168.10.10', userAgent: 'Mozilla/5.0' };

    jest.useFakeTimers(FAKE_TIMERS_OPTIONS);
    // 2026-06-02T02:00:00.000Z:
    // - In Asia/Kolkata (+05:30): 2026-06-02 07:30 -> attendanceDate = '2026-06-02'
    // - In America/New_York (-04:00 EDT): 2026-06-01 22:00 -> attendanceDate = '2026-06-01'
    jest.setSystemTime(new Date('2026-06-02T02:00:00.000Z'));

    const resKol = await attendanceService.checkIn(
      userKol,
      { source: AttendanceSource.WEB, workMode: WorkMode.OFFICE },
      metadata,
    );
    const resNy = await attendanceService.checkIn(
      userNy,
      { source: AttendanceSource.WEB, workMode: WorkMode.OFFICE },
      metadata,
    );

    expect(resKol.attendanceDate).toBe('2026-06-02');
    expect(resNy.attendanceDate).toBe('2026-06-01');
  });
});
