import {
  Controller,
  Put,
  Param,
  Body,
  Req,
  Post,
  Get,
  Patch,
  Query,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { ParseObjectIdPipe } from '@nestjs/mongoose';

import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({
  path: 'users',
  version: '1',
})
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiCreatedResponse({ description: 'User created successfully' })
  @RequirePermissions(PermissionKeys.USERS_CREATE)
  async create(
    @Body() createUserDto: CreateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const user = await this.usersService.create(
      createUserDto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: user };
  }

  @Get()
  @ApiOperation({ summary: 'List users with pagination' })
  @ApiOkResponse({ description: 'Users retrieved successfully' })
  @RequirePermissions(PermissionKeys.USERS_VIEW)
  async list(@Query() query: ListUsersQueryDto) {
    const result = await this.usersService.list(query);
    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User ID', type: String })
  @ApiOkResponse({ description: 'User retrieved successfully' })
  @RequirePermissions(PermissionKeys.USERS_VIEW)
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const user = await this.usersService.getById(id);
    return { success: true, data: user };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user details' })
  @ApiParam({ name: 'id', description: 'User ID', type: String })
  @ApiOkResponse({ description: 'User updated successfully' })
  @RequirePermissions(PermissionKeys.USERS_EDIT)
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() updateUserDto: UpdateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const user = await this.usersService.update(
      id,
      updateUserDto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: user };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate or deactivate a user' })
  @ApiParam({ name: 'id', description: 'User ID', type: String })
  @ApiOkResponse({ description: 'User status updated successfully' })
  @RequirePermissions(PermissionKeys.USERS_EDIT)
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() updateStatusDto: UpdateUserStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const user = await this.usersService.updateStatus(
      id,
      updateStatusDto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: user };
  }

  @Put(':id/roles')
  @ApiOperation({ summary: 'Assign roles to a user' })
  @RequirePermissions(PermissionKeys.USERS_ASSIGN)
  @ApiParam({
    name: 'id',
    description: 'The ID of the user to assign roles to',
    type: String,
  })
  @ApiOkResponse({ description: 'Roles assigned successfully' })
  async assignRoles(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() assignRolesDto: AssignRolesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.usersService.assignRoles(
      id,
      assignRolesDto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, message: 'Roles assigned successfully' };
  }
}
