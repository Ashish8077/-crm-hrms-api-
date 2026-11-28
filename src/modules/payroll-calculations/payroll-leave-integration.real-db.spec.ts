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
import { AttendanceRepository } from '../attendance/repositories/attendance.repository';
import {
  AttendanceRegularization,
  AttendanceRegularizationDocument,
} from '../attendance/schemas/attendance-regularization.schema';
import {
  Attendance,
  AttendanceDocument,
} from '../attendance/schemas/attendance.schema';
import { Shift, ShiftDocument } from '../attendance/schemas/shift.schema';
import { AuthModule } from '../auth/auth.module';
import { ACCESS_TOKEN_COOKIE } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Session, SessionDocument } from '../auth/schemas/session.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { EmployeeSalaryStatus } from '../employee-salaries/constants/employee-salary.constant';
import {
  EmployeeSalary,
  EmployeeSalaryDocument,
} from '../employee-salaries/schemas/employee-salary.schema';
import { EmployeeSalaryRepository } from '../employee-salaries/repositories/employee-salary.repository';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import { LeaveRequestStatus } from '../leaves/constants/leaves.constant';
import { LeaveRequestRepository } from '../leaves/repositories/leave-request.repository';
import { Holiday, HolidayDocument } from '../leaves/schemas/holiday.schema';
import { HolidayRepository } from '../leaves/repositories/holiday.repository';
import {
  LeaveBalance,
  LeaveBalanceDocument,
} from '../leaves/schemas/leave-balance.schema';
import {
  LeaveRequest,
  LeaveRequestDocument,
} from '../leaves/schemas/leave-request.schema';
import {
  LeaveTransaction,
  LeaveTransactionDocument,
} from '../leaves/schemas/leave-transaction.schema';
import {
  LeaveType,
  LeaveTypeDocument,
} from '../leaves/schemas/leave-type.schema';
import {
  NegativeNetPayPolicy,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../payroll-configuration/constants/payroll-configuration.constant';
import {
  PayrollCalculationRule,
  PayrollCalculationRuleDocument,
} from '../payroll-configuration/schemas/payroll-calculation-rule.schema';
import {
  PayrollSettings,
  PayrollSettingsDocument,
} from '../payroll-configuration/schemas/payroll-settings.schema';
import { PayrollPeriodStatus } from '../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodsModule } from '../payroll-periods/payroll-periods.module';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
} from '../payroll-periods/schemas/payroll-period.schema';
import {
  assertMongoSrvReachable,
  assertTestDatabaseConnection,
  PayrollAttendanceRealDbFactory,
  RealDbModels,
  resolveTestMongoUri,
  TestCleanupTracker,
} from '../payroll-periods/testing/payroll-attendance-real-db.factory';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  Permission,
  PermissionDocument,
} from '../permissions/schemas/permission.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import {
  SalaryComponent,
  SalaryComponentDocument,
} from '../salary-components/schemas/salary-component.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../salary-structures/constants/salary-structure.constant';
import { SalaryStructureRepository } from '../salary-structures/repositories/salary-structure.repository';
import {
  SalaryStructure,
  SalaryStructureDocument,
} from '../salary-structures/schemas/salary-structure.schema';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  WeeklyOffConfig,
  WeeklyOffConfigDocument,
} from '../work-schedules/schemas/weekly-off-config.schema';
import { WeeklyOffConfigRepository } from '../work-schedules/repositories/weekly-off-config.repository';
import { PayrollCalculationsModule } from './payroll-calculations.module';
import {
  PayrollRecord,
  PayrollRecordDocument,
} from './schemas/payroll-record.schema';
import { PayrollInputResolver } from './services/payroll-input.resolver';

function getWeekdaysInMonth(year: number, month: number): string[] {
  const result: string[] = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      result.push(
        `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      );
    }
  }
  return result;
}

describe('Payroll Leave & Attendance Integration — Real MongoDB E2E & 1,000-Employee Benchmark', () => {
  jest.setTimeout(300000);

  let app: INestApplication<App> | null = null;
  let moduleRef: TestingModule | null = null;
  let connection: Connection | null = null;
  let models!: RealDbModels;
  let tracker!: TestCleanupTracker;
  let factory!: PayrollAttendanceRealDbFactory;
  let isConnected = false;

  let salaryComponentModel!: Model<SalaryComponentDocument>;
  let salaryStructureModel!: Model<SalaryStructureDocument>;
  let employeeSalaryModel!: Model<EmployeeSalaryDocument>;
  let payrollSettingsModel!: Model<PayrollSettingsDocument>;
  let payrollRuleModel!: Model<PayrollCalculationRuleDocument>;
  let payrollRecordModel!: Model<PayrollRecordDocument>;
  let leaveBalanceModel!: Model<LeaveBalanceDocument>;
  let leaveTransactionModel!: Model<LeaveTransactionDocument>;

  const runTag = `S42${Date.now().toString(36).toUpperCase()}`;
  const createdComponentIds: Types.ObjectId[] = [];
  const createdStructureIds: Types.ObjectId[] = [];
  const createdAssignmentIds: Types.ObjectId[] = [];
  const createdPayrollRecordIds: Types.ObjectId[] = [];
  let createdSettingsId: Types.ObjectId | null = null;
  let createdRuleId: Types.ObjectId | null = null;
  let prevSettingsState: {
    id: Types.ObjectId;
    currency: string;
    fixedWorkingDaysPerMonth: number | null;
  } | null = null;
  let prevRuleState: {
    id: Types.ObjectId;
    roundingMode: PayrollRoundingMode;
    roundingPrecision: number;
    prorationPolicy: PayrollProrationPolicy;
    prorateFixedComponents: boolean;
    prorateDeductions: boolean;
    prorateEmployerContributions: boolean;
    negativeNetPayPolicy: NegativeNetPayPolicy;
    componentExecutionOrder: string[];
  } | null = null;

  let testYear!: number;
  let periodStartStr!: string;
  let periodEndStr!: string;
  let period!: PayrollPeriodDocument;
  let branch!: BranchDocument;
  let shift!: ShiftDocument;
  let paidLeaveType!: LeaveTypeDocument;
  let unpaidLeaveType!: LeaveTypeDocument;
  let structure!: SalaryStructureDocument;
  let authCookie!: string;
  let limitedAuthCookie!: string;
  let actorUserId!: Types.ObjectId;

  const ensureSalaryComponent = async (
    code: string,
    name: string,
    type: SalaryComponentType,
  ): Promise<SalaryComponentDocument> => {
    const existing = await salaryComponentModel.findOne({ code }).exec();
    if (existing) return existing;
    const created = await salaryComponentModel.create({
      name,
      code,
      type,
      calculationType: null,
      percentageOf: null,
      isTaxable: true,
      isStatutory: false,
      isActive: true,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    createdComponentIds.push(created._id);
    return created;
  };

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
        PayrollCalculationsModule,
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

    salaryComponentModel = moduleRef.get(getModelToken(SalaryComponent.name));
    salaryStructureModel = moduleRef.get(getModelToken(SalaryStructure.name));
    employeeSalaryModel = moduleRef.get(getModelToken(EmployeeSalary.name));
    payrollSettingsModel = moduleRef.get(getModelToken(PayrollSettings.name));
    payrollRuleModel = moduleRef.get(
      getModelToken(PayrollCalculationRule.name),
    );
    payrollRecordModel = moduleRef.get(getModelToken(PayrollRecord.name));
    leaveBalanceModel = moduleRef.get(getModelToken(LeaveBalance.name));
    leaveTransactionModel = moduleRef.get(getModelToken(LeaveTransaction.name));

    await Promise.all([
      models.attendanceModel.syncIndexes(),
      models.payrollPeriodModel.syncIndexes(),
      models.leaveRequestModel.syncIndexes(),
      payrollRecordModel.syncIndexes(),
      employeeSalaryModel.syncIndexes(),
    ]);

    tracker = new TestCleanupTracker();
    factory = new PayrollAttendanceRealDbFactory(runTag, models, tracker);
    isConnected = true;

    testYear = await factory.findUnusedFutureYear(2080, 2099);
    // April of future testYear (30 days)
    periodStartStr = `${testYear}-04-01`;
    periodEndStr = `${testYear}-04-30`;

    branch = await factory.createBranch({
      name: `${runTag} Branch`,
      timezone: 'Asia/Kolkata',
    });
    shift = await factory.createShift();

    // Mon-Fri working week ([0, 6] weekly off)
    await factory.createWeeklyOffConfig({
      branchId: branch._id,
      days: [
        { dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] },
        { dayOfWeek: 6, occurrences: [1, 2, 3, 4, 5] },
      ],
      effectiveFrom: `${testYear}-01-01`,
      effectiveTo: null,
    });

    period = await factory.createPayrollPeriod({
      year: testYear,
      month: 4,
      startDate: new Date(`${periodStartStr}T00:00:00.000Z`),
      endDate: new Date(`${periodEndStr}T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-05-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });

    paidLeaveType = await factory.createLeaveType({
      code: `${runTag}CL`,
      name: 'Paid Casual Leave',
      isPaid: true,
      allowHalfDay: true,
      deductWeekends: false,
      deductHolidays: false,
    });
    unpaidLeaveType = await factory.createLeaveType({
      code: `${runTag}LWP`,
      name: 'Unpaid LWP',
      isPaid: false,
      allowHalfDay: true,
      deductWeekends: false,
      deductHolidays: false,
    });

    const jwtService = new JwtService({
      secret: moduleRef.get(ConfigService).getOrThrow<string>('jwt.secret'),
      signOptions: { algorithm: 'HS256' },
    });

    const adminActor = await factory.createUserWithRole([
      PermissionKeys.PAYROLL_CALCULATIONS_VIEW,
      PermissionKeys.PAYROLL_CALCULATIONS_CREATE,
    ]);
    const adminToken = await jwtService.signAsync({
      sub: adminActor.user._id.toHexString(),
      sid: adminActor.session._id.toHexString(),
      type: 'access',
    });
    authCookie = `${ACCESS_TOKEN_COOKIE}=${adminToken}`;
    actorUserId = adminActor.user._id;

    const viewerActor = await factory.createUserWithRole([
      PermissionKeys.PAYROLL_CALCULATIONS_VIEW,
    ]);
    const viewerToken = await jwtService.signAsync({
      sub: viewerActor.user._id.toHexString(),
      sid: viewerActor.session._id.toHexString(),
      type: 'access',
    });
    limitedAuthCookie = `${ACCESS_TOKEN_COOKIE}=${viewerToken}`;

    // Temporarily ensure deterministic active settings & rule (CALENDAR_DAYS, rounding precision 2)
    // Respect singletonKey uniqueness by updating existing singleton if present and restoring in afterAll.
    const existingSettings = await payrollSettingsModel
      .findOne({})
      .lean()
      .exec();
    if (existingSettings) {
      prevSettingsState = {
        id: existingSettings._id,
        currency: existingSettings.currency,
        fixedWorkingDaysPerMonth:
          existingSettings.fixedWorkingDaysPerMonth ?? null,
      };
      await payrollSettingsModel.updateOne(
        { _id: existingSettings._id },
        {
          $set: {
            currency: 'INR',
            fixedWorkingDaysPerMonth: 22,
          },
        },
      );
    } else {
      const createdSettings = await payrollSettingsModel.create({
        currency: 'INR',
        fixedWorkingDaysPerMonth: 22,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      });
      createdSettingsId = createdSettings._id;
    }

    const existingRule = await payrollRuleModel.findOne({}).lean().exec();
    if (existingRule) {
      prevRuleState = {
        id: existingRule._id,
        roundingMode: existingRule.roundingMode,
        roundingPrecision: existingRule.roundingPrecision,
        prorationPolicy: existingRule.prorationPolicy,
        prorateFixedComponents: existingRule.prorateFixedComponents,
        prorateDeductions: existingRule.prorateDeductions,
        prorateEmployerContributions:
          existingRule.prorateEmployerContributions ?? false,
        negativeNetPayPolicy: existingRule.negativeNetPayPolicy,
        componentExecutionOrder: existingRule.componentExecutionOrder ?? [],
      };
      await payrollRuleModel.updateOne(
        { _id: existingRule._id },
        {
          $set: {
            roundingMode: PayrollRoundingMode.HALF_EVEN,
            roundingPrecision: 2,
            prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
            prorateFixedComponents: true,
            prorateDeductions: false,
            prorateEmployerContributions: false,
            negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
            componentExecutionOrder: [],
          },
        },
      );
    } else {
      const createdRule = await payrollRuleModel.create({
        roundingMode: PayrollRoundingMode.HALF_EVEN,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: false,
        prorateEmployerContributions: false,
        negativeNetPayPolicy: NegativeNetPayPolicy.REJECT,
        componentExecutionOrder: [],
        createdBy: actorUserId,
        updatedBy: actorUserId,
      });
      createdRuleId = createdRule._id;
    }

    const basicComp = await ensureSalaryComponent(
      'BASIC',
      'Basic Pay',
      SalaryComponentType.EARNING,
    );
    const hraComp = await ensureSalaryComponent(
      'HRA',
      'House Rent Allowance',
      SalaryComponentType.EARNING,
    );
    const pfComp = await ensureSalaryComponent(
      'PF_EE',
      'Employee PF',
      SalaryComponentType.EMPLOYEE_DEDUCTION,
    );

    structure = await salaryStructureModel.create({
      name: `${runTag} Structure`,
      code: `${runTag}_STR`,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 30000,
      isActive: true,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      components: [
        {
          componentId: basicComp._id,
          calculationType: StructureComponentCalculationType.FIXED,
          amount: 20000,
          percentage: null,
          percentageOf: null,
        },
        {
          componentId: hraComp._id,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 50,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
        {
          componentId: pfComp._id,
          calculationType: StructureComponentCalculationType.PERCENTAGE,
          amount: null,
          percentage: 12,
          percentageOf: StructureComponentPercentageBasis.BASIC,
        },
      ],
    });
    createdStructureIds.push(structure._id);
  }, 300000);

  afterAll(async () => {
    try {
      if (isConnected && connection) {
        if (createdPayrollRecordIds.length > 0) {
          await payrollRecordModel.deleteMany({
            _id: { $in: createdPayrollRecordIds },
          });
        }
        if (createdAssignmentIds.length > 0) {
          await employeeSalaryModel.deleteMany({
            _id: { $in: createdAssignmentIds },
          });
        }
        if (createdStructureIds.length > 0) {
          await salaryStructureModel.deleteMany({
            _id: { $in: createdStructureIds },
          });
        }
        if (createdComponentIds.length > 0) {
          await salaryComponentModel.deleteMany({
            _id: { $in: createdComponentIds },
          });
        }
        if (createdSettingsId) {
          await payrollSettingsModel.deleteOne({ _id: createdSettingsId });
        }
        if (prevSettingsState) {
          await payrollSettingsModel.updateOne(
            { _id: prevSettingsState.id },
            {
              $set: {
                currency: prevSettingsState.currency,
                fixedWorkingDaysPerMonth:
                  prevSettingsState.fixedWorkingDaysPerMonth,
              },
            },
          );
        }
        if (createdRuleId) {
          await payrollRuleModel.deleteOne({ _id: createdRuleId });
        }
        if (prevRuleState) {
          await payrollRuleModel.updateOne(
            { _id: prevRuleState.id },
            {
              $set: {
                roundingMode: prevRuleState.roundingMode,
                roundingPrecision: prevRuleState.roundingPrecision,
                prorationPolicy: prevRuleState.prorationPolicy,
                prorateFixedComponents: prevRuleState.prorateFixedComponents,
                prorateDeductions: prevRuleState.prorateDeductions,
                prorateEmployerContributions:
                  prevRuleState.prorateEmployerContributions,
                negativeNetPayPolicy: prevRuleState.negativeNetPayPolicy,
                componentExecutionOrder: prevRuleState.componentExecutionOrder,
              },
            },
          );
        }
        await tracker.cleanupAll(connection, models);
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  }, 300000);

  const assignSalary = async (employeeId: Types.ObjectId) => {
    const doc = await employeeSalaryModel.create({
      employeeId,
      salaryStructureId: structure._id,
      effectiveFrom: new Date(`${testYear}-01-01T00:00:00.000Z`),
      effectiveTo: null,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 30000,
      salaryStructureVersion: 0,
      salarySnapshot: {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        inputSalaryAmount: 30000,
        grossSalaryMonthly: 30000,
        grossSalaryAnnual: 360000,
        totalEmployerContributionsMonthly: 0,
        totalEmployerContributionsAnnual: 0,
        totalCtcMonthly: 30000,
        totalCtcAnnual: 360000,
        totalEmployeeDeductionsMonthly: 2400,
        totalEmployeeDeductionsAnnual: 28800,
        estimatedNetSalaryMonthly: 27600,
        estimatedNetSalaryAnnual: 331200,
        summary: {
          monthly: {
            grossSalary: 30000,
            employerContributions: 0,
            totalCtc: 30000,
            employeeDeductions: 2400,
            estimatedNetSalary: 27600,
          },
          annual: {
            grossSalary: 360000,
            employerContributions: 0,
            totalCtc: 360000,
            employeeDeductions: 28800,
            estimatedNetSalary: 331200,
          },
        },
        earnings: [],
        employeeDeductions: [],
        employerContributions: [],
      },
      status: EmployeeSalaryStatus.ACTIVE,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    createdAssignmentIds.push(doc._id);
    return doc;
  };

  it('calculates real-DB payroll with paid leave, unpaid leave, half-day leave, overlap no-double-deduction, preview zero writes, recalculation, RBAC, and tamper rejection', async () => {
    const emp = await factory.createEmployee({
      branchId: branch._id,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
    });
    await assignSalary(emp._id);

    const aprilWeekdays = getWeekdaysInMonth(testYear, 4);

    // Seed leaves in real MongoDB using guaranteed Mon-Fri weekdays:
    // 1. Approved Paid CL: 2 working days (0 LOP)
    await factory.createLeaveRequest({
      employeeId: emp._id,
      leaveType: paidLeaveType,
      startDate: aprilWeekdays[0],
      endDate: aprilWeekdays[0],
      totalDays: 1,
      status: LeaveRequestStatus.APPROVED,
    });
    await factory.createLeaveRequest({
      employeeId: emp._id,
      leaveType: paidLeaveType,
      startDate: aprilWeekdays[1],
      endDate: aprilWeekdays[1],
      totalDays: 1,
      status: LeaveRequestStatus.APPROVED,
    });

    // 2. Approved Unpaid LWP + ABSENT overlap on same weekday (MUST be 1 LOP, never 2)
    await factory.createLeaveRequest({
      employeeId: emp._id,
      leaveType: unpaidLeaveType,
      startDate: aprilWeekdays[2],
      endDate: aprilWeekdays[2],
      totalDays: 1,
      status: LeaveRequestStatus.APPROVED,
    });
    await factory.createAttendance({
      employeeId: emp._id,
      attendanceDate: aprilWeekdays[2],
      shift,
      status: AttendanceStatus.ABSENT,
    });

    // 3. Half-day unpaid LWP on next weekday (0.5 LOP)
    await factory.createLeaveRequest({
      employeeId: emp._id,
      leaveType: unpaidLeaveType,
      startDate: aprilWeekdays[3],
      endDate: aprilWeekdays[3],
      totalDays: 0.5,
      isHalfDay: true,
      status: LeaveRequestStatus.APPROVED,
    });

    // 4. Pending LWP on next 2 weekdays (must be ignored until approved!)
    const pendingLeave1 = await factory.createLeaveRequest({
      employeeId: emp._id,
      leaveType: unpaidLeaveType,
      startDate: aprilWeekdays[4],
      endDate: aprilWeekdays[4],
      totalDays: 1,
      status: LeaveRequestStatus.PENDING,
    });
    const pendingLeave2 = await factory.createLeaveRequest({
      employeeId: emp._id,
      leaveType: unpaidLeaveType,
      startDate: aprilWeekdays[5],
      endDate: aprilWeekdays[5],
      totalDays: 1,
      status: LeaveRequestStatus.PENDING,
    });

    const beforeRecordsCount = await payrollRecordModel.countDocuments({
      payrollPeriodId: period._id,
      employeeId: emp._id,
    });
    const beforeTxCount = await leaveTransactionModel.countDocuments({
      employeeId: emp._id,
    });
    const beforeBalCount = await leaveBalanceModel.countDocuments({
      employeeId: emp._id,
    });

    // A. RBAC 401 & 403 + tamper rejection
    await request(app!.getHttpServer())
      .post('/api/v1/payroll/calculations/preview')
      .send({
        payrollPeriodId: period._id.toHexString(),
        employeeId: emp._id.toHexString(),
      })
      .expect(HttpStatus.UNAUTHORIZED);

    await request(app!.getHttpServer())
      .post('/api/v1/payroll/calculations/employee')
      .set('Cookie', limitedAuthCookie)
      .send({
        payrollPeriodId: period._id.toHexString(),
        employeeId: emp._id.toHexString(),
      })
      .expect(HttpStatus.FORBIDDEN);

    await request(app!.getHttpServer())
      .post('/api/v1/payroll/calculations/preview')
      .set('Cookie', authCookie)
      .send({
        payrollPeriodId: period._id.toHexString(),
        employeeId: emp._id.toHexString(),
        payableDays: 30,
      })
      .expect(HttpStatus.BAD_REQUEST);

    // B. Preview -> 1.5 total LOP (1 + 0.5), 28.5 payable days, Gross = 28,500.00, ZERO DB writes!
    const previewRes = await request(app!.getHttpServer())
      .post('/api/v1/payroll/calculations/preview')
      .set('Cookie', authCookie)
      .send({
        payrollPeriodId: period._id.toHexString(),
        employeeId: emp._id.toHexString(),
      })
      .expect(HttpStatus.OK);

    expect(previewRes.body.data.persisted).toBe(false);
    expect(previewRes.body.data.snapshot.paidLeaveDays).toBe(2);
    expect(previewRes.body.data.snapshot.unpaidLeaveDays).toBe(1.5);
    expect(previewRes.body.data.snapshot.attendanceAbsenceLopDays).toBe(0);
    expect(previewRes.body.data.snapshot.totalLopDays).toBe(1.5);
    expect(previewRes.body.data.snapshot.payableDays).toBe(28.5);
    expect(previewRes.body.data.snapshot.grossEarnings).toBe('28500.00');
    expect(previewRes.body.data.snapshot.netSalary).toBe('26100.00');

    expect(
      await payrollRecordModel.countDocuments({
        payrollPeriodId: period._id,
        employeeId: emp._id,
      }),
    ).toBe(beforeRecordsCount);
    expect(
      await leaveTransactionModel.countDocuments({ employeeId: emp._id }),
    ).toBe(beforeTxCount);
    expect(
      await leaveBalanceModel.countDocuments({ employeeId: emp._id }),
    ).toBe(beforeBalCount);

    // C. Persist calculation
    const calcRes = await request(app!.getHttpServer())
      .post('/api/v1/payroll/calculations/employee')
      .set('Cookie', authCookie)
      .send({
        payrollPeriodId: period._id.toHexString(),
        employeeId: emp._id.toHexString(),
      })
      .expect(HttpStatus.CREATED);

    createdPayrollRecordIds.push(
      new Types.ObjectId(String(calcRes.body.data.id)),
    );
    expect(calcRes.body.data.calculationVersion).toBe(1);
    expect(calcRes.body.data.netSalary).toBe('26100.00');

    // D. Approve previously PENDING 2-day LWP and recalculate -> 3.5 total LOP, 26.5 payable days, Gross 26,500, Net 24,100
    await models.leaveRequestModel.updateMany(
      { _id: { $in: [pendingLeave1._id, pendingLeave2._id] } },
      { $set: { status: LeaveRequestStatus.APPROVED } },
    );

    const recalcRes = await request(app!.getHttpServer())
      .post('/api/v1/payroll/calculations/employee')
      .set('Cookie', authCookie)
      .send({
        payrollPeriodId: period._id.toHexString(),
        employeeId: emp._id.toHexString(),
        recalculate: true,
      })
      .expect(HttpStatus.CREATED);

    expect(recalcRes.body.data.id).toBe(calcRes.body.data.id);
    expect(recalcRes.body.data.calculationVersion).toBe(2);
    expect(recalcRes.body.data.calculationSnapshot.totalLopDays).toBe(3.5);
    expect(recalcRes.body.data.calculationSnapshot.payableDays).toBe(26.5);
    expect(recalcRes.body.data.grossEarnings).toBe('26500.00');
    expect(recalcRes.body.data.netSalary).toBe('24100.00');

    // Verify zero writes to LeaveBalance or LeaveTransaction after calculate + recalculate
    expect(
      await leaveTransactionModel.countDocuments({ employeeId: emp._id }),
    ).toBe(beforeTxCount);
    expect(
      await leaveBalanceModel.countDocuments({ employeeId: emp._id }),
    ).toBe(beforeBalCount);
  });

  it('executes 1,000-employee / 31,000-record leave + attendance batch resolution using O(1) indexed MongoDB queries without N+1', async () => {
    const batchYear = await factory.findUnusedFutureYear(testYear + 1, 2199);
    const janStart = `${batchYear}-01-01`;
    const janEnd = `${batchYear}-01-31`;
    const benchPeriod = await factory.createPayrollPeriod({
      year: batchYear,
      month: 1,
      startDate: new Date(`${janStart}T00:00:00.000Z`),
      endDate: new Date(`${janEnd}T00:00:00.000Z`),
      paymentDate: new Date(`${batchYear}-02-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });

    const deptId = new Types.ObjectId();
    const desigId = new Types.ObjectId();
    const now = new Date();
    const empDocs = Array.from({ length: 1000 }, (_, i) => ({
      userId: null,
      employeeCode: `${runTag}-B${String(i).padStart(4, '0')}`,
      firstName: `Bench`,
      lastName: `Emp${i}`,
      workEmail: `${runTag.toLowerCase()}-b${i}@bench.example.com`,
      dateOfJoining: new Date('2024-01-01T00:00:00.000Z'),
      lastWorkingDate: null,
      terminationDate: null,
      branchId: branch._id,
      departmentId: deptId,
      designationId: desigId,
      shiftId: shift._id,
      employmentType: EmploymentType.FULL_TIME,
      employmentStatus: EmploymentStatus.ACTIVE,
      isRemoteAllowed: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
    const insertedEmps =
      await models.employeeModel.collection.insertMany(empDocs);
    const benchEmpIds = Object.values(
      insertedEmps.insertedIds,
    ) as Types.ObjectId[];
    for (const id of benchEmpIds) tracker.track('employeeIds', id);

    // 1,000 salary assignments
    const assignDocs = benchEmpIds.map((empId) => ({
      employeeId: empId,
      salaryStructureId: structure._id,
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
      effectiveTo: null,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 30000,
      salaryStructureVersion: 0,
      salarySnapshot: {
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        inputSalaryAmount: 30000,
        grossSalaryMonthly: 30000,
        grossSalaryAnnual: 360000,
        totalEmployerContributionsMonthly: 0,
        totalEmployerContributionsAnnual: 0,
        totalCtcMonthly: 30000,
        totalCtcAnnual: 360000,
        totalEmployeeDeductionsMonthly: 2400,
        totalEmployeeDeductionsAnnual: 28800,
        estimatedNetSalaryMonthly: 27600,
        estimatedNetSalaryAnnual: 331200,
        summary: {
          monthly: {
            grossSalary: 30000,
            employerContributions: 0,
            totalCtc: 30000,
            employeeDeductions: 2400,
            estimatedNetSalary: 27600,
          },
          annual: {
            grossSalary: 360000,
            employerContributions: 0,
            totalCtc: 360000,
            employeeDeductions: 28800,
            estimatedNetSalary: 331200,
          },
        },
        earnings: [],
        employeeDeductions: [],
        employerContributions: [],
      },
      status: EmployeeSalaryStatus.ACTIVE,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    }));
    for (let s = 0; s < assignDocs.length; s += 250) {
      const slice = assignDocs.slice(s, s + 250);
      const res = await employeeSalaryModel.insertMany(slice, {
        ordered: false,
      });
      for (const doc of res) {
        createdAssignmentIds.push(doc._id);
      }
    }

    // 31,000 attendance docs (chunked 200 employees at a time)
    const dates = Array.from(
      { length: 31 },
      (_, d) => `${batchYear}-01-${String(d + 1).padStart(2, '0')}`,
    );
    const shiftSnapshot = {
      name: shift.name,
      code: shift.code,
      startTime: shift.startTime,
      endTime: shift.endTime,
      isOvernight: shift.isOvernight,
      gracePeriodMinutes: shift.gracePeriodMinutes,
      breakDurationMinutes: shift.breakDurationMinutes,
      minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
      minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
      timezone: branch.timezone,
    };

    const janWeekdays = getWeekdaysInMonth(batchYear, 1);
    const targetLeaveDate = janWeekdays[0];
    const targetAbsentIdx = dates.indexOf(targetLeaveDate);

    for (let start = 0; start < benchEmpIds.length; start += 200) {
      const slice = benchEmpIds.slice(start, start + 200);
      const batch = slice.flatMap((empId, idx) =>
        dates.map((dStr, dIdx) => ({
          employeeId: empId,
          attendanceDate: dStr,
          date: new Date(`${dStr}T00:00:00.000Z`),
          shiftId: shift._id,
          shiftSnapshot,
          status:
            dIdx === targetAbsentIdx && (start + idx) % 10 === 0
              ? AttendanceStatus.ABSENT
              : AttendanceStatus.PRESENT,
          source: 'WEB',
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
          deletedBy: null,
          breaks: [],
          createdAt: now,
          updatedAt: now,
        })),
      );
      await models.attendanceModel.collection.insertMany(batch, {
        ordered: false,
      });
    }

    const leaveDocs = Array.from({ length: 1000 }, (_, i) => {
      const empId = benchEmpIds[i];
      return {
        employeeId: empId,
        leaveTypeId: i % 2 === 0 ? unpaidLeaveType._id : paidLeaveType._id,
        leaveTypeSnapshot: {
          name: i % 2 === 0 ? unpaidLeaveType.name : paidLeaveType.name,
          code: i % 2 === 0 ? unpaidLeaveType.code : paidLeaveType.code,
          isPaid: i % 2 !== 0,
          allowHalfDay: true,
          deductWeekends: false,
          deductHolidays: false,
        },
        startDate: targetLeaveDate, // overlaps ABSENT day for i % 10 === 0!
        endDate: targetLeaveDate,
        totalDays: 1,
        isHalfDay: false,
        halfDaySession: null,
        excludedDates: [],
        yearBreakdown: [],
        reason: 'Bench LWP',
        status:
          i % 4 === 3
            ? LeaveRequestStatus.PENDING
            : LeaveRequestStatus.APPROVED,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    });
    const insertedLeaves =
      await models.leaveRequestModel.collection.insertMany(leaveDocs);
    for (const id of Object.values(
      insertedLeaves.insertedIds,
    ) as Types.ObjectId[]) {
      tracker.track('leaveRequestIds', id);
    }

    // Index explain check on LeaveRequest & Attendance
    const leaveExplain = await models.leaveRequestModel
      .find({
        status: {
          $in: [
            LeaveRequestStatus.APPROVED,
            LeaveRequestStatus.CANCELLATION_REQUESTED,
          ],
        },
        startDate: { $lte: janEnd },
        endDate: { $gte: janStart },
        deletedAt: null,
        employeeId: { $in: benchEmpIds },
      })
      .explain('executionStats');
    expect(JSON.stringify(leaveExplain)).not.toContain('"stage":"COLLSCAN"');

    // Spy on repositories to prove O(1) constant query count for 1,000 employees
    const inputResolver = moduleRef!.get(PayrollInputResolver);
    const leaveRepo = moduleRef!.get(LeaveRequestRepository);
    const attRepo = moduleRef!.get(AttendanceRepository);
    const empSalaryRepo = moduleRef!.get(EmployeeSalaryRepository);
    const structRepo = moduleRef!.get(SalaryStructureRepository);
    const branchRepo = moduleRef!.get(BranchRepository);
    const holidayRepo = moduleRef!.get(HolidayRepository);
    const weeklyOffRepo = moduleRef!.get(WeeklyOffConfigRepository);

    const spies = [
      jest.spyOn(leaveRepo, 'findOverlappingForEmployees'),
      jest.spyOn(attRepo, 'aggregateForPayrollPeriod'),
      jest.spyOn(empSalaryRepo, 'findAllByEmployeeIds'),
      jest.spyOn(structRepo, 'findByIds'),
      jest.spyOn(branchRepo, 'findByIds'),
      jest.spyOn(holidayRepo, 'findActiveInRange'),
      jest.spyOn(weeklyOffRepo, 'findActiveEffectiveInRange'),
    ];

    const t0 = performance.now();
    const batchResult = await inputResolver.resolveBatchForPeriod(
      benchPeriod._id,
      benchEmpIds,
    );
    const elapsedMs = Math.round(performance.now() - t0);

    expect(batchResult.resolved).toHaveLength(1000);
    expect(batchResult.failures).toHaveLength(0);
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(elapsedMs).toBeLessThan(15000);

    // Check employee 0: APPROVED unpaid leave on weekday AND ABSENT on same weekday -> exact LOP = 1 (no double deduction)
    const emp0Resolved = batchResult.resolved.find((r) =>
      r.employee._id.equals(benchEmpIds[0]),
    )!;
    expect(emp0Resolved.leaveAndAttendance.totalLopDays).toBe(1);

    // Check employee 1: APPROVED paid leave on weekday -> LOP = 0
    const emp1Resolved = batchResult.resolved.find((r) =>
      r.employee._id.equals(benchEmpIds[1]),
    )!;
    expect(emp1Resolved.leaveAndAttendance.paidLeaveDays).toBe(1);
    expect(emp1Resolved.leaveAndAttendance.totalLopDays).toBe(0);

    console.info(
      `[Step4.2 Benchmark] 1,000 employees + 31,000 attendance + 1,000 leaves resolved in ${elapsedMs}ms (1 call per repository)`,
    );
  });
});
