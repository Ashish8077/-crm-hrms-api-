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
import { Shift, ShiftDocument } from '../attendance/schemas/shift.schema';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/constants/audit-log.constant';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import { AuthModule } from '../auth/auth.module';
import { ACCESS_TOKEN_COOKIE } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Session, SessionDocument } from '../auth/schemas/session.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { EmployeeSalaryStatus } from '../employee-salaries/constants/employee-salary.constant';
import {
  EmployeeSalary,
  EmployeeSalaryDocument,
} from '../employee-salaries/schemas/employee-salary.schema';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import { LeaveRequestStatus } from '../leaves/constants/leaves.constant';
import { Holiday, HolidayDocument } from '../leaves/schemas/holiday.schema';
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
import {
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../payroll-periods/constants/payroll-period.constant';
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
import {
  SalaryStructure,
  SalaryStructureDocument,
} from '../salary-structures/schemas/salary-structure.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  WeeklyOffConfig,
  WeeklyOffConfigDocument,
} from '../work-schedules/schemas/weekly-off-config.schema';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  PAYROLL_PROCESSING_CONSTANTS,
  PayrollRecordStatus,
} from './constants/payroll-calculation.constant';
import { PayrollCalculationsModule } from './payroll-calculations.module';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { PayrollInputResolver } from './services/payroll-input.resolver';
import { PayrollProcessingService } from './services/payroll-processing.service';
import {
  PayrollProcessingFailure,
  PayrollProcessingFailureDocument,
} from './schemas/payroll-processing-failure.schema';
import {
  PayrollRecord,
  PayrollRecordDocument,
} from './schemas/payroll-record.schema';

describe('Step 5 — Payroll Run / Processing Real MongoDB Integration & 1,000-Employee Benchmark (crm_hrms_test)', () => {
  jest.setTimeout(300000);

  let moduleRef: TestingModule | null = null;
  let app: INestApplication<App> | null = null;
  let connection: Connection | null = null;
  let isConnected = false;

  let models!: RealDbModels;
  let tracker!: TestCleanupTracker;
  let factory!: PayrollAttendanceRealDbFactory;

  let salaryComponentModel!: Model<SalaryComponentDocument>;
  let salaryStructureModel!: Model<SalaryStructureDocument>;
  let employeeSalaryModel!: Model<EmployeeSalaryDocument>;
  let payrollSettingsModel!: Model<PayrollSettingsDocument>;
  let payrollRuleModel!: Model<PayrollCalculationRuleDocument>;
  let payrollRecordModel!: Model<PayrollRecordDocument>;
  let processingFailureModel!: Model<PayrollProcessingFailureDocument>;
  let leaveBalanceModel!: Model<LeaveBalanceDocument>;
  let leaveTransactionModel!: Model<LeaveTransactionDocument>;

  const runTag = `S5_${Date.now().toString(36).toUpperCase()}`;
  const createdComponentIds: Types.ObjectId[] = [];
  const createdStructureIds: Types.ObjectId[] = [];
  const createdAssignmentIds: Types.ObjectId[] = [];
  const createdPayrollPeriodIdsForCleanup: Types.ObjectId[] = [];
  const createdBenchEmpIds: Types.ObjectId[] = [];

  let createdSettingsId: Types.ObjectId | null = null;
  let createdRuleId: Types.ObjectId | null = null;
  let prevSettingsState: {
    id: Types.ObjectId;
    currency: string;
    fixedWorkingDaysPerMonth: number | null;
    isPayrollProcessingEnabled: boolean;
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
  let branch!: BranchDocument;
  let shift!: ShiftDocument;
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

  const buildSalarySnapshot = (salaryAmount: number) => ({
    salaryBasis: SalaryStructureBasis.GROSS,
    salaryFrequency: SalaryStructureFrequency.MONTHLY,
    inputSalaryAmount: salaryAmount,
    grossSalaryMonthly: salaryAmount,
    grossSalaryAnnual: salaryAmount * 12,
    totalEmployerContributionsMonthly: 0,
    totalEmployerContributionsAnnual: 0,
    totalCtcMonthly: salaryAmount,
    totalCtcAnnual: salaryAmount * 12,
    totalEmployeeDeductionsMonthly: 0,
    totalEmployeeDeductionsAnnual: 0,
    estimatedNetSalaryMonthly: salaryAmount,
    estimatedNetSalaryAnnual: salaryAmount * 12,
    summary: {
      monthly: {
        grossSalary: salaryAmount,
        employerContributions: 0,
        totalCtc: salaryAmount,
        employeeDeductions: 0,
        estimatedNetSalary: salaryAmount,
      },
      annual: {
        grossSalary: salaryAmount * 12,
        employerContributions: 0,
        totalCtc: salaryAmount * 12,
        employeeDeductions: 0,
        estimatedNetSalary: salaryAmount * 12,
      },
    },
    earnings: [],
    employeeDeductions: [],
    employerContributions: [],
  });

  const assignSalary = async (
    employeeId: Types.ObjectId,
    salaryAmount = 30000,
  ): Promise<EmployeeSalaryDocument> => {
    const doc = await employeeSalaryModel.create({
      employeeId,
      salaryStructureId: structure._id,
      effectiveFrom: new Date(`${testYear}-01-01T00:00:00.000Z`),
      effectiveTo: null,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount,
      salaryStructureVersion: 0,
      salarySnapshot: buildSalarySnapshot(salaryAmount),
      status: EmployeeSalaryStatus.ACTIVE,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    createdAssignmentIds.push(doc._id);
    return doc;
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
    processingFailureModel = moduleRef.get(
      getModelToken(PayrollProcessingFailure.name),
    );
    leaveBalanceModel = moduleRef.get(getModelToken(LeaveBalance.name));
    leaveTransactionModel = moduleRef.get(getModelToken(LeaveTransaction.name));

    await Promise.all([
      models.attendanceModel.syncIndexes(),
      models.payrollPeriodModel.syncIndexes(),
      models.leaveRequestModel.syncIndexes(),
      payrollRecordModel.syncIndexes(),
      processingFailureModel.syncIndexes(),
      employeeSalaryModel.syncIndexes(),
    ]);

    tracker = new TestCleanupTracker();
    factory = new PayrollAttendanceRealDbFactory(runTag, models, tracker);
    isConnected = true;

    testYear = await factory.findUnusedFutureYear(2080, 2099);
    periodStartStr = `${testYear}-04-01`;
    periodEndStr = `${testYear}-04-30`;

    branch = await factory.createBranch({
      name: `${runTag} Branch`,
      timezone: 'Asia/Kolkata',
    });
    shift = await factory.createShift();

    await factory.createWeeklyOffConfig({
      branchId: branch._id,
      days: [
        { dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] },
        { dayOfWeek: 6, occurrences: [1, 2, 3, 4, 5] },
      ],
      effectiveFrom: `${testYear}-01-01`,
      effectiveTo: null,
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
      PermissionKeys.PAYROLL_PERIODS_VIEW,
      PermissionKeys.PAYROLL_PERIODS_EDIT,
      PermissionKeys.PAYROLL_PERIODS_APPROVE,
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
        isPayrollProcessingEnabled: existingSettings.isPayrollProcessingEnabled,
      };
      await payrollSettingsModel.updateOne(
        { _id: existingSettings._id },
        {
          $set: {
            currency: 'INR',
            fixedWorkingDaysPerMonth: 22,
            isPayrollProcessingEnabled: true,
          },
        },
      );
    } else {
      const createdSettings = await payrollSettingsModel.create({
        currency: 'INR',
        fixedWorkingDaysPerMonth: 22,
        isPayrollProcessingEnabled: true,
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
      ],
    });
    createdStructureIds.push(structure._id);
  }, 300000);

  afterAll(async () => {
    try {
      if (isConnected && connection) {
        if (createdBenchEmpIds.length > 0) {
          await models.attendanceModel.deleteMany({
            employeeId: { $in: createdBenchEmpIds },
          });
        }
        if (createdPayrollPeriodIdsForCleanup.length > 0) {
          await processingFailureModel.deleteMany({
            payrollPeriodId: { $in: createdPayrollPeriodIdsForCleanup },
          });
          await payrollRecordModel.deleteMany({
            payrollPeriodId: { $in: createdPayrollPeriodIdsForCleanup },
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
                isPayrollProcessingEnabled:
                  prevSettingsState.isPayrollProcessingEnabled,
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

  it('executes full E2E batch lifecycle on real MongoDB: RBAC, partial failure retry, leave/salary stale detection, zero leave mutation, COMPLETED -> FINALIZED', async () => {
    const httpServer = app!.getHttpServer();
    const period = await factory.createPayrollPeriod({
      year: testYear,
      month: 4,
      startDate: new Date(`${periodStartStr}T00:00:00.000Z`),
      endDate: new Date(`${periodEndStr}T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-05-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.DRAFT,
    });
    createdPayrollPeriodIdsForCleanup.push(period._id);

    const empHealthy = await factory.createEmployee({
      employeeCode: `${runTag}-E1`,
      branchId: branch._id,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
    });
    const empResigned = await factory.createEmployee({
      employeeCode: `${runTag}-E2`,
      branchId: branch._id,
      employmentStatus: EmploymentStatus.RESIGNED,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
      lastWorkingDate: new Date(`${testYear}-04-15T00:00:00.000Z`),
    });
    const empMissingSalary = await factory.createEmployee({
      employeeCode: `${runTag}-E3`,
      branchId: branch._id,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
    });
    const empFuture = await factory.createEmployee({
      employeeCode: `${runTag}-E4`,
      branchId: branch._id,
      dateOfJoining: new Date(`${testYear}-06-01T00:00:00.000Z`),
    });

    await assignSalary(empHealthy._id, 30000);
    await assignSalary(empResigned._id, 30000);
    await assignSalary(empFuture._id, 30000);

    // Seed leave balance & full PRESENT attendance on working weekdays of April
    const leaveBal = await leaveBalanceModel.create({
      employeeId: empHealthy._id,
      leaveTypeId: unpaidLeaveType._id,
      year: testYear,
      allocatedDays: 10,
      carriedForwardDays: 0,
      creditedDays: 0,
      debitedDays: 0,
      usedDays: 0,
      pendingDays: 0,
      availableBalance: 10,
      deletedAt: null,
      updatedBy: actorUserId,
    });

    const weekdayDates: string[] = [];
    for (let day = 1; day <= 30; day++) {
      const ds = `${testYear}-04-${String(day).padStart(2, '0')}`;
      const dow = new Date(`${ds}T00:00:00.000Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) weekdayDates.push(ds);
    }
    const now = new Date();
    const attDocs: Array<Record<string, unknown>> = [];
    for (const ds of weekdayDates) {
      attDocs.push({
        employeeId: empHealthy._id,
        branchId: branch._id,
        shiftId: shift._id,
        attendanceDate: ds,
        status: AttendanceStatus.PRESENT,
        checkInTime: new Date(`${ds}T03:30:00.000Z`),
        checkOutTime: new Date(`${ds}T12:30:00.000Z`),
        totalWorkMinutes: 540,
        totalBreakMinutes: 0,
        overtimeMinutes: 0,
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      });
      if (ds <= `${testYear}-04-15`) {
        attDocs.push({
          employeeId: empResigned._id,
          branchId: branch._id,
          shiftId: shift._id,
          attendanceDate: ds,
          status: AttendanceStatus.PRESENT,
          checkInTime: new Date(`${ds}T03:30:00.000Z`),
          checkOutTime: new Date(`${ds}T12:30:00.000Z`),
          totalWorkMinutes: 540,
          totalBreakMinutes: 0,
          overtimeMinutes: 0,
          deletedAt: null,
          createdBy: actorUserId,
          updatedBy: actorUserId,
          createdAt: now,
          updatedAt: now,
        });
      }
      attDocs.push({
        employeeId: empMissingSalary._id,
        branchId: branch._id,
        shiftId: shift._id,
        attendanceDate: ds,
        status: AttendanceStatus.PRESENT,
        checkInTime: new Date(`${ds}T03:30:00.000Z`),
        checkOutTime: new Date(`${ds}T12:30:00.000Z`),
        totalWorkMinutes: 540,
        totalBreakMinutes: 0,
        overtimeMinutes: 0,
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: now,
        updatedAt: now,
      });
    }
    const insertedAtt =
      await models.attendanceModel.collection.insertMany(attDocs);
    for (const id of Object.values(
      insertedAtt.insertedIds,
    ) as Types.ObjectId[]) {
      tracker.track('attendanceIds', id);
    }

    try {
      // 1. Auth & RBAC + ValidationPipe guards
      await request(httpServer)
        .post(`/api/v1/payroll/periods/${period._id.toHexString()}/process`)
        .send({})
        .expect(HttpStatus.UNAUTHORIZED);

      await request(httpServer)
        .post(`/api/v1/payroll/periods/${period._id.toHexString()}/process`)
        .set('Cookie', limitedAuthCookie)
        .send({})
        .expect(HttpStatus.FORBIDDEN);

      await request(httpServer)
        .post(`/api/v1/payroll/periods/${period._id.toHexString()}/process`)
        .set('Cookie', authCookie)
        .send({ payableDays: 30 })
        .expect(HttpStatus.BAD_REQUEST);

      // 2. First run: healthy & resigned succeed, empMissingSalary isolated as failure
      const firstRun = await request(httpServer)
        .post(`/api/v1/payroll/periods/${period._id.toHexString()}/process`)
        .set('Cookie', authCookie)
        .send({ batchSize: 10 })
        .expect(HttpStatus.OK);

      expect(firstRun.body.data.processingStatus).toBe(
        PayrollProcessingStatus.COMPLETED_WITH_ERRORS,
      );
      expect(firstRun.body.data.canRetry).toBe(true);
      expect(firstRun.body.data.canComplete).toBe(false);

      const healthyRec1 = await payrollRecordModel
        .findOne({ payrollPeriodId: period._id, employeeId: empHealthy._id })
        .lean()
        .exec();
      const resignedRec1 = await payrollRecordModel
        .findOne({ payrollPeriodId: period._id, employeeId: empResigned._id })
        .lean()
        .exec();
      const futureRec = await payrollRecordModel
        .findOne({ payrollPeriodId: period._id, employeeId: empFuture._id })
        .lean()
        .exec();
      expect(healthyRec1?.calculationVersion).toBe(1);
      expect(healthyRec1?.calculationSnapshot.inputFingerprint).toBeTruthy();
      expect(resignedRec1?.calculationSnapshot.payableDays).toBe(15);
      expect(futureRec).toBeNull();

      const failuresRes = await request(httpServer)
        .get(
          `/api/v1/payroll/periods/${period._id.toHexString()}/processing-failures?page=1&limit=10`,
        )
        .set('Cookie', authCookie)
        .expect(HttpStatus.OK);
      const failureItems = failuresRes.body.data as Array<{
        employeeId: string;
      }>;
      expect(
        failureItems.some(
          (f) => f.employeeId === empMissingSalary._id.toHexString(),
        ),
      ).toBe(true);

      // Completion blocked while unresolved failure remains
      await request(httpServer)
        .patch(`/api/v1/payroll/periods/${period._id.toHexString()}/status`)
        .set('Cookie', authCookie)
        .send({ status: PayrollPeriodStatus.COMPLETED })
        .expect(HttpStatus.CONFLICT);

      // 3. Assign missing salary & retry -> no duplicate records, failure cleared
      await assignSalary(empMissingSalary._id, 30000);
      const retryClean = await request(httpServer)
        .post(`/api/v1/payroll/periods/${period._id.toHexString()}/process`)
        .set('Cookie', authCookie)
        .send({})
        .expect(HttpStatus.OK);

      expect(
        retryClean.body.data.skippedUpToDateEmployees,
      ).toBeGreaterThanOrEqual(2);
      expect(retryClean.body.data.recalculatedEmployees).toBe(0);
      expect(
        await payrollRecordModel.countDocuments({
          payrollPeriodId: period._id,
          employeeId: empHealthy._id,
        }),
      ).toBe(1);
      expect(
        await processingFailureModel.countDocuments({
          payrollPeriodId: period._id,
          employeeId: empMissingSalary._id,
        }),
      ).toBe(0);

      // 4. Approve unpaid leave for empHealthy -> marks ONLY empHealthy stale, leave balance/tx untouched
      const leaveTxCountBefore = await leaveTransactionModel.countDocuments({
        employeeId: empHealthy._id,
      });
      await factory.createLeaveRequest({
        employeeId: empHealthy._id,
        leaveType: unpaidLeaveType,
        startDate: weekdayDates[0],
        endDate: weekdayDates[0],
        totalDays: 1,
        status: LeaveRequestStatus.APPROVED,
      });

      const statusStale = await request(httpServer)
        .get(
          `/api/v1/payroll/periods/${period._id.toHexString()}/processing-status`,
        )
        .set('Cookie', authCookie)
        .expect(HttpStatus.OK);
      expect(statusStale.body.data.staleEmployees).toBeGreaterThanOrEqual(1);
      expect(statusStale.body.data.canComplete).toBe(false);

      // Retry updates ONLY empHealthy -> version 2, resigned remains version 1
      const recalcRun = await request(httpServer)
        .post(`/api/v1/payroll/periods/${period._id.toHexString()}/process`)
        .set('Cookie', authCookie)
        .send({})
        .expect(HttpStatus.OK);
      expect(recalcRun.body.data.recalculatedEmployees).toBe(1);

      const healthyRec2 = await payrollRecordModel
        .findOne({ payrollPeriodId: period._id, employeeId: empHealthy._id })
        .lean()
        .exec();
      const resignedRec2 = await payrollRecordModel
        .findOne({ payrollPeriodId: period._id, employeeId: empResigned._id })
        .lean()
        .exec();
      expect(healthyRec2?.calculationVersion).toBe(2);
      expect(healthyRec2?.calculationSnapshot.totalLopDays).toBe(1);
      expect(resignedRec2?.calculationVersion).toBe(1);

      // Verify zero mutations to LeaveBalance / LeaveTransaction
      const balAfter = await leaveBalanceModel
        .findById(leaveBal._id)
        .lean()
        .exec();
      expect(balAfter?.usedDays).toBe(0);
      expect(balAfter?.availableBalance).toBe(10);
      expect(
        await leaveTransactionModel.countDocuments({
          employeeId: empHealthy._id,
        }),
      ).toBe(leaveTxCountBefore);

      // 5. If no external baseline failures exist in test DB, transition COMPLETED -> FINALIZED
      if (recalcRun.body.data.canComplete) {
        await request(httpServer)
          .patch(`/api/v1/payroll/periods/${period._id.toHexString()}/status`)
          .set('Cookie', authCookie)
          .send({ status: PayrollPeriodStatus.COMPLETED })
          .expect(HttpStatus.OK);

        await request(httpServer)
          .patch(`/api/v1/payroll/periods/${period._id.toHexString()}/status`)
          .set('Cookie', authCookie)
          .send({
            status: PayrollPeriodStatus.FINALIZED,
            acknowledgeAnomalies: true,
            reason: 'Verified Step 5 E2E finalization',
          })
          .expect(HttpStatus.OK);

        // Processing FINALIZED period must be rejected 409
        await request(httpServer)
          .post(`/api/v1/payroll/periods/${period._id.toHexString()}/process`)
          .set('Cookie', authCookie)
          .send({})
          .expect(HttpStatus.CONFLICT);
      }
    } finally {
      await leaveBalanceModel.deleteOne({ _id: leaveBal._id });
    }
  });

  it('prevents concurrent processing races and recovers expired stale locks on real MongoDB', async () => {
    const httpServer = app!.getHttpServer();
    const lockPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 5,
      startDate: new Date(`${testYear}-05-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-05-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-06-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });
    createdPayrollPeriodIdsForCleanup.push(lockPeriod._id);

    const emp = await factory.createEmployee({
      employeeCode: `${runTag}-LOCK`,
      branchId: branch._id,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
    });
    await assignSalary(emp._id, 30000);

    // 1. Fresh active lock -> rejected with 409 CONCURRENT_MODIFICATION
    await models.payrollPeriodModel.updateOne(
      { _id: lockPeriod._id },
      {
        $set: {
          'processing.processingStatus': PayrollProcessingStatus.PROCESSING,
          'processing.activeRunId': 'live-worker-xyz',
          'processing.heartbeatAt': new Date(),
          'processing.lastAttemptAt': new Date(),
          'processing.processingAttempts': 1,
        },
      },
    );

    await request(httpServer)
      .post(`/api/v1/payroll/periods/${lockPeriod._id.toHexString()}/process`)
      .set('Cookie', authCookie)
      .send({})
      .expect(HttpStatus.CONFLICT);

    // 2. Backdate heartbeat past LOCK_STALE_TIMEOUT_MS -> recovers cleanly
    const staleDate = new Date(
      Date.now() - PAYROLL_PROCESSING_CONSTANTS.LOCK_STALE_TIMEOUT_MS - 30_000,
    );
    await models.payrollPeriodModel.updateOne(
      { _id: lockPeriod._id },
      {
        $set: {
          'processing.heartbeatAt': staleDate,
          'processing.lastAttemptAt': staleDate,
        },
      },
    );

    const recovered = await request(httpServer)
      .post(`/api/v1/payroll/periods/${lockPeriod._id.toHexString()}/process`)
      .set('Cookie', authCookie)
      .send({})
      .expect(HttpStatus.OK);
    expect(recovered.body.data.processingAttempts).toBe(2);
    expect(
      await payrollRecordModel.countDocuments({
        payrollPeriodId: lockPeriod._id,
        employeeId: emp._id,
      }),
    ).toBe(1);

    // 3. Fire two parallel requests simultaneously -> never creates duplicates
    const [r1, r2] = await Promise.all([
      request(httpServer)
        .post(`/api/v1/payroll/periods/${lockPeriod._id.toHexString()}/process`)
        .set('Cookie', authCookie)
        .send({}),
      request(httpServer)
        .post(`/api/v1/payroll/periods/${lockPeriod._id.toHexString()}/process`)
        .set('Cookie', authCookie)
        .send({}),
    ]);
    const codes = [r1.status, r2.status];
    expect(codes).toContain(HttpStatus.OK);
    for (const c of codes) {
      expect([HttpStatus.OK, HttpStatus.CONFLICT]).toContain(c);
    }
    expect(
      await payrollRecordModel.countDocuments({
        payrollPeriodId: lockPeriod._id,
        employeeId: emp._id,
      }),
    ).toBe(1);
  });

  it('remediates Defect 1 (ineligible invalidation/reactivation/approved protection) & Defect 2 (MongoDB transaction fencing) on real MongoDB', async () => {
    const httpServer = app!.getHttpServer();
    const febStart = `${testYear}-02-01`;
    const febEnd = `${testYear}-02-28`;

    const defPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 2,
      startDate: new Date(`${febStart}T00:00:00.000Z`),
      endDate: new Date(`${febEnd}T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-03-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.DRAFT,
    });
    createdPayrollPeriodIdsForCleanup.push(defPeriod._id);

    const emp1 = await factory.createEmployee({
      employeeCode: `${runTag}_D1_A`,
      branchId: branch._id,
      shiftId: shift._id,
      employmentStatus: EmploymentStatus.ACTIVE,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
    });
    const emp2 = await factory.createEmployee({
      employeeCode: `${runTag}_D1_B`,
      branchId: branch._id,
      shiftId: shift._id,
      employmentStatus: EmploymentStatus.ACTIVE,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
    });
    await assignSalary(emp1._id, 30000);
    await assignSalary(emp2._id, 30000);

    // ── Defect 1 Real-DB Verification ───────────────────────────────────────
    await request(httpServer)
      .post(`/api/v1/payroll/periods/${defPeriod._id.toHexString()}/process`)
      .set('Cookie', authCookie)
      .send({})
      .expect(HttpStatus.OK);

    // Terminate emp2 prior to period start -> retry invalidates record & preserves snapshot
    await models.employeeModel.updateOne(
      { _id: emp2._id },
      {
        $set: {
          employmentStatus: EmploymentStatus.TERMINATED,
          terminationDate: new Date(`${testYear}-01-15T00:00:00.000Z`),
          lastWorkingDate: new Date(`${testYear}-01-15T00:00:00.000Z`),
        },
      },
    );

    const retryInvalidated = await request(httpServer)
      .post(`/api/v1/payroll/periods/${defPeriod._id.toHexString()}/process`)
      .set('Cookie', authCookie)
      .send({})
      .expect(HttpStatus.OK);
    expect(retryInvalidated.body.data).toMatchObject({ canComplete: true });

    const invDoc = await payrollRecordModel
      .findOne({ payrollPeriodId: defPeriod._id, employeeId: emp2._id })
      .lean()
      .exec();
    expect(invDoc?.status).toBe(PayrollRecordStatus.INVALIDATED);
    expect(invDoc?.invalidationReason).toContain('INELIGIBLE:');
    expect(invDoc?.calculationSnapshot).toBeDefined();

    const auditLogModel = moduleRef!.get<Model<AuditLogDocument>>(
      getModelToken(AuditLog.name),
    );
    const invAuditLogs = await auditLogModel
      .find({
        action: AuditAction.PAYROLL_RECORD_INVALIDATED,
        targetId: invDoc!._id,
      })
      .lean()
      .exec();
    expect(invAuditLogs.length).toBe(1);
    expect(invAuditLogs[0].actorId?.toString()).toBe(actorUserId.toString());
    expect(invAuditLogs[0].details?.reason).toContain('INELIGIBLE:');
    expect(invAuditLogs[0].details?.previousCalculationVersion).toBe(1);
    expect(invAuditLogs[0].details?.previousNetSalary).toBe(
      invDoc!.netSalary.toString(),
    );
    expect(invAuditLogs[0].details?.previousCalculationSnapshot).toBeDefined();

    // Re-activate emp2 before period completion -> retry reactivates to version 2
    await models.employeeModel.updateOne(
      { _id: emp2._id },
      {
        $set: {
          employmentStatus: EmploymentStatus.ACTIVE,
          terminationDate: null,
          lastWorkingDate: null,
        },
      },
    );
    await request(httpServer)
      .post(`/api/v1/payroll/periods/${defPeriod._id.toHexString()}/process`)
      .set('Cookie', authCookie)
      .send({})
      .expect(HttpStatus.OK);

    const reactDoc = await payrollRecordModel
      .findOne({ payrollPeriodId: defPeriod._id, employeeId: emp2._id })
      .lean()
      .exec();
    expect(reactDoc?.status).toBe(PayrollRecordStatus.CALCULATED);
    expect(reactDoc?.calculationVersion).toBe(2);
    expect(reactDoc?.invalidatedAt).toBeNull();

    const recalcAuditLogs = await auditLogModel
      .find({
        action: AuditAction.PAYROLL_CALCULATION_RECALCULATED,
        targetId: reactDoc!._id,
      })
      .lean()
      .exec();
    expect(recalcAuditLogs.length).toBe(1);
    expect(recalcAuditLogs[0].details?.previousStatus).toBe(
      PayrollRecordStatus.INVALIDATED,
    );
    expect(recalcAuditLogs[0].details?.previousCalculationVersion).toBe(1);
    expect(
      recalcAuditLogs[0].details?.previousCalculationSnapshot,
    ).toBeDefined();

    // Mark emp2 APPROVED, then terminate -> silent invalidation must be rejected with 409
    await payrollRecordModel.updateOne(
      { _id: reactDoc!._id },
      { $set: { status: PayrollRecordStatus.APPROVED } },
    );
    await models.employeeModel.updateOne(
      { _id: emp2._id },
      {
        $set: {
          employmentStatus: EmploymentStatus.TERMINATED,
          terminationDate: new Date(`${testYear}-01-15T00:00:00.000Z`),
          lastWorkingDate: new Date(`${testYear}-01-15T00:00:00.000Z`),
        },
      },
    );
    await request(httpServer)
      .post(`/api/v1/payroll/periods/${defPeriod._id.toHexString()}/process`)
      .set('Cookie', authCookie)
      .send({})
      .expect(HttpStatus.CONFLICT);
    expect(
      (await payrollRecordModel.findOne({ _id: reactDoc!._id }).lean().exec())
        ?.status,
    ).toBe(PayrollRecordStatus.APPROVED);

    // ── Defect 2 Real-DB Multi-Document Transaction Fencing ────────────────
    // Restore emp2 status and create a fresh period for Worker A vs Worker B race
    await models.employeeModel.updateOne(
      { _id: emp2._id },
      {
        $set: {
          employmentStatus: EmploymentStatus.ACTIVE,
          terminationDate: null,
          lastWorkingDate: null,
        },
      },
    );
    const fencePeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 3,
      startDate: new Date(`${testYear}-03-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-03-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-04-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.DRAFT,
    });
    createdPayrollPeriodIdsForCleanup.push(fencePeriod._id);

    const processingService = moduleRef!.get(PayrollProcessingService);
    const calculationService = moduleRef!.get(PayrollCalculationService);
    const origCompute =
      calculationService.computeFromResolvedInputs.bind(calculationService);

    let workerBRan = false;
    const computeSpy = jest
      .spyOn(calculationService, 'computeFromResolvedInputs')
      .mockImplementation(async (inputs, preResolved, calcAt) => {
        const computed = await origCompute(inputs, preResolved, calcAt);
        if (!workerBRan && inputs.period._id.equals(fencePeriod._id)) {
          workerBRan = true;
          // Expire Worker A's heartbeat in MongoDB and let Worker B recover and complete
          const expired = new Date(
            Date.now() -
              PAYROLL_PROCESSING_CONSTANTS.LOCK_STALE_TIMEOUT_MS -
              10_000,
          );
          await models.payrollPeriodModel.updateOne(
            { _id: fencePeriod._id },
            { $set: { 'processing.heartbeatAt': expired } },
          );
          await processingService.processPeriod(
            fencePeriod._id,
            { batchSize: 50 },
            actorUserId,
          );
        }
        return computed;
      });

    // Worker A must fail fenced inside its MongoDB transaction and NOT overwrite Worker B
    await expect(
      processingService.processPeriod(
        fencePeriod._id,
        { batchSize: 50 },
        actorUserId,
      ),
    ).rejects.toMatchObject({ statusCode: HttpStatus.CONFLICT });
    computeSpy.mockRestore();

    const fencePeriodDoc = await models.payrollPeriodModel
      .findById(fencePeriod._id)
      .lean()
      .exec();
    expect(fencePeriodDoc?.processing?.processingStatus).toBe(
      PayrollProcessingStatus.COMPLETED,
    );
    expect(fencePeriodDoc?.processing?.activeRunId).toBeNull();

    const workerBRecords = await payrollRecordModel
      .find({ payrollPeriodId: fencePeriod._id })
      .lean()
      .exec();
    expect(workerBRecords.length).toBeGreaterThanOrEqual(2);
    for (const r of workerBRecords) {
      expect(r.calculationVersion).toBe(1);
    }
  });

  it('atomically persists or rolls back processing-started and single-employee recalculation audits on real MongoDB', async () => {
    const auditPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 6,
      startDate: new Date(`${testYear}-06-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-06-30T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-07-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.DRAFT,
    });
    createdPayrollPeriodIdsForCleanup.push(auditPeriod._id);

    const empAudit = await factory.createEmployee({
      employeeCode: `${runTag}_AUD_01`,
      branchId: branch._id,
      shiftId: shift._id,
      employmentStatus: EmploymentStatus.ACTIVE,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
    });
    await assignSalary(empAudit._id, 30000);

    const processingService = moduleRef!.get(PayrollProcessingService);
    const calculationService = moduleRef!.get(PayrollCalculationService);
    const auditLogsService = moduleRef!.get(AuditLogsService);
    const auditLogModel = moduleRef!.get<Model<AuditLogDocument>>(
      getModelToken(AuditLog.name),
    );
    const origCreateAuditLog =
      auditLogsService.createAuditLog.bind(auditLogsService);

    // 1. Audit failure on PAYROLL_PROCESSING_STARTED rolls back lock acquisition
    const lockFailSpy = jest
      .spyOn(auditLogsService, 'createAuditLog')
      .mockImplementation(async (params, session) => {
        if (params.action === AuditAction.PAYROLL_PROCESSING_STARTED) {
          throw new Error('Simulated real-DB lock audit failure');
        }
        return origCreateAuditLog(params, session);
      });

    await expect(
      processingService.processPeriod(
        auditPeriod._id,
        { batchSize: 50 },
        actorUserId,
      ),
    ).rejects.toThrow('Simulated real-DB lock audit failure');
    lockFailSpy.mockRestore();

    const periodAfterRollback = await models.payrollPeriodModel
      .findById(auditPeriod._id)
      .lean()
      .exec();
    expect(periodAfterRollback?.status).toBe(PayrollPeriodStatus.DRAFT);
    expect(periodAfterRollback?.processing?.activeRunId ?? null).toBeNull();
    expect(periodAfterRollback?.processing?.processingAttempts ?? 0).toBe(0);
    expect(
      await auditLogModel.countDocuments({
        targetId: auditPeriod._id,
        action: AuditAction.PAYROLL_PROCESSING_STARTED,
      }),
    ).toBe(0);

    // 2. Concurrent lock acquisition permits only one active run & persists one start audit
    const [c1, c2] = await Promise.allSettled([
      processingService.processPeriod(
        auditPeriod._id,
        { batchSize: 50 },
        actorUserId,
      ),
      processingService.processPeriod(
        auditPeriod._id,
        { batchSize: 50 },
        actorUserId,
      ),
    ]);
    expect([c1, c2].filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect([c1, c2].filter((r) => r.status === 'rejected').length).toBe(1);
    expect(
      await auditLogModel.countDocuments({
        targetId: auditPeriod._id,
        action: AuditAction.PAYROLL_PROCESSING_STARTED,
      }),
    ).toBe(1);

    // 3. Single-employee recalculation audit failure rolls back PayrollRecord update
    const recalcPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 7,
      startDate: new Date(`${testYear}-07-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-07-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-08-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.DRAFT,
    });
    createdPayrollPeriodIdsForCleanup.push(recalcPeriod._id);

    const v1Res = await calculationService.calculateAndPersistEmployeePayroll(
      {
        payrollPeriodId: recalcPeriod._id.toString(),
        employeeId: empAudit._id.toString(),
      },
      actorUserId,
    );
    expect(v1Res.calculationVersion).toBe(1);
    expect(v1Res.netSalary).toBe('30000.00');

    let julyWeekday = `${testYear}-07-02`;
    for (let d = 1; d <= 7; d++) {
      const ds = `${testYear}-07-${String(d).padStart(2, '0')}`;
      const dow = new Date(`${ds}T00:00:00.000Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) {
        julyWeekday = ds;
        break;
      }
    }
    await factory.createLeaveRequest({
      employeeId: empAudit._id,
      leaveType: unpaidLeaveType,
      startDate: julyWeekday,
      endDate: julyWeekday,
      totalDays: 1,
      status: LeaveRequestStatus.APPROVED,
    });

    const recalcFailSpy = jest
      .spyOn(auditLogsService, 'createAuditLog')
      .mockImplementation(async (params, session) => {
        if (params.action === AuditAction.PAYROLL_CALCULATION_RECALCULATED) {
          throw new Error('Simulated real-DB recalc audit failure');
        }
        return origCreateAuditLog(params, session);
      });

    await expect(
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: recalcPeriod._id.toString(),
          employeeId: empAudit._id.toString(),
          recalculate: true,
        },
        actorUserId,
      ),
    ).rejects.toThrow('Simulated real-DB recalc audit failure');
    recalcFailSpy.mockRestore();

    const recordAfterFail = await payrollRecordModel
      .findOne({ payrollPeriodId: recalcPeriod._id, employeeId: empAudit._id })
      .lean()
      .exec();
    expect(recordAfterFail).not.toBeNull();
    expect(recordAfterFail!.calculationVersion).toBe(1);
    expect(recordAfterFail!.__v).toBe(0);
    expect(recordAfterFail!.netSalary.toString()).toBe('30000.00');
    expect(
      await auditLogModel.countDocuments({
        targetId: recordAfterFail!._id,
        action: AuditAction.PAYROLL_CALCULATION_RECALCULATED,
      }),
    ).toBe(0);

    // 4. Successful recalculation persists both PayrollRecord v2 and audit event
    const v2Res = await calculationService.calculateAndPersistEmployeePayroll(
      {
        payrollPeriodId: recalcPeriod._id.toString(),
        employeeId: empAudit._id.toString(),
        recalculate: true,
      },
      actorUserId,
    );
    expect(v2Res.calculationVersion).toBe(2);
    expect(Number(v2Res.netSalary)).toBeLessThan(30000);
    expect(
      await auditLogModel.countDocuments({
        targetId: recordAfterFail!._id,
        action: AuditAction.PAYROLL_CALCULATION_RECALCULATED,
      }),
    ).toBe(1);
  });

  it('enforces lifecycle concurrency invariants across calculation, approval guard, concurrent recalculation, and finalization on real MongoDB', async () => {
    const httpServer = app!.getHttpServer();
    const calculationService = moduleRef!.get(PayrollCalculationService);
    const processingService = moduleRef!.get(PayrollProcessingService);
    const inputResolver = moduleRef!.get(PayrollInputResolver);
    const auditLogModel = moduleRef!.get<Model<AuditLogDocument>>(
      getModelToken(AuditLog.name),
    );

    const raceEmp = await factory.createEmployee({
      employeeCode: `${runTag}_LC_01`,
      branchId: branch._id,
      shiftId: shift._id,
      employmentStatus: EmploymentStatus.ACTIVE,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
    });
    await assignSalary(raceEmp._id, 30000);

    // 1. Initial calculation starts while PROCESSING, period finalizes before tx commit -> rejected 409, 0 records created
    const createRacePeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 9,
      startDate: new Date(`${testYear}-09-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-09-30T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-10-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });
    createdPayrollPeriodIdsForCleanup.push(createRacePeriod._id);

    const origResolve = inputResolver.resolve.bind(inputResolver);
    const resolveFinalizedSpy = jest
      .spyOn(inputResolver, 'resolve')
      .mockImplementationOnce(async (pId, eId) => {
        const resolved = await origResolve(pId, eId);
        await models.payrollPeriodModel.updateOne(
          { _id: createRacePeriod._id },
          {
            $set: { status: PayrollPeriodStatus.FINALIZED },
            $inc: { __v: 1 },
          },
        );
        return resolved;
      });

    await expect(
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: createRacePeriod._id.toString(),
          employeeId: raceEmp._id.toString(),
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    resolveFinalizedSpy.mockRestore();
    expect(
      await payrollRecordModel.countDocuments({
        payrollPeriodId: createRacePeriod._id,
        employeeId: raceEmp._id,
      }),
    ).toBe(0);

    // 2. Recalculation starts while PROCESSING, real HTTP COMPLETED -> FINALIZED commits before tx commit -> rejected 409
    const lifecyclePeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 8,
      startDate: new Date(`${testYear}-08-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-08-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-09-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });
    createdPayrollPeriodIdsForCleanup.push(lifecyclePeriod._id);

    await processingService.processPeriod(
      lifecyclePeriod._id,
      { batchSize: 50 },
      actorUserId,
    );

    const recalcFinalizedSpy = jest
      .spyOn(inputResolver, 'resolve')
      .mockImplementationOnce(async (pId, eId) => {
        const resolved = await origResolve(pId, eId);
        await request(httpServer)
          .patch(
            `/api/v1/payroll/periods/${lifecyclePeriod._id.toHexString()}/status`,
          )
          .set('Cookie', authCookie)
          .send({ status: PayrollPeriodStatus.COMPLETED })
          .expect(HttpStatus.OK);
        await request(httpServer)
          .patch(
            `/api/v1/payroll/periods/${lifecyclePeriod._id.toHexString()}/status`,
          )
          .set('Cookie', authCookie)
          .send({
            status: PayrollPeriodStatus.FINALIZED,
            acknowledgeAnomalies: true,
            reason: 'Concurrent finalization race verification',
          })
          .expect(HttpStatus.OK);
        return resolved;
      });

    await expect(
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: lifecyclePeriod._id.toString(),
          employeeId: raceEmp._id.toString(),
          recalculate: true,
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    recalcFinalizedSpy.mockRestore();

    const postFinalizedRec = await payrollRecordModel
      .findOne({
        payrollPeriodId: lifecyclePeriod._id,
        employeeId: raceEmp._id,
      })
      .lean()
      .exec();
    expect(postFinalizedRec?.calculationVersion).toBe(1);
    expect(
      await auditLogModel.countDocuments({
        targetId: postFinalizedRec!._id,
        action: AuditAction.PAYROLL_CALCULATION_RECALCULATED,
      }),
    ).toBe(0);

    // 3. Recalculation cannot overwrite an APPROVED PayrollRecord (even when status transitions to APPROVED mid-flight)
    const approvedRacePeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 10,
      startDate: new Date(`${testYear}-10-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-10-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-11-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });
    createdPayrollPeriodIdsForCleanup.push(approvedRacePeriod._id);

    await calculationService.calculateAndPersistEmployeePayroll(
      {
        payrollPeriodId: approvedRacePeriod._id.toString(),
        employeeId: raceEmp._id.toString(),
      },
      actorUserId,
    );

    const recordRepoForSpy = (
      calculationService as unknown as {
        payrollRecordRepository: {
          findByPeriodAndEmployee: (
            pId: Types.ObjectId,
            eId: Types.ObjectId,
          ) => Promise<Record<string, unknown> | null>;
        };
      }
    ).payrollRecordRepository;
    const origFindByPeriodAndEmp =
      recordRepoForSpy.findByPeriodAndEmployee.bind(recordRepoForSpy);
    const approvedRaceSpy = jest
      .spyOn(recordRepoForSpy, 'findByPeriodAndEmployee')
      .mockImplementationOnce(async (pId, eId) => {
        const doc = await origFindByPeriodAndEmp(pId, eId);
        await payrollRecordModel.updateOne(
          { payrollPeriodId: approvedRacePeriod._id, employeeId: raceEmp._id },
          { $set: { status: PayrollRecordStatus.APPROVED }, $inc: { __v: 1 } },
        );
        return doc;
      });

    await expect(
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: approvedRacePeriod._id.toString(),
          employeeId: raceEmp._id.toString(),
          recalculate: true,
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    approvedRaceSpy.mockRestore();

    const approvedDocAfter = await payrollRecordModel
      .findOne({
        payrollPeriodId: approvedRacePeriod._id,
        employeeId: raceEmp._id,
      })
      .lean()
      .exec();
    expect(approvedDocAfter?.status).toBe(PayrollRecordStatus.APPROVED);
    expect(approvedDocAfter?.calculationVersion).toBe(1);

    // 4. Concurrent recalculation requests cannot overwrite each other on real MongoDB
    const recalcRacePeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 11,
      startDate: new Date(`${testYear}-11-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-11-30T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-12-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });
    createdPayrollPeriodIdsForCleanup.push(recalcRacePeriod._id);

    await calculationService.calculateAndPersistEmployeePayroll(
      {
        payrollPeriodId: recalcRacePeriod._id.toString(),
        employeeId: raceEmp._id.toString(),
      },
      actorUserId,
    );

    const [rr1, rr2] = await Promise.allSettled([
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: recalcRacePeriod._id.toString(),
          employeeId: raceEmp._id.toString(),
          recalculate: true,
        },
        actorUserId,
      ),
      calculationService.calculateAndPersistEmployeePayroll(
        {
          payrollPeriodId: recalcRacePeriod._id.toString(),
          employeeId: raceEmp._id.toString(),
          recalculate: true,
        },
        actorUserId,
      ),
    ]);
    expect([rr1, rr2].filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect([rr1, rr2].filter((r) => r.status === 'rejected').length).toBe(1);
    const raceDocAfter = await payrollRecordModel
      .findOne({
        payrollPeriodId: recalcRacePeriod._id,
        employeeId: raceEmp._id,
      })
      .lean()
      .exec();
    expect(raceDocAfter?.calculationVersion).toBe(2);
    expect(raceDocAfter?.__v).toBe(1);

    // 5. Finalization / completion cannot race with an in-flight calculation commit
    const finRacePeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 12,
      startDate: new Date(`${testYear}-12-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-12-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear + 1}-01-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.PROCESSING,
    });
    createdPayrollPeriodIdsForCleanup.push(finRacePeriod._id);

    await processingService.processPeriod(
      finRacePeriod._id,
      { batchSize: 50 },
      actorUserId,
    );

    const origVerifyReadiness =
      processingService.verifyPeriodCompletionReadiness.bind(processingService);
    const readinessRaceSpy = jest
      .spyOn(processingService, 'verifyPeriodCompletionReadiness')
      .mockImplementationOnce(async (p) => {
        await origVerifyReadiness(p);
        await calculationService.calculateAndPersistEmployeePayroll(
          {
            payrollPeriodId: finRacePeriod._id.toString(),
            employeeId: raceEmp._id.toString(),
            recalculate: true,
          },
          actorUserId,
        );
      });

    await request(httpServer)
      .patch(
        `/api/v1/payroll/periods/${finRacePeriod._id.toHexString()}/status`,
      )
      .set('Cookie', authCookie)
      .send({ status: PayrollPeriodStatus.COMPLETED })
      .expect(HttpStatus.CONFLICT);
    readinessRaceSpy.mockRestore();

    const finRaceDocAfter = await models.payrollPeriodModel
      .findById(finRacePeriod._id)
      .lean()
      .exec();
    expect(finRaceDocAfter?.status).toBe(PayrollPeriodStatus.PROCESSING);
  });

  it('benchmarks 1,000 employees + 31,000 attendance + 1,000 leaves batch payroll processing on real MongoDB', async () => {
    const janStart = `${testYear}-01-01`;
    const janEnd = `${testYear}-01-31`;
    const benchPeriod = await factory.createPayrollPeriod({
      year: testYear,
      month: 1,
      startDate: new Date(`${janStart}T00:00:00.000Z`),
      endDate: new Date(`${janEnd}T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-02-01T00:00:00.000Z`),
      status: PayrollPeriodStatus.DRAFT,
    });
    createdPayrollPeriodIdsForCleanup.push(benchPeriod._id);

    const now = new Date();
    const deptId = new Types.ObjectId();
    const desigId = new Types.ObjectId();
    const empDocs = Array.from({ length: 1000 }, (_, i) => ({
      employeeCode: `${runTag}_B${String(i).padStart(4, '0')}`,
      firstName: 'Bench',
      lastName: `Emp${i}`,
      workEmail: `${runTag.toLowerCase()}-b${i}@bench.example.com`,
      branchId: branch._id,
      departmentId: deptId,
      designationId: desigId,
      shiftId: shift._id,
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
      lastWorkingDate: null,
      terminationDate: null,
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
    for (const id of benchEmpIds) {
      tracker.track('employeeIds', id);
      createdBenchEmpIds.push(id);
    }

    const salaryDocs = benchEmpIds.map((empId) => ({
      employeeId: empId,
      salaryStructureId: structure._id,
      effectiveFrom: new Date(`${testYear}-01-01T00:00:00.000Z`),
      effectiveTo: null,
      salaryBasis: SalaryStructureBasis.GROSS,
      salaryFrequency: SalaryStructureFrequency.MONTHLY,
      salaryAmount: 30000,
      salaryStructureVersion: 0,
      salarySnapshot: buildSalarySnapshot(30000),
      status: EmployeeSalaryStatus.ACTIVE,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    }));
    for (let s = 0; s < salaryDocs.length; s += 250) {
      const insertedBatch = await employeeSalaryModel.insertMany(
        salaryDocs.slice(s, s + 250),
        { ordered: false },
      );
      for (const doc of insertedBatch) {
        createdAssignmentIds.push(doc._id);
      }
    }

    // Seed 31,000 attendance docs + 1,000 leave requests (750 APPROVED, 250 PENDING)
    const janDates = Array.from(
      { length: 31 },
      (_, d) => `${testYear}-01-${String(d + 1).padStart(2, '0')}`,
    );
    const firstWeekday =
      janDates.find((d) => {
        const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
        return dow !== 0 && dow !== 6;
      }) ?? `${testYear}-01-02`;

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

    for (let start = 0; start < benchEmpIds.length; start += 100) {
      const slice = benchEmpIds.slice(start, start + 100);
      const batch = slice.flatMap((empId) =>
        janDates.map((ds) => ({
          employeeId: empId,
          attendanceDate: ds,
          date: new Date(`${ds}T00:00:00.000Z`),
          shiftId: shift._id,
          shiftSnapshot,
          status:
            ds === firstWeekday
              ? AttendanceStatus.ABSENT
              : AttendanceStatus.PRESENT,
          source: 'WEB',
          workMode: 'OFFICE',
          checkInSource: 'WEB',
          totalBreakMinutes: 0,
          totalWorkMinutes: ds === firstWeekday ? 0 : 480,
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
        writeConcern: { w: 1, j: false },
      });
    }

    const leaveDocs = benchEmpIds.map((empId, i) => ({
      employeeId: empId,
      leaveTypeId: unpaidLeaveType._id,
      leaveTypeSnapshot: {
        name: unpaidLeaveType.name,
        code: unpaidLeaveType.code,
        isPaid: false,
        allowHalfDay: true,
        deductWeekends: false,
        deductHolidays: false,
      },
      startDate: firstWeekday,
      endDate: firstWeekday,
      totalDays: 1,
      isHalfDay: false,
      halfDaySession: null,
      excludedDates: [],
      yearBreakdown: [],
      reason: 'Step5 Benchmark Leave',
      status:
        i % 4 === 3 ? LeaveRequestStatus.PENDING : LeaveRequestStatus.APPROVED,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
    const insertedLeaves =
      await models.leaveRequestModel.collection.insertMany(leaveDocs);
    for (const id of Object.values(
      insertedLeaves.insertedIds,
    ) as Types.ObjectId[]) {
      tracker.track('leaveRequestIds', id);
    }

    const processingService = moduleRef!.get(PayrollProcessingService);
    const calculationService = moduleRef!.get(PayrollCalculationService);
    const computeSpy = jest.spyOn(
      calculationService,
      'computeFromResolvedInputs',
    );

    const memBeforeMb = Math.round(
      process.memoryUsage().heapUsed / (1024 * 1024),
    );
    const t0 = performance.now();
    const res = await processingService.processPeriod(
      benchPeriod._id,
      { batchSize: 100 },
      actorUserId,
    );
    const elapsedMs = Math.round(performance.now() - t0);
    const memAfterMb = Math.round(
      process.memoryUsage().heapUsed / (1024 * 1024),
    );

    const persistedCount = await payrollRecordModel.countDocuments({
      payrollPeriodId: benchPeriod._id,
      employeeId: { $in: benchEmpIds },
      status: PayrollRecordStatus.CALCULATED,
    });
    expect(persistedCount).toBe(1000);
    expect(computeSpy.mock.calls.length).toBeGreaterThanOrEqual(1000);

    // Spot-check financial consistency for benchmark employees (31 days, 1 LOP day -> 30/31 * 30,000)
    const sampleRec = await payrollRecordModel
      .findOne({ payrollPeriodId: benchPeriod._id, employeeId: benchEmpIds[0] })
      .lean()
      .exec();
    expect(sampleRec?.calculationSnapshot.totalLopDays).toBe(1);
    expect(sampleRec?.calculationSnapshot.payableDays).toBe(30);

    // Idempotent second pass immediately after -> 0 full snapshot recomputations for benchmark employees
    computeSpy.mockClear();
    const tRetry = performance.now();
    const retryRes = await processingService.processPeriod(
      benchPeriod._id,
      { batchSize: 100 },
      actorUserId,
    );
    const retryMs = Math.round(performance.now() - tRetry);
    expect(retryRes.skippedUpToDateEmployees).toBeGreaterThanOrEqual(1000);
    expect(retryRes.recalculatedEmployees).toBe(0);
    expect(computeSpy).toHaveBeenCalledTimes(0);

    console.info(
      `[Step 5 Benchmark] 1,000 employees + 31,000 attendance + 1,000 leaves: initial=${elapsedMs}ms (heap ${memBeforeMb}MB -> ${memAfterMb}MB), idempotentRetry=${retryMs}ms, status=${res.processingStatus}`,
    );
    computeSpy.mockRestore();
  });
});
