/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
  HttpStatus,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  Attendance,
  AttendanceSchema,
  AttendanceDocument,
} from '../src/modules/attendance/schemas/attendance.schema';
import {
  Shift,
  ShiftSchema,
  ShiftDocument,
} from '../src/modules/attendance/schemas/shift.schema';
import {
  Branch,
  BranchSchema,
  BranchDocument,
} from '../src/modules/branches/schemas/branch.schema';
import {
  Employee,
  EmployeeSchema,
  EmployeeDocument,
} from '../src/modules/employees/schemas/employee.schema';
import { AttendanceModule } from '../src/modules/attendance/attendance.module';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/modules/authorization/guards/permissions.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  EmploymentStatus,
  EmploymentType,
} from '../src/modules/employees/constants/employee.constant';
import {
  AttendanceSource,
  AttendanceStatus,
} from '../src/modules/attendance/constants/attendance.constant';
import { RedisModule } from '../src/common/redis/redis.module';
import { StorageModule } from '../src/modules/storage/storage.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import configuration from '../src/config/configuration';

describe('POST /api/v1/attendance/check-in (Production Edge Cases)', () => {
  jest.setTimeout(60000);

  let app: INestApplication<App>;
  let attendanceModel: Model<AttendanceDocument>;
  let employeeModel: Model<EmployeeDocument>;
  let shiftModel: Model<ShiftDocument>;
  let branchModel: Model<BranchDocument>;

  // Authenticated test user & session identity
  const testUserId = new Types.ObjectId();
  const testSessionId = new Types.ObjectId();
  let testDepartmentId: Types.ObjectId;
  let testDesignationId: Types.ObjectId;

  // Active branch: Bangalore HQ
  const branchCoordinates = { latitude: 12.9716, longitude: 77.5946 };
  let defaultBranch: BranchDocument;
  let assignedShift: ShiftDocument;
  let defaultShift: ShiftDocument;
  let activeEmployee: EmployeeDocument;

  beforeAll(async () => {
    testDepartmentId = new Types.ObjectId();
    testDesignationId = new Types.ObjectId();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          envFilePath: '.env.test',
        }),
        RedisModule,
        StorageModule,
        MongooseModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.getOrThrow<string>('database.mongodbUri'),
          }),
        }),
        MongooseModule.forFeature([
          { name: Attendance.name, schema: AttendanceSchema },
          { name: Shift.name, schema: ShiftSchema },
          { name: Branch.name, schema: BranchSchema },
          { name: Employee.name, schema: EmployeeSchema },
        ]),
        AttendanceModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: testUserId, sessionId: testSessionId };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();

    // Replicate production main.ts pipeline
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    // Attach authenticated test user & session to incoming requests
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { userId: testUserId, sessionId: testSessionId };
      next();
    });
    // Trust reverse proxy for real client IP checks
    app.getHttpAdapter().getInstance().set('trust proxy', 1);

    await app.init();

    attendanceModel = moduleFixture.get<Model<AttendanceDocument>>(
      getModelToken(Attendance.name),
    );
    employeeModel = moduleFixture.get<Model<EmployeeDocument>>(
      getModelToken(Employee.name),
    );
    shiftModel = moduleFixture.get<Model<ShiftDocument>>(
      getModelToken(Shift.name),
    );
    branchModel = moduleFixture.get<Model<BranchDocument>>(
      getModelToken(Branch.name),
    );

    // Mandatory: Ensure WiredTiger compound unique index { employeeId: 1, attendanceDate: 1 } exists
    await attendanceModel.syncIndexes();
  }, 60000);

  beforeEach(async () => {
    // Seed standard branch with office Wi-Fi whitelist + CIDR subnet
    defaultBranch = await branchModel.create({
      name: 'Bangalore HQ Tower A',
      latitude: branchCoordinates.latitude,
      longitude: branchCoordinates.longitude,
      radiusMeters: 150,
      allowedIps: ['192.168.1.100', '10.0.0.0/24'],
      enforceIpCheck: true,
      timezone: 'Asia/Kolkata',
      isActive: true,
    });

    // Seed standard assigned shift
    assignedShift = await shiftModel.create({
      name: 'Regular Day Shift',
      code: 'REG-DAY',
      startTime: '09:00',
      endTime: '18:00',
      isOvernight: false,
      gracePeriodMinutes: 15,
      minWorkMinutesForFullDay: 480,
      minWorkMinutesForHalfDay: 240,
      overtimeThresholdMinutes: 480,
      isDefault: false,
      isActive: true,
    });

    // Seed standard company default shift
    defaultShift = await shiftModel.create({
      name: 'Company General Shift',
      code: 'GEN-DEFAULT',
      startTime: '09:30',
      endTime: '18:30',
      isOvernight: false,
      gracePeriodMinutes: 15,
      minWorkMinutesForFullDay: 480,
      minWorkMinutesForHalfDay: 240,
      overtimeThresholdMinutes: 480,
      isDefault: true,
      isActive: true,
    });

    // Seed standard active employee
    activeEmployee = await employeeModel.create({
      userId: testUserId,
      employeeCode: 'EMP-9001',
      firstName: 'Alex',
      lastName: 'Morgan',
      workEmail: 'alex.morgan@company.com',
      dateOfJoining: new Date('2022-01-01'),
      departmentId: testDepartmentId,
      designationId: testDesignationId,
      branchId: defaultBranch._id,
      shiftId: assignedShift._id,
      employmentType: EmploymentType.FULL_TIME,
      employmentStatus: EmploymentStatus.ACTIVE,
      isRemoteAllowed: false,
    });
  });

  afterEach(async () => {
    // Clean collections without dropping unique indexes
    if (attendanceModel) await attendanceModel.deleteMany({});
    if (employeeModel) await employeeModel.deleteMany({});
    if (shiftModel) await shiftModel.deleteMany({});
    if (branchModel) await branchModel.deleteMany({});
  });

  afterAll(async () => {
    if (app) await app.close();
  }, 30000);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Shift Resolution & Payload Tampering
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Shift Resolution & Payload Tampering', () => {
    it('Client Injection Ignored: should completely ignore fake/unassigned shiftId in request body and resolve assigned shift', async () => {
      const maliciousShiftId = new Types.ObjectId().toString();

      const response = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set('X-Forwarded-For', '192.168.1.100')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({
          source: AttendanceSource.WEB,
          shiftId: maliciousShiftId,
        })
        .expect(HttpStatus.CREATED);

      expect(response.body.success).toBe(true);
      expect(response.body.data.shiftSnapshot.code).toBe('REG-DAY');

      const savedAttendance = await attendanceModel.findOne({
        employeeId: activeEmployee._id,
      });
      expect(savedAttendance).toBeDefined();
      expect(savedAttendance!.shiftId.toString()).toBe(
        assignedShift._id.toString(),
      );
      expect(savedAttendance!.shiftSnapshot.code).toBe('REG-DAY');
      expect(savedAttendance!.shiftSnapshot.code).not.toBe('MALICIOUS');
    });

    it('Default Shift Fallback: should automatically resolve company isDefault: true shift when employee.shiftId is null', async () => {
      await employeeModel.updateOne(
        { _id: activeEmployee._id },
        { $set: { shiftId: null } },
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set('X-Forwarded-For', '192.168.1.100')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({ source: AttendanceSource.WEB })
        .expect(HttpStatus.CREATED);

      expect(response.body.success).toBe(true);
      expect(response.body.data.shiftSnapshot.code).toBe('GEN-DEFAULT');

      const savedAttendance = await attendanceModel.findOne({
        employeeId: activeEmployee._id,
      });
      expect(savedAttendance!.shiftId.toString()).toBe(
        defaultShift._id.toString(),
      );
      expect(savedAttendance!.shiftSnapshot.code).toBe('GEN-DEFAULT');
    });

    it('No Shift Configured (Hard Stop): should reject with HTTP 422 when employee has no shift and no default company shift exists', async () => {
      await employeeModel.updateOne(
        { _id: activeEmployee._id },
        { $set: { shiftId: null } },
      );
      await shiftModel.deleteMany({ isDefault: true });

      const response = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set('X-Forwarded-For', '192.168.1.100')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({ source: AttendanceSource.WEB })
        .expect(HttpStatus.UNPROCESSABLE_ENTITY);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      const count = await attendanceModel.countDocuments({
        employeeId: activeEmployee._id,
      });
      expect(count).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Location & Network Security Validation
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Location & Network Security Validation', () => {
    it('Mobile Geofence Pass: should allow check-in when mobile coordinates are within branch radius (50m away)', async () => {
      // 50m offset north: ~0.00045 degrees latitude
      const closeLocation = {
        latitude: 12.97205,
        longitude: 77.5946,
        accuracyMeters: 15,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set(
          'User-Agent',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        )
        .send({
          source: AttendanceSource.MOBILE,
          location: closeLocation,
          deviceInfo: { deviceId: 'iphone-prod-uuid' },
        })
        .expect(HttpStatus.CREATED);

      expect(response.body.success).toBe(true);
      expect(response.body.data.checkInSource).toBe(AttendanceSource.MOBILE);
      expect(response.body.data.checkInLocation.isGeofenceVerified).toBe(true);
      expect(
        response.body.data.checkInLocation.distanceMeters,
      ).toBeLessThanOrEqual(150);
    });

    it('Mobile Geofence Fail: should reject with HTTP 403 when mobile coordinates are outside radius (500m away)', async () => {
      // 500m offset north: ~0.0045 degrees latitude
      const farLocation = {
        latitude: 12.9761,
        longitude: 77.5946,
        accuracyMeters: 20,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set(
          'User-Agent',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        )
        .send({
          source: AttendanceSource.MOBILE,
          location: farLocation,
          deviceInfo: { deviceId: 'iphone-prod-uuid' },
        })
        .expect(HttpStatus.FORBIDDEN);

      expect(response.body.error.message).toMatch(/away from Bangalore HQ/i);
      const count = await attendanceModel.countDocuments({
        employeeId: activeEmployee._id,
      });
      expect(count).toBe(0);
    });

    it('Weak GPS Accuracy Rejection: should reject mobile punch with HTTP 400 when accuracyMeters > 100m', async () => {
      const weakGpsLocation = {
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 140, // Cell tower lock
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set('User-Agent', 'Mozilla/5.0 (Linux; Android 14; Pixel 8)')
        .send({
          source: AttendanceSource.MOBILE,
          location: weakGpsLocation,
          deviceInfo: { deviceId: 'android-pixel-id' },
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.error.message).toMatch(/GPS signal is too weak/i);
    });

    it('Web IP Whitelist CIDR Subnet Enforcement: should allow authorized subnet IP (10.0.0.45) and reject unauthorized external IP with HTTP 403', async () => {
      // 1. Authorized CIDR subnet IP (10.0.0.45 matches 10.0.0.0/24)
      const allowedRes = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set('X-Forwarded-For', '10.0.0.45')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({ source: AttendanceSource.WEB })
        .expect(HttpStatus.CREATED);

      expect(allowedRes.body.data.checkInLocation.isIpVerified).toBe(true);

      // Clean attendance record for second test
      await attendanceModel.deleteMany({});

      // 2. Unauthorized public ISP IP (203.0.113.88)
      const blockedRes = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set('X-Forwarded-For', '203.0.113.88')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({ source: AttendanceSource.WEB })
        .expect(HttpStatus.FORBIDDEN);

      expect(blockedRes.body.error.message).toMatch(
        /Web punch-in restricted to office Wi-Fi network/i,
      );
    });

    it('Unauthorized WFH Attempt: should reject with HTTP 403 when workMode is WFH but employee.isRemoteAllowed is false', async () => {
      expect(activeEmployee.isRemoteAllowed).toBe(false);

      const response = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set('X-Forwarded-For', '203.0.113.88')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({ workMode: 'WORK_FROM_HOME' })
        .expect(HttpStatus.FORBIDDEN);

      expect(response.body.error.message).toMatch(
        /Remote work.*is not authorized/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Concurrency, Race Conditions & Double-Tap Protection
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Concurrency, Race Conditions & Double-Tap Protection', () => {
    it('True Race Condition (Promise.all): simultaneous check-in requests must result in exactly ONE 201 and ONE 409 via MongoDB WiredTiger unique index', async () => {
      const payload = { source: AttendanceSource.WEB };
      const reqHeaders = {
        'X-Forwarded-For': '192.168.1.100',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      };

      // Fire 2 concurrent HTTP requests simultaneously hitting the NestJS pipeline
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/attendance/check-in')
          .set(reqHeaders)
          .send(payload),
        request(app.getHttpServer())
          .post('/api/v1/attendance/check-in')
          .set(reqHeaders)
          .send(payload),
      ]);

      const statusCodes = [res1.status, res2.status].sort();

      // Exactly ONE request wins the lock (201), the other is rejected by MongoDB E11000 (409)
      expect(statusCodes).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT]);

      // Verify database state: strictly 1 attendance document created
      const totalRecords = await attendanceModel.countDocuments({
        employeeId: activeEmployee._id,
      });
      expect(totalRecords).toBe(1);
    });

    it('Multi-Punch Cooldown: should reject check-out attempted within 60 seconds of check-in', async () => {
      // 1. Initial successful check-in
      await request(app.getHttpServer())
        .post('/api/v1/attendance/check-in')
        .set('X-Forwarded-For', '192.168.1.100')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({ source: AttendanceSource.WEB })
        .expect(HttpStatus.CREATED);

      // 2. Immediate check-out attempt (within 60s cooldown threshold)
      const cooldownRes = await request(app.getHttpServer())
        .post('/api/v1/attendance/check-out')
        .set('X-Forwarded-For', '192.168.1.100')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .send({})
        .expect(HttpStatus.BAD_REQUEST);

      expect(cooldownRes.body.error.message).toMatch(
        /Cannot check out within 60 seconds/i,
      );

      // Verify status remains CHECKED_IN
      const currentDoc = await attendanceModel.findOne({
        employeeId: activeEmployee._id,
      });
      expect(currentDoc!.status).toBe(AttendanceStatus.CHECKED_IN);
    });
  });
});
