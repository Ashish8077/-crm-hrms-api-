import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { AssignTaskDto } from './dto/assign-task.dto';
import { BulkAssignTasksDto } from './dto/bulk-assign-tasks.dto';
import { CancelTaskDto } from './dto/cancel-task.dto';
import { ChangeTaskStatusDto } from './dto/change-task-status.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SnoozeTaskDto } from './dto/snooze-task.dto';
import { TaskCalendarQueryDto } from './dto/task-calendar-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@ApiTags('CRM - Tasks')
@ApiBearerAuth('access-token')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  // =========================================================================
  // 1. Core Creation & Collection Queries
  // =========================================================================

  @Post()
  @RequirePermissions(PermissionKeys.TASKS_CREATE)
  @ApiOperation({ summary: 'Create a new CRM task' })
  @ApiCreatedResponse({ description: 'Task created successfully' })
  async create(@Body() dto: CreateTaskDto, @Req() req: AuthenticatedRequest) {
    return this.tasksService.create(dto, req.user.userId);
  }

  @Get()
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({ summary: 'List and filter tasks with pagination' })
  @ApiOkResponse({ description: 'Paginated list of tasks' })
  async findAll(
    @Query() queryDto: ListTasksQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.findAll(queryDto, req.user);
  }

  // =========================================================================
  // 2. Static GET & Bulk Routes (MUST BE DECLARED ABOVE @Get(':id'))
  // =========================================================================

  @Get('my')
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({ summary: "Get current user's assigned tasks" })
  @ApiOkResponse({ description: 'Current user tasks' })
  async findMy(
    @Query() queryDto: ListTasksQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.findMy(queryDto, req.user);
  }

  @Get('team')
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({ summary: "Get current user's team tasks" })
  @ApiOkResponse({ description: 'Team tasks' })
  async findTeam(
    @Query() queryDto: ListTasksQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.findTeam(queryDto, req.user);
  }

  @Get('overdue')
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({ summary: 'Get open overdue tasks' })
  @ApiOkResponse({ description: 'Overdue tasks' })
  async findOverdue(
    @Query() queryDto: PaginationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.findOverdue(req.user, queryDto);
  }

  @Get('upcoming')
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({ summary: 'Get tasks due in the next 7 days' })
  @ApiOkResponse({ description: 'Upcoming tasks' })
  async findUpcoming(
    @Query() queryDto: PaginationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.findUpcoming(req.user, queryDto);
  }

  @Get('calendar')
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({
    summary: 'Get calendar tasks within a date range (max 90 days)',
  })
  @ApiOkResponse({ description: 'Calendar tasks list' })
  async findCalendar(
    @Query() queryDto: TaskCalendarQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.findCalendar(queryDto, req.user);
  }

  @Get('summary')
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({ summary: 'Get aggregate task metrics and completion rate' })
  @ApiOkResponse({ description: 'Task metrics summary' })
  async getSummary(@Req() req: AuthenticatedRequest) {
    return this.tasksService.getSummary(req.user);
  }

  @Get('reminders/due')
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({ summary: 'Poll due in-app reminders for current user' })
  @ApiOkResponse({ description: 'Due reminders' })
  async findDueReminders(@Req() req: AuthenticatedRequest) {
    return this.tasksService.findDueReminders(req.user);
  }

  @Post('bulk-assign')
  @RequirePermissions(PermissionKeys.TASKS_ASSIGN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk reassign tasks (max 50) in O(1) queries' })
  @ApiOkResponse({ description: 'Tasks reassigned successfully' })
  async bulkAssign(
    @Body() dto: BulkAssignTasksDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.bulkAssign(dto, req.user);
  }

  // =========================================================================
  // 3. Dynamic Routes (@Get(':id'), @Patch(':id'), @Delete(':id'))
  // =========================================================================

  @Get(':id')
  @RequirePermissions(PermissionKeys.TASKS_VIEW)
  @ApiOperation({ summary: 'Get task by ID' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: 'Task details' })
  async findById(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.tasksService.findById(id, req.user);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.TASKS_EDIT)
  @ApiOperation({ summary: 'Update task details (omits assignedTo & status)' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: 'Updated task' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.update(id, dto, req.user);
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionKeys.TASKS_EDIT)
  @ApiOperation({ summary: 'State machine status transition' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: 'Task status updated' })
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeTaskStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.changeStatus(id, dto, req.user);
  }

  @Patch(':id/assign')
  @RequirePermissions(PermissionKeys.TASKS_ASSIGN)
  @ApiOperation({ summary: 'Reassign task and sync teamId' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: 'Task reassigned' })
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.assign(id, dto, req.user);
  }

  @Patch(':id/complete')
  @RequirePermissions(PermissionKeys.TASKS_EDIT)
  @ApiOperation({ summary: 'Mark task as completed' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: 'Task completed' })
  async complete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.tasksService.complete(id, req.user);
  }

  @Patch(':id/cancel')
  @RequirePermissions(PermissionKeys.TASKS_EDIT)
  @ApiOperation({ summary: 'Cancel task with mandatory reason' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: 'Task cancelled' })
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.cancel(id, dto, req.user);
  }

  @Patch(':id/snooze')
  @RequirePermissions(PermissionKeys.TASKS_EDIT)
  @ApiOperation({
    summary: 'Snooze task reminder timing without changing status',
  })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: 'Task reminder snoozed' })
  async snooze(
    @Param('id') id: string,
    @Body() dto: SnoozeTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.snooze(id, dto, req.user);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.TASKS_DELETE)
  @ApiOperation({ summary: 'Soft delete task' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: 'Task soft deleted' })
  async delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.tasksService.delete(id, req.user);
  }
}
