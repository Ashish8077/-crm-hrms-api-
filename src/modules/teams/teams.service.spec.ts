/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TeamsService } from './teams.service';
import { TeamRepository, TeamLean } from './repositories/team.repository';
import { DepartmentsService } from '../departments/departments.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';

describe('TeamsService', () => {
  let service: TeamsService;
  let teamRepository: jest.Mocked<TeamRepository>;
  let departmentsService: jest.Mocked<DepartmentsService>;
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
        TeamsService,
        {
          provide: TeamRepository,
          useValue: {
            findByNameAndDepartment: jest.fn(),
            create: jest.fn(),
            updateById: jest.fn(),
            updateStatus: jest.fn(),
            findById: jest.fn(),
            findList: jest.fn(),
          },
        },
        {
          provide: DepartmentsService,
          useValue: {
            getById: jest.fn(),
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

    service = module.get<TeamsService>(TeamsService);
    teamRepository = module.get(TeamRepository);
    departmentsService = module.get(DepartmentsService);
    auditLogsService = module.get(AuditLogsService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a team successfully', async () => {
      const dto = {
        name: 'Backend',
        departmentId: new Types.ObjectId().toString(),
      };

      departmentsService.getById.mockResolvedValue({
        id: dto.departmentId,
        name: 'Engineering',
        isActive: true,
      });

      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      const createdTeam = {
        _id: new Types.ObjectId(),
        name: 'Backend',
        departmentId: new Types.ObjectId(dto.departmentId),
        isActive: true,
      };
      teamRepository.create.mockResolvedValue(
        createdTeam as unknown as TeamLean,
      );

      const result = await service.create(dto, actorId, clientMetadata);

      expect(result).toBeDefined();
      expect(result.id).toEqual(createdTeam._id.toString());
      expect(result.name).toEqual('Backend');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw an error if the department is not active', async () => {
      const dto = {
        name: 'Backend',
        departmentId: new Types.ObjectId().toString(),
      };

      departmentsService.getById.mockResolvedValue({
        id: dto.departmentId,
        name: 'Engineering',
        isActive: false,
      });

      await expect(
        service.create(dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw an error if team name already exists in the department', async () => {
      const dto = {
        name: 'Backend',
        departmentId: new Types.ObjectId().toString(),
      };

      departmentsService.getById.mockResolvedValue({
        id: dto.departmentId,
        name: 'Engineering',
        isActive: true,
      });

      teamRepository.findByNameAndDepartment.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Backend',
      } as unknown as TeamLean);

      await expect(
        service.create(dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('should allow creating a team with the same name in a different department', async () => {
      const dto = {
        name: 'Backend',
        departmentId: new Types.ObjectId().toString(),
      };

      departmentsService.getById.mockResolvedValue({
        id: dto.departmentId,
        name: 'Product',
        isActive: true,
      });

      // No duplicate found in the new department
      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      teamRepository.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Backend',
        departmentId: new Types.ObjectId(dto.departmentId),
        isActive: true,
      } as unknown as TeamLean);

      const result = await service.create(dto, actorId, clientMetadata);
      expect(result.name).toEqual('Backend');
      expect(teamRepository.findByNameAndDepartment).toHaveBeenCalledWith(
        'Backend',
        dto.departmentId,
        undefined,
        mockSession,
      );
    });

    it('should reject case-insensitive duplicate name in the same department', async () => {
      const dto = {
        name: 'backend', // lowercase
        departmentId: new Types.ObjectId().toString(),
      };

      departmentsService.getById.mockResolvedValue({
        id: dto.departmentId,
        name: 'Engineering',
        isActive: true,
      });

      // Mock repository returning an existing team with different casing
      teamRepository.findByNameAndDepartment.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Backend',
        departmentId: new Types.ObjectId(dto.departmentId),
      } as unknown as TeamLean);

      await expect(
        service.create(dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('should allow creating an active team if an existing team with the same name is soft-deleted', async () => {
      const dto = {
        name: 'Backend',
        departmentId: new Types.ObjectId().toString(),
      };

      departmentsService.getById.mockResolvedValue({
        id: dto.departmentId,
        name: 'Engineering',
        isActive: true,
      });

      // The repository method findByNameAndDepartment excludes soft-deleted records and returns null
      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      teamRepository.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Backend',
        departmentId: new Types.ObjectId(dto.departmentId),
        isActive: true,
      } as unknown as TeamLean);

      const result = await service.create(dto, actorId, clientMetadata);
      expect(result.name).toEqual('Backend');
    });
  });

  describe('update', () => {
    const teamId = new Types.ObjectId();
    const dto = {
      name: 'New Backend',
    };

    it('should update a team successfully', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Old Backend',
        departmentId: new Types.ObjectId(),
      };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      const updatedTeam = {
        ...existingTeam,
        name: 'New Backend',
      };
      teamRepository.updateById.mockResolvedValue(
        updatedTeam as unknown as TeamLean,
      );

      const result = await service.update(teamId, dto, actorId, clientMetadata);

      expect(result.name).toEqual('New Backend');
      expect(teamRepository.updateById).toHaveBeenCalledWith(
        teamId,
        expect.objectContaining({ name: 'New Backend' }),
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw an error if updating to a duplicate name', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Old Backend',
        departmentId: new Types.ObjectId(),
      };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      teamRepository.findByNameAndDepartment.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'New Backend',
      } as unknown as TeamLean);

      await expect(
        service.update(teamId, dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('should throw an error if team not found', async () => {
      teamRepository.findById.mockResolvedValue(null);

      await expect(
        service.update(teamId, dto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_NOT_FOUND,
      });
    });

    it('should leave name unchanged if updating only departmentId', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Backend',
        departmentId: new Types.ObjectId(),
      };
      const newDepartmentId = new Types.ObjectId();
      const updateDto = { departmentId: newDepartmentId.toString() };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      departmentsService.getById.mockResolvedValue({
        id: updateDto.departmentId,
        name: 'New Department',
        isActive: true,
      });
      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      const updatedTeam = { ...existingTeam, departmentId: newDepartmentId };
      teamRepository.updateById.mockResolvedValue(
        updatedTeam as unknown as TeamLean,
      );

      await service.update(teamId, updateDto, actorId, clientMetadata);

      expect(teamRepository.findByNameAndDepartment).toHaveBeenCalledWith(
        'Backend', // existing name
        newDepartmentId,
        teamId,
        mockSession,
      );
      expect(teamRepository.updateById).toHaveBeenCalledWith(
        teamId,
        expect.objectContaining({ departmentId: newDepartmentId }),
        mockSession,
      );
    });

    it('should leave departmentId unchanged if updating only name', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Old Backend',
        departmentId: new Types.ObjectId(),
      };
      const updateDto = { name: 'New Backend' };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      const updatedTeam = { ...existingTeam, name: 'New Backend' };
      teamRepository.updateById.mockResolvedValue(
        updatedTeam as unknown as TeamLean,
      );

      await service.update(teamId, updateDto, actorId, clientMetadata);

      expect(teamRepository.findByNameAndDepartment).toHaveBeenCalledWith(
        'New Backend',
        existingTeam.departmentId, // existing department
        teamId,
        mockSession,
      );
      expect(teamRepository.updateById).toHaveBeenCalledWith(
        teamId,
        expect.objectContaining({ name: 'New Backend' }),
        mockSession,
      );
    });

    it('should throw RESOURCE_ALREADY_EXISTS if moving team to department where same name already exists', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Backend',
        departmentId: new Types.ObjectId(),
      };
      const newDepartmentId = new Types.ObjectId();
      const updateDto = { departmentId: newDepartmentId.toString() };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      departmentsService.getById.mockResolvedValue({
        id: updateDto.departmentId,
        name: 'New Department',
        isActive: true,
      });
      teamRepository.findByNameAndDepartment.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Backend',
        departmentId: newDepartmentId,
      } as unknown as TeamLean);

      await expect(
        service.update(teamId, updateDto, actorId, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      });
    });

    it('should allow moving team to department where same name does not exist', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Backend',
        departmentId: new Types.ObjectId(),
      };
      const newDepartmentId = new Types.ObjectId();
      const updateDto = { departmentId: newDepartmentId.toString() };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      departmentsService.getById.mockResolvedValue({
        id: updateDto.departmentId,
        name: 'New Department',
        isActive: true,
      });
      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      const updatedTeam = { ...existingTeam, departmentId: newDepartmentId };
      teamRepository.updateById.mockResolvedValue(
        updatedTeam as unknown as TeamLean,
      );

      const result = await service.update(
        teamId,
        updateDto,
        actorId,
        clientMetadata,
      );
      expect(result.departmentId).toEqual(newDepartmentId.toString());
    });

    it('should allow updating team without changing final (departmentId, name) combination', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Backend',
        departmentId: new Types.ObjectId(),
        description: 'Old Description',
      };
      // Providing the exact same name and departmentId
      const updateDto = {
        name: 'Backend',
        departmentId: existingTeam.departmentId.toString(),
        description: 'New Description',
      };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      departmentsService.getById.mockResolvedValue({
        id: updateDto.departmentId,
        name: 'Engineering',
        isActive: true,
      });

      // Should not throw because excludeId matches existing team's id in repository
      // Though in our unit test mock we just return null because the query excludes the id
      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      const updatedTeam = { ...existingTeam, description: 'New Description' };
      teamRepository.updateById.mockResolvedValue(
        updatedTeam as unknown as TeamLean,
      );

      await service.update(teamId, updateDto, actorId, clientMetadata);
      expect(teamRepository.updateById).toHaveBeenCalledWith(
        teamId,
        expect.objectContaining({ description: 'New Description' }),
        mockSession,
      );
    });

    it('should validate final combination when updating name and departmentId together', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Backend',
        departmentId: new Types.ObjectId(),
      };
      const newDepartmentId = new Types.ObjectId();
      const updateDto = {
        name: 'New Backend',
        departmentId: newDepartmentId.toString(),
      };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      departmentsService.getById.mockResolvedValue({
        id: updateDto.departmentId,
        name: 'New Department',
        isActive: true,
      });
      teamRepository.findByNameAndDepartment.mockResolvedValue(null);

      const updatedTeam = {
        ...existingTeam,
        name: 'New Backend',
        departmentId: newDepartmentId,
      };
      teamRepository.updateById.mockResolvedValue(
        updatedTeam as unknown as TeamLean,
      );

      await service.update(teamId, updateDto, actorId, clientMetadata);

      expect(teamRepository.findByNameAndDepartment).toHaveBeenCalledWith(
        'New Backend',
        newDepartmentId,
        teamId,
        mockSession,
      );
    });
  });

  describe('updateStatus', () => {
    const teamId = new Types.ObjectId();

    it('should update the status successfully', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Backend',
        departmentId: new Types.ObjectId(),
        isActive: true,
      };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );
      teamRepository.updateStatus.mockResolvedValue({
        ...existingTeam,
        isActive: false,
      } as unknown as TeamLean);

      const result = await service.updateStatus(
        teamId,
        { isActive: false },
        actorId,
        clientMetadata,
      );

      expect(result.isActive).toBe(false);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should avoid db operation and audit if status is unchanged', async () => {
      const existingTeam = {
        _id: teamId,
        name: 'Backend',
        departmentId: new Types.ObjectId(),
        isActive: true,
      };

      teamRepository.findById.mockResolvedValue(
        existingTeam as unknown as TeamLean,
      );

      const result = await service.updateStatus(
        teamId,
        { isActive: true },
        actorId,
        clientMetadata,
      );

      expect(result.isActive).toBe(true);
      expect(teamRepository.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });
  });
});
