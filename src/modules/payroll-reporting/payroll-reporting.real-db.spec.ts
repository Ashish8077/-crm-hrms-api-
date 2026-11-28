import {
  HttpStatus,
  INestApplication,
  ValidationError,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { RedisModule } from '../../common/redis/redis.module';
import { RedisService } from '../../common/redis/redis.service';
import { toDecimal } from '../../common/utils/financial-math.util';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import configuration from '../../config/configuration';
import { AttendanceModule } from '../attendance/attendance.module';
import {
  Attendance,
  AttendanceDocument,
} from '../attendance/schemas/attendance.schema';
import {
  AttendanceRegularization,
  AttendanceRegularizationDocument,
} from '../attendance/schemas/attendance-regularization.schema';
import { Shift, ShiftDocument } from '../attendance/schemas/shift.schema';
import { AuthModule } from '../auth/auth.module';
import { ACCESS_TOKEN_COOKIE } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Session, SessionDocument } from '../auth/schemas/session.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { BranchesModule } from '../branches/branches.module';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { DepartmentsModule } from '../departments/departments.module';
import {
  Department,
  DepartmentDocument,
} from '../departments/schemas/department.schema';
import { DesignationsModule } from '../designations/designations.module';
import {
  Designation,
  DesignationDocument,
} from '../designations/schemas/designation.schema';
import { EmploymentStatus } from '../employees/constants/employee.constant';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import { LeavesModule } from '../leaves/leaves.module';
import { Holiday, HolidayDocument } from '../leaves/schemas/holiday.schema';
import {
  LeaveRequest,
  LeaveRequestDocument,
} from '../leaves/schemas/leave-request.schema';
import {
  LeaveType,
  LeaveTypeDocument,
} from '../leaves/schemas/leave-type.schema';
import { PayrollRecordStatus } from '../payroll-calculations/constants/payroll-calculation.constant';
import { PayrollCalculationsModule } from '../payroll-calculations/payroll-calculations.module';
import {
  PayrollRecord,
  PayrollRecordDocument,
} from '../payroll-calculations/schemas/payroll-record.schema';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollPeriodStatus } from '../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodsModule } from '../payroll-periods/payroll-periods.module';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
} from '../payroll-periods/schemas/payroll-period.schema';
import {
  PayrollAttendanceRealDbFactory,
  RealDbModels,
  TestCleanupTracker,
  assertMongoSrvReachable,
  assertTestDatabaseConnection,
  resolveTestMongoUri,
} from '../payroll-periods/testing/payroll-attendance-real-db.factory';
import { Payslip, PayslipDocument } from '../payslips/schemas/payslip.schema';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  Permission,
  PermissionDocument,
} from '../permissions/schemas/permission.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { SalaryComponentType } from '../salary-components/constants/salary-component.constant';
import { SalaryComponentsModule } from '../salary-components/salary-components.module';
import {
  SalaryComponent,
  SalaryComponentDocument,
} from '../salary-components/schemas/salary-component.schema';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../salary-structures/constants/salary-structure.constant';
import { StorageModule } from '../storage/storage.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { WorkSchedulesModule } from '../work-schedules/work-schedules.module';
import {
  WeeklyOffConfig,
  WeeklyOffConfigDocument,
} from '../work-schedules/schemas/weekly-off-config.schema';
import { PAYROLL_REPORTING_CONSTANTS } from './constants/payroll-reporting.constant';
import { PayrollReportingModule } from './payroll-reporting.module';

describe('Payroll Reporting & History — Real MongoDB Integration, Financial Accuracy, Multi-Currency & RBAC', () => {
  jest.setTimeout(120000);

  let moduleRef: TestingModule | null = null;
  let app: INestApplication<App> | null = null;
  let connection: Connection | null = null;
  let isConnected = false;

  let models!: RealDbModels;
  let tracker!: TestCleanupTracker;
  let factory!: PayrollAttendanceRealDbFactory;

  let deptModel!: Model<DepartmentDocument>;
  let desigModel!: Model<DesignationDocument>;
  let recordModel!: Model<PayrollRecordDocument>;
  let payslipModel!: Model<PayslipDocument>;
  let salaryComponentModel!: Model<SalaryComponentDocument>;

  const runTag = `PRPT_${Date.now().toString(36).toUpperCase()}`;
  const createdDeptIds: Types.ObjectId[] = [];
  const createdDesigIds: Types.ObjectId[] = [];
  const createdComponentIds: Types.ObjectId[] = [];
  const createdRecordPeriodIds: Types.ObjectId[] = [];

  let testYear!: number;
  let emptyYear!: number;

  let fullActorCookie!: string;
  let viewerOnlyCookie!: string;
  let selfEmpCookie!: string;
  let hrUserId!: Types.ObjectId;

  let branchHQ!: BranchDocument;
  let branchWest!: BranchDocument;
  let branchDeleted!: BranchDocument;
  let deptEng!: DepartmentDocument;
  let deptSales!: DepartmentDocument;
  let deptDeleted!: DepartmentDocument;
  let desigDev!: DesignationDocument;
  let liveBasicComp!: SalaryComponentDocument;

  let emp1!: EmployeeDocument;
  let emp2!: EmployeeDocument;
  let emp3!: EmployeeDocument;
  let emp4!: EmployeeDocument;
  let empDeletedSelf!: EmployeeDocument;

  let periodJanInr!: PayrollPeriodDocument;
  let periodFebUsd!: PayrollPeriodDocument;
  let periodDraft!: PayrollPeriodDocument;
  let periodApprovedUnfinalized!: PayrollPeriodDocument;
  let periodSoftDeleted!: PayrollPeriodDocument;
  let periodEmptyFinalized!: PayrollPeriodDocument;

  beforeAll(async () => {
    const uri = resolveTestMongoUri();
    if (!uri) {
      throw new Error('Test MongoDB URI not configured in .env.test');
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
        BranchesModule,
        DepartmentsModule,
        DesignationsModule,
        AttendanceModule,
        LeavesModule,
        WorkSchedulesModule,
        SalaryComponentsModule,
        PayrollPeriodsModule,
        PayrollCalculationsModule,
        PayrollReportingModule,
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
      .compile();

    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors: ValidationError[]) =>
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Validation failed',
            HttpStatus.BAD_REQUEST,
            mapValidationErrors(errors),
          ),
      }),
    );
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

    deptModel = moduleRef.get(getModelToken(Department.name));
    desigModel = moduleRef.get(getModelToken(Designation.name));
    recordModel = moduleRef.get(getModelToken(PayrollRecord.name));
    payslipModel = moduleRef.get(getModelToken(Payslip.name));
    salaryComponentModel = moduleRef.get(getModelToken(SalaryComponent.name));

    await Promise.all([
      models.payrollPeriodModel.syncIndexes(),
      recordModel.syncIndexes(),
    ]);

    tracker = new TestCleanupTracker();
    factory = new PayrollAttendanceRealDbFactory(runTag, models, tracker);
    isConnected = true;

    testYear = await factory.findUnusedFutureYear(2080, 2099);
    emptyYear = await factory.findUnusedFutureYear(testYear + 1, 2100);

    // Real JWT + RBAC actors backed by MongoDB User, Role, Permission, and Session collections
    const jwtService = new JwtService({
      secret: moduleRef.get(ConfigService).getOrThrow<string>('jwt.secret'),
      signOptions: { algorithm: 'HS256' },
    });

    const fullActor = await factory.createUserWithRole([
      PermissionKeys.PAYROLL_HISTORY_VIEW,
      PermissionKeys.PAYROLL_REPORTS_VIEW,
      PermissionKeys.PAYROLL_REPORTS_EXPORT,
    ]);
    hrUserId = fullActor.user._id;
    fullActorCookie = `${ACCESS_TOKEN_COOKIE}=${await jwtService.signAsync({
      sub: fullActor.user._id.toHexString(),
      sid: fullActor.session._id.toHexString(),
      type: 'access',
    })}`;

    const viewerActor = await factory.createUserWithRole([
      PermissionKeys.PAYROLL_REPORTS_VIEW,
    ]);
    viewerOnlyCookie = `${ACCESS_TOKEN_COOKIE}=${await jwtService.signAsync({
      sub: viewerActor.user._id.toHexString(),
      sid: viewerActor.session._id.toHexString(),
      type: 'access',
    })}`;

    const selfEmpActor = await factory.createUserWithRole([
      PermissionKeys.PAYROLL_HISTORY_VIEW_OWN,
    ]);
    selfEmpCookie = `${ACCESS_TOKEN_COOKIE}=${await jwtService.signAsync({
      sub: selfEmpActor.user._id.toHexString(),
      sid: selfEmpActor.session._id.toHexString(),
      type: 'access',
    })}`;

    // Branches & Departments (active + soft-deleted)
    branchHQ = await factory.createBranch({ name: `${runTag}_HQ` });
    branchWest = await factory.createBranch({ name: `${runTag}_West` });
    branchDeleted = await factory.createBranch({
      name: `${runTag}_ClosedBranch`,
      isActive: false,
      deletedAt: new Date(),
    });

    deptEng = await deptModel.create({ name: `${runTag}_Eng`, isActive: true });
    deptSales = await deptModel.create({
      name: `${runTag}_Sales`,
      isActive: true,
    });
    deptDeleted = await deptModel.create({
      name: `${runTag}_DeletedDept`,
      isActive: false,
      deletedAt: new Date(),
    });
    desigDev = await desigModel.create({
      name: `${runTag}_Dev`,
      isActive: true,
    });
    createdDeptIds.push(deptEng._id, deptSales._id, deptDeleted._id);
    createdDesigIds.push(desigDev._id);

    liveBasicComp = await salaryComponentModel.create({
      name: 'Basic Salary Original',
      code: `${runTag}_BASIC`,
      type: SalaryComponentType.EARNING,
      calculationType: null,
      percentageOf: null,
      isTaxable: true,
      isStatutory: false,
      isActive: true,
      createdBy: hrUserId,
      updatedBy: hrUserId,
    });
    createdComponentIds.push(liveBasicComp._id);

    // Employees
    emp1 = await factory.createEmployee({
      userId: selfEmpActor.user._id,
      employeeCode: `${runTag}_E1`,
      firstName: 'Asha',
      lastName: 'Rao',
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
      branchId: branchHQ._id,
      departmentId: deptEng._id,
      designationId: desigDev._id,
    });
    emp2 = await factory.createEmployee({
      employeeCode: `=CMD_${runTag}_E2`,
      firstName: 'Bob',
      lastName: 'Lee',
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
      branchId: branchWest._id,
      departmentId: deptSales._id,
      designationId: desigDev._id,
    });
    emp3 = await factory.createEmployee({
      employeeCode: `${runTag}_E3`,
      firstName: 'Kiran',
      lastName: 'Patel',
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
      branchId: branchDeleted._id,
      departmentId: deptDeleted._id,
      designationId: desigDev._id,
    });
    emp4 = await factory.createEmployee({
      employeeCode: `${runTag}_E4`,
      firstName: 'Meera',
      lastName: 'Nair',
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
      branchId: branchWest._id,
      departmentId: deptEng._id,
      designationId: desigDev._id,
    });
    empDeletedSelf = await factory.createEmployee({
      employeeCode: `${runTag}_E5_DEL`,
      firstName: 'Archived',
      lastName: 'User',
      dateOfJoining: new Date(`${testYear}-01-01T00:00:00.000Z`),
      branchId: branchHQ._id,
      departmentId: deptEng._id,
      designationId: desigDev._id,
      employmentStatus: EmploymentStatus.RESIGNED,
      deletedAt: new Date(),
    });

    // Payroll Periods (FINALIZED + non-finalized + soft-deleted + empty FINALIZED)
    periodJanInr = await factory.createPayrollPeriod({
      periodName: `${runTag} Jan INR`,
      periodCode: `${runTag}-JAN-INR`,
      startDate: new Date(`${testYear}-01-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-01-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-02-01T00:00:00.000Z`),
      month: 1,
      year: testYear,
      status: PayrollPeriodStatus.FINALIZED,
      approval: {
        approvedBy: hrUserId,
        approvedAt: new Date(),
        approvedRecordsCount: 3,
        alreadyApprovedRecordsCount: 0,
        totalGrossEarnings: '90000.00',
        totalDeductions: '17000.00',
        totalEmployerContributions: '3500.00',
        totalNetSalary: '75000.00',
        totalEmployerCost: '93500.00',
        reason: 'Finalized Jan INR',
        acknowledgeAnomalies: false,
        acknowledgedAnomalyEmployees: 0,
        acknowledgedWarningCodes: [],
      },
      updatedBy: hrUserId,
    });

    periodFebUsd = await factory.createPayrollPeriod({
      periodName: `${runTag} Feb USD`,
      periodCode: `${runTag}-FEB-USD`,
      startDate: new Date(`${testYear}-02-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-02-28T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-03-01T00:00:00.000Z`),
      month: 2,
      year: testYear,
      status: PayrollPeriodStatus.FINALIZED,
      approval: {
        approvedBy: hrUserId,
        approvedAt: new Date(),
        approvedRecordsCount: 1,
        alreadyApprovedRecordsCount: 0,
        totalGrossEarnings: '4000.00',
        totalDeductions: '400.00',
        totalEmployerContributions: '200.00',
        totalNetSalary: '3600.00',
        totalEmployerCost: '4200.00',
        reason: 'Finalized Feb USD',
        acknowledgeAnomalies: false,
        acknowledgedAnomalyEmployees: 0,
        acknowledgedWarningCodes: [],
      },
      updatedBy: hrUserId,
    });

    periodDraft = await factory.createPayrollPeriod({
      periodName: `${runTag} Mar Draft`,
      periodCode: `${runTag}-MAR-DRAFT`,
      startDate: new Date(`${testYear}-03-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-03-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-04-01T00:00:00.000Z`),
      month: 3,
      year: testYear,
      status: PayrollPeriodStatus.DRAFT,
    });

    periodApprovedUnfinalized = await factory.createPayrollPeriod({
      periodName: `${runTag} Apr Approved Unfinalized`,
      periodCode: `${runTag}-APR-APPR`,
      startDate: new Date(`${testYear}-04-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-04-30T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-05-01T00:00:00.000Z`),
      month: 4,
      year: testYear,
      status: PayrollPeriodStatus.APPROVED,
    });

    periodSoftDeleted = await factory.createPayrollPeriod({
      periodName: `${runTag} May Deleted`,
      periodCode: `${runTag}-MAY-DEL`,
      startDate: new Date(`${testYear}-05-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-05-31T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-06-01T00:00:00.000Z`),
      month: 5,
      year: testYear,
      status: PayrollPeriodStatus.FINALIZED,
      deletedAt: new Date(),
    });

    periodEmptyFinalized = await factory.createPayrollPeriod({
      periodName: `${runTag} Jun Empty Finalized`,
      periodCode: `${runTag}-JUN-EMPTY`,
      startDate: new Date(`${testYear}-06-01T00:00:00.000Z`),
      endDate: new Date(`${testYear}-06-30T00:00:00.000Z`),
      paymentDate: new Date(`${testYear}-07-01T00:00:00.000Z`),
      month: 6,
      year: testYear,
      status: PayrollPeriodStatus.FINALIZED,
      approval: {
        approvedBy: hrUserId,
        approvedAt: new Date(),
        approvedRecordsCount: 0,
        alreadyApprovedRecordsCount: 0,
        totalGrossEarnings: '0.00',
        totalDeductions: '0.00',
        totalEmployerContributions: '0.00',
        totalNetSalary: '0.00',
        totalEmployerCost: '0.00',
        reason: 'Empty cycle',
        acknowledgeAnomalies: false,
        acknowledgedAnomalyEmployees: 0,
        acknowledgedWarningCodes: [],
      },
      updatedBy: hrUserId,
    });

    createdRecordPeriodIds.push(
      periodJanInr._id,
      periodFebUsd._id,
      periodDraft._id,
      periodApprovedUnfinalized._id,
      periodSoftDeleted._id,
      periodEmptyFinalized._id,
    );

    const buildRecordPayload = (opts: {
      period: PayrollPeriodDocument;
      emp: EmployeeDocument;
      name: string;
      currency: string;
      gross: string;
      ded: string;
      er: string;
      net: string;
      lop: number;
      status: PayrollRecordStatus;
      netPayClamped?: boolean;
      deletedAt?: Date | null;
      earningId?: string;
      earningCode?: string;
      earningName?: string;
    }) => ({
      payrollPeriodId: opts.period._id,
      employeeId: opts.emp._id,
      salaryAssignmentId: new Types.ObjectId(),
      salaryStructureId: new Types.ObjectId(),
      grossEarnings: Types.Decimal128.fromString(opts.gross),
      totalDeductions: Types.Decimal128.fromString(opts.ded),
      employerContributions: Types.Decimal128.fromString(opts.er),
      netSalary: Types.Decimal128.fromString(opts.net),
      status: opts.status,
      calculatedAt: new Date(),
      calculationVersion: 1,
      approvedAt:
        opts.status === PayrollRecordStatus.APPROVED ? new Date() : null,
      approvedBy:
        opts.status === PayrollRecordStatus.APPROVED ? hrUserId : null,
      deletedAt: opts.deletedAt ?? null,
      createdBy: hrUserId,
      updatedBy: hrUserId,
      calculationSnapshot: {
        engineVersion: '1.0.0',
        calculatedAt: new Date(),
        payrollPeriodId: opts.period._id.toHexString(),
        periodCode: opts.period.periodCode,
        periodName: opts.period.periodName,
        payrollFrequency: PayrollFrequency.MONTHLY,
        startDate: opts.period.startDate.toISOString().slice(0, 10),
        endDate: opts.period.endDate.toISOString().slice(0, 10),
        month: opts.period.month,
        year: opts.period.year,
        employeeId: opts.emp._id.toHexString(),
        employeeCode: opts.emp.employeeCode,
        employeeName: opts.name,
        employmentStatus: EmploymentStatus.ACTIVE,
        salaryAssignmentId: new Types.ObjectId().toHexString(),
        salaryAssignmentVersion: 0,
        salaryAssignmentEffectiveFrom: `${testYear}-01-01`,
        salaryAssignmentEffectiveTo: null,
        salaryStructureId: new Types.ObjectId().toHexString(),
        salaryStructureCode: 'STD',
        salaryStructureName: 'Std',
        salaryStructureVersion: 0,
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        payrollSettingsId: null,
        payrollSettingsVersion: null,
        payrollCalculationRuleId: null,
        payrollCalculationRuleVersion: null,
        currency: opts.currency,
        roundingMode: PayrollRoundingMode.HALF_UP,
        roundingPrecision: 2,
        prorationPolicy: PayrollProrationPolicy.CALENDAR_DAYS,
        prorateFixedComponents: true,
        prorateDeductions: true,
        prorateEmployerContributions: true,
        negativeNetPayPolicy: NegativeNetPayPolicy.CLAMP_TO_ZERO,
        calendarDays: 30,
        tenureCalendarDays: 30,
        eligibleWorkingDays: 22,
        weeklyOffDays: 8,
        holidayDays: 0,
        presentDays: 22 - opts.lop,
        halfDays: 0,
        paidLeaveDays: 0,
        unpaidLeaveDays: opts.lop,
        unpaidLeaveLopDays: opts.lop,
        attendanceAbsenceDays: 0,
        attendanceAbsenceLopDays: 0,
        halfDayDeductions: 0,
        totalLopDays: opts.lop,
        pendingCancellationLeaveDays: 0,
        attendanceLeaveWarnings: [],
        leaveAttendanceMismatchDates: [],
        prorationDenominatorDays: 30,
        payableDays: 30 - opts.lop,
        prorationApplied: opts.lop > 0,
        prorationFactor: '1',
        executionOrder: [opts.earningCode ?? 'BASIC', 'PF_EE', 'PF_ER'],
        earnings: [
          {
            componentId: opts.earningId ?? liveBasicComp._id.toHexString(),
            componentCode: opts.earningCode ?? liveBasicComp.code,
            componentName: opts.earningName ?? liveBasicComp.name,
            classification: SalaryComponentType.EARNING,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString(opts.gross),
            monthlyCalculatedAmount: Types.Decimal128.fromString(opts.gross),
            prorationApplied: false,
            payableDays: 30 - opts.lop,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString(opts.gross),
          },
        ],
        deductions: [
          {
            componentId: 'COMP_PF_EE',
            componentCode: `PF_EE_${opts.currency}`,
            componentName: `PF Employee (${opts.currency})`,
            classification: SalaryComponentType.EMPLOYEE_DEDUCTION,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString(opts.ded),
            monthlyCalculatedAmount: Types.Decimal128.fromString(opts.ded),
            prorationApplied: false,
            payableDays: 30 - opts.lop,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString(opts.ded),
          },
        ],
        employerContributions: [
          {
            componentId: 'COMP_PF_ER',
            componentCode: `PF_ER_${opts.currency}`,
            componentName: `PF Employer (${opts.currency})`,
            classification: SalaryComponentType.EMPLOYER_CONTRIBUTION,
            calculationMethod: StructureComponentCalculationType.FIXED,
            percentage: null,
            percentageOf: null,
            monthlyBaseAmount: Types.Decimal128.fromString(opts.er),
            monthlyCalculatedAmount: Types.Decimal128.fromString(opts.er),
            prorationApplied: false,
            payableDays: 30 - opts.lop,
            calendarDays: 30,
            finalAmount: Types.Decimal128.fromString(opts.er),
          },
        ],
        grossEarnings: Types.Decimal128.fromString(opts.gross),
        totalDeductions: Types.Decimal128.fromString(opts.ded),
        employerContributionsTotal: Types.Decimal128.fromString(opts.er),
        netSalary: Types.Decimal128.fromString(opts.net),
        netPayClamped: Boolean(opts.netPayClamped),
      },
    });

    const [recEmp1Jan] = await recordModel.create([
      // Emp1 Jan INR (HQ + Eng)
      buildRecordPayload({
        period: periodJanInr,
        emp: emp1,
        name: 'Asha Rao',
        currency: 'INR',
        gross: '50000.00',
        ded: '3000.00',
        er: '2000.00',
        net: '47000.00',
        lop: 1,
        status: PayrollRecordStatus.APPROVED,
      }),
      // Emp3 Jan INR (Deleted branch + deleted dept)
      buildRecordPayload({
        period: periodJanInr,
        emp: emp3,
        name: 'Kiran Patel',
        currency: 'INR',
        gross: '30000.00',
        ded: '2000.00',
        er: '1000.00',
        net: '28000.00',
        lop: 0.5,
        status: PayrollRecordStatus.APPROVED,
      }),
      // Emp4 Jan INR (West + Eng, negative-net-pay clamped: 10000 - 12000 -> net 0.00, employerCost = 10500.00)
      buildRecordPayload({
        period: periodJanInr,
        emp: emp4,
        name: 'Meera Nair',
        currency: 'INR',
        gross: '10000.00',
        ded: '12000.00',
        er: '500.00',
        net: '0.00',
        lop: 0,
        status: PayrollRecordStatus.APPROVED,
        netPayClamped: true,
      }),
      // Emp2 Jan INR INVALIDATED -> must be excluded
      buildRecordPayload({
        period: periodJanInr,
        emp: emp2,
        name: 'Bob Lee',
        currency: 'INR',
        gross: '99999.00',
        ded: '0.00',
        er: '0.00',
        net: '99999.00',
        lop: 0,
        status: PayrollRecordStatus.INVALIDATED,
      }),
      // Emp2 Feb USD (West + Sales)
      buildRecordPayload({
        period: periodFebUsd,
        emp: emp2,
        name: 'Bob Lee',
        currency: 'USD',
        gross: '4000.00',
        ded: '400.00',
        er: '200.00',
        net: '3600.00',
        lop: 2,
        status: PayrollRecordStatus.APPROVED,
        earningId: 'COMP_BASIC_USD',
        earningCode: 'BASIC_USD',
        earningName: 'Basic Salary USD',
      }),
      // Emp4 Feb USD soft-deleted PayrollRecord -> must be excluded
      buildRecordPayload({
        period: periodFebUsd,
        emp: emp4,
        name: 'Meera Nair',
        currency: 'USD',
        gross: '88888.00',
        ded: '0.00',
        er: '0.00',
        net: '88888.00',
        lop: 0,
        status: PayrollRecordStatus.APPROVED,
        deletedAt: new Date(),
      }),
      // Emp1 Apr Unfinalized period -> must be excluded
      buildRecordPayload({
        period: periodApprovedUnfinalized,
        emp: emp1,
        name: 'Asha Rao',
        currency: 'INR',
        gross: '77777.00',
        ded: '0.00',
        er: '0.00',
        net: '77777.00',
        lop: 0,
        status: PayrollRecordStatus.APPROVED,
      }),
    ]);

    // Mutate live SalaryComponent definition AFTER finalization to prove component report reads immutable snapshot
    await salaryComponentModel.updateOne(
      { _id: liveBasicComp._id },
      { $set: { name: 'MUTATED LIVE NAME DO NOT SHOW' } },
    );

    // Payslip exists ONLY for emp1 Jan INR
    await payslipModel.create({
      payrollPeriodId: periodJanInr._id,
      payrollRecordId: recEmp1Jan._id,
      employeeId: emp1._id,
      payrollCalculationVersion: 1,
      templateVersion: '1.0.0',
      fileKey: 'hrms/payroll/payslips/secret/key.pdf',
      fileName: `payslip-${periodJanInr.periodCode}-${emp1.employeeCode}.pdf`,
      mimeType: 'application/pdf',
      fileSize: 1024,
      checksumSha256: 'abc123',
      generatedAt: new Date(),
      generatedBy: hrUserId,
    });
  });

  afterAll(async () => {
    try {
      if (isConnected && connection) {
        if (payslipModel && createdRecordPeriodIds.length > 0) {
          await payslipModel.deleteMany({
            payrollPeriodId: { $in: createdRecordPeriodIds },
          });
        }
        if (recordModel && createdRecordPeriodIds.length > 0) {
          await recordModel.deleteMany({
            payrollPeriodId: { $in: createdRecordPeriodIds },
          });
        }
        if (salaryComponentModel && createdComponentIds.length > 0) {
          await salaryComponentModel.deleteMany({
            _id: { $in: createdComponentIds },
          });
        }
        if (deptModel && createdDeptIds.length > 0) {
          await deptModel.deleteMany({ _id: { $in: createdDeptIds } });
        }
        if (desigModel && createdDesigIds.length > 0) {
          await desigModel.deleteMany({ _id: { $in: createdDesigIds } });
        }
        await tracker.cleanupAll(connection, models);
      }
    } finally {
      if (app) {
        await app.close();
      } else if (moduleRef) {
        await moduleRef.close();
      }
    }
  });

  it('verifies schema indexes and real JWT authentication / RBAC across all 7 report endpoints', async () => {
    const periodIdx = await models.payrollPeriodModel.collection.indexes();
    const recordIdx = await recordModel.collection.indexes();
    expect(
      periodIdx.some((i) => i.name === 'idx_payroll_periods_status_dates'),
    ).toBe(true);
    expect(
      recordIdx.some((i) => i.name === 'idx_payroll_records_emp_status_period'),
    ).toBe(true);

    const httpServer = app!.getHttpServer();
    const reportPaths = [
      `/api/v1/payroll/reports/monthly-summary?year=${testYear}`,
      `/api/v1/payroll/reports/department-wise?year=${testYear}`,
      `/api/v1/payroll/reports/branch-wise?year=${testYear}`,
      `/api/v1/payroll/reports/employee-wise?year=${testYear}`,
      `/api/v1/payroll/reports/components?year=${testYear}`,
      `/api/v1/payroll/reports/monthly-summary/export?year=${testYear}`,
      `/api/v1/payroll/reports/employee-wise/export?year=${testYear}`,
    ];

    // 1. Unauthenticated -> 401
    for (const urlPath of reportPaths) {
      await request(httpServer).get(urlPath).expect(HttpStatus.UNAUTHORIZED);
    }

    // 2. Authenticated employee without report permissions -> 403 on all 7 report endpoints
    for (const urlPath of reportPaths) {
      await request(httpServer)
        .get(urlPath)
        .set('Cookie', selfEmpCookie)
        .expect(HttpStatus.FORBIDDEN);
    }

    // 3. Report viewer (PAYROLL_REPORTS_VIEW only) -> 200 on JSON reports, 403 on both CSV exports
    for (const jsonPath of reportPaths.slice(0, 5)) {
      await request(httpServer)
        .get(jsonPath)
        .set('Cookie', viewerOnlyCookie)
        .expect(HttpStatus.OK);
    }
    for (const exportPath of reportPaths.slice(5)) {
      await request(httpServer)
        .get(exportPath)
        .set('Cookie', viewerOnlyCookie)
        .expect(HttpStatus.FORBIDDEN);
    }

    // 4. Full report + export permissions -> 200 on all 7
    for (const urlPath of reportPaths) {
      await request(httpServer)
        .get(urlPath)
        .set('Cookie', fullActorCookie)
        .expect(HttpStatus.OK);
    }
  });

  it('verifies finalized payroll history, invalidated/deleted exclusions, payslip availability, and employee self-service IDOR', async () => {
    const httpServer = app!.getHttpServer();

    const historyListRes = await request(httpServer)
      .get(`/api/v1/payroll/history?year=${testYear}&page=1&limit=10`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const historyBody = historyListRes.body as {
      data: Array<{ periodCode: string; totalNetSalary: string }>;
      meta: { total: number };
    };
    expect(historyBody.meta.total).toBe(3); // Jun Empty, Feb USD, Jan INR
    expect(historyBody.data.map((d) => d.periodCode)).toEqual([
      `${runTag}-JUN-EMPTY`,
      `${runTag}-FEB-USD`,
      `${runTag}-JAN-INR`,
    ]);

    // Non-finalized period -> 404
    await request(httpServer)
      .get(
        `/api/v1/payroll/history/${periodApprovedUnfinalized._id.toHexString()}`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.NOT_FOUND);

    // Period detail excludes INVALIDATED record
    const periodDetailRes = await request(httpServer)
      .get(`/api/v1/payroll/history/${periodJanInr._id.toHexString()}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const periodDetail = (
      periodDetailRes.body as {
        data: {
          approvedEmployeeCount: number;
          excludedInvalidatedCount: number;
          generatedPayslipsCount: number;
          totalGrossEarnings: string;
          totalDeductions: string;
          totalNetSalary: string;
          totalEmployerContributions: string;
          totalEmployerCost: string;
        };
      }
    ).data;
    expect(periodDetail.approvedEmployeeCount).toBe(3);
    expect(periodDetail.excludedInvalidatedCount).toBe(1);
    expect(periodDetail.generatedPayslipsCount).toBe(1);
    expect(periodDetail.totalGrossEarnings).toBe('90000.00');
    expect(periodDetail.totalDeductions).toBe('17000.00');
    expect(periodDetail.totalNetSalary).toBe('75000.00');
    expect(periodDetail.totalEmployerContributions).toBe('3500.00');
    expect(periodDetail.totalEmployerCost).toBe('93500.00');

    // Self-service employee history (real JWT)
    const emp1HistRes = await request(httpServer)
      .get(
        `/api/v1/payroll/history/employees/${emp1._id.toHexString()}?year=${testYear}`,
      )
      .set('Cookie', selfEmpCookie)
      .expect(HttpStatus.OK);
    const emp1HistBody = emp1HistRes.body as {
      data: Array<{
        netSalary: string;
        payslipAvailable: boolean;
        fileKey?: string;
      }>;
    };
    expect(emp1HistBody.data).toHaveLength(1);
    expect(emp1HistBody.data[0].netSalary).toBe('47000.00');
    expect(emp1HistBody.data[0].payslipAvailable).toBe(true);
    expect(emp1HistBody.data[0].fileKey).toBeUndefined();

    // Emp1 CANNOT read Emp2 -> 403 IDOR
    await request(httpServer)
      .get(`/api/v1/payroll/history/employees/${emp2._id.toHexString()}`)
      .set('Cookie', selfEmpCookie)
      .expect(HttpStatus.FORBIDDEN);

    // Emp1 details in Jan INR vs non-finalized period -> 404
    const emp1DetailRes = await request(httpServer)
      .get(
        `/api/v1/payroll/history/employees/${emp1._id.toHexString()}/${periodJanInr._id.toHexString()}`,
      )
      .set('Cookie', selfEmpCookie)
      .expect(HttpStatus.OK);
    const emp1Detail = (
      emp1DetailRes.body as {
        data: {
          employerCost: string;
          payslipAvailable: boolean;
          lopSummary: { totalLopDays: number };
        };
      }
    ).data;
    expect(emp1Detail.employerCost).toBe('52000.00');
    expect(emp1Detail.payslipAvailable).toBe(true);
    expect(emp1Detail.lopSummary.totalLopDays).toBe(1);

    await request(httpServer)
      .get(
        `/api/v1/payroll/history/employees/${emp1._id.toHexString()}/${periodApprovedUnfinalized._id.toHexString()}`,
      )
      .set('Cookie', selfEmpCookie)
      .expect(HttpStatus.NOT_FOUND);

    // Soft-deleted employee -> 404 for HR
    await request(httpServer)
      .get(
        `/api/v1/payroll/history/employees/${empDeletedSelf._id.toHexString()}`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('Report 1: Monthly Summary supports year/month/branch/department filters, multi-currency isolation, clamped net pay reconciliation, and empty datasets', async () => {
    const httpServer = app!.getHttpServer();

    // Multi-currency unfiltered by year (excludes DRAFT, APPROVED unfinalized, soft-deleted period, INVALIDATED & soft-deleted records)
    const yearlyRes = await request(httpServer)
      .get(`/api/v1/payroll/reports/monthly-summary?year=${testYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const yearly = (
      yearlyRes.body as {
        data: {
          payrollPeriods: Array<{ periodCode: string }>;
          summaries: Array<{
            currency: string;
            totalEmployees: number;
            totalRecords: number;
            totalGrossEarnings: string;
            totalEmployeeDeductions: string;
            totalNetSalary: string;
            totalEmployerContributions: string;
            totalEmployerCost: string;
            totalLOPDays: number;
          }>;
        };
      }
    ).data;
    expect(yearly.payrollPeriods).toHaveLength(3);
    expect(yearly.summaries).toHaveLength(2);

    const inr = yearly.summaries.find((s) => s.currency === 'INR')!;
    const usd = yearly.summaries.find((s) => s.currency === 'USD')!;
    expect(inr.totalEmployees).toBe(3);
    expect(inr.totalGrossEarnings).toBe('90000.00');
    expect(inr.totalEmployeeDeductions).toBe('17000.00');
    expect(inr.totalNetSalary).toBe('75000.00'); // 47000 + 28000 + 0 (clamped emp4)
    expect(inr.totalEmployerContributions).toBe('3500.00');
    expect(inr.totalEmployerCost).toBe('93500.00'); // 90000 + 3500
    expect(inr.totalLOPDays).toBe(1.5);
    expect(
      toDecimal(inr.totalGrossEarnings)
        .plus(toDecimal(inr.totalEmployerContributions))
        .equals(toDecimal(inr.totalEmployerCost)),
    ).toBe(true);

    expect(usd.totalEmployees).toBe(1);
    expect(usd.totalGrossEarnings).toBe('4000.00');
    expect(usd.totalEmployeeDeductions).toBe('400.00');
    expect(usd.totalNetSalary).toBe('3600.00');
    expect(usd.totalEmployerContributions).toBe('200.00');
    expect(usd.totalEmployerCost).toBe('4200.00');
    expect(
      toDecimal(usd.totalGrossEarnings)
        .minus(toDecimal(usd.totalEmployeeDeductions))
        .equals(toDecimal(usd.totalNetSalary)),
    ).toBe(true);

    // Month filter (month=1 -> INR only)
    const janRes = await request(httpServer)
      .get(`/api/v1/payroll/reports/monthly-summary?year=${testYear}&month=1`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const janData = (
      janRes.body as {
        data: {
          payrollPeriods: Array<{ month: number }>;
          summaries: unknown[];
        };
      }
    ).data;
    expect(janData.payrollPeriods).toHaveLength(1);
    expect(janData.payrollPeriods[0].month).toBe(1);
    expect(janData.summaries).toHaveLength(1);

    // Branch + Department combined filter (branchWest + deptEng -> emp4 clamped record)
    const filteredRes = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/monthly-summary?year=${testYear}&branchId=${branchWest._id.toHexString()}&departmentId=${deptEng._id.toHexString()}`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const filteredSummaries = (
      filteredRes.body as {
        data: {
          summaries: Array<{
            totalEmployees: number;
            totalGrossEarnings: string;
            totalEmployeeDeductions: string;
            totalNetSalary: string;
            totalEmployerContributions: string;
            totalEmployerCost: string;
          }>;
        };
      }
    ).data.summaries;
    expect(filteredSummaries).toHaveLength(1);
    expect(filteredSummaries[0]).toMatchObject({
      totalEmployees: 1,
      totalGrossEarnings: '10000.00',
      totalEmployeeDeductions: '12000.00',
      totalNetSalary: '0.00',
      totalEmployerContributions: '500.00',
      totalEmployerCost: '10500.00',
    });

    // Empty report year -> valid empty arrays
    const emptyRes = await request(httpServer)
      .get(`/api/v1/payroll/reports/monthly-summary?year=${emptyYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    expect(emptyRes.body).toMatchObject({
      success: true,
      data: { payrollPeriods: [], summaries: [] },
    });
  });

  it('Reports 2 & 3: Department-wise & Branch-wise grouping, branch filter, and deleted entity Unassigned / Unknown fallback', async () => {
    const httpServer = app!.getHttpServer();

    // Department-wise unfiltered
    const deptAllRes = await request(httpServer)
      .get(`/api/v1/payroll/reports/department-wise?year=${testYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const deptRows = (
      deptAllRes.body as {
        data: Array<{
          departmentId: string | null;
          departmentName: string;
          currency: string;
          employeeCount: number;
          grossEarnings: string;
          employeeDeductions: string;
          netSalary: string;
          employerContributions: string;
          employerCost: string;
        }>;
      }
    ).data;
    expect(deptRows).toHaveLength(3); // Eng (INR), Sales (USD), Unassigned (INR)

    const engRow = deptRows.find((r) => r.departmentName === `${runTag}_Eng`)!;
    expect(engRow.departmentId).toBe(deptEng._id.toHexString());
    expect(engRow.employeeCount).toBe(2); // emp1 + emp4
    expect(engRow.grossEarnings).toBe('60000.00');
    expect(engRow.employeeDeductions).toBe('15000.00');
    expect(engRow.netSalary).toBe('47000.00');
    expect(engRow.employerContributions).toBe('2500.00');
    expect(engRow.employerCost).toBe('62500.00');

    const unassignedDept = deptRows.find(
      (r) =>
        r.departmentName === PAYROLL_REPORTING_CONSTANTS.UNASSIGNED_GROUP_LABEL,
    )!;
    expect(unassignedDept.departmentId).toBeNull();
    expect(unassignedDept.netSalary).toBe('28000.00');

    // Department-wise filtered by branchWest -> emp4 (Eng INR) + emp2 (Sales USD)
    const deptBranchRes = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/department-wise?year=${testYear}&branchId=${branchWest._id.toHexString()}`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const deptWestRows = (
      deptBranchRes.body as {
        data: Array<{ departmentName: string; netSalary: string }>;
      }
    ).data;
    expect(deptWestRows).toHaveLength(2);
    expect(
      deptWestRows.find((r) => r.departmentName === `${runTag}_Eng`)?.netSalary,
    ).toBe('0.00');
    expect(
      deptWestRows.find((r) => r.departmentName === `${runTag}_Sales`)
        ?.netSalary,
    ).toBe('3600.00');

    // Branch-wise unfiltered -> HQ (INR), West (INR + USD separate rows), Unassigned (INR)
    const branchRes = await request(httpServer)
      .get(`/api/v1/payroll/reports/branch-wise?year=${testYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const branchRows = (
      branchRes.body as {
        data: Array<{
          branchId: string | null;
          branchName: string;
          currency: string;
          netSalary: string;
          employerCost: string;
        }>;
      }
    ).data;
    expect(branchRows).toHaveLength(4);
    expect(
      branchRows.find(
        (r) => r.branchName === `${runTag}_HQ` && r.currency === 'INR',
      )?.employerCost,
    ).toBe('52000.00');
    expect(
      branchRows.find(
        (r) => r.branchName === `${runTag}_West` && r.currency === 'USD',
      )?.netSalary,
    ).toBe('3600.00');
    expect(
      branchRows.find(
        (r) =>
          r.branchName === PAYROLL_REPORTING_CONSTANTS.UNASSIGNED_GROUP_LABEL,
      )?.branchId,
    ).toBeNull();
  });

  it('Report 4 & Report 5: Employee-wise filters/pagination and Component Report using immutable snapshots', async () => {
    const httpServer = app!.getHttpServer();

    // Employee-wise pagination page 1 & page 2 (4 valid employee-currency groups)
    const page1Res = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/employee-wise?year=${testYear}&page=1&limit=2`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const page1Body = page1Res.body as {
      data: Array<{ employeeCode: string }>;
      meta: { total: number; totalPages: number };
    };
    expect(page1Body.meta.total).toBe(4);
    expect(page1Body.meta.totalPages).toBe(2);
    expect(page1Body.data).toHaveLength(2);

    // Search filter
    const searchRes = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/employee-wise?year=${testYear}&search=Kiran`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const searchData = (
      searchRes.body as {
        data: Array<{ employeeCode: string; netSalary: string }>;
      }
    ).data;
    expect(searchData).toHaveLength(1);
    expect(searchData[0].employeeCode).toBe(`${runTag}_E3`);
    expect(searchData[0].netSalary).toBe('28000.00');

    // Department + branch filter
    const empFilterRes = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/employee-wise?year=${testYear}&departmentId=${deptEng._id.toHexString()}&branchId=${branchHQ._id.toHexString()}`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    expect((empFilterRes.body as { data: unknown[] }).data).toHaveLength(1);

    // Component Report: EARNING, EMPLOYEE_DEDUCTION, EMPLOYER_CONTRIBUTION, and unfiltered
    const earningRes = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/components?year=${testYear}&componentType=${SalaryComponentType.EARNING}`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const earnings = (
      earningRes.body as {
        data: Array<{
          componentCode: string;
          componentName: string;
          componentType: SalaryComponentType;
          currency: string;
          totalAmount: string;
        }>;
      }
    ).data;
    const basicInr = earnings.find((e) => e.currency === 'INR')!;
    // Must reflect immutable snapshot name ("Basic Salary Original"), NOT mutated live DB name
    expect(basicInr.componentName).toBe('Basic Salary Original');
    expect(basicInr.componentName).not.toBe('MUTATED LIVE NAME DO NOT SHOW');
    expect(basicInr.totalAmount).toBe('90000.00');
    expect(earnings.find((e) => e.currency === 'USD')?.totalAmount).toBe(
      '4000.00',
    );

    const dedRes = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/components?year=${testYear}&componentType=${SalaryComponentType.EMPLOYEE_DEDUCTION}`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const deds = (
      dedRes.body as {
        data: Array<{ currency: string; totalAmount: string }>;
      }
    ).data;
    expect(deds.find((d) => d.currency === 'INR')?.totalAmount).toBe(
      '17000.00',
    );
    expect(deds.find((d) => d.currency === 'USD')?.totalAmount).toBe('400.00');

    const erRes = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/components?year=${testYear}&componentType=${SalaryComponentType.EMPLOYER_CONTRIBUTION}`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const ers = (
      erRes.body as {
        data: Array<{ currency: string; totalAmount: string }>;
      }
    ).data;
    expect(ers.find((e) => e.currency === 'INR')?.totalAmount).toBe('3500.00');
    expect(ers.find((e) => e.currency === 'USD')?.totalAmount).toBe('200.00');

    // Unfiltered returns all 6 component-currency rows across all 3 types
    const allCompRes = await request(httpServer)
      .get(`/api/v1/payroll/reports/components?year=${testYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    expect((allCompRes.body as { data: unknown[] }).data).toHaveLength(6);
  });

  it('Reports 6 & 7: Monthly Summary & Employee-wise CSV Exports verify headers, filters, empty behavior, and export row limit enforcement', async () => {
    const httpServer = app!.getHttpServer();

    // 1. Monthly Summary CSV export
    const csvMonthlyRes = await request(httpServer)
      .get(`/api/v1/payroll/reports/monthly-summary/export?year=${testYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    expect(csvMonthlyRes.headers['content-type']).toContain('text/csv');
    expect(csvMonthlyRes.headers['content-disposition']).toMatch(
      /attachment; filename="payroll-monthly-summary-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(csvMonthlyRes.headers['cache-control']).toBe('no-store, private');
    expect(csvMonthlyRes.headers['x-content-type-options']).toBe('nosniff');
    expect(csvMonthlyRes.text).toContain(
      '"Period Codes","Currency","Total Employees"',
    );
    expect(csvMonthlyRes.text).toContain('"90000.00"');
    expect(csvMonthlyRes.text).toContain('"93500.00"');
    expect(csvMonthlyRes.text).toContain('"4000.00"');
    expect(csvMonthlyRes.text).toContain('"4200.00"');

    // 2. Employee-wise CSV export with formula sanitization + search filter
    const csvEmpRes = await request(httpServer)
      .get(`/api/v1/payroll/reports/employee-wise/export?year=${testYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    expect(csvEmpRes.text).toContain(`"'=CMD_${runTag}_E2"`);
    expect(csvEmpRes.text).toContain('52000.00');

    const csvFilteredRes = await request(httpServer)
      .get(
        `/api/v1/payroll/reports/employee-wise/export?year=${testYear}&search=Kiran`,
      )
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    const filteredLines = csvFilteredRes.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/);
    expect(filteredLines).toHaveLength(2); // 1 header + 1 matching row
    expect(filteredLines[1]).toContain(`${runTag}_E3`);

    // 3. Empty CSV exports return headers only without fabricated rows
    const emptyMonthlyCsv = await request(httpServer)
      .get(`/api/v1/payroll/reports/monthly-summary/export?year=${emptyYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    expect(
      emptyMonthlyCsv.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/),
    ).toHaveLength(1);

    const emptyEmpCsv = await request(httpServer)
      .get(`/api/v1/payroll/reports/employee-wise/export?year=${emptyYear}`)
      .set('Cookie', fullActorCookie)
      .expect(HttpStatus.OK);
    expect(
      emptyEmpCsv.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/),
    ).toHaveLength(1);

    // 4. Export row limit enforcement via real MongoDB cursor $limit
    const origMaxRows = PAYROLL_REPORTING_CONSTANTS.MAX_EXPORT_ROWS;
    (
      PAYROLL_REPORTING_CONSTANTS as unknown as { MAX_EXPORT_ROWS: number }
    ).MAX_EXPORT_ROWS = 2;
    try {
      const cappedRes = await request(httpServer)
        .get(`/api/v1/payroll/reports/employee-wise/export?year=${testYear}`)
        .set('Cookie', fullActorCookie)
        .expect(HttpStatus.OK);
      const cappedLines = cappedRes.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/);
      // 4 total rows exist in testYear, cursor cap of 2 yields 1 header + 2 data rows
      expect(cappedLines).toHaveLength(3);
    } finally {
      (
        PAYROLL_REPORTING_CONSTANTS as unknown as { MAX_EXPORT_ROWS: number }
      ).MAX_EXPORT_ROWS = origMaxRows;
    }
  });
});
