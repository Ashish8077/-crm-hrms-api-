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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { LeavesService } from './services/leaves.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { UpdateLeaveTypeStatusDto } from './dto/update-leave-type-status.dto';
import { ListLeaveTypesQueryDto } from './dto/list-leave-types-query.dto';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { ListHolidaysQueryDto } from './dto/list-holidays-query.dto';
import { AllocateLeaveDto } from './dto/allocate-leave.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-leave-balance.dto';
import { ListLeaveTransactionsQueryDto } from './dto/list-leave-transactions-query.dto';
import { ApplyLeaveDto } from './dto/apply-leave.dto';
import { ListLeaveRequestsQueryDto } from './dto/list-leave-requests-query.dto';
import { ListPendingApprovalsQueryDto } from './dto/list-pending-approvals-query.dto';
import { ApproveLeaveDto } from './dto/approve-leave.dto';
import { RejectLeaveDto } from './dto/reject-leave.dto';
import { CancelLeaveDto } from './dto/cancel-leave.dto';
import { ReconcileLeaveCancellationDto } from './dto/reconcile-leave-cancellation.dto';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { OrganizationCalendarQueryDto } from './dto/organization-calendar-query.dto';
import { ProcessCarryForwardDto } from './dto/process-carry-forward.dto';

import { LeaveTypeMapper } from './mappers/leave-type.mapper';
import { HolidayMapper } from './mappers/holiday.mapper';
import { LeaveBalanceMapper } from './mappers/leave-balance.mapper';
import { LeaveRequestMapper } from './mappers/leave-request.mapper';

@ApiTags('Leaves')
@ApiBearerAuth('access-token')
@Controller({
  path: 'leaves',
  version: '1',
})
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  // ===========================================================================
  // 1. LEAVE TYPES
  // ===========================================================================

  @Post('types')
  @ApiOperation({ summary: 'Create a new leave type configuration' })
  @ApiCreatedResponse({ description: 'Leave type created successfully.' })
  @RequirePermissions(PermissionKeys.LEAVE_TYPES_CREATE)
  async createLeaveType(
    @Body() dto: CreateLeaveTypeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.createLeaveType(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: LeaveTypeMapper.toResponse(result) };
  }

  @Get('types')
  @ApiOperation({ summary: 'List leave types with pagination and filters' })
  @ApiOkResponse({ description: 'Paginated leave types list.' })
  @RequirePermissions(PermissionKeys.LEAVE_TYPES_VIEW)
  async listLeaveTypes(@Query() query: ListLeaveTypesQueryDto) {
    const result = await this.leavesService.listLeaveTypes(query);
    return {
      success: true,
      data: LeaveTypeMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  @Get('types/:id')
  @ApiOperation({ summary: 'Get leave type details by ID' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave type ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Leave type details.' })
  @RequirePermissions(PermissionKeys.LEAVE_TYPES_VIEW)
  async getLeaveTypeById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const result = await this.leavesService.getLeaveTypeById(id);
    return { success: true, data: LeaveTypeMapper.toResponse(result) };
  }

  @Patch('types/:id')
  @ApiOperation({ summary: 'Update an existing leave type' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave type ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Leave type updated successfully.' })
  @RequirePermissions(PermissionKeys.LEAVE_TYPES_EDIT)
  async updateLeaveType(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateLeaveTypeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.updateLeaveType(
      request.user.userId,
      id,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: LeaveTypeMapper.toResponse(result) };
  }

  @Patch('types/:id/status')
  @ApiOperation({
    summary: 'Toggle or update active status of a leave type',
    description:
      'Toggles active status if request body is omitted, or explicitly sets isActive when provided.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave type ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Leave type status updated successfully.' })
  @RequirePermissions(PermissionKeys.LEAVE_TYPES_EDIT)
  async toggleLeaveTypeStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateLeaveTypeStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.updateLeaveTypeStatus(
      request.user.userId,
      id,
      dto?.isActive,
      { ipAddress, userAgent },
    );
    return { success: true, data: LeaveTypeMapper.toResponse(result) };
  }

  @Delete('types/:id')
  @ApiOperation({ summary: 'Soft delete a leave type' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave type ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Leave type soft-deleted successfully.' })
  @RequirePermissions(PermissionKeys.LEAVE_TYPES_DELETE)
  async deleteLeaveType(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.leavesService.deleteLeaveType(request.user.userId, id, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Leave type soft-deleted successfully' };
  }

  // ===========================================================================
  // 2. HOLIDAYS
  // ===========================================================================

  @Post('holidays')
  @ApiOperation({ summary: 'Create a calendar holiday' })
  @ApiCreatedResponse({ description: 'Holiday created successfully.' })
  @RequirePermissions(PermissionKeys.HOLIDAYS_CREATE)
  async createHoliday(
    @Body() dto: CreateHolidayDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.createHoliday(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return {
      success: true,
      message: 'Holiday created successfully',
      data: HolidayMapper.toResponse(result),
    };
  }

  @Get('holidays')
  @ApiOperation({
    summary: 'List calendar holidays with pagination and filters',
  })
  @ApiOkResponse({ description: 'Paginated holidays list.' })
  @RequirePermissions(PermissionKeys.HOLIDAYS_VIEW)
  async listHolidays(@Query() query: ListHolidaysQueryDto) {
    const result = await this.leavesService.listHolidays(query);
    return {
      success: true,
      data: HolidayMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  @Get('holidays/:id')
  @ApiOperation({ summary: 'Get holiday details by ID' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Holiday ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Holiday details.' })
  @RequirePermissions(PermissionKeys.HOLIDAYS_VIEW)
  async getHolidayById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const result = await this.leavesService.getHolidayById(id);
    return { success: true, data: HolidayMapper.toResponse(result) };
  }

  @Patch('holidays/:id')
  @ApiOperation({ summary: 'Update an existing holiday' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Holiday ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Holiday updated successfully.' })
  @RequirePermissions(PermissionKeys.HOLIDAYS_EDIT)
  async updateHoliday(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateHolidayDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.updateHoliday(
      request.user.userId,
      id,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: HolidayMapper.toResponse(result) };
  }

  @Delete('holidays/:id')
  @ApiOperation({ summary: 'Soft delete a holiday' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Holiday ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Holiday soft-deleted successfully.' })
  @RequirePermissions(PermissionKeys.HOLIDAYS_DELETE)
  async deleteHoliday(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.leavesService.deleteHoliday(request.user.userId, id, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Holiday soft-deleted successfully' };
  }

  // ===========================================================================
  // 3. BALANCES & LEDGERS
  // ===========================================================================

  @Get('balances/me')
  @ApiOperation({
    summary: 'Get leave balances for the authenticated employee',
  })
  @ApiOkResponse({ description: 'Employee leave balances.' })
  @RequirePermissions(PermissionKeys.LEAVE_BALANCES_VIEW_OWN)
  async getMyBalances(
    @Req() request: AuthenticatedRequest,
    @Query('year') year?: number,
  ) {
    const targetYear = year ? Number(year) : new Date().getUTCFullYear();
    const result = await this.leavesService.getMyBalances(
      request.user.userId,
      targetYear,
    );
    return {
      success: true,
      data: LeaveBalanceMapper.toResponseList(result),
    };
  }

  @Get('balances/employees/:id')
  @ApiOperation({
    summary: 'Get leave balances for a specific employee (Manager/HR)',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Employee ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Target employee leave balances.' })
  @RequirePermissions(PermissionKeys.LEAVE_BALANCES_VIEW_TEAM)
  async getEmployeeBalances(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
    @Query('year') year?: number,
  ) {
    const targetYear = year ? Number(year) : new Date().getUTCFullYear();
    const result = await this.leavesService.getEmployeeBalances(
      request.user.userId,
      id,
      targetYear,
    );
    return {
      success: true,
      data: LeaveBalanceMapper.toResponseList(result),
    };
  }

  @Post('balances/allocate')
  @ApiOperation({
    summary: 'Allocate annual leave grants to an employee',
  })
  @ApiCreatedResponse({ description: 'Leave balances allocated successfully.' })
  @ApiConflictResponse({
    description:
      'Leave balance already allocated for this employee, leave type, and year.',
  })
  @RequirePermissions(PermissionKeys.LEAVE_BALANCES_ALLOCATE)
  async allocateBalance(
    @Body() dto: AllocateLeaveDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.allocateLeave(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return {
      success: true,
      data: LeaveBalanceMapper.toResponseList(result),
    };
  }

  @Post('balances/adjust')
  @ApiOperation({
    summary: 'HR manual credit or debit adjustment to leave balance',
  })
  @ApiCreatedResponse({ description: 'Leave balance adjusted successfully.' })
  @RequirePermissions(PermissionKeys.LEAVE_BALANCES_ADJUST)
  async adjustBalance(
    @Body() dto: AdjustLeaveBalanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.adjustBalance(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return {
      success: true,
      data: LeaveBalanceMapper.toResponse(result),
    };
  }

  @Post('balances/carry-forward')
  @ApiOperation({
    summary: 'Process year-end carry forward of eligible unused leave balances',
  })
  @ApiCreatedResponse({
    description: 'Year-end carry forward processed successfully.',
  })
  @RequirePermissions(PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD)
  async processCarryForward(
    @Body() dto: ProcessCarryForwardDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.processYearEndCarryForward(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return {
      success: true,
      data: result,
    };
  }

  @Get('balances/me/transactions')
  @ApiOperation({ summary: 'Audit trail of own leave balance transactions' })
  @ApiOkResponse({ description: 'Paginated leave transactions.' })
  @RequirePermissions(PermissionKeys.LEAVE_BALANCES_VIEW_OWN_TRANSACTIONS)
  async getMyTransactions(
    @Query() query: ListLeaveTransactionsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.leavesService.getMyTransactions(
      request.user.userId,
      query,
    );
    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('balances/employees/:id/transactions')
  @ApiOperation({
    summary: 'Audit trail of leave balance transactions for an employee',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Employee ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Paginated leave transactions.' })
  @RequirePermissions(PermissionKeys.LEAVE_BALANCES_VIEW_TEAM_TRANSACTIONS)
  async getEmployeeTransactions(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: ListLeaveTransactionsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.leavesService.getTransactions(
      request.user.userId,
      id,
      query,
    );
    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  // ===========================================================================
  // 4. LEAVE REQUESTS & APPROVALS
  // ===========================================================================

  @Post('requests')
  @ApiOperation({ summary: 'Apply for leave' })
  @ApiCreatedResponse({
    description: 'Leave request created and balance reserved.',
  })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_APPLY)
  async applyLeave(
    @Body() dto: ApplyLeaveDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.applyLeave(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: LeaveRequestMapper.toResponse(result) };
  }

  @Get('requests/me')
  @ApiOperation({
    summary: 'Get leave requests for the authenticated employee',
  })
  @ApiOkResponse({ description: 'Paginated own leave requests.' })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_VIEW_OWN)
  async getMyRequests(
    @Query() query: ListLeaveRequestsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.leavesService.getMyRequests(
      request.user.userId,
      query,
    );
    return {
      success: true,
      data: LeaveRequestMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  @Get('requests/approvals/pending')
  @ApiOperation({
    summary: 'List pending leave requests for the manager to approve',
  })
  @ApiOkResponse({ description: 'Pending approval leave requests.' })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_VIEW_PENDING_APPROVALS)
  async getPendingApprovals(
    @Query() query: ListPendingApprovalsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.leavesService.getPendingApprovals(
      request.user.userId,
      query,
    );
    return {
      success: true,
      data: LeaveRequestMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  @Get('requests')
  @ApiOperation({ summary: 'List leave requests (Manager/HR scoping)' })
  @ApiOkResponse({ description: 'Paginated leave requests.' })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM)
  async listRequests(
    @Query() query: ListLeaveRequestsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.leavesService.listRequests(
      request.user.userId,
      query,
    );
    return {
      success: true,
      data: LeaveRequestMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Get leave request details by ID' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave request ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Leave request details.' })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_VIEW)
  async getRequestById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.leavesService.getRequestById(
      request.user.userId,
      id,
    );
    return { success: true, data: LeaveRequestMapper.toResponse(result) };
  }

  @Patch('requests/:id/approve')
  @ApiOperation({ summary: 'Approve a pending leave request' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave request ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Leave request approved and balance debited.' })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_APPROVE)
  async approveLeave(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ApproveLeaveDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.approveLeave(
      request.user.userId,
      id,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: LeaveRequestMapper.toResponse(result) };
  }

  @Patch('requests/:id/reject')
  @ApiOperation({ summary: 'Reject a pending leave request' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave request ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({
    description: 'Leave request rejected and balance reservation released.',
  })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_REJECT)
  async rejectLeave(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: RejectLeaveDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.rejectLeave(
      request.user.userId,
      id,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: LeaveRequestMapper.toResponse(result) };
  }

  @Patch('requests/:id/cancel')
  @ApiOperation({ summary: 'Cancel a leave request (Tier 1-3 policy)' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave request ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Leave request cancelled.' })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_CANCEL_OWN)
  async cancelLeave(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: CancelLeaveDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.cancelLeave(
      request.user.userId,
      id,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: LeaveRequestMapper.toResponse(result) };
  }

  @Patch('requests/:id/reconcile')
  @ApiOperation({
    summary: 'HR Leave Cancellation Reconciliation (Tier 3 policy)',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Leave request ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Leave cancellation reconciled successfully.' })
  @RequirePermissions(PermissionKeys.LEAVE_REQUESTS_APPROVE)
  async reconcileLeaveCancellation(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ReconcileLeaveCancellationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leavesService.reconcileLeaveCancellation(
      request.user.userId,
      id,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: LeaveRequestMapper.toResponse(result) };
  }

  // ===========================================================================
  // 5. CALENDAR & SCHEDULE VISUALIZATION (PART 13)
  // ===========================================================================

  @Get('calendar/me')
  @ApiOperation({
    summary: 'Get leave calendar and applicable holidays for current employee',
  })
  @ApiOkResponse({ description: 'Personal leave calendar and holidays.' })
  @RequirePermissions(PermissionKeys.LEAVE_CALENDAR_VIEW_OWN)
  async getMyCalendar(
    @Query() query: CalendarQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.leavesService.getMyCalendar(
      request.user.userId,
      query,
    );
    return {
      success: true,
      data: result,
    };
  }

  @Get('calendar/team')
  @ApiOperation({
    summary: 'Get leave calendar and holidays for manager direct reports',
  })
  @ApiOkResponse({ description: 'Team leave calendar and holidays.' })
  @RequirePermissions(PermissionKeys.LEAVE_CALENDAR_VIEW_TEAM)
  async getTeamCalendar(
    @Query() query: CalendarQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.leavesService.getTeamCalendar(
      request.user.userId,
      query,
    );
    return {
      success: true,
      data: result,
    };
  }

  @Get('calendar/organization')
  @ApiOperation({
    summary:
      'Get organization-wide leave calendar with branch and department filters',
  })
  @ApiOkResponse({ description: 'Organization leave calendar and holidays.' })
  @RequirePermissions(PermissionKeys.LEAVE_CALENDAR_VIEW_ORGANIZATION)
  async getOrganizationCalendar(@Query() query: OrganizationCalendarQueryDto) {
    const result = await this.leavesService.getOrganizationCalendar(query);
    return {
      success: true,
      data: result,
    };
  }
}
