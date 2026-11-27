/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import { ExecutionContext, HttpStatus, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollPeriodsService } from './services/payroll-periods.service';
import { PayrollAttendanceSummaryService } from './services/payroll-attendance-summary.service';
import { PayrollLeaveAttendanceResolverService } from './services/payroll-leave-attendance-resolver.service';
import { PayrollProcessingService } from '../payroll-calculations/services/payroll-processing.service';
import { EmployeeRepository } from '../employees/repositories/employee.repository';
import {
  PayrollPeriodPaginationOptions,
  PayrollPeriodQueryFilter,
  PayrollPeriodRepository,
} from './repositories/payroll-period.repository';
import { PayrollSettingsRepository } from '../payroll-configuration/repositories/payroll-settings.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { PayrollPeriodStatus } from './constants/payroll-period.constant';
import { PayrollFrequency } from '../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollPeriodLean } from './schemas/payroll-period.schema';
import { CreatePayrollPeriodDto } from './dto/create-payroll-period.dto';
import { UpdatePayrollPeriodDto } from './dto/update-payroll-period.dto';
import { UpdatePayrollPeriodStatusDto } from './dto/update-payroll-period-status.dto';
import { ListPayrollPeriodsQueryDto } from './dto/list-payroll-periods-query.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

/**
 * In-memory repository implementing the Mongoose collection behavior for Payroll Periods:
 * - Unique index on periodCode
 * - Unique index on (year, month, payrollFrequency)
 * - Date-range overlap detection
 * - Draft-only field updates
 * - Status transitions and concurrency versioning
 */
class InMemoryPayrollPeriodRepository {
  private store = new Map<string, PayrollPeriodLean>();

  clear(): void {
    this.store.clear();
  }

  softDelete(id: Types.ObjectId): void {
    const item = this.store.get(id.toHexString());
    if (item) {
      item.deletedAt = new Date();
    }
  }

  isDuplicateKeyError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes('E11000 duplicate key error')
    );
  }

  async create(data: Partial<PayrollPeriodLean>): Promise<PayrollPeriodLean> {
    const code = data.periodCode!.toUpperCase();

    // Unique index check: periodCode
    for (const item of this.store.values()) {
      if (item.deletedAt === null && item.periodCode.toUpperCase() === code) {
        throw new Error('E11000 duplicate key error: periodCode');
      }
    }

    // Unique index check: (year, month, payrollFrequency)
    for (const item of this.store.values()) {
      if (
        item.deletedAt === null &&
        item.year === data.year &&
        item.month === data.month &&
        item.payrollFrequency === data.payrollFrequency
      ) {
        throw new Error('E11000 duplicate key error: cycle');
      }
    }

    const _id = new Types.ObjectId();
    const doc: PayrollPeriodLean = {
      _id,
      periodName: data.periodName!,
      periodCode: code,
      payrollFrequency: data.payrollFrequency!,
      startDate: data.startDate!,
      endDate: data.endDate!,
      paymentDate: data.paymentDate!,
      month: data.month!,
      year: data.year!,
      status: data.status ?? PayrollPeriodStatus.DRAFT,
      notes: data.notes ?? null,
      deletedAt: null,
      createdBy: data.createdBy!,
      updatedBy: data.updatedBy!,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    };

    this.store.set(_id.toHexString(), doc);
    return { ...doc };
  }

  async findById(id: Types.ObjectId): Promise<PayrollPeriodLean | null> {
    const item = this.store.get(id.toHexString());
    if (!item || item.deletedAt !== null) return null;
    return { ...item };
  }

  async findByCode(code: string): Promise<PayrollPeriodLean | null> {
    const upper = code.trim().toUpperCase();
    for (const item of this.store.values()) {
      if (item.deletedAt === null && item.periodCode.toUpperCase() === upper) {
        return { ...item };
      }
    }
    return null;
  }

  async findOverlapping(
    startDate: Date,
    endDate: Date,
    excludeId?: Types.ObjectId,
  ): Promise<PayrollPeriodLean | null> {
    for (const item of this.store.values()) {
      if (item.deletedAt !== null) continue;
      if (excludeId && item._id.equals(excludeId)) continue;
      if (startDate <= item.endDate && endDate >= item.startDate) {
        return { ...item };
      }
    }
    return null;
  }

  async findDuplicateCycle(
    year: number,
    month: number,
    frequency: PayrollFrequency,
    excludeId?: Types.ObjectId,
  ): Promise<PayrollPeriodLean | null> {
    for (const item of this.store.values()) {
      if (item.deletedAt !== null) continue;
      if (excludeId && item._id.equals(excludeId)) continue;
      if (
        item.year === year &&
        item.month === month &&
        item.payrollFrequency === frequency
      ) {
        return { ...item };
      }
    }
    return null;
  }

  async updateById(
    id: Types.ObjectId,
    data: Partial<PayrollPeriodLean>,
    expectedVersion?: number,
  ): Promise<PayrollPeriodLean | null> {
    const item = this.store.get(id.toHexString());
    if (!item || item.deletedAt !== null) return null;
    if (typeof expectedVersion === 'number' && item.__v !== expectedVersion) {
      return null;
    }

    const updated: PayrollPeriodLean = {
      ...item,
      ...data,
      updatedAt: new Date(),
      __v: item.__v + 1,
    };
    this.store.set(id.toHexString(), updated);
    return { ...updated };
  }

  async updateStatus(
    id: Types.ObjectId,
    status: PayrollPeriodStatus,
    actorId: Types.ObjectId,
    expectedVersion?: number,
    _session?: unknown,
    options?: {
      expectedFromStatus?: PayrollPeriodStatus;
      requireApprovalMetadata?: boolean;
    },
  ): Promise<PayrollPeriodLean | null> {
    const item = this.store.get(id.toHexString());
    if (!item || item.deletedAt !== null) return null;
    if (typeof expectedVersion === 'number' && item.__v !== expectedVersion) {
      return null;
    }
    if (
      options?.expectedFromStatus !== undefined &&
      item.status !== options.expectedFromStatus
    ) {
      return null;
    }
    if (
      options?.requireApprovalMetadata &&
      (!item.approval?.approvedBy || !item.approval?.approvedAt)
    ) {
      return null;
    }

    const updated: PayrollPeriodLean = {
      ...item,
      status,
      updatedBy: actorId,
      updatedAt: new Date(),
      __v: item.__v + 1,
    };
    this.store.set(id.toHexString(), updated);
    return { ...updated };
  }

  approveForTest(id: Types.ObjectId, actorId: Types.ObjectId): void {
    const item = this.store.get(id.toHexString());
    if (!item) return;
    this.store.set(id.toHexString(), {
      ...item,
      status: PayrollPeriodStatus.APPROVED,
      approval: {
        approvedBy: actorId,
        approvedAt: new Date(),
        approvedRecordsCount: 1,
        alreadyApprovedRecordsCount: 0,
        totalGrossEarnings: '10000.00',
        totalDeductions: '0.00',
        totalEmployerContributions: '0.00',
        totalNetSalary: '10000.00',
        totalEmployerCost: '10000.00',
        reason: 'Test approval',
        acknowledgeAnomalies: false,
        acknowledgedAnomalyEmployees: 0,
        acknowledgedWarningCodes: [],
      },
      __v: item.__v + 1,
    });
  }

  async findList(
    filter: PayrollPeriodQueryFilter,
    pagination: PayrollPeriodPaginationOptions,
  ): Promise<PaginatedResult<PayrollPeriodLean>> {
    let items = Array.from(this.store.values()).filter(
      (doc) => doc.deletedAt === null,
    );

    if (filter.year !== undefined) {
      items = items.filter((doc) => doc.year === filter.year);
    }
    if (filter.month !== undefined) {
      items = items.filter((doc) => doc.month === filter.month);
    }
    if (filter.status !== undefined) {
      items = items.filter((doc) => doc.status === filter.status);
    }
    if (filter.payrollFrequency !== undefined) {
      items = items.filter(
        (doc) => doc.payrollFrequency === filter.payrollFrequency,
      );
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      items = items.filter(
        (doc) =>
          doc.periodName.toLowerCase().includes(q) ||
          doc.periodCode.toLowerCase().includes(q),
      );
    }

    const sortBy = pagination.sortBy ?? 'startDate';
    const sortOrder = pagination.sortOrder === 'asc' ? 1 : -1;

    items.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortBy];
      const bVal = (b as unknown as Record<string, unknown>)[sortBy];
      if (aVal instanceof Date && bVal instanceof Date) {
        return (aVal.getTime() - bVal.getTime()) * sortOrder;
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * sortOrder;
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * sortOrder;
      }
      return 0;
    });

    const page = Math.max(1, pagination.page);
    const limit = Math.max(1, pagination.limit);
    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const pagedItems = items.slice(skip, skip + limit);

    return {
      data: pagedItems.map((i) => ({ ...i })),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }
}

describe('Payroll Periods Module - Complete Integration Test Suite', () => {
  let controller: PayrollPeriodsController;
  let repository: InMemoryPayrollPeriodRepository;
  let guard: PermissionsGuard;
  let validationPipe: ValidationPipe;

  const actorId = new Types.ObjectId();
  const payrollAdminRoleId = new Types.ObjectId();
  const auditorRoleId = new Types.ObjectId();
  const cfoRoleId = new Types.ObjectId();

  let activePermissions: string[] = [];

  const mockAuditLogsService = {
    createAuditLog: jest.fn().mockResolvedValue(undefined),
  };

  const mockAuthorizationService = {
    hasPermissions: jest.fn(
      (_roleIds: Types.ObjectId[], requiredPermissions: string[]) => {
        return Promise.resolve(
          requiredPermissions.every((p) => activePermissions.includes(p)),
        );
      },
    ),
  };

  const mockSettingsRepository = {
    findActive: jest.fn().mockResolvedValue({
      payrollFrequency: PayrollFrequency.MONTHLY,
    }),
  };

  const createRequest = (
    roleIds: Types.ObjectId[] = [payrollAdminRoleId],
  ): AuthenticatedRequest =>
    ({
      user: {
        userId: actorId,
        sessionId: new Types.ObjectId(),
        roleIds,
      },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'Jest-PayrollPeriodIntegration/1.0' },
    }) as unknown as AuthenticatedRequest;

  const createExecutionContext = (
    handler: (...args: unknown[]) => unknown,
    req: AuthenticatedRequest = createRequest(),
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PayrollPeriodsController,
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    }) as unknown as ExecutionContext;

  const validateBody = async <T>(
    metatype: new () => T,
    body: Record<string, unknown>,
  ): Promise<T> => {
    return (await validationPipe.transform(body, {
      type: 'body',
      metatype,
    })) as T;
  };

  beforeAll(async () => {
    repository = new InMemoryPayrollPeriodRepository();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollPeriodsController],
      providers: [
        PayrollPeriodsService,
        {
          provide: PayrollAttendanceSummaryService,
          useValue: {
            getPeriodAttendanceSummary: jest.fn(),
          },
        },
        {
          provide: PayrollPeriodRepository,
          useValue: repository,
        },
        {
          provide: PayrollSettingsRepository,
          useValue: mockSettingsRepository,
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogsService,
        },
        {
          provide: AuthorizationService,
          useValue: mockAuthorizationService,
        },
        {
          provide: EmployeeRepository,
          useValue: {
            findForPayrollAttendanceSummary: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PayrollLeaveAttendanceResolverService,
          useValue: {
            resolveBatch: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: PayrollProcessingService,
          useValue: {
            verifyPeriodCompletionReadiness: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        Reflector,
        PermissionsGuard,
      ],
    }).compile();

    controller = module.get<PayrollPeriodsController>(PayrollPeriodsController);
    guard = module.get<PermissionsGuard>(PermissionsGuard);

    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = mapValidationErrors(errors);
        return new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          HttpStatus.BAD_REQUEST,
          details,
        );
      },
    });
  });

  beforeEach(() => {
    repository.clear();
    jest.clearAllMocks();
    mockSettingsRepository.findActive.mockResolvedValue({
      payrollFrequency: PayrollFrequency.MONTHLY,
    });
    // Default permissions: full payroll period permissions including APPROVE
    activePermissions = [
      PermissionKeys.PAYROLL_PERIODS_VIEW,
      PermissionKeys.PAYROLL_PERIODS_CREATE,
      PermissionKeys.PAYROLL_PERIODS_EDIT,
      PermissionKeys.PAYROLL_PERIODS_APPROVE,
    ];
  });

  describe('Suite 1: Creation & Auto-Generation', () => {
    it('should create a valid payroll period with custom code and initial DRAFT status', async () => {
      const payload = {
        periodName: 'April 2026 Monthly Payroll',
        periodCode: 'PR-2026-04-CUSTOM',
        payrollFrequency: PayrollFrequency.MONTHLY,
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        paymentDate: '2026-05-02',
        month: 4,
        year: 2026,
        notes: 'Financial year start period',
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      const res = await controller.create(dto, createRequest());

      expect(res.success).toBe(true);
      expect(res.data.periodCode).toBe('PR-2026-04-CUSTOM');
      expect(res.data.status).toBe(PayrollPeriodStatus.DRAFT);
      expect(res.data.month).toBe(4);
      expect(res.data.year).toBe(2026);
      expect(res.data.version).toBe(0);
      expect(
        (res.data as unknown as Record<string, unknown>).companyId,
      ).toBeUndefined();

      expect(mockAuditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PAYROLL_PERIOD_CREATED,
          targetModel: AuditTargetModel.PAYROLL_PERIOD,
          details: expect.objectContaining({
            periodCode: 'PR-2026-04-CUSTOM',
            status: PayrollPeriodStatus.DRAFT,
          }),
        }),
      );
    });

    it('should auto-generate periodCode when omitted (PR-YYYY-MM)', async () => {
      const payload = {
        periodName: 'May 2026 Payroll',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        paymentDate: '2026-06-01',
        month: 5,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      const res = await controller.create(dto, createRequest());

      expect(res.success).toBe(true);
      expect(res.data.periodCode).toBe('PR-2026-05');
    });

    it('should normalize lowercase periodCode to uppercase upon creation', async () => {
      const payload = {
        periodName: 'June 2026 Payroll',
        periodCode: 'pr-2026-06',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        paymentDate: '2026-07-01',
        month: 6,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      const res = await controller.create(dto, createRequest());

      expect(res.success).toBe(true);
      expect(res.data.periodCode).toBe('PR-2026-06');
    });

    it('should inherit company payroll settings frequency when omitted in DTO', async () => {
      mockSettingsRepository.findActive.mockResolvedValue({
        payrollFrequency: PayrollFrequency.MONTHLY,
      });

      const payload = {
        periodName: 'June 2026 Payroll',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        paymentDate: '2026-07-01',
        month: 6,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      const res = await controller.create(dto, createRequest());

      expect(res.data.payrollFrequency).toBe(PayrollFrequency.MONTHLY);
    });

    it('should fallback to default monthly frequency when payroll settings record is absent', async () => {
      mockSettingsRepository.findActive.mockResolvedValue(null);

      const payload = {
        periodName: 'July 2026 Payroll',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        paymentDate: '2026-08-01',
        month: 7,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      const res = await controller.create(dto, createRequest());

      expect(res.data.payrollFrequency).toBe(PayrollFrequency.MONTHLY);
    });
  });

  describe('Suite 2: DTO & Business Date Validation', () => {
    it('should reject periodCode containing invalid characters or spaces via ValidationPipe', async () => {
      const payload = {
        periodName: 'Invalid Code Period',
        periodCode: 'PR 2026 01!',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        paymentDate: '2026-02-01',
        month: 1,
        year: 2026,
      };

      await expect(
        validateBody(CreatePayrollPeriodDto, payload),
      ).rejects.toThrow(AppError);
    });
    it('should reject invalid month (e.g. 13) via ValidationPipe', async () => {
      const payload = {
        periodName: 'Invalid Month',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        paymentDate: '2026-02-01',
        month: 13,
        year: 2026,
      };

      await expect(
        validateBody(CreatePayrollPeriodDto, payload),
      ).rejects.toThrow(AppError);
    });

    it('should reject empty or whitespace periodName via ValidationPipe', async () => {
      const payload = {
        periodName: '   ',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        paymentDate: '2026-02-01',
        month: 1,
        year: 2026,
      };

      await expect(
        validateBody(CreatePayrollPeriodDto, payload),
      ).rejects.toThrow(AppError);
    });

    it('should reject when startDate is after endDate', async () => {
      const payload = {
        periodName: 'Inverted Dates',
        startDate: '2026-04-30',
        endDate: '2026-04-01',
        paymentDate: '2026-05-01',
        month: 4,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      await expect(controller.create(dto, createRequest())).rejects.toThrow(
        AppError,
      );
      await expect(
        controller.create(dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject when paymentDate is before endDate (e.g. February period with paymentDate before Feb 28)', async () => {
      const payload = {
        periodName: 'February 2026 Payroll',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        paymentDate: '2026-02-25',
        month: 2,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      await expect(
        controller.create(dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should accept when paymentDate is equal to endDate (closing day disbursement)', async () => {
      const payload = {
        periodName: 'February 2026 Closing Day Payment',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        paymentDate: '2026-02-28',
        month: 2,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      const res = await controller.create(dto, createRequest());
      expect(res.success).toBe(true);
      expect(res.data.paymentDate).toBe('2026-02-28');
    });

    it('should accept when paymentDate is after endDate (post-closing disbursement)', async () => {
      const payload = {
        periodName: 'February 2026 Next Month Payment',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        paymentDate: '2026-03-01',
        month: 2,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      const res = await controller.create(dto, createRequest());
      expect(res.success).toBe(true);
      expect(res.data.paymentDate).toBe('2026-03-01');
    });

    it('should reject when period frequency does not match company settings frequency', async () => {
      mockSettingsRepository.findActive.mockResolvedValue({
        payrollFrequency: PayrollFrequency.MONTHLY,
      });

      const payload: CreatePayrollPeriodDto = {
        periodName: 'Biweekly Period in Monthly Company',
        payrollFrequency: 'BI_WEEKLY' as unknown as PayrollFrequency,
        startDate: '2026-04-01',
        endDate: '2026-04-15',
        paymentDate: '2026-04-16',
        month: 4,
        year: 2026,
      };

      await expect(
        controller.create(payload, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject when month/year is completely inconsistent with period dates', async () => {
      const payload = {
        periodName: 'Mismatched Calendar Month',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        paymentDate: '2026-05-01',
        month: 11,
        year: 2026,
      };

      const dto = await validateBody(CreatePayrollPeriodDto, payload);
      await expect(
        controller.create(dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });
  });

  describe('Suite 3: Overlap & Uniqueness Enforcement', () => {
    beforeEach(async () => {
      // Seed April 2026 period: 2026-04-01 to 2026-04-30
      const dto = await validateBody(CreatePayrollPeriodDto, {
        periodName: 'April 2026',
        periodCode: 'PR-2026-04',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        paymentDate: '2026-05-01',
        month: 4,
        year: 2026,
      });
      await controller.create(dto, createRequest());
    });

    it('should reject with 409 Conflict when new period date range overlaps existing period', async () => {
      const overlappingPayload = {
        periodName: 'Conflicting Period',
        periodCode: 'PR-2026-04-OVERLAP',
        startDate: '2026-04-15',
        endDate: '2026-05-15',
        paymentDate: '2026-05-16',
        month: 4,
        year: 2026,
      };

      const dto = await validateBody(
        CreatePayrollPeriodDto,
        overlappingPayload,
      );
      await expect(
        controller.create(dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should reject with 409 Conflict when duplicate cycle (year, month, frequency) is submitted', async () => {
      const duplicateCyclePayload = {
        periodName: 'Duplicate April Cycle',
        periodCode: 'PR-2026-04-DUP',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        paymentDate: '2026-05-01',
        month: 4,
        year: 2026,
      };

      const dto = await validateBody(
        CreatePayrollPeriodDto,
        duplicateCyclePayload,
      );
      await expect(
        controller.create(dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should reject with 409 Conflict when periodCode is duplicate (case-insensitive)', async () => {
      const duplicateCodePayload = {
        periodName: 'Different Dates Same Code',
        periodCode: 'pr-2026-04',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        paymentDate: '2026-06-01',
        month: 5,
        year: 2026,
      };

      const dto = await validateBody(
        CreatePayrollPeriodDto,
        duplicateCodePayload,
      );
      await expect(
        controller.create(dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  describe('Suite 4: Listing, Filtering & Retrieval', () => {
    let aprilId: Types.ObjectId;

    beforeEach(async () => {
      const apr = await controller.create(
        await validateBody(CreatePayrollPeriodDto, {
          periodName: 'April 2026',
          startDate: '2026-04-01',
          endDate: '2026-04-30',
          paymentDate: '2026-05-01',
          month: 4,
          year: 2026,
        }),
        createRequest(),
      );
      aprilId = new Types.ObjectId(apr.data.id);

      await controller.create(
        await validateBody(CreatePayrollPeriodDto, {
          periodName: 'May 2026',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          paymentDate: '2026-06-01',
          month: 5,
          year: 2026,
        }),
        createRequest(),
      );
    });

    it('should list all active payroll periods with pagination meta', async () => {
      const queryDto = await validateBody(ListPayrollPeriodsQueryDto, {
        page: 1,
        limit: 10,
      });
      const res = await controller.list(queryDto);

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(2);
      expect(res.meta.total).toBe(2);
      expect(res.meta.page).toBe(1);
    });

    it('should filter periods by month and year', async () => {
      const queryDto = await validateBody(ListPayrollPeriodsQueryDto, {
        year: 2026,
        month: 4,
      });
      const res = await controller.list(queryDto);

      expect(res.data).toHaveLength(1);
      expect(res.data[0].periodCode).toBe('PR-2026-04');
    });

    it('should search periods by case-insensitive name or code substring', async () => {
      const searchNameRes = await controller.list(
        await validateBody(ListPayrollPeriodsQueryDto, { search: 'april' }),
      );
      expect(searchNameRes.data).toHaveLength(1);
      expect(searchNameRes.data[0].periodCode).toBe('PR-2026-04');

      const searchCodeRes = await controller.list(
        await validateBody(ListPayrollPeriodsQueryDto, { search: '2026-05' }),
      );
      expect(searchCodeRes.data).toHaveLength(1);
      expect(searchCodeRes.data[0].periodCode).toBe('PR-2026-05');
    });

    it('should filter periods by status and payroll frequency', async () => {
      const statusFilterRes = await controller.list(
        await validateBody(ListPayrollPeriodsQueryDto, {
          status: PayrollPeriodStatus.DRAFT,
          payrollFrequency: PayrollFrequency.MONTHLY,
        }),
      );
      expect(statusFilterRes.data).toHaveLength(2);

      const emptyStatusRes = await controller.list(
        await validateBody(ListPayrollPeriodsQueryDto, {
          status: PayrollPeriodStatus.FINALIZED,
        }),
      );
      expect(emptyStatusRes.data).toHaveLength(0);
    });

    it('should sort periods by sortable fields and orders', async () => {
      const ascRes = await controller.list(
        await validateBody(ListPayrollPeriodsQueryDto, {
          sortBy: 'periodCode',
          sortOrder: 'asc',
        }),
      );
      expect(ascRes.data[0].periodCode).toBe('PR-2026-04');
      expect(ascRes.data[1].periodCode).toBe('PR-2026-05');

      const descRes = await controller.list(
        await validateBody(ListPayrollPeriodsQueryDto, {
          sortBy: 'periodCode',
          sortOrder: 'desc',
        }),
      );
      expect(descRes.data[0].periodCode).toBe('PR-2026-05');
      expect(descRes.data[1].periodCode).toBe('PR-2026-04');
    });

    it('should exclude soft-deleted periods from list and getById results', async () => {
      repository.softDelete(aprilId);

      const listRes = await controller.list(
        await validateBody(ListPayrollPeriodsQueryDto, {}),
      );
      expect(listRes.data).toHaveLength(1);
      expect(listRes.data[0].periodCode).toBe('PR-2026-05');

      await expect(controller.getById(aprilId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('should reject invalid ObjectId format via ParseObjectIdPipe', () => {
      const pipe = new ParseObjectIdPipe();
      expect(() => {
        pipe.transform('invalid-object-id');
      }).toThrow();
    });

    it('should get period details by ID', async () => {
      const res = await controller.getById(aprilId);

      expect(res.success).toBe(true);
      expect(res.data.id).toBe(aprilId.toHexString());
      expect(res.data.periodName).toBe('April 2026');
    });

    it('should return 404 for non-existent ID', async () => {
      const randomId = new Types.ObjectId();
      await expect(controller.getById(randomId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('Suite 5: Updates & Immutability Rules', () => {
    let createdPeriodId: Types.ObjectId;

    beforeEach(async () => {
      const res = await controller.create(
        await validateBody(CreatePayrollPeriodDto, {
          periodName: 'April 2026 Initial',
          startDate: '2026-04-01',
          endDate: '2026-04-30',
          paymentDate: '2026-05-01',
          month: 4,
          year: 2026,
          notes: 'Draft note',
        }),
        createRequest(),
      );
      createdPeriodId = new Types.ObjectId(res.data.id);
    });

    it('should update a DRAFT period successfully and bump version', async () => {
      const updatePayload = {
        periodName: 'April 2026 Renamed',
        paymentDate: '2026-05-05',
        notes: 'Updated notes',
      };

      const dto = await validateBody(UpdatePayrollPeriodDto, updatePayload);
      const res = await controller.update(
        createdPeriodId,
        dto,
        createRequest(),
      );

      expect(res.data.periodName).toBe('April 2026 Renamed');
      expect(res.data.notes).toBe('Updated notes');
      expect(res.data.version).toBe(1);

      expect(mockAuditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PAYROLL_PERIOD_UPDATED,
        }),
      );
    });

    it('should reject update if updated paymentDate is before endDate', async () => {
      const updatePayload = {
        paymentDate: '2026-04-20', // before endDate 2026-04-30
      };

      const dto = await validateBody(UpdatePayrollPeriodDto, updatePayload);
      await expect(
        controller.update(createdPeriodId, dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject update if period has transitioned past DRAFT status', async () => {
      // Transition to PROCESSING
      await controller.updateStatus(
        createdPeriodId,
        await validateBody(UpdatePayrollPeriodStatusDto, {
          status: PayrollPeriodStatus.PROCESSING,
        }),
        createRequest(),
      );

      const updatePayload = { periodName: 'Illegal Update' };
      const dto = await validateBody(UpdatePayrollPeriodDto, updatePayload);

      await expect(
        controller.update(createdPeriodId, dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should reject non-whitelisted immutable fields (periodCode, year, month, frequency) via ValidationPipe', async () => {
      const payload = {
        periodCode: 'PR-ILLEGAL-MUTATION',
        year: 2099,
        month: 12,
        payrollFrequency: PayrollFrequency.MONTHLY,
      };

      await expect(
        validateBody(UpdatePayrollPeriodDto, payload),
      ).rejects.toThrow(AppError);
    });

    it('should reject empty update payload ({}) with HTTP 400 VALIDATION_ERROR and leave document, updatedAt, and __v unchanged', async () => {
      const before = await repository.findById(createdPeriodId);
      expect(before).not.toBeNull();
      const initialUpdatedAt = before!.updatedAt;
      const initialVersion = before!.__v;

      await expect(
        controller.update(createdPeriodId, {}, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      const after = await repository.findById(createdPeriodId);
      expect(after!.periodName).toBe(before!.periodName);
      expect(after!.notes).toBe(before!.notes);
      expect(after!.__v).toBe(initialVersion);
      expect(after!.updatedAt.getTime()).toBe(initialUpdatedAt.getTime());
    });

    it('should reject update when supplied version is stale with 409 CONCURRENT_MODIFICATION', async () => {
      await controller.update(
        createdPeriodId,
        await validateBody(UpdatePayrollPeriodDto, {
          periodName: 'First Valid Update',
          version: 0,
        }),
        createRequest(),
      );

      const staleDto = await validateBody(UpdatePayrollPeriodDto, {
        periodName: 'Stale Second Update',
        version: 0,
      });

      await expect(
        controller.update(createdPeriodId, staleDto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should guarantee two concurrent updates starting with same version cannot both succeed silently', async () => {
      const updateA = controller.update(
        createdPeriodId,
        { periodName: 'Concurrent User A' },
        createRequest(),
      );
      const updateB = controller.update(
        createdPeriodId,
        { periodName: 'Concurrent User B' },
        createRequest(),
      );

      const results = await Promise.allSettled([updateA, updateB]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedReason = rejected[0].reason as AppError;
      expect(rejectedReason.code).toBe(ErrorCode.CONCURRENT_MODIFICATION);
      expect(rejectedReason.statusCode).toBe(HttpStatus.CONFLICT);
    });

    it('should return 404 when updating non-existent period', async () => {
      const randomId = new Types.ObjectId();
      const dto = await validateBody(UpdatePayrollPeriodDto, {
        periodName: 'Ghost Period',
      });
      await expect(
        controller.update(randomId, dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('should return 404 when updating soft-deleted period', async () => {
      repository.softDelete(createdPeriodId);
      const dto = await validateBody(UpdatePayrollPeriodDto, {
        periodName: 'Soft Deleted Update',
      });
      await expect(
        controller.update(createdPeriodId, dto, createRequest()),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('Suite 6: Lifecycle State Machine & Approval RBAC', () => {
    let periodId: Types.ObjectId;

    beforeEach(async () => {
      const res = await controller.create(
        await validateBody(CreatePayrollPeriodDto, {
          periodName: 'State Machine Period',
          startDate: '2026-04-01',
          endDate: '2026-04-30',
          paymentDate: '2026-05-01',
          month: 4,
          year: 2026,
        }),
        createRequest(),
      );
      periodId = new Types.ObjectId(res.data.id);
    });

    it('should execute full valid forward lifecycle: DRAFT -> PROCESSING -> COMPLETED -> APPROVED -> FINALIZED, and reject direct COMPLETED -> FINALIZED (409)', async () => {
      // 1. DRAFT -> PROCESSING
      let res = await controller.updateStatus(
        periodId,
        await validateBody(UpdatePayrollPeriodStatusDto, {
          status: PayrollPeriodStatus.PROCESSING,
        }),
        createRequest(),
      );
      expect(res.data.status).toBe(PayrollPeriodStatus.PROCESSING);

      // 2. PROCESSING -> COMPLETED
      res = await controller.updateStatus(
        periodId,
        await validateBody(UpdatePayrollPeriodStatusDto, {
          status: PayrollPeriodStatus.COMPLETED,
        }),
        createRequest(),
      );
      expect(res.data.status).toBe(PayrollPeriodStatus.COMPLETED);

      // Direct COMPLETED -> FINALIZED must fail with 409 Conflict
      await expect(
        controller.updateStatus(
          periodId,
          await validateBody(UpdatePayrollPeriodStatusDto, {
            status: PayrollPeriodStatus.FINALIZED,
            reason: 'Trying to bypass approval',
          }),
          createRequest([cfoRoleId]),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });

      // 3. Approve via Step 6 approval state transition, then APPROVED -> FINALIZED
      repository.approveForTest(periodId, actorId);

      res = await controller.updateStatus(
        periodId,
        await validateBody(UpdatePayrollPeriodStatusDto, {
          status: PayrollPeriodStatus.FINALIZED,
          reason: 'Month-end payroll signed off by HR Director',
        }),
        createRequest([cfoRoleId]),
      );
      expect(res.data.status).toBe(PayrollPeriodStatus.FINALIZED);

      expect(mockAuditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PAYROLL_PERIOD_STATUS_CHANGED,
          details: expect.objectContaining({
            fromStatus: PayrollPeriodStatus.APPROVED,
            toStatus: PayrollPeriodStatus.FINALIZED,
            reason: 'Month-end payroll signed off by HR Director',
          }),
        }),
      );
    });

    it('should reject transition to FINALIZED when user lacks PAYROLL_PERIODS_APPROVE permission', async () => {
      // Advance to COMPLETED then APPROVED first
      await controller.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.PROCESSING },
        createRequest(),
      );
      await controller.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.COMPLETED },
        createRequest(),
      );
      repository.approveForTest(periodId, actorId);

      // Revoke APPROVE permission
      activePermissions = [
        PermissionKeys.PAYROLL_PERIODS_VIEW,
        PermissionKeys.PAYROLL_PERIODS_CREATE,
        PermissionKeys.PAYROLL_PERIODS_EDIT,
      ];

      await expect(
        controller.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.FINALIZED },
          createRequest([payrollAdminRoleId]),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('should support rollback: PROCESSING -> DRAFT and COMPLETED -> PROCESSING', async () => {
      // DRAFT -> PROCESSING
      await controller.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.PROCESSING },
        createRequest(),
      );

      // Rollback to DRAFT
      let res = await controller.updateStatus(
        periodId,
        {
          status: PayrollPeriodStatus.DRAFT,
          reason: 'Attendance needs correction',
        },
        createRequest(),
      );
      expect(res.data.status).toBe(PayrollPeriodStatus.DRAFT);

      // Forward again: DRAFT -> PROCESSING -> COMPLETED
      await controller.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.PROCESSING },
        createRequest(),
      );
      await controller.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.COMPLETED },
        createRequest(),
      );

      // Rollback to PROCESSING
      res = await controller.updateStatus(
        periodId,
        {
          status: PayrollPeriodStatus.PROCESSING,
          reason: 'Recalculating bonus',
        },
        createRequest(),
      );
      expect(res.data.status).toBe(PayrollPeriodStatus.PROCESSING);
    });

    it('should reject invalid transition skipping steps: DRAFT -> COMPLETED', async () => {
      await expect(
        controller.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.COMPLETED },
          createRequest(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject invalid direct transition skipping steps: DRAFT -> FINALIZED', async () => {
      await expect(
        controller.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.FINALIZED },
          createRequest(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should lock FINALIZED period: reject any transition away from FINALIZED', async () => {
      // Advance to FINALIZED via APPROVED
      await controller.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.PROCESSING },
        createRequest(),
      );
      await controller.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.COMPLETED },
        createRequest(),
      );
      repository.approveForTest(periodId, actorId);
      await controller.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.FINALIZED },
        createRequest(),
      );

      // Attempt to modify status of FINALIZED period
      const targetStatuses = [
        PayrollPeriodStatus.DRAFT,
        PayrollPeriodStatus.PROCESSING,
        PayrollPeriodStatus.COMPLETED,
      ];

      for (const target of targetStatuses) {
        await expect(
          controller.updateStatus(
            periodId,
            { status: target },
            createRequest(),
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.CONCURRENT_MODIFICATION,
          statusCode: HttpStatus.CONFLICT,
        });
      }
    });
  });

  describe('Suite 7: API Endpoint RBAC Guards', () => {
    it('should reject unauthenticated request with 401 Unauthorized when request.user is missing', async () => {
      const unauthReq = {
        ip: '10.0.0.1',
        headers: {},
      } as unknown as AuthenticatedRequest;

      const context = createExecutionContext(controller.list, unauthReq);

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
        statusCode: HttpStatus.UNAUTHORIZED,
      });
    });

    it('should reject unauthorized user on POST /api/v1/payroll/periods (missing PAYROLL_PERIODS_CREATE)', async () => {
      activePermissions = [PermissionKeys.PAYROLL_PERIODS_VIEW];
      const context = createExecutionContext(
        controller.create,
        createRequest([auditorRoleId]),
      );

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('should reject unauthorized user on GET /api/v1/payroll/periods (missing PAYROLL_PERIODS_VIEW)', async () => {
      activePermissions = [];
      const context = createExecutionContext(
        controller.list,
        createRequest([auditorRoleId]),
      );

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('should reject unauthorized user on GET /api/v1/payroll/periods/:id (missing PAYROLL_PERIODS_VIEW)', async () => {
      activePermissions = [];
      const context = createExecutionContext(
        controller.getById,
        createRequest([auditorRoleId]),
      );

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('should reject unauthorized user on PATCH /api/v1/payroll/periods/:id (missing PAYROLL_PERIODS_EDIT)', async () => {
      activePermissions = [PermissionKeys.PAYROLL_PERIODS_VIEW];
      const context = createExecutionContext(
        controller.update,
        createRequest([auditorRoleId]),
      );

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('should allow authorized user with required permissions', async () => {
      activePermissions = [
        PermissionKeys.PAYROLL_PERIODS_VIEW,
        PermissionKeys.PAYROLL_PERIODS_CREATE,
        PermissionKeys.PAYROLL_PERIODS_EDIT,
      ];

      const createCtx = createExecutionContext(
        controller.create,
        createRequest(),
      );
      const listCtx = createExecutionContext(controller.list, createRequest());
      const updateCtx = createExecutionContext(
        controller.update,
        createRequest(),
      );

      await expect(guard.canActivate(createCtx)).resolves.toBe(true);
      await expect(guard.canActivate(listCtx)).resolves.toBe(true);
      await expect(guard.canActivate(updateCtx)).resolves.toBe(true);
    });
  });
});
