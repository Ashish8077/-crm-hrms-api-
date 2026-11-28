/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { PayrollSettingsService } from './payroll-settings.service';
import { PayrollSettingsRepository } from '../repositories/payroll-settings.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PayrollSettingsLean } from '../schemas/payroll-settings.schema';
import {
  PayrollFrequency,
  WorkingDaysPolicy,
} from '../constants/payroll-configuration.constant';
import { AuditAction } from '../../audit-logs/constants/audit-log.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('PayrollSettingsService', () => {
  let service: PayrollSettingsService;
  let repository: jest.Mocked<PayrollSettingsRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const actorId = new Types.ObjectId();
  const settingsId = new Types.ObjectId();

  const buildSettings = (
    overrides: Partial<PayrollSettingsLean> = {},
  ): PayrollSettingsLean => ({
    _id: settingsId,
    singletonKey: 'DEFAULT',
    currency: 'INR',
    currencyPrecision: 2,
    payrollFrequency: PayrollFrequency.MONTHLY,
    cutoffDay: 25,
    paymentDay: 1,
    financialYearStartMonth: 4,
    workingDaysPolicy: WorkingDaysPolicy.CALENDAR_DAYS,
    fixedWorkingDaysPerMonth: null,
    isPayrollProcessingEnabled: true,
    hasProcessedPayroll: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    __v: 0,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollSettingsService,
        {
          provide: PayrollSettingsRepository,
          useValue: {
            findActive: jest.fn(),
            findOrCreateDefault: jest.fn(),
            upsertSettings: jest.fn(),
            isDuplicateKeyError: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get(PayrollSettingsService);
    repository = module.get(PayrollSettingsRepository);
    auditLogsService = module.get(AuditLogsService);
    jest.clearAllMocks();
  });

  it('returns default company payroll settings when queried for the first time', async () => {
    const defaults = buildSettings();
    repository.findOrCreateDefault.mockResolvedValue({
      settings: defaults,
      created: true,
    });

    const result = await service.getSettings();

    expect(result.currency).toBe('INR');
    expect(result.payrollFrequency).toBe(PayrollFrequency.MONTHLY);
    expect(result.cutoffDay).toBe(25);
    expect(result.paymentDay).toBe(1);
    expect(result.financialYearStartMonth).toBe(4);
    expect(result.workingDaysPolicy).toBe(WorkingDaysPolicy.CALENDAR_DAYS);
    expect(result.isPayrollProcessingEnabled).toBe(true);
    expect(
      (result as unknown as Record<string, unknown>).singletonKey,
    ).toBeUndefined();
  });

  it('creates initial company payroll settings on PUT when none exist and writes audit log', async () => {
    repository.findActive.mockResolvedValue(null);
    const created = buildSettings({
      cutoffDay: 22,
      paymentDay: 5,
      __v: 1,
    });
    repository.upsertSettings.mockResolvedValue(created);

    const result = await service.updateSettings(
      { cutoffDay: 22, paymentDay: 5 },
      actorId,
      { ipAddress: '127.0.0.1', userAgent: 'Jest' },
    );

    expect(result.cutoffDay).toBe(22);
    expect(result.paymentDay).toBe(5);
    expect(result.version).toBe(1);
    expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        action: AuditAction.PAYROLL_SETTINGS_CREATED,
        targetId: settingsId,
      }),
    );
  });

  it('updates payroll settings cleanly with optimistic concurrency version match', async () => {
    const existing = buildSettings({ __v: 2 });
    const updated = buildSettings({
      workingDaysPolicy: WorkingDaysPolicy.FIXED_WORKING_DAYS,
      fixedWorkingDaysPerMonth: 26,
      isPayrollProcessingEnabled: false,
      __v: 3,
    });
    repository.findActive.mockResolvedValue(existing);
    repository.upsertSettings.mockResolvedValue(updated);

    const result = await service.updateSettings(
      {
        workingDaysPolicy: WorkingDaysPolicy.FIXED_WORKING_DAYS,
        fixedWorkingDaysPerMonth: 26,
        isPayrollProcessingEnabled: false,
        version: 2,
      },
      actorId,
    );

    expect(result.workingDaysPolicy).toBe(WorkingDaysPolicy.FIXED_WORKING_DAYS);
    expect(result.fixedWorkingDaysPerMonth).toBe(26);
    expect(result.isPayrollProcessingEnabled).toBe(false);
    expect(result.version).toBe(3);
    expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PAYROLL_SETTINGS_UPDATED,
      }),
    );
  });

  it('rejects FIXED_WORKING_DAYS policy when fixedWorkingDaysPerMonth is missing', async () => {
    repository.findActive.mockResolvedValue(buildSettings());

    await expect(
      service.updateSettings(
        { workingDaysPolicy: WorkingDaysPolicy.FIXED_WORKING_DAYS },
        actorId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });
    expect(repository.upsertSettings).not.toHaveBeenCalled();
  });

  it('rejects fixedWorkingDaysPerMonth when policy is CALENDAR_DAYS', async () => {
    repository.findActive.mockResolvedValue(buildSettings());

    await expect(
      service.updateSettings(
        {
          workingDaysPolicy: WorkingDaysPolicy.CALENDAR_DAYS,
          fixedWorkingDaysPerMonth: 26,
        },
        actorId,
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(repository.upsertSettings).not.toHaveBeenCalled();
  });

  it('rejects concurrent settings update when version does not match', async () => {
    repository.findActive.mockResolvedValue(buildSettings({ __v: 4 }));

    await expect(
      service.updateSettings({ cutoffDay: 20, version: 3 }, actorId),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });
    expect(repository.upsertSettings).not.toHaveBeenCalled();
  });

  it('prevents breaking currency/frequency/FY changes after payroll has been processed', async () => {
    repository.findActive.mockResolvedValue(
      buildSettings({ hasProcessedPayroll: true }),
    );

    await expect(
      service.updateSettings({ currency: 'USD' }, actorId),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    await expect(
      service.updateSettings({ financialYearStartMonth: 1 }, actorId),
    ).rejects.toMatchObject({
      code: ErrorCode.CONCURRENT_MODIFICATION,
      statusCode: HttpStatus.CONFLICT,
    });

    expect(repository.upsertSettings).not.toHaveBeenCalled();
  });

  it('allows safe operational updates (cutoffDay, processing toggle) even when payroll was processed', async () => {
    const existing = buildSettings({ hasProcessedPayroll: true, __v: 1 });
    const updated = buildSettings({
      hasProcessedPayroll: true,
      cutoffDay: 24,
      __v: 2,
    });
    repository.findActive.mockResolvedValue(existing);
    repository.upsertSettings.mockResolvedValue(updated);

    const result = await service.updateSettings({ cutoffDay: 24 }, actorId);
    expect(result.cutoffDay).toBe(24);
  });
});
