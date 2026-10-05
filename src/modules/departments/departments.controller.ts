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
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { UpdateDepartmentStatusDto } from './dto/update-department-status.dto';
import { ListDepartmentsQueryDto } from './dto/list-departments-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PermissionModule,
  PermissionAction,
  PermissionKey,
} from '../permissions/constants/permission.constant';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('Departments')
@ApiBearerAuth('access-token')
@Controller({
  path: 'departments',
  version: '1',
})
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new department' })
  @ApiCreatedResponse({
    description: 'The department has been successfully created.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEPARTMENTS, PermissionAction.CREATE),
  )
  async create(
    @Body() dto: CreateDepartmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const department = await this.departmentsService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: department };
  }

  @Get()
  @ApiOperation({ summary: 'List all departments' })
  @ApiOkResponse({ description: 'List of departments with pagination.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEPARTMENTS, PermissionAction.VIEW),
  )
  async list(@Query() query: ListDepartmentsQueryDto) {
    const result = await this.departmentsService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get department by ID' })
  @ApiParam({ name: 'id', description: 'Department ID', type: String })
  @ApiOkResponse({ description: 'The department details.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEPARTMENTS, PermissionAction.VIEW),
  )
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const department = await this.departmentsService.getById(id);
    return { success: true, data: department };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update department' })
  @ApiParam({ name: 'id', description: 'Department ID', type: String })
  @ApiOkResponse({
    description: 'The department has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEPARTMENTS, PermissionAction.EDIT),
  )
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateDepartmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const department = await this.departmentsService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: department };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update department status (activate/deactivate)' })
  @ApiParam({ name: 'id', description: 'Department ID', type: String })
  @ApiOkResponse({
    description: 'The department status has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEPARTMENTS, PermissionAction.EDIT),
  )
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateDepartmentStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const department = await this.departmentsService.updateStatus(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: department };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a department' })
  @ApiParam({ name: 'id', description: 'Department ID', type: String })
  @ApiOkResponse({
    description: 'The department has been successfully deleted.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEPARTMENTS, PermissionAction.DELETE),
  )
  async delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.departmentsService.delete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Department successfully deleted' };
  }
}
