/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BranchesService } from './branches.service';
import { BranchRepository } from './repositories/branch.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Branch } from './schemas/branch.schema';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';

describe('BranchesService', () => {
  let service: BranchesService;
  let branchRepository: jest.Mocked<BranchRepository>;
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
        BranchesService,
        {
          provide: BranchRepository,
          useValue: {
            findByName: jest.fn(),
            create: jest.fn(),
            updateById: jest.fn(),
            updateStatus: jest.fn(),
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

    service = module.get<BranchesService>(BranchesService);
    branchRepository = module.get(BranchRepository);
    auditLogsService = module.get(AuditLogsService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a branch successfully', async () => {
      const dto = {
        name: 'Headquarters',
      };

      branchRepository.findByName.mockResolvedValue(null);

      const createdBranch = {
        _id: new Types.ObjectId(),
        name: 'Headquarters',
        isActive: true,
      };
      branchRepository.create.mockResolvedValue(
        createdBranch as unknown as Branch & { _id: Types.ObjectId },
      );

      const result = await service.create(dto, actorId, clientMetadata);

      expect(result).toBeDefined();
      expect(result.id).toEqual(createdBranch._id.toString());
      expect(result.name).toEqual('Headquarters');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw an error if branch name already exists', async () => {
      const dto = {
        name: 'Headquarters',
      };

      branchRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Headquarters',
      } as unknown as Branch & { _id: Types.ObjectId });

      await expect(
        service.create(dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });
  });

  describe('update', () => {
    const branchId = new Types.ObjectId();
    const dto = {
      name: 'New Headquarters',
    };

    it('should update a branch successfully', async () => {
      const existingBranch = {
        _id: branchId,
        name: 'Old Headquarters',
      };

      branchRepository.findById.mockResolvedValue(
        existingBranch as unknown as Branch & { _id: Types.ObjectId },
      );
      branchRepository.findByName.mockResolvedValue(null);

      const updatedBranch = {
        ...existingBranch,
        name: 'New Headquarters',
      };
      branchRepository.updateById.mockResolvedValue(
        updatedBranch as unknown as Branch & { _id: Types.ObjectId },
      );

      const result = await service.update(
        branchId,
        dto,
        actorId,
        clientMetadata,
      );

      expect(result.name).toEqual('New Headquarters');
      expect(branchRepository.updateById).toHaveBeenCalledWith(
        branchId,
        expect.objectContaining({ name: 'New Headquarters' }),
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw an error if updating to a duplicate name', async () => {
      const existingBranch = {
        _id: branchId,
        name: 'Old Headquarters',
      };

      branchRepository.findById.mockResolvedValue(
        existingBranch as unknown as Branch & { _id: Types.ObjectId },
      );
      branchRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'New Headquarters',
      } as unknown as Branch & { _id: Types.ObjectId });

      await expect(
        service.update(branchId, dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('should throw an error if branch not found', async () => {
      branchRepository.findById.mockResolvedValue(null);

      await expect(
        service.update(branchId, dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });
  });

  describe('updateStatus', () => {
    const branchId = new Types.ObjectId();

    it('should update the status successfully', async () => {
      const existingBranch = {
        _id: branchId,
        name: 'Headquarters',
        isActive: true,
      };

      branchRepository.findById.mockResolvedValue(
        existingBranch as unknown as Branch & { _id: Types.ObjectId },
      );
      branchRepository.updateStatus.mockResolvedValue({
        ...existingBranch,
        isActive: false,
      } as unknown as Branch & { _id: Types.ObjectId });

      const result = await service.updateStatus(
        branchId,
        { isActive: false },
        actorId,
        clientMetadata,
      );

      expect(result.isActive).toBe(false);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should avoid db operation and audit if status is unchanged', async () => {
      const existingBranch = {
        _id: branchId,
        name: 'Headquarters',
        isActive: true,
      };

      branchRepository.findById.mockResolvedValue(
        existingBranch as unknown as Branch & { _id: Types.ObjectId },
      );

      const result = await service.updateStatus(
        branchId,
        { isActive: true },
        actorId,
        clientMetadata,
      );

      expect(result.isActive).toBe(true);
      expect(branchRepository.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });
  });
});
