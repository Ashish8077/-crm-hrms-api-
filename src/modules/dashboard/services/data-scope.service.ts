import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../../auth/types/auth-request.type';
import { Role, RoleDocument } from '../../roles/schemas/role.schema';
import { SystemRole } from '../../roles/constants/role.constant';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { UserStatus } from '../../users/constants/user-status.constant';
import { Employee, EmployeeDocument } from '../../employees/schemas/employee.schema';
import { EmploymentStatus } from '../../employees/constants/employee.constant';
import { DataScope } from '../types/data-scope.types';

@Injectable()
export class DataScopeService {
  private readonly logger = new Logger(DataScopeService.name);

  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  /**
   * Resolves the caller's RBAC scope and allowed user/owner IDs.
   * CRITICAL GUARANTEE: An empty ownerIds list will NEVER result in unrestricted access.
   */
  async resolveCallerDataScope(caller: AuthenticatedUser): Promise<DataScope> {
    const callerUserId = new Types.ObjectId(caller.userId);

    // 1. Resolve caller roles
    const activeRoles = await this.roleModel
      .find({
        _id: { $in: caller.roleIds },
        isActive: true,
      })
      .lean()
      .exec();

    const roleKeys = new Set<string>(activeRoles.map((r) => r.key));

    const isSuperAdmin = roleKeys.has(SystemRole.SUPER_ADMIN);
    const isAdmin = roleKeys.has(SystemRole.ADMIN);
    const isSalesManager = roleKeys.has(SystemRole.SALES_MANAGER);
    const isFinance = roleKeys.has(SystemRole.FINANCE);
    const isHr = roleKeys.has(SystemRole.HR) || roleKeys.has(SystemRole.HR_MANAGER);

    // 2. Organization Scope: Super Admin, Admin, Finance, HR
    if (isSuperAdmin || isAdmin || isFinance || isHr) {
      const allActiveUsers = await this.userModel
        .find({
          status: UserStatus.ACTIVE,
          deletedAt: null,
        })
        .select('_id')
        .lean()
        .exec();

      const allUserIds = allActiveUsers.map((u) => new Types.ObjectId(u._id));

      return {
        scopeLevel: 'ORGANIZATION',
        ownerIds: allUserIds, // if no active users, returns [] (safe)
        callerUserId,
        canViewFinancial: !isHr || isSuperAdmin || isAdmin || isFinance, // HR has financial data hidden
      };
    }

    // 3. Team Scope: Sales Manager (or any manager with active reporting subordinates)
    if (isSalesManager) {
      const subordinateIds = await this.resolveSubordinates(callerUserId, 3);
      const teamUserIds = Array.from(
        new Set([callerUserId.toString(), ...subordinateIds.map((id) => id.toString())]),
      ).map((id) => new Types.ObjectId(id));

      return {
        scopeLevel: 'TEAM',
        ownerIds: teamUserIds,
        callerUserId,
        canViewFinancial: true,
      };
    }

    // Check if the user is a manager with subordinates even without the explicit Sales Manager role
    const potentialSubordinates = await this.resolveSubordinates(callerUserId, 3);
    if (potentialSubordinates.length > 0) {
      const teamUserIds = Array.from(
        new Set([callerUserId.toString(), ...potentialSubordinates.map((id) => id.toString())]),
      ).map((id) => new Types.ObjectId(id));

      return {
        scopeLevel: 'TEAM',
        ownerIds: teamUserIds,
        callerUserId,
        canViewFinancial: true,
      };
    }

    // 4. Self Scope: Sales Executive / General Employee
    return {
      scopeLevel: 'SELF',
      ownerIds: [callerUserId],
      callerUserId,
      canViewFinancial: true, // Can view own financial metrics
    };
  }

  /**
   * Traverses reporting hierarchy via Employee.reportingManagerId using BFS.
   * Guarded with maxDepth (default: 3) and visited Set to prevent circular loops.
   */
  async resolveSubordinates(
    managerUserId: Types.ObjectId,
    maxDepth: number = 3,
  ): Promise<Types.ObjectId[]> {
    const managerEmp = await this.employeeModel
      .findOne({
        userId: managerUserId,
        employmentStatus: { $ne: EmploymentStatus.TERMINATED },
      })
      .select('_id')
      .lean()
      .exec();

    if (!managerEmp) {
      return [];
    }

    const visited = new Set<string>();
    const subordinateUserIds: Types.ObjectId[] = [];
    const queue: Array<{ employeeId: Types.ObjectId; depth: number }> = [
      { employeeId: managerEmp._id, depth: 0 },
    ];

    while (queue.length > 0) {
      const { employeeId, depth } = queue.shift()!;
      const empIdStr = employeeId.toString();

      if (visited.has(empIdStr)) continue;
      visited.add(empIdStr);

      if (depth >= maxDepth) continue;

      const directSubs = await this.employeeModel
        .find({
          reportingManagerId: employeeId,
          employmentStatus: { $ne: EmploymentStatus.TERMINATED },
        })
        .select('_id userId')
        .lean()
        .exec();

      for (const sub of directSubs) {
        if (sub.userId) {
          subordinateUserIds.push(new Types.ObjectId(sub.userId));
        }
        queue.push({ employeeId: sub._id, depth: depth + 1 });
      }
    }

    return subordinateUserIds;
  }
}

