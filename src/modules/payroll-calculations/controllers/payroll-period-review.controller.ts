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
  ApiForbiddenResponse,
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
  ApprovePayrollPeriodDto,
  ApprovePayrollPeriodResponseDto,
  ListPayrollReviewRecordsQueryDto,
  PayrollReviewRecordDetailResponseDto,
  PayrollReviewRecordListItemDto,
  PayrollReviewSummaryResponseDto,
} from '../dto/payroll-review.dto';
import { PayrollReviewService } from '../services/payroll-review.service';

@ApiTags('Payroll Review & Approval')
@ApiBearerAuth('access-token')
@Controller({
  path: 'payroll/periods',
  version: '1',
})
export class PayrollPeriodReviewController {
  constructor(private readonly payrollReviewService: PayrollReviewService) {}

  @Get(':periodId/review-summary')
  @ApiOperation({
    summary: 'Get period-level payroll review summary and approval readiness',
    description:
      'Aggregates persisted active PayrollRecord totals (excluding INVALIDATED records), employee status counts, readiness state, employees requiring attention, and approval eligibility.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Payroll review summary retrieved successfully.',
    type: PayrollReviewSummaryResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYROLL_CALCULATIONS_VIEW)
  async getReviewSummary(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
  ): Promise<{ success: true; data: PayrollReviewSummaryResponseDto }> {
    const data = await this.payrollReviewService.getReviewSummary(periodId);
    return { success: true, data };
  }

  @Get(':periodId/records')
  @ApiOperation({
    summary: 'List paginated employee-wise payroll records for review',
    description:
      'Returns paginated employee payroll summaries supporting search, department, branch, status, and anomaly filtering without recalculating payroll.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Paginated list of payroll records for the requested period.',
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYROLL_CALCULATIONS_VIEW)
  async listPeriodRecords(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Query() query: ListPayrollReviewRecordsQueryDto,
  ): Promise<{
    success: true;
    data: PayrollReviewRecordListItemDto[];
    meta: PaginationMeta;
  }> {
    const result = await this.payrollReviewService.listPeriodRecords(
      periodId,
      query,
    );
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':periodId/records/:recordId')
  @ApiOperation({
    summary: 'Get detailed persisted employee payroll calculation breakdown',
    description:
      'Returns full earnings/deduction/employer contribution breakdowns, leave/attendance LOP details, proration, fingerprint, calculation version, and anomalies for one record belonging to the period.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiParam({
    name: 'recordId',
    description: 'Payroll Record ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Detailed persisted employee payroll record retrieved.',
    type: PayrollReviewRecordDetailResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Payroll period or record in that period not found.',
  })
  @RequirePermissions(PermissionKeys.PAYROLL_CALCULATIONS_VIEW)
  async getRecordDetails(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Param('recordId', ParseObjectIdPipe) recordId: Types.ObjectId,
  ): Promise<{ success: true; data: PayrollReviewRecordDetailResponseDto }> {
    const data = await this.payrollReviewService.getRecordDetails(
      periodId,
      recordId,
    );
    return { success: true, data };
  }

  @Post(':periodId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Review and approve a COMPLETED payroll period atomically',
    description:
      'Validates payroll completion readiness and anomaly gates, atomically transitions eligible CALCULATED records to APPROVED and period status to APPROVED, records authoritative totals and approval metadata, and emits an audit event without finalizing the period.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Payroll period approved successfully.',
    type: ApprovePayrollPeriodResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @ApiForbiddenResponse({
    description:
      'Insufficient permissions. Requires PAYROLL_PERIODS_APPROVE permission.',
  })
  @ApiConflictResponse({
    description:
      'Period is not COMPLETED, already approved/finalized, has missing/stale/failed records or unresolved anomalies, or was modified concurrently.',
  })
  @RequirePermissions(PermissionKeys.PAYROLL_PERIODS_APPROVE)
  async approvePeriod(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Body() dto: ApprovePayrollPeriodDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: ApprovePayrollPeriodResponseDto }> {
    const data = await this.payrollReviewService.approvePeriod(
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
}
