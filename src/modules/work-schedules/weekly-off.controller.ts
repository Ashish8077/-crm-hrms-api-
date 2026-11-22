import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { WeeklyOffService } from './services/weekly-off.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { CreateWeeklyOffConfigDto } from './dto/create-weekly-off-config.dto';
import { UpdateWeeklyOffConfigDto } from './dto/update-weekly-off-config.dto';
import { UpdateWeeklyOffStatusDto } from './dto/update-weekly-off-status.dto';
import { ListWeeklyOffQueryDto } from './dto/list-weekly-off-query.dto';
import { CheckWeeklyOffQueryDto } from './dto/check-weekly-off-query.dto';

@ApiTags('Work Schedules & Policies', 'Weekly Offs')
@ApiBearerAuth('access-token')
@Controller({
  path: 'work-schedules/weekly-offs',
  version: '1',
})
export class WeeklyOffController {
  constructor(private readonly weeklyOffService: WeeklyOffService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new weekly off configuration' })
  @ApiCreatedResponse({
    description: 'Weekly off configuration created successfully.',
  })
  @RequirePermissions(PermissionKeys.WORK_SCHEDULES_CREATE)
  async createConfig(
    @Body() dto: CreateWeeklyOffConfigDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.weeklyOffService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({
    summary:
      'List weekly off configurations (supports branchId, isActive, and pagination)',
  })
  @ApiOkResponse({ description: 'List of weekly off configurations.' })
  @RequirePermissions(PermissionKeys.WORK_SCHEDULES_VIEW)
  async listConfigs(@Query() query: ListWeeklyOffQueryDto) {
    const result = await this.weeklyOffService.list(query);
    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('effective')
  @ApiOperation({
    summary:
      'Get effective weekly off configuration and status for a given calendar date and branch',
  })
  @ApiOkResponse({
    description:
      'Effective configuration details, resolution source, and whether the date is a weekly off.',
  })
  @RequirePermissions(PermissionKeys.WORK_SCHEDULES_VIEW)
  async getEffectiveConfig(@Query() query: CheckWeeklyOffQueryDto) {
    const result = await this.weeklyOffService.getEffectiveConfig(
      query.date,
      query.branchId,
    );
    return { success: true, data: result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get weekly off configuration by ID' })
  @ApiParam({
    name: 'id',
    description: 'Weekly Off Configuration ID',
    type: String,
  })
  @ApiOkResponse({ description: 'Weekly off configuration details.' })
  @RequirePermissions(PermissionKeys.WORK_SCHEDULES_VIEW)
  async getConfigById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const result = await this.weeklyOffService.getById(id);
    return { success: true, data: result };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update weekly off configuration details' })
  @ApiParam({
    name: 'id',
    description: 'Weekly Off Configuration ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Weekly off configuration updated successfully.',
  })
  @RequirePermissions(PermissionKeys.WORK_SCHEDULES_EDIT)
  async updateConfig(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateWeeklyOffConfigDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.weeklyOffService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Activate or deactivate a weekly off configuration',
  })
  @ApiParam({
    name: 'id',
    description: 'Weekly Off Configuration ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Weekly off configuration status updated successfully.',
  })
  @RequirePermissions(PermissionKeys.WORK_SCHEDULES_EDIT)
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateWeeklyOffStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.weeklyOffService.updateStatus(
      id,
      dto.isActive,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a weekly off configuration' })
  @ApiParam({
    name: 'id',
    description: 'Weekly Off Configuration ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Weekly off configuration deleted successfully.',
  })
  @RequirePermissions(PermissionKeys.WORK_SCHEDULES_DELETE)
  async deleteConfig(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.weeklyOffService.delete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return {
      success: true,
      message: 'Weekly off configuration successfully deleted',
    };
  }
}
