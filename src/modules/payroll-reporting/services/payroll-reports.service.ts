import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { PAYROLL_REPORTING_CONSTANTS } from '../constants/payroll-reporting.constant';
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
import { PayrollReportingMapper } from '../mappers/payroll-reporting.mapper';
import { PayrollReportingRepository } from '../repositories/payroll-reporting.repository';
import { buildSafeCsvFilename, formatCsvRow } from '../utils/csv-export.util';

@Injectable()
export class PayrollReportsService {
  constructor(
    private readonly reportingRepository: PayrollReportingRepository,
  ) {}

  async getMonthlySummary(
    query: MonthlySummaryReportQueryDto,
  ): Promise<MonthlySummaryReportResponseDto> {
    const periods =
      await this.reportingRepository.findFinalizedPeriodsForReport(
        query.year,
        query.month,
      );
    const periodIds = periods.map((p) => p._id);

    const rows = await this.reportingRepository.aggregateMonthlySummary(
      periodIds,
      {
        branchId: query.branchId
          ? new Types.ObjectId(query.branchId)
          : undefined,
        departmentId: query.departmentId
          ? new Types.ObjectId(query.departmentId)
          : undefined,
      },
    );

    return {
      payrollPeriods: periods.map((p) =>
        PayrollReportingMapper.toReportPeriodMeta(p),
      ),
      summaries: rows.map((row) =>
        PayrollReportingMapper.toMonthlySummaryRow(row),
      ),
    };
  }

  async getDepartmentWiseReport(
    query: DepartmentWiseReportQueryDto,
  ): Promise<DepartmentWiseReportRowDto[]> {
    const periods =
      await this.reportingRepository.findFinalizedPeriodsForReport(
        query.year,
        query.month,
      );
    const periodIds = periods.map((p) => p._id);

    const rows = await this.reportingRepository.aggregateDepartmentWise(
      periodIds,
      query.branchId ? new Types.ObjectId(query.branchId) : undefined,
    );

    return rows.map((row) => PayrollReportingMapper.toDepartmentWiseRow(row));
  }

  async getBranchWiseReport(
    query: BranchWiseReportQueryDto,
  ): Promise<BranchWiseReportRowDto[]> {
    const periods =
      await this.reportingRepository.findFinalizedPeriodsForReport(
        query.year,
        query.month,
      );
    const periodIds = periods.map((p) => p._id);

    const rows = await this.reportingRepository.aggregateBranchWise(periodIds);

    return rows.map((row) => PayrollReportingMapper.toBranchWiseRow(row));
  }

  async getEmployeeWiseReport(
    query: EmployeeWiseReportQueryDto,
  ): Promise<PaginatedResult<EmployeeWiseReportRowDto>> {
    const page = Math.max(
      1,
      query.page ?? PAYROLL_REPORTING_CONSTANTS.DEFAULT_PAGE,
    );
    const limit = Math.min(
      PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT,
      Math.max(1, query.limit ?? PAYROLL_REPORTING_CONSTANTS.DEFAULT_LIMIT),
    );

    const periods =
      await this.reportingRepository.findFinalizedPeriodsForReport(
        query.year,
        query.month,
      );
    const periodIds = periods.map((p) => p._id);

    const { data, total } =
      await this.reportingRepository.aggregateEmployeeWise(periodIds, {
        departmentId: query.departmentId
          ? new Types.ObjectId(query.departmentId)
          : undefined,
        branchId: query.branchId
          ? new Types.ObjectId(query.branchId)
          : undefined,
        search: query.search,
        page,
        limit,
      });

    return {
      data: data.map((row) => PayrollReportingMapper.toEmployeeWiseRow(row)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getComponentReport(
    query: ComponentReportQueryDto,
  ): Promise<PayrollComponentReportRowDto[]> {
    const periods =
      await this.reportingRepository.findFinalizedPeriodsForReport(
        query.year,
        query.month,
      );
    const periodIds = periods.map((p) => p._id);

    const rows = await this.reportingRepository.aggregateComponents(
      periodIds,
      query.componentType,
    );

    return rows.map((row) => PayrollReportingMapper.toComponentReportRow(row));
  }

  async streamMonthlySummaryCsv(
    query: MonthlySummaryReportQueryDto,
    res: Response,
  ): Promise<void> {
    const summary = await this.getMonthlySummary(query);
    const fileName = buildSafeCsvFilename('payroll-monthly-summary');
    const periodCodes = summary.payrollPeriods
      .map((p) => p.periodCode)
      .join(' | ');

    this.setCsvHeaders(res, fileName);
    res.write('\uFEFF');
    res.write(
      formatCsvRow([
        'Period Codes',
        'Currency',
        'Total Employees',
        'Total Approved Records',
        'Gross Earnings',
        'Employee Deductions',
        'Net Salary',
        'Employer Contributions',
        'Employer Cost',
        'Total LOP Days',
      ]),
    );

    for (const row of summary.summaries) {
      res.write(
        formatCsvRow([
          periodCodes,
          row.currency,
          row.totalEmployees,
          row.totalRecords,
          row.totalGrossEarnings,
          row.totalEmployeeDeductions,
          row.totalNetSalary,
          row.totalEmployerContributions,
          row.totalEmployerCost,
          row.totalLOPDays,
        ]),
      );
    }

    res.end();
  }

  async streamEmployeeWiseCsv(
    query: EmployeeWiseReportExportQueryDto,
    res: Response,
  ): Promise<void> {
    const periods =
      await this.reportingRepository.findFinalizedPeriodsForReport(
        query.year,
        query.month,
      );
    const periodIds = periods.map((p) => p._id);

    const cursor = this.reportingRepository.openEmployeeWiseCursor(
      periodIds,
      {
        departmentId: query.departmentId
          ? new Types.ObjectId(query.departmentId)
          : undefined,
        branchId: query.branchId
          ? new Types.ObjectId(query.branchId)
          : undefined,
        search: query.search,
      },
      PAYROLL_REPORTING_CONSTANTS.MAX_EXPORT_ROWS,
    );

    const fileName = buildSafeCsvFilename('payroll-employee-wise');
    this.setCsvHeaders(res, fileName);
    res.write('\uFEFF');
    res.write(
      formatCsvRow([
        'Employee Code',
        'Employee Name',
        'Department',
        'Branch',
        'Currency',
        'Periods Count',
        'Gross Earnings',
        'Employee Deductions',
        'Net Salary',
        'Employer Contributions',
        'Employer Cost',
        'Total LOP Days',
      ]),
    );

    for await (const rawRow of cursor) {
      const mapped = PayrollReportingMapper.toEmployeeWiseRow(rawRow);
      res.write(
        formatCsvRow([
          mapped.employeeCode,
          mapped.employeeName,
          mapped.department.name,
          mapped.branch.name,
          mapped.currency,
          mapped.periodCount,
          mapped.grossEarnings,
          mapped.deductions,
          mapped.netSalary,
          mapped.employerContributions,
          mapped.employerCost,
          mapped.totalLOPDays,
        ]),
      );
    }

    res.end();
  }

  private setCsvHeaders(res: Response, fileName: string): void {
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    });
  }
}
