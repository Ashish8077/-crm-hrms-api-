import { Injectable, HttpStatus } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { UserRepository } from './repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { User, UserDocument } from './schemas/user.schema';
import { ClientMetadata } from '../auth/types/auth.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async assignRoles(
    userId: Types.ObjectId,
    dto: AssignRolesDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<void> {
    const { ipAddress, userAgent } = clientMetadata;
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Deduplicate role IDs
    const uniqueIds = Array.from(
      new Set(dto.roleIds.map((id) => id.toString())),
    ).map((id) => new Types.ObjectId(id));

    // Verify all roles exist and are active
    if (uniqueIds.length > 0) {
      const activeRoles = await this.roleRepository.findActiveByIds(uniqueIds);
      if (activeRoles.length !== uniqueIds.length) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'One or more assigned roles are invalid, inactive, or do not exist',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const oldRoles = user.roleIds;
    user.roleIds = uniqueIds;
    await user.save();

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.USER_ROLES_ASSIGNED,
      targetId: user._id,
      targetModel: AuditTargetModel.USER,
      details: {
        oldRoleIds: oldRoles,
        newRoleIds: uniqueIds,
      },
      ipAddress,
      userAgent,
    });
  }
}
