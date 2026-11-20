import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DataScopeService } from '../services/data-scope.service';
import { Role } from '../../roles/schemas/role.schema';
import { SystemRole } from '../../roles/constants/role.constant';
import { User } from '../../users/schemas/user.schema';
import { Employee } from '../../employees/schemas/employee.schema';
import { AuthenticatedUser } from '../../auth/types/auth-request.type';

describe('DataScopeService', () => {
  let service: DataScopeService;

  const mockRoleModel = {
    find: jest.fn(),
  };

  const mockUserModel = {
    find: jest.fn(),
  };

  const mockEmployeeModel = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataScopeService,
        {
          provide: getModelToken(Role.name),
          useValue: mockRoleModel,
        },
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Employee.name),
          useValue: mockEmployeeModel,
        },
      ],
    }).compile();

    service = module.get<DataScopeService>(DataScopeService);
  });

  it('should resolve ORGANIZATION scope for SUPER_ADMIN with full permissions', async () => {
    const callerId = new Types.ObjectId();
    const roleId = new Types.ObjectId();
    const allUser1 = new Types.ObjectId();
    const allUser2 = new Types.ObjectId();

    mockRoleModel.find.mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue([{ _id: roleId, key: SystemRole.SUPER_ADMIN }]),
      }),
    });

    mockUserModel.find.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue([{ _id: allUser1 }, { _id: allUser2 }]),
        }),
      }),
    });

    const caller: AuthenticatedUser = {
      userId: callerId,
      roleIds: [roleId],
      sessionId: new Types.ObjectId(),
    };

    const scope = await service.resolveCallerDataScope(caller);

    expect(scope.scopeLevel).toBe('ORGANIZATION');
    expect(scope.ownerIds).toHaveLength(2);
    expect(scope.canViewFinancial).toBe(true);
    expect(scope.callerUserId.equals(callerId)).toBe(true);
  });

  it('should resolve ORGANIZATION scope with financialDataHidden for HR_MANAGER', async () => {
    const callerId = new Types.ObjectId();
    const roleId = new Types.ObjectId();

    mockRoleModel.find.mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue([{ _id: roleId, key: SystemRole.HR_MANAGER }]),
      }),
    });

    mockUserModel.find.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue([{ _id: callerId }]),
        }),
      }),
    });

    const caller: AuthenticatedUser = {
      userId: callerId,
      roleIds: [roleId],
      sessionId: new Types.ObjectId(),
    };

    const scope = await service.resolveCallerDataScope(caller);

    expect(scope.scopeLevel).toBe('ORGANIZATION');
    expect(scope.canViewFinancial).toBe(false); // HR cannot view CRM financial amounts
  });

  it('should resolve TEAM scope for SALES_MANAGER with subordinates via BFS', async () => {
    const managerUserId = new Types.ObjectId();
    const managerEmpId = new Types.ObjectId();
    const sub1UserId = new Types.ObjectId();
    const sub1EmpId = new Types.ObjectId();
    const roleId = new Types.ObjectId();

    mockRoleModel.find.mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue([{ _id: roleId, key: SystemRole.SALES_MANAGER }]),
      }),
    });

    // Manager employee record
    mockEmployeeModel.findOne.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue({ _id: managerEmpId }),
        }),
      }),
    });

    // Subordinates
    mockEmployeeModel.find
      .mockReturnValueOnce({
        select: () => ({
          lean: () => ({
            exec: jest.fn().mockResolvedValue([{ _id: sub1EmpId, userId: sub1UserId }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: () => ({
          lean: () => ({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

    const caller: AuthenticatedUser = {
      userId: managerUserId,
      roleIds: [roleId],
      sessionId: new Types.ObjectId(),
    };

    const scope = await service.resolveCallerDataScope(caller);

    expect(scope.scopeLevel).toBe('TEAM');
    expect(scope.ownerIds).toHaveLength(2); // manager + subordinate
    expect(scope.canViewFinancial).toBe(true);
  });

  it('should resolve SELF scope for SALES_EXECUTIVE', async () => {
    const execUserId = new Types.ObjectId();
    const roleId = new Types.ObjectId();

    mockRoleModel.find.mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue([{ _id: roleId, key: SystemRole.SALES_EXECUTIVE }]),
      }),
    });

    // No subordinates
    mockEmployeeModel.findOne.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    });

    const caller: AuthenticatedUser = {
      userId: execUserId,
      roleIds: [roleId],
      sessionId: new Types.ObjectId(),
    };

    const scope = await service.resolveCallerDataScope(caller);

    expect(scope.scopeLevel).toBe('SELF');
    expect(scope.ownerIds).toHaveLength(1);
    expect(scope.ownerIds[0].equals(execUserId)).toBe(true);
    expect(scope.canViewFinancial).toBe(true);
  });

  it('CRITICAL: empty ownerIds never results in unrestricted access', async () => {
    const callerId = new Types.ObjectId();
    const roleId = new Types.ObjectId();

    mockRoleModel.find.mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue([{ _id: roleId, key: SystemRole.SUPER_ADMIN }]),
      }),
    });

    // DB has no active users
    mockUserModel.find.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    const caller: AuthenticatedUser = {
      userId: callerId,
      roleIds: [roleId],
      sessionId: new Types.ObjectId(),
    };

    const scope = await service.resolveCallerDataScope(caller);

    // Guaranteed empty array - in MongoDB this evaluates to { $in: [] } yielding 0 records
    expect(scope.ownerIds).toEqual([]);
    expect(scope.ownerIds).toHaveLength(0);
  });
});

