/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { HttpStatus } from '@nestjs/common';
import { WeeklyOffService } from './weekly-off.service';
import { WeeklyOffConfigRepository } from '../repositories/weekly-off-config.repository';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { DayOfWeek } from '../constants/weekly-off.constant';

describe('WeeklyOffService', () => {
  let service: WeeklyOffService;
  let weeklyOffRepo: jest.Mocked<WeeklyOffConfigRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const actorId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const metadata = { ipAddress: '127.0.0.1', userAgent: 'Jest' };

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation(async (cb: () => Promise<unknown>) => {
        return cb();
      }),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyOffService,
        {
          provide: WeeklyOffConfigRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findPaginated: jest.fn(),
            findOverlappingConfig: jest.fn(),
            findEffectiveConfig: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: BranchRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<WeeklyOffService>(WeeklyOffService);
    weeklyOffRepo = module.get(WeeklyOffConfigRepository);
    branchRepo = module.get(BranchRepository);
    auditLogsService = module.get(AuditLogsService);
  });

  describe('create', () => {
    it('should create a valid company-wide weekly off configuration', async () => {
      const createdDoc = {
        _id: new Types.ObjectId(),
        name: 'Company Sunday Off',
        description: 'Every Sunday',
        branchId: null,
        days: [{ dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
      weeklyOffRepo.create.mockResolvedValue(createdDoc as any);

      const result = await service.create(
        {
          name: 'Company Sunday Off',
          description: 'Every Sunday',
          days: [{ dayOfWeek: DayOfWeek.SUNDAY }],
          effectiveFrom: '2026-01-01',
        },
        actorId,
        metadata,
      );

      expect(result.id).toBe(createdDoc._id.toString());
      expect(result.name).toBe('Company Sunday Off');
      expect(result.branchId).toBeNull();
      expect(weeklyOffRepo.create).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should create a valid branch-level override configuration', async () => {
      const branchDoc = {
        _id: branchId,
        name: 'Headquarters',
        isActive: true,
        deletedAt: null,
      };
      branchRepo.findById.mockResolvedValue(branchDoc as any);

      const createdDoc = {
        _id: new Types.ObjectId(),
        name: 'HQ 2nd & 4th Saturday Off',
        branchId,
        days: [
          { dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] },
          { dayOfWeek: DayOfWeek.SATURDAY, occurrences: [2, 4] },
        ],
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
      weeklyOffRepo.create.mockResolvedValue(createdDoc as any);

      const result = await service.create(
        {
          name: 'HQ 2nd & 4th Saturday Off',
          branchId: branchId.toString(),
          days: [
            { dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] },
            { dayOfWeek: DayOfWeek.SATURDAY, occurrences: [2, 4] },
          ],
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31',
        },
        actorId,
        metadata,
      );

      expect(result.id).toBe(createdDoc._id.toString());
      expect(result.branchId).toBe(branchId.toString());
      expect(branchRepo.findById).toHaveBeenCalledWith(branchId);
    });

    it('should reject if days array is empty', async () => {
      await expect(
        service.create(
          {
            name: 'Invalid',
            days: [],
            effectiveFrom: '2026-01-01',
          },
          actorId,
          metadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'At least one weekly off day rule must be specified',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject if duplicate dayOfWeek entries are provided in days array', async () => {
      await expect(
        service.create(
          {
            name: 'Invalid Duplicates',
            days: [
              { dayOfWeek: DayOfWeek.SATURDAY, occurrences: [1, 3] },
              { dayOfWeek: DayOfWeek.SATURDAY, occurrences: [2, 4] },
            ],
            effectiveFrom: '2026-01-01',
          },
          actorId,
          metadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Duplicate dayOfWeek (6) specified in weekly off rules. Combine occurrences into a single entry.',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject if an invalid occurrence number is provided', async () => {
      await expect(
        service.create(
          {
            name: 'Invalid Occ',
            days: [{ dayOfWeek: DayOfWeek.SUNDAY, occurrences: [6] }],
            effectiveFrom: '2026-01-01',
          },
          actorId,
          metadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Invalid occurrence (6) in weekly off rule for day 0. Must be between 1 and 5.',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject if effectiveTo is earlier than effectiveFrom', async () => {
      await expect(
        service.create(
          {
            name: 'Invalid Dates',
            days: [{ dayOfWeek: DayOfWeek.SUNDAY }],
            effectiveFrom: '2026-06-01',
            effectiveTo: '2026-05-31',
          },
          actorId,
          metadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'effectiveTo cannot be earlier than effectiveFrom',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject if specified branch does not exist', async () => {
      branchRepo.findById.mockResolvedValue(null);

      await expect(
        service.create(
          {
            name: 'Branch Off',
            branchId: branchId.toString(),
            days: [{ dayOfWeek: DayOfWeek.SUNDAY }],
            effectiveFrom: '2026-01-01',
          },
          actorId,
          metadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Specified branch does not exist',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('should reject if specified branch is inactive', async () => {
      branchRepo.findById.mockResolvedValue({
        _id: branchId,
        isActive: false,
        deletedAt: null,
      } as any);

      await expect(
        service.create(
          {
            name: 'Branch Off',
            branchId: branchId.toString(),
            days: [{ dayOfWeek: DayOfWeek.SUNDAY }],
            effectiveFrom: '2026-01-01',
          },
          actorId,
          metadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Cannot assign weekly off configuration to an inactive branch',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject with 409 Conflict if an active configuration overlaps with candidate dates', async () => {
      weeklyOffRepo.findOverlappingConfig.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Existing Ongoing Config',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      } as any);

      await expect(
        service.create(
          {
            name: 'New Conflicting Config',
            days: [{ dayOfWeek: DayOfWeek.SUNDAY }],
            effectiveFrom: '2026-06-01',
          },
          actorId,
          metadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "An active weekly off configuration 'Existing Ongoing Config' already overlaps with effective dates [2026-01-01 to ongoing] for this scope.",
          HttpStatus.CONFLICT,
        ),
      );
    });
  });

  describe('list', () => {
    it('should query paginated configurations and map to response', async () => {
      const mockResult = {
        data: [
          {
            _id: new Types.ObjectId(),
            name: 'Config 1',
            days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            isActive: true,
          },
        ] as any,
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };

      weeklyOffRepo.findPaginated.mockResolvedValue(mockResult);

      const result = await service.list({ page: 1, limit: 20 });

      expect(weeklyOffRepo.findPaginated).toHaveBeenCalledWith({
        branchId: undefined,
        isActive: undefined,
        page: 1,
        limit: 20,
      });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should support branchId "company" filter', async () => {
      weeklyOffRepo.findPaginated.mockResolvedValue({
        data: [],
        meta: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      await service.list({ branchId: 'company' });

      expect(weeklyOffRepo.findPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'company' }),
      );
    });

    it('should throw validation error for invalid branchId string in filter', async () => {
      await expect(service.list({ branchId: 'invalid-id' })).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Invalid branchId filter format',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  describe('getById', () => {
    it('should return configuration if found', async () => {
      const id = new Types.ObjectId();
      weeklyOffRepo.findById.mockResolvedValue({
        _id: id,
        name: 'Config',
        days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      } as any);

      const result = await service.getById(id);
      expect(result.id).toBe(id.toString());
    });

    it('should throw 404 if not found', async () => {
      weeklyOffRepo.findById.mockResolvedValue(null);

      await expect(service.getById(new Types.ObjectId())).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Weekly off configuration not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });
  });

  describe('update', () => {
    it('should update configuration details successfully', async () => {
      const id = new Types.ObjectId();
      const existing = {
        _id: id,
        name: 'Old Name',
        days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        branchId: null,
      };

      const updated = {
        ...existing,
        name: 'New Name',
        effectiveTo: '2026-12-31',
      };

      weeklyOffRepo.findById.mockResolvedValue(existing as any);
      weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
      weeklyOffRepo.update.mockResolvedValue(updated as any);

      const result = await service.update(
        id,
        { name: 'New Name', effectiveTo: '2026-12-31' },
        actorId,
        metadata,
      );

      expect(result.name).toBe('New Name');
      expect(result.effectiveTo).toBe('2026-12-31');
      expect(weeklyOffRepo.update).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should reject update if effectiveTo is before effectiveFrom', async () => {
      const id = new Types.ObjectId();
      weeklyOffRepo.findById.mockResolvedValue({
        _id: id,
        effectiveFrom: '2026-06-01',
        effectiveTo: null,
      } as any);

      await expect(
        service.update(id, { effectiveTo: '2026-05-01' }, actorId, metadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'effectiveTo cannot be earlier than effectiveFrom',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject update if dates cause overlap with another active configuration', async () => {
      const id = new Types.ObjectId();
      weeklyOffRepo.findById.mockResolvedValue({
        _id: id,
        branchId: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      } as any);

      weeklyOffRepo.findOverlappingConfig.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Another Active Config',
        effectiveFrom: '2026-06-01',
        effectiveTo: null,
      } as any);

      await expect(
        service.update(id, { effectiveFrom: '2026-07-01' }, actorId, metadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "An active weekly off configuration 'Another Active Config' already overlaps with effective dates [2026-06-01 to ongoing] for this scope.",
          HttpStatus.CONFLICT,
        ),
      );
    });
  });

  describe('updateStatus', () => {
    it('should toggle configuration to inactive without conflict check', async () => {
      const id = new Types.ObjectId();
      const existing = {
        _id: id,
        name: 'Config',
        isActive: true,
        branchId: null,
      };

      weeklyOffRepo.findById.mockResolvedValue(existing as any);
      weeklyOffRepo.update.mockResolvedValue({
        ...existing,
        isActive: false,
      } as any);

      const result = await service.updateStatus(id, false, actorId, metadata);
      expect(result.isActive).toBe(false);
      expect(weeklyOffRepo.findOverlappingConfig).not.toHaveBeenCalled();
    });

    it('should check conflict when activating and reject if overlapping', async () => {
      const id = new Types.ObjectId();
      const existing = {
        _id: id,
        name: 'Inactive Config',
        isActive: false,
        branchId: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      };

      weeklyOffRepo.findById.mockResolvedValue(existing as any);
      weeklyOffRepo.findOverlappingConfig.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Currently Active Config',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      } as any);

      await expect(
        service.updateStatus(id, true, actorId, metadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "Cannot activate configuration: overlaps with active configuration 'Currently Active Config' [2026-01-01 to ongoing].",
          HttpStatus.CONFLICT,
        ),
      );
    });
  });

  describe('delete', () => {
    it('should soft delete configuration and record audit log', async () => {
      const id = new Types.ObjectId();
      const existing = {
        _id: id,
        name: 'Config',
        branchId: null,
      };

      weeklyOffRepo.findById.mockResolvedValue(existing as any);
      weeklyOffRepo.softDelete.mockResolvedValue(existing as any);

      await service.delete(id, actorId, metadata);

      expect(weeklyOffRepo.softDelete).toHaveBeenCalledWith(
        id,
        actorId,
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw 404 if configuration not found during delete', async () => {
      weeklyOffRepo.findById.mockResolvedValue(null);

      await expect(
        service.delete(new Types.ObjectId(), actorId, metadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Weekly off configuration not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });
  });

  describe('getEffectiveConfig and isWeeklyOff', () => {
    it('should resolve branch override when present', async () => {
      const branchConfig = {
        _id: new Types.ObjectId(),
        name: 'Branch Special Config',
        branchId,
        days: [{ dayOfWeek: DayOfWeek.SATURDAY, occurrences: [2, 4] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      };

      weeklyOffRepo.findEffectiveConfig.mockImplementation((_date, bId) =>
        Promise.resolve(
          bId && bId.toString() === branchId.toString()
            ? (branchConfig as any)
            : null,
        ),
      );

      // 2026-10-10 is 2nd Saturday
      const result = await service.getEffectiveConfig('2026-10-10', branchId);
      expect(result.source).toBe('BRANCH_OVERRIDE');
      expect(result.isWeeklyOff).toBe(true);

      // 2026-10-17 is 3rd Saturday (not off under 2nd/4th rule)
      const isOff3rdSat = await service.isWeeklyOff('2026-10-17', branchId);
      expect(isOff3rdSat).toBe(false);
    });

    it('should fallback to company default when branch override not found', async () => {
      const companyConfig = {
        _id: new Types.ObjectId(),
        name: 'Company Default Config',
        branchId: null,
        days: [{ dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      };

      weeklyOffRepo.findEffectiveConfig.mockImplementation((_date, bId) =>
        Promise.resolve(bId === null ? (companyConfig as any) : null),
      );

      // 2026-10-11 is Sunday
      const result = await service.getEffectiveConfig('2026-10-11', branchId);
      expect(result.source).toBe('COMPANY_DEFAULT');
      expect(result.isWeeklyOff).toBe(true);

      // 2026-10-12 is Monday
      const isOffMonday = await service.isWeeklyOff('2026-10-12', branchId);
      expect(isOffMonday).toBe(false);
    });

    it('should fallback to system default (Every Sunday) when no configuration exists in DB', async () => {
      weeklyOffRepo.findEffectiveConfig.mockResolvedValue(null);

      // 2026-10-11 is Sunday
      const result = await service.getEffectiveConfig('2026-10-11');
      expect(result.source).toBe('SYSTEM_DEFAULT');
      expect(result.isWeeklyOff).toBe(true);

      // 2026-10-12 is Monday
      const isOff = await service.isWeeklyOff('2026-10-12');
      expect(isOff).toBe(false);
    });
  });
});
