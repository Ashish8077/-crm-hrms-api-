import { Types } from 'mongoose';
import { User } from '../schemas/user.schema';
import { UserStatus } from '../constants/user-status.constant';

export type UserMapperInput = User & {
  _id: Types.ObjectId | string;
};

export interface UserResponse {
  id: string;
  email: string;
  status: UserStatus;
  roleIds: string[];
  lastLoginAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class UserMapper {
  static toUpdateAuditDetails(before: UserMapperInput, after: UserMapperInput) {
    return {
      changes: {
        ...(before.email !== after.email && {
          email: { from: before.email, to: after.email },
        }),
      },
    };
  }

  static toResponse(user: UserMapperInput): UserResponse {
    return {
      id: user._id.toString(),
      email: user.email,
      status: user.status,
      roleIds: (user.roleIds ?? []).map((id) => id.toString()),
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
