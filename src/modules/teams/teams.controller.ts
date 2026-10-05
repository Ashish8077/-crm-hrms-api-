import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { UpdateTeamStatusDto } from './dto/update-team-status.dto';
import { ListTeamsQueryDto } from './dto/list-teams-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PermissionModule,
  PermissionAction,
  PermissionKey,
} from '../permissions/constants/permission.constant';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('Teams')
@ApiBearerAuth('access-token')
@Controller({
  path: 'teams',
  version: '1',
})
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new team' })
  @ApiCreatedResponse({
    description: 'The team has been successfully created.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.TEAMS, PermissionAction.CREATE),
  )
  async create(
    @Body() dto: CreateTeamDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const clientMetadata = {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    };
    const team = await this.teamsService.create(
      dto,
      request.user.userId,
      clientMetadata,
    );
    return { success: true, data: team };
  }

  @Get()
  @ApiOperation({ summary: 'List all teams' })
  @ApiOkResponse({ description: 'List of teams with pagination.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.TEAMS, PermissionAction.VIEW),
  )
  async list(@Query() query: ListTeamsQueryDto) {
    const result = await this.teamsService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get team by ID' })
  @ApiParam({ name: 'id', description: 'Team ID', type: String })
  @ApiOkResponse({ description: 'The team details.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.TEAMS, PermissionAction.VIEW),
  )
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const team = await this.teamsService.getById(id);
    return { success: true, data: team };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update team' })
  @ApiParam({ name: 'id', description: 'Team ID', type: String })
  @ApiOkResponse({
    description: 'The team has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.TEAMS, PermissionAction.EDIT),
  )
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateTeamDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const clientMetadata = {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    };
    const team = await this.teamsService.update(
      id,
      dto,
      request.user.userId,
      clientMetadata,
    );
    return { success: true, data: team };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update team status (activate/deactivate)' })
  @ApiParam({ name: 'id', description: 'Team ID', type: String })
  @ApiOkResponse({
    description: 'The team status has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.TEAMS, PermissionAction.EDIT),
  )
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateTeamStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const clientMetadata = {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    };
    const team = await this.teamsService.updateStatus(
      id,
      dto,
      request.user.userId,
      clientMetadata,
    );
    return { success: true, data: team };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a team' })
  @ApiParam({ name: 'id', description: 'Team ID', type: String })
  @ApiOkResponse({
    description: 'The team has been successfully deleted.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.TEAMS, PermissionAction.DELETE),
  )
  async delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const clientMetadata = {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    };
    await this.teamsService.delete(id, request.user.userId, clientMetadata);
    return { success: true, message: 'Team successfully deleted' };
  }
}
