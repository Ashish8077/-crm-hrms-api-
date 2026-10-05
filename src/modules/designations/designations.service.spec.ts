/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DesignationsService } from './designations.service';
import { DesignationRepository } from './repositories/designation.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { Designation } from './schemas/designation.schema';

describe('DesignationsService', () => {
  let service: DesignationsService;
  let designationRepository: jest.Mocked<DesignationRepository>;
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
        DesignationsService,
        {
          provide: DesignationRepository,
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

    service = module.get<DesignationsService>(DesignationsService);
    designationRepository = module.get(DesignationRepository);
    auditLogsService = module.get(AuditLogsService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a designation successfully', async () => {
      const dto = {
        name: 'Senior Engineer',
      };

      designationRepository.findByName.mockResolvedValue(null);

      const createdDesignation = {
        _id: new Types.ObjectId(),
        name: 'Senior Engineer',
        isActive: true,
      };
      designationRepository.create.mockResolvedValue(
        createdDesignation as unknown as Designation & { _id: Types.ObjectId },
      );

      const result = await service.create(dto, actorId, clientMetadata);

      expect(result).toBeDefined();
      expect(result.id).toEqual(createdDesignation._id.toString());
      expect(result.name).toEqual('Senior Engineer');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw an error if designation name already exists', async () => {
      const dto = {
        name: 'Senior Engineer',
      };

      designationRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Senior Engineer',
      } as unknown as Designation & { _id: Types.ObjectId });

      await expect(
        service.create(dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });
  });

  describe('update', () => {
    const designationId = new Types.ObjectId();
    const dto = {
      name: 'Staff Engineer',
    };

    it('should update a designation successfully', async () => {
      const existingDesignation = {
        _id: designationId,
        name: 'Senior Engineer',
      };

      designationRepository.findById.mockResolvedValue(
        existingDesignation as unknown as Designation & { _id: Types.ObjectId },
      );
      designationRepository.findByName.mockResolvedValue(null);

      const updatedDesignation = {
        ...existingDesignation,
        name: 'Staff Engineer',
      };
      designationRepository.updateById.mockResolvedValue(
        updatedDesignation as unknown as Designation & { _id: Types.ObjectId },
      );

      const result = await service.update(
        designationId,
        dto,
        actorId,
        clientMetadata,
      );

      expect(result.name).toEqual('Staff Engineer');
      expect(designationRepository.updateById).toHaveBeenCalledWith(
        designationId,
        expect.objectContaining({ name: 'Staff Engineer' }),
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw an error if updating to a duplicate name', async () => {
      const existingDesignation = {
        _id: designationId,
        name: 'Senior Engineer',
      };

      designationRepository.findById.mockResolvedValue(
        existingDesignation as unknown as Designation & { _id: Types.ObjectId },
      );
      designationRepository.findByName.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Staff Engineer',
      } as unknown as Designation & { _id: Types.ObjectId });

      await expect(
        service.update(designationId, dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('should throw an error if designation not found', async () => {
      designationRepository.findById.mockResolvedValue(null);

      await expect(
        service.update(designationId, dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });
  });

  describe('updateStatus', () => {
    const designationId = new Types.ObjectId();

    it('should update the status successfully', async () => {
      const existingDesignation = {
        _id: designationId,
        name: 'Senior Engineer',
        isActive: true,
      };

      designationRepository.findById.mockResolvedValue(
        existingDesignation as unknown as Designation & { _id: Types.ObjectId },
      );
      designationRepository.updateStatus.mockResolvedValue({
        ...existingDesignation,
        isActive: false,
      } as unknown as Designation & { _id: Types.ObjectId });

      const result = await service.updateStatus(
        designationId,
        { isActive: false },
        actorId,
        clientMetadata,
      );

      expect(result.isActive).toBe(false);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should avoid db operation and audit if status is unchanged', async () => {
      const existingDesignation = {
        _id: designationId,
        name: 'Senior Engineer',
        isActive: true,
      };

      designationRepository.findById.mockResolvedValue(
        existingDesignation as unknown as Designation & { _id: Types.ObjectId },
      );

      const result = await service.updateStatus(
        designationId,
        { isActive: true },
        actorId,
        clientMetadata,
      );

      expect(result.isActive).toBe(true);
      expect(designationRepository.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });
  });
});
