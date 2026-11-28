import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PaginationMeta } from '../../../common/pagination/types/pagination.types';
import type { AuthenticatedRequest } from '../../auth/types/auth-request.type';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import {
  ListPayrollProcessingFailuresQueryDto,
  PayrollPeriodProcessingStatusResponseDto,
  PayrollProcessingFailureItemDto,
  ProcessPayrollPeriodDto,
} from '../dto/payroll-processing.dto';
import { PayrollProcessingService } from '../services/payroll-processing.service';

@ApiTags('Payroll Processing')
@ApiBearerAuth('access-token')
@Controller({
  path: 'payroll/periods',
  version: '1',
})
export class PayrollPeriodProcessingController {
  constructor(
    private readonly payrollProcessingService: PayrollProcessingService,
  ) {}

  @Post(':periodId/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start or safely retry batch payroll processing for a period',
    description:
      'Atomically locks the payroll period, skips up-to-date PayrollRecords, recalculates stale records, processes failed or unprocessed employees in bounded batches, and synchronizes period processing counters.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Payroll processing execution finished or recovered.',
    type: PayrollPeriodProcessingStatusResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @ApiConflictResponse({
    description:
      'Period is already processing, completed, finalized, or payroll processing is disabled in settings.',
  })
  @RequirePermissions(PermissionKeys.PAYROLL_CALCULATIONS_CREATE)
  async processPeriod(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Body() dto: ProcessPayrollPeriodDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    success: true;
    data: PayrollPeriodProcessingStatusResponseDto;
  }> {
    const data = await this.payrollProcessingService.processPeriod(
      periodId,
      dto ?? {},
      request.user.userId,
      {
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
    return { success: true, data };
  }

  @Get(':periodId/processing-status')
  @ApiOperation({
    summary: 'Get payroll period batch processing status and counters',
    description:
      'Returns live processing status, eligible/processed/successful/failed/stale/remaining counts, timestamps, and whether retry or completion is allowed.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Payroll processing status retrieved.',
    type: PayrollPeriodProcessingStatusResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYROLL_CALCULATIONS_VIEW)
  async getProcessingStatus(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
  ): Promise<{
    success: true;
    data: PayrollPeriodProcessingStatusResponseDto;
  }> {
    const data =
      await this.payrollProcessingService.getProcessingStatus(periodId);
    return { success: true, data };
  }

  @Get(':periodId/processing-failures')
  @ApiOperation({
    summary: 'Get paginated employee-level payroll processing failures',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Paginated list of unresolved employee processing failures.',
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYROLL_CALCULATIONS_VIEW)
  async getProcessingFailures(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Query() query: ListPayrollProcessingFailuresQueryDto,
  ): Promise<{
    success: true;
    data: PayrollProcessingFailureItemDto[];
    meta: PaginationMeta;
  }> {
    const result = await this.payrollProcessingService.getProcessingFailures(
      periodId,
      query,
    );
    return { success: true, data: result.data, meta: result.meta };
  }
}
