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
import { DesignationsService } from './designations.service';
import { CreateDesignationDto } from './dto/create-designation.dto';
import { UpdateDesignationDto } from './dto/update-designation.dto';
import { UpdateDesignationStatusDto } from './dto/update-designation-status.dto';
import { ListDesignationsQueryDto } from './dto/list-designations-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PermissionModule,
  PermissionAction,
  PermissionKey,
} from '../permissions/constants/permission.constant';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('Designations')
@ApiBearerAuth('access-token')
@Controller({
  path: 'designations',
  version: '1',
})
export class DesignationsController {
  constructor(private readonly designationsService: DesignationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new designation' })
  @ApiCreatedResponse({
    description: 'The designation has been successfully created.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DESIGNATIONS, PermissionAction.CREATE),
  )
  async create(
    @Body() dto: CreateDesignationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const designation = await this.designationsService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: designation };
  }

  @Get()
  @ApiOperation({ summary: 'List all designations' })
  @ApiOkResponse({ description: 'List of designations with pagination.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DESIGNATIONS, PermissionAction.VIEW),
  )
  async list(@Query() query: ListDesignationsQueryDto) {
    const result = await this.designationsService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get designation by ID' })
  @ApiParam({ name: 'id', description: 'Designation ID', type: String })
  @ApiOkResponse({ description: 'The designation details.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DESIGNATIONS, PermissionAction.VIEW),
  )
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const designation = await this.designationsService.getById(id);
    return { success: true, data: designation };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update designation' })
  @ApiParam({ name: 'id', description: 'Designation ID', type: String })
  @ApiOkResponse({
    description: 'The designation has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DESIGNATIONS, PermissionAction.EDIT),
  )
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateDesignationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const designation = await this.designationsService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: designation };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update designation status (activate/deactivate)' })
  @ApiParam({ name: 'id', description: 'Designation ID', type: String })
  @ApiOkResponse({
    description: 'The designation status has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DESIGNATIONS, PermissionAction.EDIT),
  )
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateDesignationStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const designation = await this.designationsService.updateStatus(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: designation };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a designation' })
  @ApiParam({ name: 'id', description: 'Designation ID', type: String })
  @ApiOkResponse({
    description: 'The designation has been successfully deleted.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DESIGNATIONS, PermissionAction.DELETE),
  )
  async delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.designationsService.delete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Designation successfully deleted' };
  }
}
