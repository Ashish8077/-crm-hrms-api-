import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { EmployeesService } from './employees.service';
import { EmployeeRepository } from './repositories/employee.repository';
import { EmployeeStatusHistoryRepository } from './repositories/employee-status-history.repository';
import { DepartmentRepository } from '../departments/repositories/department.repository';
import { DesignationRepository } from '../designations/repositories/designation.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { TeamRepository } from '../teams/repositories/team.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { EmploymentStatus } from './constants/employee.constant';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let employeeStatusHistoryRepo: jest.Mocked<EmployeeStatusHistoryRepository>;
  let departmentRepo: jest.Mocked<DepartmentRepository>;
  let designationRepo: jest.Mocked<DesignationRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let teamRepo: jest.Mocked<TeamRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation((cb: (session: unknown) => unknown) =>
        cb(mockSession),
      ),
    endSession: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const activeDepartment = {
    _id: new Types.ObjectId(),
    name: 'Engineering',
    isActive: true,
  };

  const inactiveDepartment = {
    _id: new Types.ObjectId(),
    name: 'Old Dept',
    isActive: false,
  };

  const activeDesignation = {
    _id: new Types.ObjectId(),
    name: 'Software Engineer',
    isActive: true,
  };

  const activeBranch = {
    _id: new Types.ObjectId(),
    name: 'HQ',
    isActive: true,
  };

  const activeTeam = {
    _id: new Types.ObjectId(),
    name: 'Backend',
    departmentId: activeDepartment._id,
    isActive: true,
  };

  const activeManager = {
    _id: new Types.ObjectId(),
    employeeCode: 'EMP-001',
    firstName: 'Manager',
    lastName: 'One',
    workEmail: 'manager@test.com',
    employmentStatus: EmploymentStatus.ACTIVE,
    reportingManagerId: null,
  };

  beforeEach(async () => {
    employeeRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByWorkEmail: jest.fn(),
      findByCode: jest.fn(),
      findList: jest.fn(),
      updateById: jest.fn(),
      updateStatus: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<EmployeeRepository>;

    employeeStatusHistoryRepo = {
      create: jest.fn(),
      findByEmployeeId: jest.fn(),
    } as unknown as jest.Mocked<EmployeeStatusHistoryRepository>;

    departmentRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<DepartmentRepository>;

    designationRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<DesignationRepository>;

    branchRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<BranchRepository>;

    teamRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<TeamRepository>;

    auditLogsService = {
      createAuditLog: jest.fn(),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: EmployeeRepository, useValue: employeeRepo },
        {
          provide: EmployeeStatusHistoryRepository,
          useValue: employeeStatusHistoryRepo,
        },
        { provide: DepartmentRepository, useValue: departmentRepo },
        { provide: DesignationRepository, useValue: designationRepo },
        { provide: BranchRepository, useValue: branchRepo },
        { provide: TeamRepository, useValue: teamRepo },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: getConnectionToken(), useValue: mockConnection },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
  });

  describe('validateRelationships', () => {
    it('should throw an error if department is inactive', async () => {
      departmentRepo.findById.mockResolvedValue(inactiveDepartment as never);
      designationRepo.findById.mockResolvedValue(activeDesignation as never);
      branchRepo.findById.mockResolvedValue(activeBranch as never);

      await expect(
        service['validateRelationships'](
          inactiveDepartment._id,
          activeDesignation._id,
          activeBranch._id,
        ),
      ).rejects.toThrow(AppError);

      try {
        await service['validateRelationships'](
          inactiveDepartment._id,
          activeDesignation._id,
          activeBranch._id,
        );
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
        }
      }
    });

    it('should throw an error if team does not belong to the department', async () => {
      departmentRepo.findById.mockResolvedValue(activeDepartment as never);
      designationRepo.findById.mockResolvedValue(activeDesignation as never);
      branchRepo.findById.mockResolvedValue(activeBranch as never);

      const differentDeptId = new Types.ObjectId();
      teamRepo.findById.mockResolvedValue({
        ...activeTeam,
        departmentId: differentDeptId,
      } as never);

      await expect(
        service['validateRelationships'](
          activeDepartment._id,
          activeDesignation._id,
          activeBranch._id,
          activeTeam._id,
        ),
      ).rejects.toThrow(/Team does not belong/);
    });

    it('should pass for valid relationships', async () => {
      departmentRepo.findById.mockResolvedValue(activeDepartment as never);
      designationRepo.findById.mockResolvedValue(activeDesignation as never);
      branchRepo.findById.mockResolvedValue(activeBranch as never);
      teamRepo.findById.mockResolvedValue(activeTeam as never);
      employeeRepo.findById.mockResolvedValue(activeManager as never);

      await expect(
        service['validateRelationships'](
          activeDepartment._id,
          activeDesignation._id,
          activeBranch._id,
          activeTeam._id,
          activeManager._id,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('validateReportingManager', () => {
    it('should prevent employee from reporting to themselves', async () => {
      const empId = new Types.ObjectId();
      await expect(
        service['validateReportingManager'](empId, empId),
      ).rejects.toThrow(/Employee cannot report to themselves/);
    });

    it('should detect circular hierarchy (A -> B -> A)', async () => {
      const empA_id = new Types.ObjectId();
      const empB_id = new Types.ObjectId();

      // manager is B, who reports to A
      employeeRepo.findById.mockImplementation((id) => {
        if (id.toString() === empB_id.toString()) {
          return Promise.resolve({
            _id: empB_id,
            employmentStatus: EmploymentStatus.ACTIVE,
            reportingManagerId: empA_id,
          } as never);
        }
        if (id.toString() === empA_id.toString()) {
          return Promise.resolve({
            _id: empA_id,
            employmentStatus: EmploymentStatus.ACTIVE,
            reportingManagerId: null,
          } as never);
        }
        return Promise.resolve(null);
      });

      // Employee A is updating manager to B
      await expect(
        service['validateReportingManager'](empB_id, empA_id),
      ).rejects.toThrow(/Circular reporting hierarchy detected/);
    });

    it('should pass if hierarchy is valid', async () => {
      const empA_id = new Types.ObjectId();
      const empB_id = new Types.ObjectId();
      const empC_id = new Types.ObjectId();

      employeeRepo.findById.mockImplementation((id) => {
        if (id.toString() === empB_id.toString()) {
          return Promise.resolve({
            _id: empB_id,
            employmentStatus: EmploymentStatus.ACTIVE,
            reportingManagerId: empC_id,
          } as never);
        }
        if (id.toString() === empC_id.toString()) {
          return Promise.resolve({
            _id: empC_id,
            employmentStatus: EmploymentStatus.ACTIVE,
            reportingManagerId: null,
          } as never);
        }
        return Promise.resolve(null);
      });

      // Employee A is updating manager to B
      await expect(
        service['validateReportingManager'](empB_id, empA_id),
      ).resolves.not.toThrow();
    });
  });
});
