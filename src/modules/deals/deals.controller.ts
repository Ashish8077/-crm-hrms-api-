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
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { AssignDealDto } from './dto/assign-deal.dto';
import { ChangeDealStageDto } from './dto/change-deal-stage.dto';
import { CloseDealDto } from './dto/close-deal.dto';
import { ReopenDealDto } from './dto/reopen-deal.dto';
import { BulkAssignDealsDto } from './dto/bulk-assign-deals.dto';
import { AddDealNoteDto } from './dto/add-deal-note.dto';
import { LogDealActivityDto } from './dto/log-deal-activity.dto';
import { UpdateDealActivityDto } from './dto/update-deal-activity.dto';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PermissionModule,
  PermissionAction,
  PermissionKey,
} from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('CRM - Deals')
@ApiBearerAuth('access-token')
@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Static Routes (MUST BE DECLARED BEFORE /:id TO PREVENT ROUTE AMBIGUITY)
  // ──────────────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new deal opportunity' })
  @ApiCreatedResponse({ description: 'Deal created successfully' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.CREATE),
  )
  async create(
    @Body() dto: CreateDealDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deal = await this.dealsService.create(dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, data: deal };
  }

  @Get()
  @ApiOperation({
    summary: 'List and search deals with filters and pagination',
  })
  @ApiOkResponse({ description: 'Paginated list of deals' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.VIEW),
  )
  async list(
    @Query() queryDto: ListDealsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.dealsService.findAll(
      queryDto,
      request.user.userId,
    );
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get('pipeline')
  @ApiOperation({ summary: 'Get Kanban pipeline view grouped by stages' })
  @ApiOkResponse({
    description: 'Pipeline stage columns with aggregate metrics and deals',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.VIEW),
  )
  async getPipeline(
    @Query('pipeline') pipeline: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const columns = await this.dealsService.getPipeline(
      pipeline,
      request.user.userId,
    );
    return { success: true, data: columns };
  }

  @Get('forecast')
  @ApiOperation({
    summary: 'Get weighted revenue forecast by currency and stage',
  })
  @ApiOkResponse({ description: 'Forecast metrics and stage breakdown' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.VIEW),
  )
  async getForecast(
    @Query() queryDto: ForecastQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const forecast = await this.dealsService.getForecast(
      queryDto,
      request.user.userId,
    );
    return { success: true, data: forecast };
  }

  @Get('export')
  @ApiOperation({ summary: 'Export deals matching filters (max 1000 records)' })
  @ApiOkResponse({ description: 'Array of deals for export' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EXPORT),
  )
  async exportDeals(
    @Query() queryDto: ListDealsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deals = await this.dealsService.exportDeals(
      queryDto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: deals };
  }

  @Post('bulk-assign')
  @ApiOperation({ summary: 'Bulk assign multiple deals to a sales rep' })
  @ApiOkResponse({ description: 'Count of deals reassigned' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.ASSIGN),
  )
  async bulkAssign(
    @Body() dto: BulkAssignDealsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.dealsService.bulkAssign(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Parametric Routes (/:id)
  // ──────────────────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get deal by ID' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiOkResponse({ description: 'Deal details with notes and closure history' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.VIEW),
  )
  async findById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const deal = await this.dealsService.findById(id, request.user.userId);
    return { success: true, data: deal };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update deal fields (rejects if deal is closed)' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiOkResponse({ description: 'Updated deal details' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateDealDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deal = await this.dealsService.update(id, dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, data: deal };
  }

  @Patch(':id/stage')
  @ApiOperation({ summary: 'Transition deal to another open pipeline stage' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiOkResponse({ description: 'Deal updated with new stage and probability' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async changeStage(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ChangeDealStageDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deal = await this.dealsService.changeStage(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: deal };
  }

  @Patch(':id/owner')
  @ApiOperation({ summary: 'Assign or reassign deal to another user' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiOkResponse({ description: 'Deal owner updated successfully' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.ASSIGN),
  )
  async assignOwner(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AssignDealDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deal = await this.dealsService.assignOwner(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: deal };
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'Close a deal as CLOSED_WON or CLOSED_LOST' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiOkResponse({ description: 'Deal closed and closure history recorded' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async closeDeal(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: CloseDealDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deal = await this.dealsService.closeDeal(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: deal };
  }

  @Patch(':id/reopen')
  @ApiOperation({ summary: 'Reopen a previously closed deal' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiOkResponse({
    description: 'Deal restored to open status with reason recorded',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async reopenDeal(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ReopenDealDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deal = await this.dealsService.reopenDeal(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: deal };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a deal' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiOkResponse({ description: 'Deal soft-deleted successfully' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.DELETE),
  )
  async softDelete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.dealsService.softDelete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Deal successfully deleted' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Sub-resource Routes (Notes & Activities)
  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add an internal note to a deal' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiCreatedResponse({ description: 'Note added successfully' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async addNote(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AddDealNoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deal = await this.dealsService.addNote(id, dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, data: deal };
  }

  @Delete(':id/notes/:noteId')
  @ApiOperation({ summary: 'Soft delete a note from a deal' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiParam({ name: 'noteId', description: 'Note ID', type: String })
  @ApiOkResponse({ description: 'Note deleted successfully' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async deleteNote(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('noteId', ParseObjectIdPipe) noteId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const deal = await this.dealsService.deleteNote(
      id,
      noteId,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: deal };
  }

  @Post(':id/activities')
  @ApiOperation({
    summary: 'Log an activity (call, meeting, email) for a deal',
  })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiCreatedResponse({ description: 'Activity logged successfully' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async logActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: LogDealActivityDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const activity = await this.dealsService.logActivity(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: activity };
  }

  @Get(':id/activities')
  @ApiOperation({ summary: 'Get paginated activity timeline for a deal' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiOkResponse({ description: 'Paginated activity records' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.VIEW),
  )
  async listActivities(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() queryDto: PaginationQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.dealsService.listActivities(
      id,
      queryDto,
      request.user.userId,
    );
    return { success: true, data: result.data, meta: result.meta };
  }

  @Patch(':id/activities/:activityId')
  @ApiOperation({ summary: 'Update an existing activity on a deal' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiParam({ name: 'activityId', description: 'Activity ID', type: String })
  @ApiOkResponse({ description: 'Activity updated successfully' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async updateActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('activityId', ParseObjectIdPipe) activityId: Types.ObjectId,
    @Body() dto: UpdateDealActivityDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const activity = await this.dealsService.updateActivity(
      id,
      activityId,
      dto,
      request.user.userId,
    );
    return { success: true, data: activity };
  }

  @Delete(':id/activities/:activityId')
  @ApiOperation({ summary: 'Delete an activity from a deal' })
  @ApiParam({ name: 'id', description: 'Deal ID', type: String })
  @ApiParam({ name: 'activityId', description: 'Activity ID', type: String })
  @ApiOkResponse({ description: 'Activity deleted successfully' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  )
  async deleteActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('activityId', ParseObjectIdPipe) activityId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.dealsService.deleteActivity(id, activityId, request.user.userId);
    return { success: true, message: 'Activity deleted successfully' };
  }
}
