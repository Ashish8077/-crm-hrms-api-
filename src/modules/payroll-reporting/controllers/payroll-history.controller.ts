import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBearerAuth,
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
  EmployeePayrollHistoryDetailsDto,
  EmployeePayrollHistoryItemDto,
  ListEmployeePayrollHistoryQueryDto,
  ListPayrollHistoryQueryDto,
  PayrollHistoryDetailsDto,
  PayrollHistoryListItemDto,
} from '../dto/payroll-history.dto';
import { PayrollHistoryService } from '../services/payroll-history.service';

@ApiTags('Payroll History')
@ApiBearerAuth('access-token')
@Controller({
  path: 'payroll/history',
  version: '1',
})
export class PayrollHistoryController {
  constructor(private readonly payrollHistoryService: PayrollHistoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List finalized payroll period history',
    description:
      'Returns paginated FINALIZED payroll periods with financial summary totals. DRAFT, PROCESSING, COMPLETED, and unapproved periods are excluded.',
  })
  @ApiOkResponse({
    description: 'Paginated finalized payroll history.',
    type: [PayrollHistoryListItemDto],
  })
  @RequirePermissions(PermissionKeys.PAYROLL_HISTORY_VIEW)
  async listHistory(@Query() query: ListPayrollHistoryQueryDto): Promise<{
    success: true;
    data: PayrollHistoryListItemDto[];
    meta: PaginationMeta;
  }> {
    const result = await this.payrollHistoryService.listHistory(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get('employees/:employeeId/:periodId')
  @ApiOperation({
    summary:
      'Get finalized payroll history details for an employee in a period',
    description:
      'Returns immutable calculation snapshot, earnings, deductions, employer contributions, net salary, LOP breakdown, and payslip availability. Accessible to HR/Admin (payroll.history.view) or the owning employee (payroll.history.view_own).',
  })
  @ApiParam({ name: 'employeeId', description: 'Employee ID', type: String })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Employee finalized payroll details.',
    type: EmployeePayrollHistoryDetailsDto,
  })
  @ApiForbiddenResponse({
    description: 'Not authorized to view this employee payroll history.',
  })
  @ApiNotFoundResponse({
    description:
      'Employee, finalized payroll period, or approved payroll record not found.',
  })
  async getEmployeePeriodHistoryDetails(
    @Param('employeeId', ParseObjectIdPipe) employeeId: Types.ObjectId,
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: EmployeePayrollHistoryDetailsDto }> {
    const data =
      await this.payrollHistoryService.getEmployeePeriodHistoryDetails(
        employeeId,
        periodId,
        request.user.userId,
        request.user.roleIds,
      );
    return { success: true, data };
  }

  @Get('employees/:employeeId')
  @ApiOperation({
    summary: 'List finalized payroll history for a single employee',
    description:
      'Returns paginated APPROVED payroll records in FINALIZED payroll periods for the employee. Accessible to HR/Admin (payroll.history.view) or the owning employee (payroll.history.view_own).',
  })
  @ApiParam({ name: 'employeeId', description: 'Employee ID', type: String })
  @ApiOkResponse({
    description: 'Paginated employee payroll history.',
    type: [EmployeePayrollHistoryItemDto],
  })
  @ApiForbiddenResponse({
    description: 'Not authorized to view this employee payroll history.',
  })
  @ApiNotFoundResponse({ description: 'Employee not found.' })
  async listEmployeeHistory(
    @Param('employeeId', ParseObjectIdPipe) employeeId: Types.ObjectId,
    @Query() query: ListEmployeePayrollHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    success: true;
    data: EmployeePayrollHistoryItemDto[];
    meta: PaginationMeta;
  }> {
    const result = await this.payrollHistoryService.listEmployeeHistory(
      employeeId,
      query,
      request.user.userId,
      request.user.roleIds,
    );
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':periodId')
  @ApiOperation({
    summary: 'Get finalized payroll period history details',
    description:
      'Returns period details, finalization metadata, approval summary, approved employee count, and currency-grouped financial totals for a FINALIZED period.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Finalized payroll period history details.',
    type: PayrollHistoryDetailsDto,
  })
  @ApiNotFoundResponse({
    description: 'Finalized payroll period not found.',
  })
  @RequirePermissions(PermissionKeys.PAYROLL_HISTORY_VIEW)
  async getPeriodHistoryDetails(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
  ): Promise<{ success: true; data: PayrollHistoryDetailsDto }> {
    const data =
      await this.payrollHistoryService.getPeriodHistoryDetails(periodId);
    return { success: true, data };
  }
}
