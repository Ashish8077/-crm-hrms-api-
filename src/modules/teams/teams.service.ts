import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { TeamRepository } from './repositories/team.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { UpdateTeamStatusDto } from './dto/update-team-status.dto';
import { ListTeamsQueryDto } from './dto/list-teams-query.dto';
import { DepartmentsService } from '../departments/departments.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { TeamMapper, TeamResponse } from './mappers/team.mapper';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { getChangedFields } from '../../common/utils/change-detection.util';

@Injectable()
export class TeamsService {
  constructor(
    private readonly teamRepository: TeamRepository,
    private readonly departmentsService: DepartmentsService,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    dto: CreateTeamDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ) {
    // Validate Department
    const department = await this.departmentsService.getById(
      new Types.ObjectId(dto.departmentId),
    );
    if (!department.isActive) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot assign team to an inactive department',
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await this.connection.startSession();
    let teamId: Types.ObjectId | undefined;

    try {
      const team = await session.withTransaction(async (ts) => {
        // Check for duplicate name in same department
        const existing = await this.teamRepository.findByNameAndDepartment(
          dto.name,
          dto.departmentId,
          undefined,
          ts,
        );
        if (existing) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'A team with this name already exists in the selected department',
            HttpStatus.CONFLICT,
          );
        }

        const createData = TeamMapper.toCreateData(dto);

        const newTeam = await this.teamRepository.create(
          {
            ...createData,
            createdBy: actorId,
          },
          ts,
        );

        teamId = newTeam._id;

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.TEAM_CREATED,
            actorId,
            targetId: teamId,
            targetModel: AuditTargetModel.TEAM,
            details: { name: newTeam.name },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          ts,
        );

        return TeamMapper.toResponse(newTeam);
      });

      return team;
    } finally {
      await session.endSession();
    }
  }

  async list(query: ListTeamsQueryDto): Promise<PaginatedResult<TeamResponse>> {
    const result = await this.teamRepository.findList(query);
    return {
      data: result.data.map((team) => TeamMapper.toResponse(team)),
      meta: result.meta,
    };
  }

  async getById(id: Types.ObjectId): Promise<TeamResponse> {
    const team = await this.teamRepository.findById(id);
    if (!team) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Team not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return TeamMapper.toResponse(team);
  }

  async update(
    id: Types.ObjectId,
    dto: UpdateTeamDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async (ts) => {
        const team = await this.teamRepository.findById(id, ts);
        if (!team) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Team not found',
            HttpStatus.NOT_FOUND,
          );
        }

        // Validate department change if present
        let targetDepartmentId = team.departmentId;
        if (
          dto.departmentId &&
          dto.departmentId !== team.departmentId.toString()
        ) {
          const department = await this.departmentsService.getById(
            new Types.ObjectId(dto.departmentId),
          );
          if (!department.isActive) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              'Cannot move team to an inactive department',
              HttpStatus.BAD_REQUEST,
            );
          }
          targetDepartmentId = new Types.ObjectId(dto.departmentId);
        }

        if (dto.name !== undefined || dto.departmentId !== undefined) {
          const targetName = dto.name !== undefined ? dto.name : team.name;
          const existing = await this.teamRepository.findByNameAndDepartment(
            targetName,
            targetDepartmentId,
            id,
            ts,
          );
          if (existing) {
            throw new AppError(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              'A team with this name already exists in the target department',
              HttpStatus.CONFLICT,
            );
          }
        }

        const updateData = TeamMapper.toUpdateData(dto);
        const changedFields = getChangedFields(
          updateData,
          team as unknown as Record<string, unknown>,
        );

        if (Object.keys(changedFields).length === 0) {
          return TeamMapper.toResponse(team);
        }

        const updated = await this.teamRepository.updateById(
          id,
          {
            ...changedFields,
            updatedBy: actorId,
          },
          ts,
        );

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.TEAM_UPDATED,
            actorId,
            targetId: id,
            targetModel: AuditTargetModel.TEAM,
            details: TeamMapper.toUpdateAuditDetails(team, updated!),
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          ts,
        );

        return TeamMapper.toResponse(updated!);
      });
    } finally {
      await session.endSession();
    }
  }

  async updateStatus(
    id: Types.ObjectId,
    dto: UpdateTeamStatusDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async (ts) => {
        const team = await this.teamRepository.findById(id, ts);
        if (!team) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Team not found',
            HttpStatus.NOT_FOUND,
          );
        }

        if (team.isActive === dto.isActive) {
          return TeamMapper.toResponse(team);
        }

        if (dto.isActive) {
          // Verify department is active before activating team
          const department = await this.departmentsService.getById(
            team.departmentId,
          );
          if (!department.isActive) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              'Cannot activate team while its department is inactive',
              HttpStatus.BAD_REQUEST,
            );
          }
        }

        const updated = await this.teamRepository.updateStatus(
          id,
          dto.isActive,
          ts,
        );

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.TEAM_STATUS_CHANGED,
            actorId,
            targetId: id,
            targetModel: AuditTargetModel.TEAM,
            details: {
              oldValues: { isActive: team.isActive },
              newValues: { isActive: dto.isActive },
            },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          ts,
        );

        return TeamMapper.toResponse(updated!);
      });
    } finally {
      await session.endSession();
    }
  }

  async delete(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async (ts) => {
        const team = await this.teamRepository.findById(id, ts);
        if (!team) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Team not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const deleted = await this.teamRepository.softDelete(id, actorId, ts);

        await this.auditLogsService.createAuditLog(
          {
            action: AuditAction.TEAM_DELETED,
            actorId,
            targetId: id,
            targetModel: AuditTargetModel.TEAM,
            details: {
              oldValues: {
                name: team.name,
                isActive: team.isActive,
              },
            },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          ts,
        );

        return deleted;
      });
    } finally {
      await session.endSession();
    }
  }
}
