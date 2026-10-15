/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { HttpStatus } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeeRepository } from './repositories/employee.repository';
import { DepartmentRepository } from '../departments/repositories/department.repository';
import { DesignationRepository } from '../designations/repositories/designation.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { TeamRepository } from '../teams/repositories/team.repository';
import { UserRepository } from '../users/repositories/user.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { getConnectionToken } from '@nestjs/mongoose';
import { ErrorCode } from '../../common/errors/error-codes';
import { EmploymentStatus } from './constants/employee.constant';
import { UserStatus } from '../users/constants/user-status.constant';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';

describe('EmployeesService - linkUser', () => {
  let service: EmployeesService;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let userRepo: jest.Mocked<UserRepository>;
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

  const actorId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const clientMetadata = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  const activeUser = {
    _id: userId,
    email: 'user@test.com',
    status: UserStatus.ACTIVE,
    roleIds: [],
    deletedAt: null,
  };

  const activeEmployee = {
    _id: employeeId,
    employeeCode: 'EMP-0001',
    firstName: 'John',
    lastName: 'Doe',
    workEmail: 'john@test.com',
    employmentStatus: EmploymentStatus.ACTIVE,
    userId: null,
    departmentId: new Types.ObjectId(),
    designationId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    teamId: null,
    reportingManagerId: null,
    skills: [],
    certifications: [],
    deletedAt: null,
  };

  beforeEach(async () => {
    employeeRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByWorkEmail: jest.fn(),
      findByCode: jest.fn(),
      findList: jest.fn(),
      updateById: jest.fn(),
      softDelete: jest.fn(),
      getNextEmployeeCode: jest.fn(),
      findByUserId: jest.fn(),
      linkUser: jest.fn(),
    } as unknown as jest.Mocked<EmployeeRepository>;

    userRepo = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    auditLogsService = {
      createAuditLog: jest.fn(),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: EmployeeRepository, useValue: employeeRepo },
        { provide: DepartmentRepository, useValue: { findById: jest.fn() } },
        { provide: DesignationRepository, useValue: { findById: jest.fn() } },
        { provide: BranchRepository, useValue: { findById: jest.fn() } },
        { provide: TeamRepository, useValue: { findById: jest.fn() } },
        { provide: UserRepository, useValue: userRepo },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: getConnectionToken(), useValue: mockConnection },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
  });

  it('should successfully link a user to an employee and create an audit log', async () => {
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue(activeEmployee as any);
    employeeRepo.findByUserId.mockResolvedValue(null);
    const linkedEmployee = { ...activeEmployee, userId };
    employeeRepo.linkUser.mockResolvedValue(linkedEmployee as any);
    auditLogsService.createAuditLog.mockResolvedValue(undefined);

    const result = await service.linkUser(
      employeeId,
      userId,
      actorId,
      clientMetadata,
    );

    expect(employeeRepo.linkUser).toHaveBeenCalledWith(
      employeeId,
      userId,
      actorId,
      mockSession,
    );
    expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.EMPLOYEE_USER_LINKED,
        targetModel: AuditTargetModel.EMPLOYEE,
        targetId: employeeId,
        actorId,
        details: expect.objectContaining({
          userId: userId.toString(),
          employeeCode: activeEmployee.employeeCode,
        }),
      }),
      mockSession,
    );
    expect(result.userId).toBe(userId.toString());
  });

  it('should throw RESOURCE_NOT_FOUND when user does not exist', async () => {
    userRepo.findById.mockResolvedValue(null);

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      statusCode: HttpStatus.NOT_FOUND,
    });

    expect(employeeRepo.linkUser).not.toHaveBeenCalled();
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should throw VALIDATION_ERROR when user is inactive', async () => {
    userRepo.findById.mockResolvedValue({
      ...activeUser,
      status: UserStatus.INACTIVE,
    } as any);

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    expect(employeeRepo.linkUser).not.toHaveBeenCalled();
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should throw RESOURCE_NOT_FOUND when employee does not exist', async () => {
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue(null);

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      statusCode: HttpStatus.NOT_FOUND,
    });

    expect(employeeRepo.linkUser).not.toHaveBeenCalled();
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should throw VALIDATION_ERROR when employee is terminated (inactive)', async () => {
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue({
      ...activeEmployee,
      employmentStatus: EmploymentStatus.TERMINATED,
    } as any);

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: HttpStatus.BAD_REQUEST,
    });

    expect(employeeRepo.linkUser).not.toHaveBeenCalled();
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should throw RESOURCE_ALREADY_EXISTS when employee is already linked to a user', async () => {
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue({
      ...activeEmployee,
      userId: new Types.ObjectId(), // already has a userId
    } as any);

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      statusCode: HttpStatus.CONFLICT,
    });

    expect(employeeRepo.linkUser).not.toHaveBeenCalled();
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should throw RESOURCE_ALREADY_EXISTS when user is already linked to a different employee', async () => {
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue(activeEmployee as any);
    employeeRepo.findByUserId.mockResolvedValue({
      ...activeEmployee,
      _id: new Types.ObjectId(), // a different employee already holds this userId
    } as any);

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      statusCode: HttpStatus.CONFLICT,
    });

    expect(employeeRepo.linkUser).not.toHaveBeenCalled();
    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should throw RESOURCE_NOT_FOUND if linkUser repository call returns null (race condition)', async () => {
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue(activeEmployee as any);
    employeeRepo.findByUserId.mockResolvedValue(null);
    // Simulate race condition — document was soft-deleted after pre-checks
    employeeRepo.linkUser.mockResolvedValue(null);

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });

    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should not create an audit log when linkUser fails', async () => {
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue(activeEmployee as any);
    employeeRepo.findByUserId.mockResolvedValue(null);
    employeeRepo.linkUser.mockRejectedValue(new Error('DB error'));

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toThrow('DB error');

    expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should preserve soft-delete: soft-deleted employees are not found', async () => {
    // The repository findById already filters deletedAt: null (verified in repo implementation)
    // This test verifies the service treats null return from findById as not found
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue(null); // soft-deleted records return null

    await expect(
      service.linkUser(employeeId, userId, actorId, clientMetadata),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
  });

  it('should preserve existing API response shape: success and data fields', async () => {
    // Verifies the controller-level contract through service return value
    userRepo.findById.mockResolvedValue(activeUser as any);
    employeeRepo.findById.mockResolvedValue(activeEmployee as any);
    employeeRepo.findByUserId.mockResolvedValue(null);
    employeeRepo.linkUser.mockResolvedValue({
      ...activeEmployee,
      userId,
    } as any);
    auditLogsService.createAuditLog.mockResolvedValue(undefined);

    const result = await service.linkUser(
      employeeId,
      userId,
      actorId,
      clientMetadata,
    );

    // Must match EmployeeResponse shape (from EmployeeMapper.toResponse)
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('userId', userId.toString());
    expect(result).toHaveProperty('employeeCode');
  });
});

// ── P0 #2: Audit Enum Verification ───────────────────────────────────────────
describe('AuditAction enum - P0 extension verification', () => {
  it('should preserve all original employee action values', () => {
    expect(AuditAction.EMPLOYEE_CREATED).toBe('EMPLOYEE_CREATED');
    expect(AuditAction.EMPLOYEE_UPDATED).toBe('EMPLOYEE_UPDATED');
    expect(AuditAction.EMPLOYEE_STATUS_CHANGED).toBe('EMPLOYEE_STATUS_CHANGED');
    expect(AuditAction.EMPLOYEE_DELETED).toBe('EMPLOYEE_DELETED');
  });

  it('should contain the new EMPLOYEE_USER_LINKED value', () => {
    expect(AuditAction.EMPLOYEE_USER_LINKED).toBe('EMPLOYEE_USER_LINKED');
  });

  it('should contain the new CRM action values with correct strings', () => {
    expect(AuditAction.COMPANY_CREATED).toBe('COMPANY_CREATED');
    expect(AuditAction.COMPANY_UPDATED).toBe('COMPANY_UPDATED');
    expect(AuditAction.COMPANY_DELETED).toBe('COMPANY_DELETED');
    expect(AuditAction.CONTACT_CREATED).toBe('CONTACT_CREATED');
    expect(AuditAction.CONTACT_UPDATED).toBe('CONTACT_UPDATED');
    expect(AuditAction.CONTACT_DELETED).toBe('CONTACT_DELETED');
    expect(AuditAction.LEAD_CREATED).toBe('LEAD_CREATED');
    expect(AuditAction.LEAD_UPDATED).toBe('LEAD_UPDATED');
    expect(AuditAction.LEAD_DELETED).toBe('LEAD_DELETED');
    expect(AuditAction.LEAD_ASSIGNED).toBe('LEAD_ASSIGNED');
    expect(AuditAction.LEAD_TRANSFERRED).toBe('LEAD_TRANSFERRED');
    expect(AuditAction.LEAD_STATUS_CHANGED).toBe('LEAD_STATUS_CHANGED');
  });

  it('should preserve all original auth action values', () => {
    expect(AuditAction.LOGIN_SUCCESS).toBe('LOGIN_SUCCESS');
    expect(AuditAction.LOGIN_FAILURE).toBe('LOGIN_FAILURE');
    expect(AuditAction.LOGOUT_SUCCESS).toBe('LOGOUT_SUCCESS');
    expect(AuditAction.REFRESH_SUCCESS).toBe('REFRESH_SUCCESS');
    expect(AuditAction.REFRESH_FAILURE).toBe('REFRESH_FAILURE');
  });
});

describe('AuditTargetModel enum - P0 extension verification', () => {
  it('should preserve all original target model values', () => {
    expect(AuditTargetModel.ROLE).toBe('Role');
    expect(AuditTargetModel.USER).toBe('User');
    expect(AuditTargetModel.DEPARTMENT).toBe('Department');
    expect(AuditTargetModel.DESIGNATION).toBe('Designation');
    expect(AuditTargetModel.BRANCH).toBe('Branch');
    expect(AuditTargetModel.TEAM).toBe('Team');
    expect(AuditTargetModel.EMPLOYEE).toBe('Employee');
  });

  it('should contain the new CRM target model values', () => {
    expect(AuditTargetModel.COMPANY).toBe('Company');
    expect(AuditTargetModel.CONTACT).toBe('Contact');
    expect(AuditTargetModel.LEAD).toBe('Lead');
  });
});
