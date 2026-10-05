import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Req,
  Query,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { GetRolesQueryDto } from './dto/get-roles-query.dto';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateRoleStatusDto } from './dto/update-role-status.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller({
  path: 'roles',
  version: '1',
})
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiCreatedResponse({ description: 'Role created successfully' })
  @RequirePermissions(PermissionKeys.ROLES_CREATE)
  async create(
    @Body() createRoleDto: CreateRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    return this.rolesService.create(createRoleDto, request.user.userId, {
      ipAddress,
      userAgent,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List roles' })
  @ApiOkResponse({ description: 'Roles retrieved successfully' })
  @RequirePermissions(PermissionKeys.ROLES_VIEW)
  async findAll(@Query() query: GetRolesQueryDto) {
    return this.rolesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get role by ID' })
  @ApiParam({ name: 'id', description: 'Role ID', type: String })
  @ApiOkResponse({ description: 'Role retrieved successfully' })
  @RequirePermissions(PermissionKeys.ROLES_VIEW)
  async findOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.rolesService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update role details' })
  @ApiParam({ name: 'id', description: 'Role ID', type: String })
  @ApiOkResponse({ description: 'Role updated successfully' })
  @RequirePermissions(PermissionKeys.ROLES_EDIT)
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() updateRoleDto: UpdateRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    return this.rolesService.update(id, updateRoleDto, request.user.userId, {
      ipAddress,
      userAgent,
    });
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update role status' })
  @ApiParam({ name: 'id', description: 'Role ID', type: String })
  @ApiOkResponse({ description: 'Role status updated successfully' })
  @RequirePermissions(PermissionKeys.ROLES_EDIT)
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() updateRoleStatusDto: UpdateRoleStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    return this.rolesService.updateStatus(
      id,
      updateRoleStatusDto,
      request.user.userId,
      { ipAddress, userAgent },
    );
  }
}
