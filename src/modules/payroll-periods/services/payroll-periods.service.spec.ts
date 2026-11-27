/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { PayrollPeriodsService } from './payroll-periods.service';
import { PayrollPeriodRepository } from '../repositories/payroll-period.repository';
import { PayrollSettingsRepository } from '../../payroll-configuration/repositories/payroll-settings.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuthorizationService } from '../../authorization/authorization.service';
import { EmployeeRepository } from '../../employees/repositories/employee.repository';
import {
  EmploymentStatus,
  EmploymentType,
} from '../../employees/constants/employee.constant';
import { PayrollLeaveAttendanceResolverService } from './payroll-leave-attendance-resolver.service';
import { PayrollPeriodStatus } from '../constants/payroll-period.constant';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { PayrollPeriodLean } from '../schemas/payroll-period.schema';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';

describe('PayrollPeriodsService', () => {
  let service: PayrollPeriodsService;
  let periodRepo: jest.Mocked<PayrollPeriodRepository>;
  let settingsRepo: jest.Mocked<PayrollSettingsRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let authorizationService: jest.Mocked<AuthorizationService>;
  let employeeRepo: { findForPayrollAttendanceSummary: jest.Mock };
  let leaveAttendanceResolver: { resolveBatch: jest.Mock };

  const actorId = new Types.ObjectId();
  const periodId = new Types.ObjectId();
  const roleId = new Types.ObjectId();
  const clientMetadata: ClientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'JestTestAgent/1.0',
  };

  const createMockPeriod = (
    overrides?: Partial<PayrollPeriodLean>,
  ): PayrollPeriodLean => ({
    _id: periodId,
    periodName: 'April 2026 Payroll',
    periodCode: 'PR-2026-04',
    payrollFrequency: PayrollFrequency.MONTHLY,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-04-30T23:59:59.999Z'),
    paymentDate: new Date('2026-05-01T00:00:00.000Z'),
    month: 4,
    year: 2026,
    status: PayrollPeriodStatus.DRAFT,
    notes: 'Regular monthly cycle',
    deletedAt: null,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    __v: 0,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollPeriodsService,
        {
          provide: PayrollPeriodRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByCode: jest.fn(),
            findOverlapping: jest.fn(),
            findDuplicateCycle: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
            updateStatus: jest.fn(),
            isDuplicateKeyError: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: PayrollSettingsRepository,
          useValue: {
            findActive: jest.fn().mockResolvedValue({
              payrollFrequency: PayrollFrequency.MONTHLY,
            }),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            hasPermissions: jest.fn().mockResolvedValue(true),
          },
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
      ],
    }).compile();

    service = module.get<PayrollPeriodsService>(PayrollPeriodsService);
    periodRepo = module.get(PayrollPeriodRepository);
    settingsRepo = module.get(PayrollSettingsRepository);
    auditLogsService = module.get(AuditLogsService);
    authorizationService = module.get(AuthorizationService);
    employeeRepo = module.get(EmployeeRepository);
    leaveAttendanceResolver = module.get(PayrollLeaveAttendanceResolverService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const validDto = {
      periodName: 'April 2026 Payroll',
      periodCode: 'PR-2026-04',
      payrollFrequency: PayrollFrequency.MONTHLY,
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      paymentDate: '2026-05-01',
      month: 4,
      year: 2026,
      notes: 'Initial cycle',
    };

    it('should successfully create a payroll period with provided code and emit audit log', async () => {
      const mockDoc = createMockPeriod();
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(null);
      periodRepo.findByCode.mockResolvedValue(null);
      periodRepo.create.mockResolvedValue(mockDoc);

      const result = await service.create(validDto, actorId, clientMetadata);

      expect(result.id).toBe(periodId.toHexString());
      expect(result.periodCode).toBe('PR-2026-04');
      expect(result.status).toBe(PayrollPeriodStatus.DRAFT);
      expect(
        (result as unknown as Record<string, unknown>).companyId,
      ).toBeUndefined();
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId,
          action: AuditAction.PAYROLL_PERIOD_CREATED,
          targetModel: AuditTargetModel.PAYROLL_PERIOD,
        }),
      );
    });

    it('should auto-generate periodCode if not provided (PR-YYYY-MM)', async () => {
      const dtoWithoutCode = { ...validDto, periodCode: undefined };
      const mockDoc = createMockPeriod({ periodCode: 'PR-2026-04' });
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(null);
      periodRepo.findByCode.mockResolvedValue(null);
      periodRepo.create.mockResolvedValue(mockDoc);

      const result = await service.create(dtoWithoutCode, actorId);

      expect(result.periodCode).toBe('PR-2026-04');
      expect(periodRepo.findByCode).toHaveBeenCalledWith('PR-2026-04');
      expect(periodRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ periodCode: 'PR-2026-04' }),
      );
    });

    it('should reject when startDate > endDate', async () => {
      const invalidDatesDto = {
        ...validDto,
        startDate: '2026-05-01',
        endDate: '2026-04-01',
      };

      await expect(service.create(invalidDatesDto, actorId)).rejects.toThrow(
        AppError,
      );
      await expect(
        service.create(invalidDatesDto, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject when paymentDate is before endDate (e.g. February period paymentDate before Feb 28)', async () => {
      const invalidPaymentDto = {
        ...validDto,
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        paymentDate: '2026-02-25',
        month: 2,
        year: 2026,
      };

      await expect(service.create(invalidPaymentDto, actorId)).rejects.toThrow(
        AppError,
      );
      await expect(
        service.create(invalidPaymentDto, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should accept when paymentDate equals endDate (closing day disbursement)', async () => {
      const closingDayPaymentDto = {
        ...validDto,
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        paymentDate: '2026-04-30',
        month: 4,
        year: 2026,
      };
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(null);
      periodRepo.findByCode.mockResolvedValue(null);
      periodRepo.create.mockResolvedValue(
        createMockPeriod({
          paymentDate: new Date('2026-04-30T00:00:00.000Z'),
        }),
      );

      const res = await service.create(closingDayPaymentDto, actorId);
      expect(res.paymentDate).toBe('2026-04-30');
    });

    it('should accept when paymentDate is after endDate (post-closing disbursement)', async () => {
      const postClosingPaymentDto = {
        ...validDto,
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        paymentDate: '2026-05-01',
        month: 4,
        year: 2026,
      };
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(null);
      periodRepo.findByCode.mockResolvedValue(null);
      periodRepo.create.mockResolvedValue(
        createMockPeriod({
          paymentDate: new Date('2026-05-01T00:00:00.000Z'),
        }),
      );

      const res = await service.create(postClosingPaymentDto, actorId);
      expect(res.paymentDate).toBe('2026-05-01');
    });

    it('should reject when period frequency does not match company settings', async () => {
      settingsRepo.findActive.mockResolvedValue({
        payrollFrequency: PayrollFrequency.MONTHLY,
      } as unknown as null);

      const mismatchDto = {
        ...validDto,
        payrollFrequency: 'BI_WEEKLY' as unknown as PayrollFrequency,
      };

      await expect(service.create(mismatchDto, actorId)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject when month/year does not align with dates', async () => {
      const misalignedDto = {
        ...validDto,
        month: 12,
        year: 2025,
      };

      await expect(
        service.create(misalignedDto, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject with 409 Conflict when date range overlaps an existing period', async () => {
      const overlappingPeriod = createMockPeriod({
        periodCode: 'PR-2026-04-EXISTING',
      });
      periodRepo.findOverlapping.mockResolvedValue(overlappingPeriod);

      await expect(service.create(validDto, actorId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should reject with 409 Conflict when cycle (year + month + frequency) already exists', async () => {
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(createMockPeriod());

      await expect(service.create(validDto, actorId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should reject with 409 Conflict when periodCode already exists', async () => {
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(null);
      periodRepo.findByCode.mockResolvedValue(createMockPeriod());

      await expect(service.create(validDto, actorId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should fallback to default monthly frequency when payroll settings record is absent', async () => {
      settingsRepo.findActive.mockResolvedValue(null);
      const mockDoc = createMockPeriod({
        payrollFrequency: PayrollFrequency.MONTHLY,
      });
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(null);
      periodRepo.findByCode.mockResolvedValue(null);
      periodRepo.create.mockResolvedValue(mockDoc);

      const res = await service.create(
        { ...validDto, payrollFrequency: undefined },
        actorId,
      );
      expect(res.payrollFrequency).toBe(PayrollFrequency.MONTHLY);
    });

    it('should rethrow unexpected database errors that are not duplicate key errors', async () => {
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(null);
      periodRepo.findByCode.mockResolvedValue(null);
      const dbError = new Error('Database connection failed');
      periodRepo.create.mockRejectedValue(dbError);
      periodRepo.isDuplicateKeyError.mockReturnValue(false);

      await expect(service.create(validDto, actorId)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle MongoDB duplicate key error race condition gracefully', async () => {
      periodRepo.findOverlapping.mockResolvedValue(null);
      periodRepo.findDuplicateCycle.mockResolvedValue(null);
      periodRepo.findByCode.mockResolvedValue(null);
      periodRepo.create.mockRejectedValue(
        new Error('E11000 duplicate key error'),
      );
      periodRepo.isDuplicateKeyError.mockReturnValue(true);

      await expect(service.create(validDto, actorId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  describe('list', () => {
    it('should return paginated list of mapped periods', async () => {
      const mockDoc = createMockPeriod();
      periodRepo.findList.mockResolvedValue({
        data: [mockDoc],
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.list({
        year: 2026,
        month: 4,
        status: PayrollPeriodStatus.DRAFT,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].periodCode).toBe('PR-2026-04');
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getById', () => {
    it('should return period details when found', async () => {
      periodRepo.findById.mockResolvedValue(createMockPeriod());

      const result = await service.getById(periodId);

      expect(result.id).toBe(periodId.toHexString());
      expect(result.periodName).toBe('April 2026 Payroll');
    });

    it('should throw 404 when period is not found', async () => {
      periodRepo.findById.mockResolvedValue(null);

      await expect(service.getById(periodId)).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('update', () => {
    const updateDto = {
      periodName: 'Updated April 2026 Payroll',
      notes: 'Updated notes',
    };

    it('should reject empty update payload ({}) with 400 VALIDATION_ERROR', async () => {
      await expect(service.update(periodId, {}, actorId)).rejects.toMatchObject(
        {
          code: ErrorCode.VALIDATION_ERROR,
          statusCode: HttpStatus.BAD_REQUEST,
        },
      );
      expect(periodRepo.findById).not.toHaveBeenCalled();
      expect(periodRepo.updateById).not.toHaveBeenCalled();
    });

    it('should update a DRAFT period successfully and emit audit log', async () => {
      const existing = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      const updated = createMockPeriod({
        periodName: 'Updated April 2026 Payroll',
        notes: 'Updated notes',
        __v: 1,
      });

      periodRepo.findById.mockResolvedValue(existing);
      periodRepo.updateById.mockResolvedValue(updated);

      const result = await service.update(
        periodId,
        updateDto,
        actorId,
        clientMetadata,
      );

      expect(result.periodName).toBe('Updated April 2026 Payroll');
      expect(periodRepo.updateById).toHaveBeenCalledWith(
        periodId,
        expect.objectContaining({ periodName: 'Updated April 2026 Payroll' }),
        0,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId,
          action: AuditAction.PAYROLL_PERIOD_UPDATED,
        }),
      );
    });

    it('should reject update if supplied version does not match existing document version', async () => {
      const existing = createMockPeriod({
        status: PayrollPeriodStatus.DRAFT,
        __v: 1,
      });
      periodRepo.findById.mockResolvedValue(existing);

      await expect(
        service.update(
          periodId,
          { periodName: 'Stale Update', version: 0 },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should throw CONCURRENT_MODIFICATION when updateById returns null but document still exists', async () => {
      const existing = createMockPeriod({
        status: PayrollPeriodStatus.DRAFT,
        __v: 0,
      });
      const concurrentlyModified = createMockPeriod({
        status: PayrollPeriodStatus.DRAFT,
        __v: 1,
      });

      periodRepo.findById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(concurrentlyModified);
      periodRepo.updateById.mockResolvedValue(null);

      await expect(
        service.update(periodId, updateDto, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should throw 404 when repository.updateById returns null and document was deleted', async () => {
      const existing = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      periodRepo.findById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null);
      periodRepo.updateById.mockResolvedValue(null);

      await expect(
        service.update(periodId, updateDto, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('should reject update if period is not in DRAFT status', async () => {
      const nonDraftStatuses = [
        PayrollPeriodStatus.PROCESSING,
        PayrollPeriodStatus.COMPLETED,
        PayrollPeriodStatus.FINALIZED,
      ];

      for (const status of nonDraftStatuses) {
        periodRepo.findById.mockResolvedValue(createMockPeriod({ status }));

        await expect(
          service.update(periodId, updateDto, actorId),
        ).rejects.toMatchObject({
          code: ErrorCode.CONCURRENT_MODIFICATION,
          statusCode: HttpStatus.CONFLICT,
        });
      }
    });

    it('should reject update when updated dates overlap another period', async () => {
      const existing = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      periodRepo.findById.mockResolvedValue(existing);
      periodRepo.findOverlapping.mockResolvedValue(
        createMockPeriod({ periodCode: 'PR-OTHER' }),
      );

      await expect(
        service.update(
          periodId,
          {
            startDate: '2026-04-05',
            endDate: '2026-05-05',
            paymentDate: '2026-05-06',
          },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should throw 404 when period to update does not exist', async () => {
      periodRepo.findById.mockResolvedValue(null);

      await expect(
        service.update(periodId, updateDto, actorId),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('should reject update if updated paymentDate is before endDate', async () => {
      const existing = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      periodRepo.findById.mockResolvedValue(existing);

      await expect(
        service.update(
          periodId,
          { paymentDate: '2026-04-20' }, // before endDate 2026-04-30
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject update if new startDate > new endDate', async () => {
      const existing = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      periodRepo.findById.mockResolvedValue(existing);

      await expect(
        service.update(
          periodId,
          { startDate: '2026-05-15', endDate: '2026-05-10' },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });
  });

  describe('updateStatus', () => {
    it('should return existing period if target status is identical (no-op)', async () => {
      const existing = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      periodRepo.findById.mockResolvedValue(existing);

      const result = await service.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.DRAFT },
        actorId,
        [roleId],
      );

      expect(result.status).toBe(PayrollPeriodStatus.DRAFT);
      expect(periodRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('should reject any status modification if period is FINALIZED', async () => {
      const finalized = createMockPeriod({
        status: PayrollPeriodStatus.FINALIZED,
      });
      periodRepo.findById.mockResolvedValue(finalized);

      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.DRAFT },
          actorId,
          [roleId],
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should allow valid transition: DRAFT -> PROCESSING', async () => {
      const draft = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      const processing = createMockPeriod({
        status: PayrollPeriodStatus.PROCESSING,
      });

      periodRepo.findById.mockResolvedValue(draft);
      periodRepo.updateStatus.mockResolvedValue(processing);

      const result = await service.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.PROCESSING },
        actorId,
        [roleId],
      );

      expect(result.status).toBe(PayrollPeriodStatus.PROCESSING);
      expect(periodRepo.updateStatus).toHaveBeenCalledWith(
        periodId,
        PayrollPeriodStatus.PROCESSING,
        actorId,
        0,
      );
    });

    it('should allow valid transition: PROCESSING -> COMPLETED', async () => {
      const processing = createMockPeriod({
        status: PayrollPeriodStatus.PROCESSING,
      });
      const completed = createMockPeriod({
        status: PayrollPeriodStatus.COMPLETED,
      });

      periodRepo.findById.mockResolvedValue(processing);
      periodRepo.updateStatus.mockResolvedValue(completed);

      const result = await service.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.COMPLETED },
        actorId,
        [roleId],
      );

      expect(result.status).toBe(PayrollPeriodStatus.COMPLETED);
    });

    it('should allow rollback: PROCESSING -> DRAFT', async () => {
      const processing = createMockPeriod({
        status: PayrollPeriodStatus.PROCESSING,
      });
      const draft = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });

      periodRepo.findById.mockResolvedValue(processing);
      periodRepo.updateStatus.mockResolvedValue(draft);

      const result = await service.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.DRAFT },
        actorId,
        [roleId],
      );

      expect(result.status).toBe(PayrollPeriodStatus.DRAFT);
    });

    it('should allow rollback: COMPLETED -> PROCESSING', async () => {
      const completed = createMockPeriod({
        status: PayrollPeriodStatus.COMPLETED,
      });
      const processing = createMockPeriod({
        status: PayrollPeriodStatus.PROCESSING,
      });

      periodRepo.findById.mockResolvedValue(completed);
      periodRepo.updateStatus.mockResolvedValue(processing);

      const result = await service.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.PROCESSING },
        actorId,
        [roleId],
      );

      expect(result.status).toBe(PayrollPeriodStatus.PROCESSING);
    });

    it('should reject invalid transition: DRAFT -> COMPLETED (cannot skip PROCESSING)', async () => {
      const draft = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      periodRepo.findById.mockResolvedValue(draft);

      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.COMPLETED },
          actorId,
          [roleId],
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should reject invalid direct transition: DRAFT -> FINALIZED (cannot skip intermediate statuses)', async () => {
      const draft = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      periodRepo.findById.mockResolvedValue(draft);

      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.FINALIZED },
          actorId,
          [roleId],
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    it('should throw 404 when updating status of non-existent period', async () => {
      periodRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.PROCESSING },
          actorId,
          [roleId],
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('should reject status update if supplied version does not match existing document version', async () => {
      const draft = createMockPeriod({
        status: PayrollPeriodStatus.DRAFT,
        __v: 1,
      });
      periodRepo.findById.mockResolvedValue(draft);

      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.PROCESSING, version: 0 },
          actorId,
          [roleId],
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should throw CONCURRENT_MODIFICATION when repository.updateStatus returns null but document still exists', async () => {
      const draft = createMockPeriod({
        status: PayrollPeriodStatus.DRAFT,
        __v: 0,
      });
      const modifiedDraft = createMockPeriod({
        status: PayrollPeriodStatus.DRAFT,
        __v: 1,
      });
      periodRepo.findById
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(modifiedDraft);
      periodRepo.updateStatus.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.PROCESSING },
          actorId,
          [roleId],
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should throw 404 when repository.updateStatus returns null and document was deleted', async () => {
      const draft = createMockPeriod({ status: PayrollPeriodStatus.DRAFT });
      periodRepo.findById
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(null);
      periodRepo.updateStatus.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.PROCESSING },
          actorId,
          [roleId],
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        statusCode: HttpStatus.NOT_FOUND,
      });
    });

    it('should reject transition to FINALIZED if user lacks PAYROLL_PERIODS_APPROVE permission', async () => {
      const completed = createMockPeriod({
        status: PayrollPeriodStatus.COMPLETED,
      });
      periodRepo.findById.mockResolvedValue(completed);
      authorizationService.hasPermissions.mockResolvedValue(false);

      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.FINALIZED },
          actorId,
          [roleId],
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
      expect(authorizationService.hasPermissions).toHaveBeenCalledWith(
        [roleId],
        [PermissionKeys.PAYROLL_PERIODS_APPROVE],
      );
    });

    it('should allow transition to FINALIZED when user has PAYROLL_PERIODS_APPROVE permission', async () => {
      const completed = createMockPeriod({
        status: PayrollPeriodStatus.COMPLETED,
      });
      const finalized = createMockPeriod({
        status: PayrollPeriodStatus.FINALIZED,
      });

      periodRepo.findById.mockResolvedValue(completed);
      authorizationService.hasPermissions.mockResolvedValue(true);
      periodRepo.updateStatus.mockResolvedValue(finalized);

      const result = await service.updateStatus(
        periodId,
        { status: PayrollPeriodStatus.FINALIZED, reason: 'Approved by CFO' },
        actorId,
        [roleId],
        clientMetadata,
      );

      expect(result.status).toBe(PayrollPeriodStatus.FINALIZED);
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PAYROLL_PERIOD_STATUS_CHANGED,
          details: expect.objectContaining({
            fromStatus: PayrollPeriodStatus.COMPLETED,
            toStatus: PayrollPeriodStatus.FINALIZED,
            reason: 'Approved by CFO',
          }),
        }),
      );
    });

    it('blocks FINALIZED transition unconditionally when hard-blocking conflicts exist (e.g. OVERLAPPING_LEAVE_REQUESTS, UNAPPROVED_REGULARIZED_ATTENDANCE)', async () => {
      const completed = createMockPeriod({
        status: PayrollPeriodStatus.COMPLETED,
      });
      const empId = new Types.ObjectId();
      periodRepo.findById.mockResolvedValue(completed);
      authorizationService.hasPermissions.mockResolvedValue(true);
      employeeRepo.findForPayrollAttendanceSummary.mockResolvedValue([
        {
          _id: empId,
          employeeCode: 'EMP-BLK-1',
          firstName: 'Sam',
          lastName: 'Lee',
          employmentStatus: EmploymentStatus.ACTIVE,
          employmentType: EmploymentType.FULL_TIME,
          dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
          deletedAt: null,
          branchId: null,
        },
      ]);
      leaveAttendanceResolver.resolveBatch.mockResolvedValue(
        new Map([
          [
            empId.toHexString(),
            {
              warnings: [
                'OVERLAPPING_LEAVE_REQUESTS',
                'CONFLICTING_LEAVE_CLASSIFICATION',
              ],
            },
          ],
        ]),
      );

      await expect(
        service.updateStatus(
          periodId,
          {
            status: PayrollPeriodStatus.FINALIZED,
            acknowledgeAnomalies: true,
            reason: 'Trying to override hard blocker',
          },
          actorId,
          [roleId],
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });
      expect(periodRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('blocks reviewable anomalies by default, requires descriptive reason, and permits finalization when authorized reviewer explicitly acknowledges', async () => {
      const completed = createMockPeriod({
        status: PayrollPeriodStatus.COMPLETED,
      });
      const finalized = createMockPeriod({
        status: PayrollPeriodStatus.FINALIZED,
      });
      const empId = new Types.ObjectId();

      periodRepo.findById.mockResolvedValue(completed);
      authorizationService.hasPermissions.mockResolvedValue(true);
      employeeRepo.findForPayrollAttendanceSummary.mockResolvedValue([
        {
          _id: empId,
          employeeCode: 'EMP-REV-1',
          firstName: 'Rita',
          lastName: 'Das',
          employmentStatus: EmploymentStatus.ACTIVE,
          employmentType: EmploymentType.FULL_TIME,
          dateOfJoining: new Date('2025-01-01T00:00:00.000Z'),
          deletedAt: null,
          branchId: null,
        },
      ]);
      leaveAttendanceResolver.resolveBatch.mockResolvedValue(
        new Map([
          [
            empId.toHexString(),
            {
              warnings: [
                'UNFINALIZED_MISSING_DAYS',
                'LEAVE_ATTENDANCE_MISMATCH',
              ],
            },
          ],
        ]),
      );

      // 1. Without acknowledgeAnomalies=true -> rejected (409)
      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.FINALIZED },
          actorId,
          [roleId],
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CONCURRENT_MODIFICATION,
        statusCode: HttpStatus.CONFLICT,
      });

      // 2. acknowledgeAnomalies=true without reason -> rejected (400)
      await expect(
        service.updateStatus(
          periodId,
          { status: PayrollPeriodStatus.FINALIZED, acknowledgeAnomalies: true },
          actorId,
          [roleId],
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      // 3. acknowledgeAnomalies=true + descriptive reason -> succeeds & audits acknowledgment
      periodRepo.updateStatus.mockResolvedValue(finalized);
      const res = await service.updateStatus(
        periodId,
        {
          status: PayrollPeriodStatus.FINALIZED,
          acknowledgeAnomalies: true,
          reason: 'Verified field sales missing punches with branch head',
        },
        actorId,
        [roleId],
        clientMetadata,
      );

      expect(res.status).toBe(PayrollPeriodStatus.FINALIZED);
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PAYROLL_PERIOD_STATUS_CHANGED,
          details: expect.objectContaining({
            toStatus: PayrollPeriodStatus.FINALIZED,
            acknowledgeAnomalies: true,
            acknowledgedAnomalyEmployees: 1,
            acknowledgedWarningCodes: [
              'UNFINALIZED_MISSING_DAYS',
              'LEAVE_ATTENDANCE_MISMATCH',
            ],
          }),
        }),
      );
    });
  });
});
