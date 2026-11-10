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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { ActivitiesService } from './activities.service';
import { ActivityCalendarQueryDto } from './dto/activity-calendar-query.dto';
import { ListActivitiesQueryDto } from './dto/list-activities-query.dto';
import { LogActivityDto } from './dto/log-activity.dto';
import { RecordActivityOutcomeDto } from './dto/record-activity-outcome.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

@ApiTags('CRM - Activities')
@ApiBearerAuth('access-token')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  // =========================================================================
  // 1. Core Creation & Collection Queries
  // =========================================================================

  @Post()
  @RequirePermissions(PermissionKeys.ACTIVITIES_CREATE)
  @ApiOperation({ summary: 'Log a new CRM activity across entities' })
  @ApiCreatedResponse({ description: 'Activity logged successfully' })
  async logActivity(
    @Body() dto: LogActivityDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.logActivity(dto, req.user.userId);
  }

  @Get()
  @RequirePermissions(PermissionKeys.ACTIVITIES_VIEW)
  @ApiOperation({ summary: 'List and filter CRM activities with pagination' })
  @ApiOkResponse({ description: 'Paginated list of activities' })
  async findAll(
    @Query() queryDto: ListActivitiesQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.findAll(queryDto, req.user);
  }

  // =========================================================================
  // 2. Static GET Routes (MUST BE DECLARED ABOVE @Get(':id'))
  // =========================================================================

  @Get('calendar')
  @RequirePermissions(PermissionKeys.ACTIVITIES_VIEW)
  @ApiOperation({
    summary: 'Calendar view of scheduled calls and meetings (max 90 days)',
  })
  @ApiOkResponse({ description: 'Calendar activities list' })
  async findCalendar(
    @Query() queryDto: ActivityCalendarQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.findCalendar(queryDto, req.user);
  }

  @Get('summary')
  @RequirePermissions(PermissionKeys.ACTIVITIES_VIEW)
  @ApiOperation({
    summary: 'Get aggregate activity metrics and outcome breakdown',
  })
  @ApiOkResponse({ description: 'Activity metrics summary' })
  async getSummary(@Req() req: AuthenticatedRequest) {
    return this.activitiesService.getSummary(req.user);
  }

  // =========================================================================
  // 3. Dynamic Routes (@Get(':id'), @Patch(':id'), @Delete(':id'))
  // =========================================================================

  @Get(':id')
  @RequirePermissions(PermissionKeys.ACTIVITIES_VIEW)
  @ApiOperation({ summary: 'Get activity details by ID' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiOkResponse({ description: 'Activity details' })
  async findById(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.activitiesService.findById(id, req.user);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.ACTIVITIES_EDIT)
  @ApiOperation({ summary: 'Update activity details' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiOkResponse({ description: 'Activity updated' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.update(id, dto, req.user);
  }

  @Patch(':id/outcome')
  @RequirePermissions(PermissionKeys.ACTIVITIES_EDIT)
  @ApiOperation({
    summary:
      'Record outcome and optionally spawn a follow-up task in a transaction',
  })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiOkResponse({ description: 'Activity outcome recorded' })
  async recordOutcome(
    @Param('id') id: string,
    @Body() dto: RecordActivityOutcomeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.recordOutcome(id, dto, req.user);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.ACTIVITIES_DELETE)
  @ApiOperation({ summary: 'Soft delete activity' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiOkResponse({ description: 'Activity soft deleted' })
  async delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.activitiesService.delete(id, req.user);
  }
}
