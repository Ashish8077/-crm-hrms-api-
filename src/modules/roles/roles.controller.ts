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
// Note: PermissionsGuard and @RequirePermissions will be added in Phase 5
@Controller({
  path: 'roles',
  version: '1',
})
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
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
  async findAll(@Query() query: GetRolesQueryDto) {
    return this.rolesService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.rolesService.findById(id);
  }

  @Patch(':id')
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
