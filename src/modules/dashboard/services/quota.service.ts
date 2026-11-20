import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, PipelineStage } from 'mongoose';
import { SalesQuotaRepository } from '../repositories/sales-quota.repository';
import { Deal, DealDocumentType } from '../../deals/schemas/deal.schema';
import { DealStatus } from '../../deals/constants/deal-status.constant';
import { DEFAULT_CURRENCY } from '../../deals/constants/deal.constant';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Employee, EmployeeDocument } from '../../employees/schemas/employee.schema';
import { DataScope } from '../types/data-scope.types';
import { SetQuotaDto } from '../dto/set-quota.dto';

@Injectable()
export class QuotaService {
  constructor(
    private readonly quotaRepository: SalesQuotaRepository,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocumentType>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  async setQuota(actorId: Types.ObjectId, dto: SetQuotaDto) {
    const targetUserId = new Types.ObjectId(dto.userId);
    return this.quotaRepository.upsertQuota(
      targetUserId,
      dto.year,
      dto.month ?? null,
      dto.currency || DEFAULT_CURRENCY,
      dto.quotaAmount,
      actorId,
    );
  }

  async getQuotaComparison(
    scope: DataScope,
    year: number,
    month?: number,
    currencyFilter?: string,
  ) {
    const currency = (currencyFilter || DEFAULT_CURRENCY).toUpperCase();

    // 1. Fetch quota records for all users in scope
    const quotas = await this.quotaRepository.findByUsersAndPeriod(
      scope.ownerIds,
      year,
      month ?? null,
      currency,
    );
    const quotaMap = new Map<string, number>();
    for (const q of quotas) {
      quotaMap.set(q.userId.toString(), q.quotaAmount);
    }

    // 2. Aggregate won revenue in period
    let startDate: Date;
    let endDate: Date;

    if (month) {
      startDate = new Date(Date.UTC(year, month - 1, 1));
      endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    } else {
      startDate = new Date(Date.UTC(year, 0, 1));
      endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    }

    const pipeline: PipelineStage[] = [
      {
        $match: {
          ownerId: { $in: scope.ownerIds },
          status: DealStatus.WON,
          currency,
          deletedAt: null,
          $or: [
            { actualCloseDate: { $gte: startDate, $lte: endDate } },
            {
              actualCloseDate: null,
              createdAt: { $gte: startDate, $lte: endDate },
            },
          ],
        },
      },
      {
        $group: {
          _id: '$ownerId',
          totalRevenue: { $sum: '$amount' },
        },
      },
    ];

    const revenueResults = await this.dealModel.aggregate(pipeline).exec();
    const revenueMap = new Map<string, number>(
      revenueResults.map((r) => [r._id.toString(), r.totalRevenue]),
    );

    // 3. Resolve user names
    const employees = await this.employeeModel
      .find({ userId: { $in: scope.ownerIds } })
      .select('userId firstName lastName workEmail')
      .lean()
      .exec();

    const nameMap = new Map<string, string>();
    for (const e of employees) {
      if (e.userId) {
        nameMap.set(e.userId.toString(), `${e.firstName} ${e.lastName}`.trim() || e.workEmail);
      }
    }

    // 4. Build quota records
    const quotaRecords = scope.ownerIds.map((userId) => {
      const uIdStr = userId.toString();
      const quotaAmount = quotaMap.get(uIdStr);
      const actualRevenue = Number((revenueMap.get(uIdStr) || 0).toFixed(2));
      const hasQuota = quotaAmount !== undefined && quotaAmount !== null;

      let attainmentPercent: number | null = null;
      if (hasQuota) {
        attainmentPercent = quotaAmount > 0 ? Number(((actualRevenue / quotaAmount) * 100).toFixed(2)) : 100;
      }

      return {
        userId: uIdStr,
        name: nameMap.get(uIdStr) || `User ${uIdStr.slice(-6)}`,
        quotaAmount: scope.canViewFinancial && hasQuota ? quotaAmount : null,
        actualRevenue: scope.canViewFinancial ? actualRevenue : null,
        attainmentPercent,
        quotaExists: hasQuota,
        note: hasQuota ? undefined : 'No quota assigned for this period',
      };
    });

    return {
      year,
      month: month ?? null,
      currency,
      financialDataHidden: !scope.canViewFinancial,
      quotaRecords,
    };
  }

  async getRepQuotaAttainment(
    userId: Types.ObjectId,
    year: number,
    month?: number,
    currency?: string,
  ) {
    const targetCurrency = (currency || DEFAULT_CURRENCY).toUpperCase();
    const quota = await this.quotaRepository.findByUserAndPeriod(
      userId,
      year,
      month ?? null,
      targetCurrency,
    );

    return {
      quotaAmount: quota ? quota.quotaAmount : null,
      quotaExists: !!quota,
    };
  }
}

