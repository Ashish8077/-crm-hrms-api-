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
import { ShiftService } from './services/shift.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';
import { ListShiftsQueryDto } from './dto/list-shifts-query.dto';

@ApiTags('Shifts')
@ApiBearerAuth('access-token')
@Controller({
  path: 'attendance/shifts',
  version: '1',
})
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  @Post()
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

  @Get()
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

  @Get(':id')
  @ApiOperation({ summary: 'Get shift by ID' })
  @ApiParam({ name: 'id', description: 'Shift ID', type: String })
  @ApiOkResponse({ description: 'Shift details.' })
  @RequirePermissions(PermissionKeys.ATTENDANCE_VIEW)
  async getShiftById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const result = await this.shiftService.getById(id);
    return { success: true, data: result };
  }

  @Patch(':id')
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

  @Delete(':id')
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

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign or unassign an employee shift' })
  @ApiOkResponse({ description: 'Shift assigned or unassigned successfully.' })
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
      message:
        dto.shiftId === null
          ? 'Shift successfully unassigned from employee'
          : 'Shift successfully assigned to employee',
    };
  }
}
