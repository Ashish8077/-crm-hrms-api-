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
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { AttendanceService } from './services/attendance.service';
import { ShiftService } from './services/shift.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { StartBreakDto } from './dto/start-break.dto';
import { EndBreakDto } from './dto/end-break.dto';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';
import { CreateRegularizationDto } from './dto/create-regularization.dto';
import { ReviewRegularizationDto } from './dto/review-regularization.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import { AttendanceCalendarQueryDto } from './dto/attendance-calendar-query.dto';
import { AttendanceSummaryQueryDto } from './dto/attendance-summary-query.dto';
import { ListRegularizationQueryDto } from './dto/list-regularization-query.dto';
import { ListShiftsQueryDto } from './dto/list-shifts-query.dto';

@ApiTags('Attendance')
@ApiBearerAuth('access-token')
@Controller({
  path: 'attendance',
  version: '1',
})
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly shiftService: ShiftService,
  ) {}

  // ── 1. Attendance Capture ──────────────────────────────────────────

  @Post('check-in')
  @ApiOperation({ summary: 'Employee check-in' })
  @ApiCreatedResponse({ description: 'Check-in recorded successfully.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_CREATE)
  async checkIn(@Body() dto: CheckInDto, @Req() request: AuthenticatedRequest) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.attendanceService.checkIn(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Employee check-out' })
  @ApiOkResponse({ description: 'Check-out recorded successfully.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_CREATE)
  async checkOut(
    @Body() dto: CheckOutDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.attendanceService.checkOut(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Post('break/start')
  @ApiOperation({ summary: 'Start a break session' })
  @ApiCreatedResponse({ description: 'Break started successfully.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_CREATE)
  async startBreak(
    @Body() dto: StartBreakDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.attendanceService.startBreak(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Post('break/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the current active break session' })
  @ApiOkResponse({ description: 'Break ended successfully.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_CREATE)
  async endBreak(
    @Body() dto: EndBreakDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.attendanceService.endBreak(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Get('today')
  @ApiOperation({
    summary: 'Get current day attendance status for authenticated employee',
  })
  @ApiOkResponse({ description: 'Today attendance state.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_VIEW)
  async getTodayStatus(@Req() request: AuthenticatedRequest) {
    const result = await this.attendanceService.getTodayStatus(
      request.user.userId,
    );
    return { success: true, data: result };
  }

  // ── 2. Attendance Management & Calendar ────────────────────────────

  @Get('calendar')
  @ApiOperation({ summary: 'Get attendance calendar records for date range' })
  @ApiOkResponse({ description: 'Calendar attendance list.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_VIEW)
  async getCalendar(
    @Query() query: AttendanceCalendarQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.attendanceService.getCalendar(
      request.user.userId,
      query,
    );
    return { success: true, data: result };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get monthly attendance summary and statistics' })
  @ApiOkResponse({ description: 'Monthly summary statistics.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_VIEW)
  async getSummary(
    @Query() query: AttendanceSummaryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.attendanceService.getMonthlySummary(
      request.user.userId,
      query,
    );
    return { success: true, data: result };
  }

  @Get('reports')
  @ApiOperation({
    summary: 'List attendance reports with pagination and filters',
  })
  @ApiOkResponse({ description: 'Paginated attendance report list.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_VIEW)
  async listReports(@Query() query: ListAttendanceQueryDto) {
    const result = await this.attendanceService.listReports(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  // ── 3. Attendance Regularization ───────────────────────────────────

  @Post('regularizations')
  @ApiOperation({ summary: 'Submit an attendance regularization request' })
  @ApiCreatedResponse({ description: 'Regularization request submitted.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_CREATE)
  async createRegularization(
    @Body() dto: CreateRegularizationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.attendanceService.createRegularization(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Get('regularizations')
  @ApiOperation({ summary: 'List attendance regularization requests' })
  @ApiOkResponse({ description: 'Paginated regularization requests.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_VIEW)
  async listRegularizations(
    @Query() query: ListRegularizationQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.attendanceService.listRegularizations(
      request.user.userId,
      query,
    );
    return { success: true, data: result.data, meta: result.meta };
  }

  @Patch('regularizations/:id/approve')
  @ApiOperation({ summary: 'Approve an attendance regularization request' })
  @ApiParam({
    name: 'id',
    description: 'Regularization Request ID',
    type: String,
  })
  @ApiOkResponse({ description: 'Regularization request approved.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_APPROVE)
  async approveRegularization(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ReviewRegularizationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.attendanceService.approveRegularization(
      id,
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Patch('regularizations/:id/reject')
  @ApiOperation({ summary: 'Reject an attendance regularization request' })
  @ApiParam({
    name: 'id',
    description: 'Regularization Request ID',
    type: String,
  })
  @ApiOkResponse({ description: 'Regularization request rejected.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_APPROVE)
  async rejectRegularization(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ReviewRegularizationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.attendanceService.rejectRegularization(
      id,
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  // ── 4. Shift Management ───────────────────────────────────────────

  @Post('shifts')
  @ApiTags('Shifts')
  @ApiOperation({ summary: 'Create a new shift' })
  @ApiCreatedResponse({ description: 'Shift created successfully.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_CREATE)
  async createShift(
    @Body() dto: CreateShiftDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.shiftService.create(dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, data: result };
  }

  @Get('shifts')
  @ApiTags('Shifts')
  @ApiOperation({
    summary:
      'List shifts (returns active and inactive shifts; excludes soft-deleted)',
  })
  @ApiOkResponse({ description: 'List of shifts.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_VIEW)
  async listShifts(@Query() query: ListShiftsQueryDto) {
    const filter =
      query.isActive !== undefined ? { isActive: query.isActive } : undefined;
    const result = await this.shiftService.list(filter);
    return { success: true, data: result };
  }

  @Get('shifts/:id')
  @ApiTags('Shifts')
  @ApiOperation({ summary: 'Get shift by ID' })
  @ApiParam({ name: 'id', description: 'Shift ID', type: String })
  @ApiOkResponse({ description: 'Shift details.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_VIEW)
  async getShiftById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const result = await this.shiftService.getById(id);
    return { success: true, data: result };
  }

  @Patch('shifts/:id')
  @ApiTags('Shifts')
  @ApiOperation({ summary: 'Update shift details' })
  @ApiParam({ name: 'id', description: 'Shift ID', type: String })
  @ApiOkResponse({ description: 'Shift updated successfully.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_EDIT)
  async updateShift(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateShiftDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.shiftService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Delete('shifts/:id')
  @ApiTags('Shifts')
  @ApiOperation({ summary: 'Delete a shift' })
  @ApiParam({ name: 'id', description: 'Shift ID', type: String })
  @ApiOkResponse({ description: 'Shift deleted successfully.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_EDIT)
  async deleteShift(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.shiftService.delete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Shift successfully deleted' };
  }

  @Post('shifts/assign')
  @ApiTags('Shifts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a shift to an employee' })
  @ApiOkResponse({ description: 'Shift assigned to employee successfully.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_EDIT)
  async assignShift(
    @Body() dto: AssignShiftDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.shiftService.assignShift(dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return {
      success: true,
      message: 'Shift successfully assigned to employee',
    };
  }
}
