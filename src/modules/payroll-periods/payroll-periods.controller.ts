import {
  Body,
  Controller,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { PayrollPeriodsService } from './services/payroll-periods.service';
import { PayrollAttendanceSummaryService } from './services/payroll-attendance-summary.service';
import { CreatePayrollPeriodDto } from './dto/create-payroll-period.dto';
import { UpdatePayrollPeriodDto } from './dto/update-payroll-period.dto';
import { UpdatePayrollPeriodStatusDto } from './dto/update-payroll-period-status.dto';
import { ListPayrollPeriodsQueryDto } from './dto/list-payroll-periods-query.dto';
import { PayrollAttendanceSummaryQueryDto } from './dto/payroll-attendance-summary-query.dto';
import { PayrollPeriodAttendanceSummaryResponseDto } from './dto/payroll-attendance-summary-response.dto';
import { PayrollPeriodResponse } from './mappers/payroll-period.mapper';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { PaginationMeta } from '../../common/pagination/types/pagination.types';

@ApiTags('Payroll Periods')
@ApiBearerAuth('access-token')
@Controller({
  path: 'payroll/periods',
  version: '1',
})
export class PayrollPeriodsController {
  constructor(
    private readonly payrollPeriodsService: PayrollPeriodsService,
    private readonly payrollAttendanceSummaryService: PayrollAttendanceSummaryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new payroll period' })
  @ApiCreatedResponse({
    description: 'The payroll period has been successfully created.',
  })
  @ApiConflictResponse({
    description:
      'Period code or cycle already exists, or date range overlaps an existing period.',
  })
  @RequirePermissions(PermissionKeys.PAYROLL_PERIODS_CREATE)
  async create(
    @Body() dto: CreatePayrollPeriodDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: PayrollPeriodResponse }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const period = await this.payrollPeriodsService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: period };
  }

  @Get()
  @ApiOperation({
    summary: 'List payroll periods with filtering, pagination and sorting',
  })
  @ApiOkResponse({
    description: 'Paginated list of payroll periods.',
  })
  @RequirePermissions(PermissionKeys.PAYROLL_PERIODS_VIEW)
  async list(@Query() query: ListPayrollPeriodsQueryDto): Promise<{
    success: true;
    data: PayrollPeriodResponse[];
    meta: PaginationMeta;
  }> {
    const result = await this.payrollPeriodsService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payroll period details by ID' })
  @ApiParam({ name: 'id', description: 'Payroll Period ID', type: String })
  @ApiOkResponse({ description: 'The payroll period details.' })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYROLL_PERIODS_VIEW)
  async getById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ): Promise<{ success: true; data: PayrollPeriodResponse }> {
    const period = await this.payrollPeriodsService.getById(id);
    return { success: true, data: period };
  }

  @Get(':periodId/attendance-summary')
  @ApiOperation({
    summary: 'Get employee-wise attendance summary for a payroll period',
    description:
      'Read-only resolution of employee attendance, approved/cancellation-requested leaves, holidays, weekly offs, tenure overlap, and data-quality anomalies for a payroll period.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Employee-wise attendance summary for the payroll period.',
    type: PayrollPeriodAttendanceSummaryResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYROLL_PERIODS_VIEW)
  async getAttendanceSummary(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Query() query: PayrollAttendanceSummaryQueryDto,
  ): Promise<{
    success: true;
    data: PayrollPeriodAttendanceSummaryResponseDto;
  }> {
    const data =
      await this.payrollAttendanceSummaryService.getPeriodAttendanceSummary(
        periodId,
        query,
      );
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing draft payroll period' })
  @ApiParam({ name: 'id', description: 'Payroll Period ID', type: String })
  @ApiOkResponse({
    description: 'The payroll period has been successfully updated.',
  })
  @ApiConflictResponse({
    description:
      'Cannot update non-draft period, or updated dates overlap another period.',
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYROLL_PERIODS_EDIT)
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdatePayrollPeriodDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: PayrollPeriodResponse }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const period = await this.payrollPeriodsService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: period };
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Transition payroll period lifecycle status',
  })
  @ApiParam({ name: 'id', description: 'Payroll Period ID', type: String })
  @ApiOkResponse({
    description: 'The payroll period status has been successfully updated.',
  })
  @ApiConflictResponse({
    description: 'Period is already finalized/locked.',
  })
  @ApiForbiddenResponse({
    description:
      'Requires PAYROLL_PERIODS_APPROVE permission to transition to FINALIZED.',
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYROLL_PERIODS_EDIT)
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdatePayrollPeriodStatusDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: PayrollPeriodResponse }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const period = await this.payrollPeriodsService.updateStatus(
      id,
      dto,
      request.user.userId,
      request.user.roleIds,
      { ipAddress, userAgent },
    );
    return { success: true, data: period };
  }
}
