import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DepartmentsService } from './departments.service';
import {
  DepartmentRepository,
  DepartmentLean,
} from './repositories/department.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let departmentRepository: jest.Mocked<DepartmentRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation(async <T>(cb: (session: unknown) => Promise<T>) => {
        return cb(mockSession);
      }),
    endSession: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const actorId = new Types.ObjectId();
  const clientMetadata: ClientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentsService,
        {
          provide: DepartmentRepository,
          useValue: {
            findByName: jest.fn(),
            create: jest.fn(),
            updateById: jest.fn(),
            findById: jest.fn(),
            findList: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<DepartmentsService>(DepartmentsService);
    departmentRepository = module.get(DepartmentRepository);
    auditLogsService = module.get(AuditLogsService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('1. Create "Engineering" -> SUCCESS', async () => {
      departmentRepository.findByName.mockResolvedValue(null);
      departmentRepository.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Engineering',
        isActive: true,
      } as unknown as DepartmentLean);

      const result = await service.create(
        { name: 'Engineering' },
        actorId,
        clientMetadata,
      );
      expect(result.name).toBe('Engineering');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('2. Create "engineering" after "Engineering" exists -> 409', async () => {
      departmentRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
      } as unknown as DepartmentLean);

      await expect(
        service.create({ name: 'engineering' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled(); // 13. Failed duplicate create does not create audit
    });

    it('3. Create "ENGINEERING" after "Engineering" exists -> 409', async () => {
      departmentRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
      } as unknown as DepartmentLean);

      await expect(
        service.create({ name: 'ENGINEERING' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('4. Create "eNgInEeRiNg" after "Engineering" exists -> 409', async () => {
      departmentRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
      } as unknown as DepartmentLean);

      await expect(
        service.create({ name: 'eNgInEeRiNg' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('5. Create another unique name -> SUCCESS', async () => {
      departmentRepository.findByName.mockResolvedValue(null);
      departmentRepository.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Finance',
        isActive: true,
      } as unknown as DepartmentLean);

      const result = await service.create(
        { name: 'Finance' },
        actorId,
        clientMetadata,
      );
      expect(result.name).toBe('Finance');
    });

    it('10. Create same name when previous department is soft-deleted -> SUCCESS', async () => {
      departmentRepository.findByName.mockResolvedValue(null);
      departmentRepository.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Engineering',
        isActive: true,
      } as unknown as DepartmentLean);

      const result = await service.create(
        { name: 'Engineering' },
        actorId,
        clientMetadata,
      );
      expect(result.name).toBe('Engineering');
    });

    it('14. Concurrent duplicate creation/update is protected by the MongoDB unique index where integration testing is available', async () => {
      departmentRepository.findByName.mockResolvedValue(null);
      departmentRepository.create.mockRejectedValue({ code: 11000 });

      await expect(
        service.create({ name: 'Race' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: 11000,
      });
    });
  });

  describe('update', () => {
    it('6. Update department with its exact same name -> no-op (no DB update, no audit)', async () => {
      const id = new Types.ObjectId();
      departmentRepository.findByName.mockResolvedValue(null);
      departmentRepository.findById.mockResolvedValue({
        _id: id,
        name: 'Engineering',
        isActive: true,
      } as unknown as DepartmentLean);

      const result = await service.update(
        id,
        { name: 'Engineering' },
        actorId,
        clientMetadata,
      );
      expect(result.name).toBe('Engineering');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(departmentRepository.updateById).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('7. Update department from: Engineering to: engineering on the SAME document -> SUCCESS', async () => {
      const id = new Types.ObjectId();
      departmentRepository.findByName.mockResolvedValue(null);
      departmentRepository.findById.mockResolvedValue({
        _id: id,
        name: 'Engineering',
        isActive: true,
      } as unknown as DepartmentLean);
      departmentRepository.updateById.mockResolvedValue({
        _id: id,
        name: 'engineering',
        isActive: true,
      } as unknown as DepartmentLean);

      await service.update(
        id,
        { name: 'engineering' },
        actorId,
        clientMetadata,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(departmentRepository.updateById).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ name: 'engineering' }),
        mockSession,
      );
    });

    it('8. Update Department B from: Finance to: Engineering when Department A already has Engineering -> 409', async () => {
      const id = new Types.ObjectId();
      departmentRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
      } as unknown as DepartmentLean);

      await expect(
        service.update(id, { name: 'Engineering' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled(); // 13. Failed duplicate update does not create audit
    });

    it('9. Update Department B from: Finance to: engineering when Department A already has Engineering -> 409', async () => {
      const id = new Types.ObjectId();
      departmentRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
      } as unknown as DepartmentLean);

      await expect(
        service.update(id, { name: 'engineering' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('11. Update to a name that belongs only to a soft-deleted department -> SUCCESS', async () => {
      const id = new Types.ObjectId();
      departmentRepository.findByName.mockResolvedValue(null);
      departmentRepository.findById.mockResolvedValue({
        _id: id,
        name: 'Finance',
        isActive: true,
      } as unknown as DepartmentLean);
      departmentRepository.updateById.mockResolvedValue({
        _id: id,
        name: 'Engineering',
        isActive: true,
      } as unknown as DepartmentLean);

      await service.update(
        id,
        { name: 'Engineering' },
        actorId,
        clientMetadata,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(departmentRepository.updateById).toHaveBeenCalled();
    });

    it('12. Failed duplicate update does not modify the target department', async () => {
      const id = new Types.ObjectId();
      departmentRepository.findByName.mockResolvedValue(null);
      departmentRepository.findById.mockResolvedValue({
        _id: id,
        name: 'Engineering',
        isActive: true,
      } as unknown as DepartmentLean);
      departmentRepository.updateById.mockRejectedValue({ code: 11000 });

      await expect(
        service.update(id, { name: 'Finance' }, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: 11000,
      });
    });
  });

  describe('list', () => {
    it('15. Verify existing pagination/search/filter behavior remains unchanged', async () => {
      departmentRepository.findList.mockResolvedValue({
        data: [
          {
            _id: new Types.ObjectId(),
            name: 'Eng',
            isActive: true,
          } as unknown as DepartmentLean,
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.list({ page: 1, limit: 10, search: 'Eng' });
      expect(result.data.length).toBe(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(departmentRepository.findList).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: 'Eng',
      });
    });
  });
});
