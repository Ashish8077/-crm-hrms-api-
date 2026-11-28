import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Employee,
  EmployeeDocument,
} from '../../employees/schemas/employee.schema';
import {
  PayrollRecord,
  PayrollRecordDocument,
  PayrollRecordLean,
} from '../../payroll-calculations/schemas/payroll-record.schema';
import { PayrollRecordStatus } from '../../payroll-calculations/constants/payroll-calculation.constant';
import { PayrollPeriodStatus } from '../../payroll-periods/constants/payroll-period.constant';
import {
  PayrollPeriod,
  PayrollPeriodDocument,
  PayrollPeriodLean,
} from '../../payroll-periods/schemas/payroll-period.schema';
import {
  Payslip,
  PayslipDocument,
} from '../../payslips/schemas/payslip.schema';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { PAYROLL_REPORTING_CONSTANTS } from '../constants/payroll-reporting.constant';

export interface PeriodCurrencyAggregateRow {
  payrollPeriodId: Types.ObjectId;
  currency: string;
  precision: number;
  employeeCount: number;
  totalGrossEarnings: Types.Decimal128;
  totalDeductions: Types.Decimal128;
  totalEmployerContributions: Types.Decimal128;
  totalNetSalary: Types.Decimal128;
}

export interface MonthlySummaryAggregateRow {
  currency: string;
  precision: number;
  totalEmployees: number;
  totalRecords: number;
  totalGrossEarnings: Types.Decimal128;
  totalEmployeeDeductions: Types.Decimal128;
  totalNetSalary: Types.Decimal128;
  totalEmployerContributions: Types.Decimal128;
  totalLOPDays: number;
}

export interface DepartmentWiseAggregateRow {
  departmentId: Types.ObjectId | null;
  departmentName: string;
  currency: string;
  precision: number;
  employeeCount: number;
  recordCount: number;
  grossEarnings: Types.Decimal128;
  employeeDeductions: Types.Decimal128;
  netSalary: Types.Decimal128;
  employerContributions: Types.Decimal128;
}

export interface BranchWiseAggregateRow {
  branchId: Types.ObjectId | null;
  branchName: string;
  currency: string;
  precision: number;
  employeeCount: number;
  recordCount: number;
  grossEarnings: Types.Decimal128;
  deductions: Types.Decimal128;
  netSalary: Types.Decimal128;
  employerContributions: Types.Decimal128;
}

export interface EmployeeWiseAggregateRow {
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  departmentId: Types.ObjectId | null;
  departmentName: string;
  branchId: Types.ObjectId | null;
  branchName: string;
  currency: string;
  precision: number;
  periodCount: number;
  grossEarnings: Types.Decimal128;
  deductions: Types.Decimal128;
  netSalary: Types.Decimal128;
  employerContributions: Types.Decimal128;
  totalLOPDays: number;
}

export interface ComponentAggregateRow {
  componentId: string;
  componentCode: string;
  componentName: string;
  componentType: SalaryComponentType;
  currency: string;
  precision: number;
  totalAmount: Types.Decimal128;
  employeeCount: number;
  recordCount: number;
}

export interface EmployeeHistoryAggregateRow {
  payrollRecordId: Types.ObjectId;
  periodId: Types.ObjectId;
  periodCode: string;
  periodName: string;
  startDate: Date;
  endDate: Date;
  paymentDate: Date;
  month: number;
  year: number;
  grossEarnings: Types.Decimal128;
  totalDeductions: Types.Decimal128;
  employerContributions: Types.Decimal128;
  netSalary: Types.Decimal128;
  currency: string;
  roundingPrecision: number;
  payrollCalculationVersion: number;
  payslipAvailable: boolean;
}

@Injectable()
export class PayrollReportingRepository {
  constructor(
    @InjectModel(PayrollPeriod.name)
    private readonly periodModel: Model<PayrollPeriodDocument>,
    @InjectModel(PayrollRecord.name)
    private readonly recordModel: Model<PayrollRecordDocument>,
    @InjectModel(Payslip.name)
    private readonly payslipModel: Model<PayslipDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  async findFinalizedPeriodsPaginated(query: {
    page: number;
    limit: number;
    year?: number;
    month?: number;
    search?: string;
  }): Promise<{ data: PayrollPeriodLean[]; total: number }> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      status: PayrollPeriodStatus.FINALIZED,
    };

    if (query.year !== undefined) filter.year = query.year;
    if (query.month !== undefined) filter.month = query.month;
    if (query.search && query.search.trim().length > 0) {
      const escaped = query.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [{ periodCode: regex }, { periodName: regex }];
    }

    const safePage = Math.max(1, query.page);
    const safeLimit = Math.max(1, query.limit);
    const skip = (safePage - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.periodModel
        .find(filter)
        .sort({ startDate: -1, _id: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean<PayrollPeriodLean[]>()
        .exec(),
      this.periodModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async aggregateTotalsByPeriodIds(
    periodIds: Types.ObjectId[],
  ): Promise<PeriodCurrencyAggregateRow[]> {
    if (periodIds.length === 0) return [];

    return this.recordModel
      .aggregate<PeriodCurrencyAggregateRow>([
        {
          $match: {
            payrollPeriodId: { $in: periodIds },
            status: PayrollRecordStatus.APPROVED,
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: {
              payrollPeriodId: '$payrollPeriodId',
              currency: '$calculationSnapshot.currency',
            },
            precision: { $max: '$calculationSnapshot.roundingPrecision' },
            employeeCount: { $sum: 1 },
            totalGrossEarnings: { $sum: '$grossEarnings' },
            totalDeductions: { $sum: '$totalDeductions' },
            totalEmployerContributions: { $sum: '$employerContributions' },
            totalNetSalary: { $sum: '$netSalary' },
          },
        },
        {
          $project: {
            _id: 0,
            payrollPeriodId: '$_id.payrollPeriodId',
            currency: '$_id.currency',
            precision: { $ifNull: ['$precision', 2] },
            employeeCount: 1,
            totalGrossEarnings: 1,
            totalDeductions: 1,
            totalEmployerContributions: 1,
            totalNetSalary: 1,
          },
        },
      ])
      .exec();
  }

  async findFinalizedPeriodById(
    periodId: Types.ObjectId,
  ): Promise<PayrollPeriodLean | null> {
    return this.periodModel
      .findOne({
        _id: periodId,
        status: PayrollPeriodStatus.FINALIZED,
        deletedAt: null,
      })
      .lean<PayrollPeriodLean>()
      .exec();
  }

  async getPeriodBreakdownStats(periodId: Types.ObjectId): Promise<{
    currencyRows: PeriodCurrencyAggregateRow[];
    invalidatedCount: number;
    payslipCount: number;
  }> {
    const [currencyRows, invalidatedCount, payslipCount] = await Promise.all([
      this.aggregateTotalsByPeriodIds([periodId]),
      this.recordModel
        .countDocuments({
          payrollPeriodId: periodId,
          status: PayrollRecordStatus.INVALIDATED,
          deletedAt: null,
        })
        .exec(),
      this.payslipModel.countDocuments({ payrollPeriodId: periodId }).exec(),
    ]);

    return { currencyRows, invalidatedCount, payslipCount };
  }

  async findActiveEmployeeById(
    employeeId: Types.ObjectId,
  ): Promise<{ _id: Types.ObjectId } | null> {
    return this.employeeModel
      .findOne({ _id: employeeId, deletedAt: null })
      .select('_id')
      .lean<{ _id: Types.ObjectId }>()
      .exec();
  }

  async findEmployeeFinalizedHistory(
    employeeId: Types.ObjectId,
    query: {
      page: number;
      limit: number;
      year?: number;
      month?: number;
    },
  ): Promise<{ data: EmployeeHistoryAggregateRow[]; total: number }> {
    const safePage = Math.max(1, query.page);
    const safeLimit = Math.max(1, query.limit);
    const skip = (safePage - 1) * safeLimit;

    const periodMatch: Record<string, unknown> = {
      deletedAt: null,
      status: PayrollPeriodStatus.FINALIZED,
    };
    if (query.year !== undefined) periodMatch.year = query.year;
    if (query.month !== undefined) periodMatch.month = query.month;

    const pipeline: Record<string, unknown>[] = [
      {
        $match: {
          employeeId,
          status: PayrollRecordStatus.APPROVED,
          deletedAt: null,
        },
      },
      {
        $lookup: {
          from: 'payroll_periods',
          let: { pid: '$payrollPeriodId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$_id', '$$pid'] },
                ...periodMatch,
              },
            },
            {
              $project: {
                _id: 1,
                periodCode: 1,
                periodName: 1,
                startDate: 1,
                endDate: 1,
                paymentDate: 1,
                month: 1,
                year: 1,
              },
            },
          ],
          as: 'period',
        },
      },
      { $unwind: '$period' },
      {
        $lookup: {
          from: 'payslips',
          let: { pid: '$payrollPeriodId', eid: '$employeeId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$payrollPeriodId', '$$pid'] },
                    { $eq: ['$employeeId', '$$eid'] },
                  ],
                },
              },
            },
            { $project: { _id: 1 } },
            { $limit: 1 },
          ],
          as: 'payslipDocs',
        },
      },
      { $sort: { 'period.startDate': -1, _id: -1 } },
      {
        $facet: {
          total: [{ $count: 'count' }],
          data: [
            { $skip: skip },
            { $limit: safeLimit },
            {
              $project: {
                _id: 0,
                payrollRecordId: '$_id',
                periodId: '$period._id',
                periodCode: '$period.periodCode',
                periodName: '$period.periodName',
                startDate: '$period.startDate',
                endDate: '$period.endDate',
                paymentDate: '$period.paymentDate',
                month: '$period.month',
                year: '$period.year',
                grossEarnings: '$grossEarnings',
                totalDeductions: '$totalDeductions',
                employerContributions: '$employerContributions',
                netSalary: '$netSalary',
                currency: '$calculationSnapshot.currency',
                roundingPrecision: {
                  $ifNull: ['$calculationSnapshot.roundingPrecision', 2],
                },
                payrollCalculationVersion: '$calculationVersion',
                payslipAvailable: { $gt: [{ $size: '$payslipDocs' }, 0] },
              },
            },
          ],
        },
      },
    ];

    const [agg] = await this.recordModel
      .aggregate<{
        total: Array<{ count: number }>;
        data: EmployeeHistoryAggregateRow[];
      }>(pipeline as unknown as never[])
      .exec();

    return {
      data: agg?.data ?? [],
      total: agg?.total?.[0]?.count ?? 0,
    };
  }

  async findEmployeeFinalizedRecordDetails(
    employeeId: Types.ObjectId,
    periodId: Types.ObjectId,
  ): Promise<{
    period: PayrollPeriodLean;
    record: PayrollRecordLean;
    payslipAvailable: boolean;
  } | null> {
    const period = await this.findFinalizedPeriodById(periodId);
    if (!period) return null;

    const [record, payslipExists] = await Promise.all([
      this.recordModel
        .findOne({
          payrollPeriodId: periodId,
          employeeId,
          status: PayrollRecordStatus.APPROVED,
          deletedAt: null,
        })
        .lean<PayrollRecordLean>()
        .exec(),
      this.payslipModel.exists({
        payrollPeriodId: periodId,
        employeeId,
      }),
    ]);

    if (!record) return null;

    return {
      period,
      record,
      payslipAvailable: Boolean(payslipExists),
    };
  }

  async findFinalizedPeriodsForReport(
    year?: number,
    month?: number,
  ): Promise<PayrollPeriodLean[]> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      status: PayrollPeriodStatus.FINALIZED,
    };
    if (year !== undefined) filter.year = year;
    if (month !== undefined) filter.month = month;

    return this.periodModel
      .find(filter)
      .sort({ startDate: -1, _id: -1 })
      .lean<PayrollPeriodLean[]>()
      .exec();
  }

  async aggregateMonthlySummary(
    periodIds: Types.ObjectId[],
    filters?: {
      branchId?: Types.ObjectId;
      departmentId?: Types.ObjectId;
    },
  ): Promise<MonthlySummaryAggregateRow[]> {
    if (periodIds.length === 0) return [];

    const pipeline: Record<string, unknown>[] = [
      {
        $match: {
          payrollPeriodId: { $in: periodIds },
          status: PayrollRecordStatus.APPROVED,
          deletedAt: null,
        },
      },
    ];

    if (filters?.branchId || filters?.departmentId) {
      pipeline.push(
        {
          $lookup: {
            from: 'employees',
            localField: 'employeeId',
            foreignField: '_id',
            pipeline: [{ $project: { _id: 1, branchId: 1, departmentId: 1 } }],
            as: 'emp',
          },
        },
        { $unwind: { path: '$emp', preserveNullAndEmptyArrays: true } },
      );

      const empMatch: Record<string, unknown> = {};
      if (filters.branchId) empMatch['emp.branchId'] = filters.branchId;
      if (filters.departmentId)
        empMatch['emp.departmentId'] = filters.departmentId;
      pipeline.push({ $match: empMatch });
    }

    pipeline.push(
      {
        $group: {
          _id: '$calculationSnapshot.currency',
          precision: { $max: '$calculationSnapshot.roundingPrecision' },
          employeeIds: { $addToSet: '$employeeId' },
          totalRecords: { $sum: 1 },
          totalGrossEarnings: { $sum: '$grossEarnings' },
          totalEmployeeDeductions: { $sum: '$totalDeductions' },
          totalNetSalary: { $sum: '$netSalary' },
          totalEmployerContributions: { $sum: '$employerContributions' },
          totalLOPDays: {
            $sum: { $ifNull: ['$calculationSnapshot.totalLopDays', 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          currency: '$_id',
          precision: { $ifNull: ['$precision', 2] },
          totalEmployees: { $size: '$employeeIds' },
          totalRecords: 1,
          totalGrossEarnings: 1,
          totalEmployeeDeductions: 1,
          totalNetSalary: 1,
          totalEmployerContributions: 1,
          totalLOPDays: 1,
        },
      },
      { $sort: { currency: 1 } },
    );

    return this.recordModel
      .aggregate<MonthlySummaryAggregateRow>(pipeline as unknown as never[])
      .exec();
  }

  async aggregateDepartmentWise(
    periodIds: Types.ObjectId[],
    branchId?: Types.ObjectId,
  ): Promise<DepartmentWiseAggregateRow[]> {
    if (periodIds.length === 0) return [];

    const pipeline: Record<string, unknown>[] = [
      {
        $match: {
          payrollPeriodId: { $in: periodIds },
          status: PayrollRecordStatus.APPROVED,
          deletedAt: null,
        },
      },
      {
        $lookup: {
          from: 'employees',
          localField: 'employeeId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1, departmentId: 1, branchId: 1 } }],
          as: 'emp',
        },
      },
      { $unwind: { path: '$emp', preserveNullAndEmptyArrays: true } },
    ];

    if (branchId) {
      pipeline.push({ $match: { 'emp.branchId': branchId } });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'departments',
          localField: 'emp.departmentId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1, name: 1, deletedAt: 1 } }],
          as: 'dept',
        },
      },
      { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          resolvedDepartmentId: {
            $cond: [
              {
                $and: [
                  { $ne: ['$dept', null] },
                  { $eq: [{ $ifNull: ['$dept.deletedAt', null] }, null] },
                ],
              },
              '$dept._id',
              null,
            ],
          },
          resolvedDepartmentName: {
            $cond: [
              {
                $and: [
                  { $ne: ['$dept', null] },
                  { $eq: [{ $ifNull: ['$dept.deletedAt', null] }, null] },
                ],
              },
              '$dept.name',
              PAYROLL_REPORTING_CONSTANTS.UNASSIGNED_GROUP_LABEL,
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            departmentId: '$resolvedDepartmentId',
            departmentName: '$resolvedDepartmentName',
            currency: '$calculationSnapshot.currency',
          },
          precision: { $max: '$calculationSnapshot.roundingPrecision' },
          employeeIds: { $addToSet: '$employeeId' },
          recordCount: { $sum: 1 },
          grossEarnings: { $sum: '$grossEarnings' },
          employeeDeductions: { $sum: '$totalDeductions' },
          netSalary: { $sum: '$netSalary' },
          employerContributions: { $sum: '$employerContributions' },
        },
      },
      {
        $project: {
          _id: 0,
          departmentId: '$_id.departmentId',
          departmentName: '$_id.departmentName',
          currency: '$_id.currency',
          precision: { $ifNull: ['$precision', 2] },
          employeeCount: { $size: '$employeeIds' },
          recordCount: 1,
          grossEarnings: 1,
          employeeDeductions: 1,
          netSalary: 1,
          employerContributions: 1,
        },
      },
      { $sort: { departmentName: 1, currency: 1 } },
    );

    return this.recordModel
      .aggregate<DepartmentWiseAggregateRow>(pipeline as unknown as never[])
      .exec();
  }

  async aggregateBranchWise(
    periodIds: Types.ObjectId[],
  ): Promise<BranchWiseAggregateRow[]> {
    if (periodIds.length === 0) return [];

    const pipeline: Record<string, unknown>[] = [
      {
        $match: {
          payrollPeriodId: { $in: periodIds },
          status: PayrollRecordStatus.APPROVED,
          deletedAt: null,
        },
      },
      {
        $lookup: {
          from: 'employees',
          localField: 'employeeId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1, branchId: 1 } }],
          as: 'emp',
        },
      },
      { $unwind: { path: '$emp', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'branches',
          localField: 'emp.branchId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1, name: 1, deletedAt: 1 } }],
          as: 'branch',
        },
      },
      { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          resolvedBranchId: {
            $cond: [
              {
                $and: [
                  { $ne: ['$branch', null] },
                  { $eq: [{ $ifNull: ['$branch.deletedAt', null] }, null] },
                ],
              },
              '$branch._id',
              null,
            ],
          },
          resolvedBranchName: {
            $cond: [
              {
                $and: [
                  { $ne: ['$branch', null] },
                  { $eq: [{ $ifNull: ['$branch.deletedAt', null] }, null] },
                ],
              },
              '$branch.name',
              PAYROLL_REPORTING_CONSTANTS.UNASSIGNED_GROUP_LABEL,
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            branchId: '$resolvedBranchId',
            branchName: '$resolvedBranchName',
            currency: '$calculationSnapshot.currency',
          },
          precision: { $max: '$calculationSnapshot.roundingPrecision' },
          employeeIds: { $addToSet: '$employeeId' },
          recordCount: { $sum: 1 },
          grossEarnings: { $sum: '$grossEarnings' },
          deductions: { $sum: '$totalDeductions' },
          netSalary: { $sum: '$netSalary' },
          employerContributions: { $sum: '$employerContributions' },
        },
      },
      {
        $project: {
          _id: 0,
          branchId: '$_id.branchId',
          branchName: '$_id.branchName',
          currency: '$_id.currency',
          precision: { $ifNull: ['$precision', 2] },
          employeeCount: { $size: '$employeeIds' },
          recordCount: 1,
          grossEarnings: 1,
          deductions: 1,
          netSalary: 1,
          employerContributions: 1,
        },
      },
      { $sort: { branchName: 1, currency: 1 } },
    ];

    return this.recordModel
      .aggregate<BranchWiseAggregateRow>(pipeline as unknown as never[])
      .exec();
  }

  private buildEmployeeWisePipeline(
    periodIds: Types.ObjectId[],
    filters: {
      departmentId?: Types.ObjectId;
      branchId?: Types.ObjectId;
      search?: string;
    },
  ): Record<string, unknown>[] {
    const pipeline: Record<string, unknown>[] = [
      {
        $match: {
          payrollPeriodId: { $in: periodIds },
          status: PayrollRecordStatus.APPROVED,
          deletedAt: null,
        },
      },
      {
        $lookup: {
          from: 'employees',
          localField: 'employeeId',
          foreignField: '_id',
          pipeline: [
            {
              $project: {
                _id: 1,
                employeeCode: 1,
                firstName: 1,
                lastName: 1,
                departmentId: 1,
                branchId: 1,
              },
            },
          ],
          as: 'emp',
        },
      },
      { $unwind: { path: '$emp', preserveNullAndEmptyArrays: true } },
    ];

    const postMatch: Record<string, unknown> = {};
    if (filters.departmentId) {
      postMatch['emp.departmentId'] = filters.departmentId;
    }
    if (filters.branchId) {
      postMatch['emp.branchId'] = filters.branchId;
    }
    if (filters.search && filters.search.trim().length > 0) {
      const escaped = filters.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      postMatch.$or = [
        { 'calculationSnapshot.employeeCode': regex },
        { 'calculationSnapshot.employeeName': regex },
        { 'emp.employeeCode': regex },
        { 'emp.firstName': regex },
        { 'emp.lastName': regex },
      ];
    }
    if (Object.keys(postMatch).length > 0) {
      pipeline.push({ $match: postMatch });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'departments',
          localField: 'emp.departmentId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1, name: 1, deletedAt: 1 } }],
          as: 'dept',
        },
      },
      { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'branches',
          localField: 'emp.branchId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1, name: 1, deletedAt: 1 } }],
          as: 'branch',
        },
      },
      { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            employeeId: '$employeeId',
            currency: '$calculationSnapshot.currency',
          },
          employeeCode: { $last: '$calculationSnapshot.employeeCode' },
          employeeName: { $last: '$calculationSnapshot.employeeName' },
          departmentId: {
            $last: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$dept', null] },
                    { $eq: [{ $ifNull: ['$dept.deletedAt', null] }, null] },
                  ],
                },
                '$dept._id',
                null,
              ],
            },
          },
          departmentName: {
            $last: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$dept', null] },
                    { $eq: [{ $ifNull: ['$dept.deletedAt', null] }, null] },
                  ],
                },
                '$dept.name',
                PAYROLL_REPORTING_CONSTANTS.UNASSIGNED_GROUP_LABEL,
              ],
            },
          },
          branchId: {
            $last: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$branch', null] },
                    { $eq: [{ $ifNull: ['$branch.deletedAt', null] }, null] },
                  ],
                },
                '$branch._id',
                null,
              ],
            },
          },
          branchName: {
            $last: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$branch', null] },
                    { $eq: [{ $ifNull: ['$branch.deletedAt', null] }, null] },
                  ],
                },
                '$branch.name',
                PAYROLL_REPORTING_CONSTANTS.UNASSIGNED_GROUP_LABEL,
              ],
            },
          },
          precision: { $max: '$calculationSnapshot.roundingPrecision' },
          periodCount: { $sum: 1 },
          grossEarnings: { $sum: '$grossEarnings' },
          deductions: { $sum: '$totalDeductions' },
          netSalary: { $sum: '$netSalary' },
          employerContributions: { $sum: '$employerContributions' },
          totalLOPDays: {
            $sum: { $ifNull: ['$calculationSnapshot.totalLopDays', 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          employeeId: '$_id.employeeId',
          currency: '$_id.currency',
          employeeCode: 1,
          employeeName: 1,
          departmentId: 1,
          departmentName: 1,
          branchId: 1,
          branchName: 1,
          precision: { $ifNull: ['$precision', 2] },
          periodCount: 1,
          grossEarnings: 1,
          deductions: 1,
          netSalary: 1,
          employerContributions: 1,
          totalLOPDays: 1,
        },
      },
      { $sort: { employeeCode: 1, currency: 1 } },
    );

    return pipeline;
  }

  async aggregateEmployeeWise(
    periodIds: Types.ObjectId[],
    query: {
      departmentId?: Types.ObjectId;
      branchId?: Types.ObjectId;
      search?: string;
      page: number;
      limit: number;
    },
  ): Promise<{ data: EmployeeWiseAggregateRow[]; total: number }> {
    if (periodIds.length === 0) return { data: [], total: 0 };

    const safePage = Math.max(1, query.page);
    const safeLimit = Math.max(1, query.limit);
    const skip = (safePage - 1) * safeLimit;

    const pipeline = [
      ...this.buildEmployeeWisePipeline(periodIds, query),
      {
        $facet: {
          total: [{ $count: 'count' }],
          data: [{ $skip: skip }, { $limit: safeLimit }],
        },
      },
    ];

    const [agg] = await this.recordModel
      .aggregate<{
        total: Array<{ count: number }>;
        data: EmployeeWiseAggregateRow[];
      }>(pipeline as unknown as never[])
      .exec();

    return {
      data: agg?.data ?? [],
      total: agg?.total?.[0]?.count ?? 0,
    };
  }

  openEmployeeWiseCursor(
    periodIds: Types.ObjectId[],
    filters: {
      departmentId?: Types.ObjectId;
      branchId?: Types.ObjectId;
      search?: string;
    },
    maxRows: number = PAYROLL_REPORTING_CONSTANTS.MAX_EXPORT_ROWS,
  ): AsyncIterable<EmployeeWiseAggregateRow> {
    if (periodIds.length === 0) {
      return {
        async *[Symbol.asyncIterator]() {
          // Empty cursor when no finalized periods matched
        },
      };
    }

    const pipeline = [
      ...this.buildEmployeeWisePipeline(periodIds, filters),
      { $limit: maxRows },
    ];

    return this.recordModel
      .aggregate<EmployeeWiseAggregateRow>(pipeline as unknown as never[])
      .cursor({ batchSize: 200 });
  }

  async aggregateComponents(
    periodIds: Types.ObjectId[],
    componentType?: SalaryComponentType,
  ): Promise<ComponentAggregateRow[]> {
    if (periodIds.length === 0) return [];

    const pipeline: Record<string, unknown>[] = [
      {
        $match: {
          payrollPeriodId: { $in: periodIds },
          status: PayrollRecordStatus.APPROVED,
          deletedAt: null,
        },
      },
      {
        $project: {
          employeeId: 1,
          currency: '$calculationSnapshot.currency',
          roundingPrecision: {
            $ifNull: ['$calculationSnapshot.roundingPrecision', 2],
          },
          componentItems: {
            $concatArrays: [
              { $ifNull: ['$calculationSnapshot.earnings', []] },
              { $ifNull: ['$calculationSnapshot.deductions', []] },
              { $ifNull: ['$calculationSnapshot.employerContributions', []] },
            ],
          },
        },
      },
      { $unwind: '$componentItems' },
    ];

    if (componentType) {
      pipeline.push({
        $match: { 'componentItems.classification': componentType },
      });
    }

    pipeline.push(
      {
        $group: {
          _id: {
            componentId: '$componentItems.componentId',
            componentCode: '$componentItems.componentCode',
            componentName: '$componentItems.componentName',
            componentType: '$componentItems.classification',
            currency: '$currency',
          },
          precision: { $max: '$roundingPrecision' },
          totalAmount: { $sum: '$componentItems.finalAmount' },
          employeeIds: { $addToSet: '$employeeId' },
          recordCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          componentId: '$_id.componentId',
          componentCode: '$_id.componentCode',
          componentName: '$_id.componentName',
          componentType: '$_id.componentType',
          currency: '$_id.currency',
          precision: { $ifNull: ['$precision', 2] },
          totalAmount: 1,
          employeeCount: { $size: '$employeeIds' },
          recordCount: 1,
        },
      },
      { $sort: { componentType: 1, componentCode: 1, currency: 1 } },
    );

    return this.recordModel
      .aggregate<ComponentAggregateRow>(pipeline as unknown as never[])
      .exec();
  }
}
