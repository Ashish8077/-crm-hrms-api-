import { HttpStatus, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { AuthorizationService } from '../../authorization/authorization.service';
import { EmployeeRepository } from '../../employees/repositories/employee.repository';
import { PayrollPeriodStatus } from '../../payroll-periods/constants/payroll-period.constant';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import { PAYROLL_REPORTING_CONSTANTS } from '../constants/payroll-reporting.constant';
import {
  EmployeePayrollHistoryDetailsDto,
  EmployeePayrollHistoryItemDto,
  ListEmployeePayrollHistoryQueryDto,
  ListPayrollHistoryQueryDto,
  PayrollHistoryDetailsDto,
  PayrollHistoryListItemDto,
} from '../dto/payroll-history.dto';
import { PayrollReportingMapper } from '../mappers/payroll-reporting.mapper';
import {
  PayrollReportingRepository,
  PeriodCurrencyAggregateRow,
} from '../repositories/payroll-reporting.repository';

@Injectable()
export class PayrollHistoryService {
  constructor(
    private readonly reportingRepository: PayrollReportingRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async listHistory(
    query: ListPayrollHistoryQueryDto,
  ): Promise<PaginatedResult<PayrollHistoryListItemDto>> {
    const page = Math.max(
      1,
      query.page ?? PAYROLL_REPORTING_CONSTANTS.DEFAULT_PAGE,
    );
    const limit = Math.min(
      PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT,
      Math.max(1, query.limit ?? PAYROLL_REPORTING_CONSTANTS.DEFAULT_LIMIT),
    );

    // Only FINALIZED payroll periods constitute completed payroll history
    if (
      query.status !== undefined &&
      query.status !== PayrollPeriodStatus.FINALIZED
    ) {
      return {
        data: [],
        meta: buildPaginationMeta(0, page, limit),
      };
    }

    const { data: periods, total } =
      await this.reportingRepository.findFinalizedPeriodsPaginated({
        page,
        limit,
        year: query.year,
        month: query.month,
        search: query.search,
      });

    const periodIds = periods.map((p) => p._id);
    const currencyTotals =
      await this.reportingRepository.aggregateTotalsByPeriodIds(periodIds);

    const byPeriodId = new Map<string, PeriodCurrencyAggregateRow[]>();
    for (const row of currencyTotals) {
      const key = row.payrollPeriodId.toHexString();
      const bucket = byPeriodId.get(key) ?? [];
      bucket.push(row);
      byPeriodId.set(key, bucket);
    }

    return {
      data: periods.map((period) =>
        PayrollReportingMapper.toHistoryListItem(
          period,
          byPeriodId.get(period._id.toHexString()) ?? [],
        ),
      ),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getPeriodHistoryDetails(
    periodId: Types.ObjectId,
  ): Promise<PayrollHistoryDetailsDto> {
    const period =
      await this.reportingRepository.findFinalizedPeriodById(periodId);
    if (!period) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Finalized payroll period history not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const stats =
      await this.reportingRepository.getPeriodBreakdownStats(periodId);

    return PayrollReportingMapper.toPeriodHistoryDetails(period, stats);
  }

  async listEmployeeHistory(
    employeeId: Types.ObjectId,
    query: ListEmployeePayrollHistoryQueryDto,
    actorUserId: Types.ObjectId,
    roleIds: Types.ObjectId[],
  ): Promise<PaginatedResult<EmployeePayrollHistoryItemDto>> {
    await this.authorizeEmployeeHistoryAccess(actorUserId, roleIds, employeeId);
    await this.requireActiveEmployee(employeeId);

    const page = Math.max(
      1,
      query.page ?? PAYROLL_REPORTING_CONSTANTS.DEFAULT_PAGE,
    );
    const limit = Math.min(
      PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT,
      Math.max(1, query.limit ?? PAYROLL_REPORTING_CONSTANTS.DEFAULT_LIMIT),
    );

    const { data, total } =
      await this.reportingRepository.findEmployeeFinalizedHistory(employeeId, {
        page,
        limit,
        year: query.year,
        month: query.month,
      });

    return {
      data: data.map((row) =>
        PayrollReportingMapper.toEmployeeHistoryItem(row),
      ),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getEmployeePeriodHistoryDetails(
    employeeId: Types.ObjectId,
    periodId: Types.ObjectId,
    actorUserId: Types.ObjectId,
    roleIds: Types.ObjectId[],
  ): Promise<EmployeePayrollHistoryDetailsDto> {
    await this.authorizeEmployeeHistoryAccess(actorUserId, roleIds, employeeId);
    await this.requireActiveEmployee(employeeId);

    const result =
      await this.reportingRepository.findEmployeeFinalizedRecordDetails(
        employeeId,
        periodId,
      );

    if (!result) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Finalized payroll record not found for the requested employee and payroll period.',
        HttpStatus.NOT_FOUND,
      );
    }

    return PayrollReportingMapper.toEmployeeHistoryDetails(result);
  }

  private async requireActiveEmployee(
    employeeId: Types.ObjectId,
  ): Promise<void> {
    const employee =
      await this.reportingRepository.findActiveEmployeeById(employeeId);
    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found.',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async authorizeEmployeeHistoryAccess(
    actorUserId: Types.ObjectId,
    roleIds: Types.ObjectId[],
    targetEmployeeId: Types.ObjectId,
  ): Promise<void> {
    const [hasOrgPermission, hasOwnPermission] = await Promise.all([
      this.authorizationService.hasPermissions(roleIds, [
        PermissionKeys.PAYROLL_HISTORY_VIEW,
      ]),
      this.authorizationService.hasPermissions(roleIds, [
        PermissionKeys.PAYROLL_HISTORY_VIEW_OWN,
      ]),
    ]);

    if (hasOrgPermission) {
      return;
    }

    if (hasOwnPermission) {
      const linkedEmployee =
        await this.employeeRepository.findByUserId(actorUserId);
      if (linkedEmployee && linkedEmployee._id.equals(targetEmployeeId)) {
        return;
      }
    }

    throw new AppError(
      ErrorCode.FORBIDDEN,
      'You are not authorized to access this employee payroll history.',
      HttpStatus.FORBIDDEN,
    );
  }
}
