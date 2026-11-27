import { Controller, Get, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PaginationMeta } from '../../../common/pagination/types/pagination.types';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import {
  BranchWiseReportQueryDto,
  BranchWiseReportRowDto,
  ComponentReportQueryDto,
  DepartmentWiseReportQueryDto,
  DepartmentWiseReportRowDto,
  EmployeeWiseReportExportQueryDto,
  EmployeeWiseReportQueryDto,
  EmployeeWiseReportRowDto,
  MonthlySummaryReportQueryDto,
  MonthlySummaryReportResponseDto,
  PayrollComponentReportRowDto,
} from '../dto/payroll-reports.dto';
import { PayrollReportsService } from '../services/payroll-reports.service';

@ApiTags('Payroll Reports')
@ApiBearerAuth('access-token')
@Controller({
  path: 'payroll/reports',
  version: '1',
})
export class PayrollReportsController {
  constructor(private readonly payrollReportsService: PayrollReportsService) {}

  @Get('monthly-summary')
  @ApiOperation({
    summary: 'Monthly payroll summary report',
    description:
      'Aggregates finalized APPROVED payroll totals grouped by currency without combining distinct currencies.',
  })
  @ApiOkResponse({
    description: 'Monthly payroll summary report.',
    type: MonthlySummaryReportResponseDto,
  })
  @RequirePermissions(PermissionKeys.PAYROLL_REPORTS_VIEW)
  async getMonthlySummary(
    @Query() query: MonthlySummaryReportQueryDto,
  ): Promise<{ success: true; data: MonthlySummaryReportResponseDto }> {
    const data = await this.payrollReportsService.getMonthlySummary(query);
    return { success: true, data };
  }

  @Get('monthly-summary/export')
  @ApiOperation({
    summary: 'Export monthly payroll summary report as CSV',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV file stream.' })
  @RequirePermissions(PermissionKeys.PAYROLL_REPORTS_EXPORT)
  async exportMonthlySummary(
    @Query() query: MonthlySummaryReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.payrollReportsService.streamMonthlySummaryCsv(query, res);
  }

  @Get('department-wise')
  @ApiOperation({
    summary: 'Department-wise payroll report',
    description:
      'Aggregates finalized APPROVED payroll totals by department and currency, preserving totals for missing or soft-deleted departments under Unassigned / Unknown.',
  })
  @ApiOkResponse({
    description: 'Department-wise payroll breakdown.',
    type: [DepartmentWiseReportRowDto],
  })
  @RequirePermissions(PermissionKeys.PAYROLL_REPORTS_VIEW)
  async getDepartmentWiseReport(
    @Query() query: DepartmentWiseReportQueryDto,
  ): Promise<{ success: true; data: DepartmentWiseReportRowDto[] }> {
    const data =
      await this.payrollReportsService.getDepartmentWiseReport(query);
    return { success: true, data };
  }

  @Get('branch-wise')
  @ApiOperation({
    summary: 'Branch-wise payroll report',
    description:
      'Aggregates finalized APPROVED payroll totals by branch and currency, preserving totals for missing or soft-deleted branches under Unassigned / Unknown.',
  })
  @ApiOkResponse({
    description: 'Branch-wise payroll breakdown.',
    type: [BranchWiseReportRowDto],
  })
  @RequirePermissions(PermissionKeys.PAYROLL_REPORTS_VIEW)
  async getBranchWiseReport(
    @Query() query: BranchWiseReportQueryDto,
  ): Promise<{ success: true; data: BranchWiseReportRowDto[] }> {
    const data = await this.payrollReportsService.getBranchWiseReport(query);
    return { success: true, data };
  }

  @Get('employee-wise')
  @ApiOperation({
    summary: 'Employee-wise payroll report',
    description:
      'Returns database-paginated employee payroll totals aggregated from finalized APPROVED records grouped by employee and currency.',
  })
  @ApiOkResponse({
    description: 'Paginated employee-wise payroll report.',
    type: [EmployeeWiseReportRowDto],
  })
  @RequirePermissions(PermissionKeys.PAYROLL_REPORTS_VIEW)
  async getEmployeeWiseReport(
    @Query() query: EmployeeWiseReportQueryDto,
  ): Promise<{
    success: true;
    data: EmployeeWiseReportRowDto[];
    meta: PaginationMeta;
  }> {
    const result =
      await this.payrollReportsService.getEmployeeWiseReport(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get('employee-wise/export')
  @ApiOperation({
    summary: 'Export employee-wise payroll report as CSV',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'Streamed CSV file.' })
  @RequirePermissions(PermissionKeys.PAYROLL_REPORTS_EXPORT)
  async exportEmployeeWiseReport(
    @Query() query: EmployeeWiseReportExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.payrollReportsService.streamEmployeeWiseCsv(query, res);
  }

  @Get('components')
  @ApiOperation({
    summary: 'Payroll component-wise report',
    description:
      'Aggregates immutable calculation snapshot component totals across EARNING, EMPLOYEE_DEDUCTION, and EMPLOYER_CONTRIBUTION grouped by component and currency.',
  })
  @ApiOkResponse({
    description: 'Payroll component totals from immutable snapshots.',
    type: [PayrollComponentReportRowDto],
  })
  @RequirePermissions(PermissionKeys.PAYROLL_REPORTS_VIEW)
  async getComponentReport(
    @Query() query: ComponentReportQueryDto,
  ): Promise<{ success: true; data: PayrollComponentReportRowDto[] }> {
    const data = await this.payrollReportsService.getComponentReport(query);
    return { success: true, data };
  }
}
