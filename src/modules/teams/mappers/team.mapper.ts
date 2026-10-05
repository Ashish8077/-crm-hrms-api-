import { Types } from 'mongoose';
import { Team } from '../schemas/team.schema';
import { CreateTeamDto } from '../dto/create-team.dto';
import { UpdateTeamDto } from '../dto/update-team.dto';

export type TeamMapperInput = Team & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export interface TeamResponse {
  id: string;
  name: string;
  description?: string;
  departmentId: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class TeamMapper {
  static toCreateData(dto: CreateTeamDto) {
    return {
      name: dto.name,
      description: dto.description,
      departmentId: new Types.ObjectId(dto.departmentId),
    };
  }

  static toUpdateData(dto: UpdateTeamDto): Partial<Team> {
    const updateData: Partial<Team> = {};
    if (dto.name !== undefined) {
      updateData.name = dto.name;
    }
    if (dto.description !== undefined) {
      updateData.description = dto.description;
    }
    if (dto.departmentId !== undefined) {
      updateData.departmentId = new Types.ObjectId(dto.departmentId);
    }
    return updateData;
  }

  static toUpdateAuditDetails(before: TeamMapperInput, after: TeamMapperInput) {
    return {
      changes: {
        ...(before.name !== after.name && {
          name: { from: before.name, to: after.name },
        }),
        ...(before.description !== after.description && {
          description: { from: before.description, to: after.description },
        }),
        ...(before.departmentId.toString() !==
          after.departmentId.toString() && {
          departmentId: {
            from: before.departmentId.toString(),
            to: after.departmentId.toString(),
          },
        }),
      },
    };
  }

  static toResponse(team: TeamMapperInput): TeamResponse {
    return {
      id: team._id.toString(),
      name: team.name,
      description: team.description,
      departmentId: team.departmentId.toString(),
      isActive: team.isActive,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };
  }
}
