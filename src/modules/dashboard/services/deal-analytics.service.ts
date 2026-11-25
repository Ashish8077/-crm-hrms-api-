import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Deal, DealDocumentType } from '../../deals/schemas/deal.schema';
import { DealStage } from '../../deals/constants/deal-stage.constant';
import { DealStatus } from '../../deals/constants/deal-status.constant';
import { DEFAULT_CURRENCY } from '../../deals/constants/deal.constant';
import { DataScope } from '../types/data-scope.types';
import { PerformanceGranularity } from '../dto/performance-query.dto';

@Injectable()
export class DealAnalyticsService {
  constructor(
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocumentType>,
  ) {}

  private buildDateFilter(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return {};
    const dateFilter: Record<string, unknown> = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }
    return { createdAt: dateFilter };
  }

  async getDealKpiSummary(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
    currencyFilter?: string,
  ) {
    const matchFilter: Record<string, unknown> = {
      ownerId: { $in: scope.ownerIds },
      deletedAt: null,
      ...this.buildDateFilter(startDate, endDate),
    };

    if (currencyFilter) {
      matchFilter.currency = currencyFilter.toUpperCase();
    }

    const pipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $group: {
          _id: { status: '$status', currency: '$currency' },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          weightedAmount: {
            $sum: {
              $multiply: ['$amount', { $divide: ['$probability', 100] }],
            },
          },
          avgCycleDays: {
            $avg: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', DealStatus.WON] },
                    { $ne: ['$actualCloseDate', null] },
                  ],
                },
                {
                  $divide: [
                    { $subtract: ['$actualCloseDate', '$createdAt'] },
                    1000 * 60 * 60 * 24,
                  ],
                },
                null,
              ],
            },
          },
        },
      },
    ];

    const results = await this.dealModel
      .aggregate<{
        _id: { status: DealStatus; currency?: string | null };
        count: number;
        totalAmount: number;
        weightedAmount: number;
        avgCycleDays: number | null;
      }>(pipeline)
      .exec();

    let totalDeals = 0;
    let openDeals = 0;
    let wonDeals = 0;
    let lostDeals = 0;
    let cycleDaysSum = 0;
    let cycleDaysCount = 0;

    const totalRevenue: Record<string, number> = {};
    const avgDealSize: Record<string, number> = {};
    const pipelineValue: Record<string, number> = {};
    const wonCountByCurrency: Record<string, number> = {};

    for (const r of results) {
      const status = r._id.status;
      const curr = r._id.currency || DEFAULT_CURRENCY;
      const count = r.count;
      totalDeals += count;

      if (status === DealStatus.OPEN) {
        openDeals += count;
        pipelineValue[curr] = Number(
          ((pipelineValue[curr] || 0) + r.weightedAmount).toFixed(2),
        );
      } else if (status === DealStatus.WON) {
        wonDeals += count;
        totalRevenue[curr] = Number(
          ((totalRevenue[curr] || 0) + r.totalAmount).toFixed(2),
        );
        wonCountByCurrency[curr] = (wonCountByCurrency[curr] || 0) + count;
        if (r.avgCycleDays !== null && r.avgCycleDays !== undefined) {
          cycleDaysSum += r.avgCycleDays * count;
          cycleDaysCount += count;
        }
      } else if (status === DealStatus.LOST) {
        lostDeals += count;
      }
    }

    for (const curr of Object.keys(totalRevenue)) {
      const wonCnt = wonCountByCurrency[curr] || 1;
      avgDealSize[curr] = Number((totalRevenue[curr] / wonCnt).toFixed(2));
    }

    const closedDeals = wonDeals + lostDeals;
    const winRate =
      closedDeals > 0 ? Number(((wonDeals / closedDeals) * 100).toFixed(2)) : 0;
    const avgSalesCycleDays =
      cycleDaysCount > 0 ? Math.round(cycleDaysSum / cycleDaysCount) : 0;

    return {
      dealMetrics: {
        totalDeals,
        openDeals,
        wonDeals,
        lostDeals,
        winRate,
        avgSalesCycleDays,
      },
      financialMetrics: scope.canViewFinancial
        ? {
            totalRevenue,
            avgDealSize,
            pipelineValue,
          }
        : null,
      financialDataHidden: !scope.canViewFinancial,
    };
  }

  async getDealPipeline(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
    currencyFilter?: string,
  ) {
    const matchFilter: Record<string, unknown> = {
      ownerId: { $in: scope.ownerIds },
      deletedAt: null,
      ...this.buildDateFilter(startDate, endDate),
    };

    if (currencyFilter) {
      matchFilter.currency = currencyFilter.toUpperCase();
    }

    const pipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $group: {
          _id: { stage: '$stage', currency: '$currency' },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgProbability: { $avg: '$probability' },
        },
      },
    ];

    const results = await this.dealModel
      .aggregate<{
        _id: { stage: string; currency?: string | null };
        count: number;
        totalAmount: number;
        avgProbability: number;
      }>(pipeline)
      .exec();

    const stageMap = new Map<
      string,
      {
        count: number;
        totalAmountByCurrency: Record<string, number>;
        avgProb: number;
        probWeight: number;
      }
    >();

    for (const r of results) {
      const stage = r._id.stage;
      const curr = r._id.currency || DEFAULT_CURRENCY;
      if (!stageMap.has(stage)) {
        stageMap.set(stage, {
          count: 0,
          totalAmountByCurrency: {},
          avgProb: 0,
          probWeight: 0,
        });
      }
      const entry = stageMap.get(stage)!;
      entry.count += r.count;
      entry.totalAmountByCurrency[curr] = Number(
        (
          (entry.totalAmountByCurrency[curr] || 0) +
          (scope.canViewFinancial ? r.totalAmount : 0)
        ).toFixed(2),
      );
      entry.probWeight += r.avgProbability * r.count;
    }

    const allStages = Object.values(DealStage);
    const stages = allStages.map((stage) => {
      const entry = stageMap.get(stage);
      const count = entry?.count || 0;
      const avgProbability =
        count > 0 ? Math.round(entry!.probWeight / count) : 0;
      return {
        stage,
        count,
        totalAmountByCurrency: entry?.totalAmountByCurrency || {},
        avgProbability,
      };
    });

    return {
      stages,
      financialDataHidden: !scope.canViewFinancial,
      currency: currencyFilter || DEFAULT_CURRENCY,
    };
  }

  async getPerformanceTrends(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
    granularity: PerformanceGranularity = PerformanceGranularity.MONTH,
    currencyFilter?: string,
  ) {
    const matchFilter: Record<string, unknown> = {
      ownerId: { $in: scope.ownerIds },
      deletedAt: null,
      ...this.buildDateFilter(startDate, endDate),
    };

    if (currencyFilter) {
      matchFilter.currency = currencyFilter.toUpperCase();
    }

    let dateProjection: Record<string, unknown>;
    switch (granularity) {
      case PerformanceGranularity.DAY:
        dateProjection = {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        };
        break;
      case PerformanceGranularity.WEEK:
        dateProjection = {
          $dateToString: { format: '%Y-W%V', date: '$createdAt' },
        };
        break;
      case PerformanceGranularity.QUARTER:
        dateProjection = {
          $concat: [
            { $dateToString: { format: '%Y-Q', date: '$createdAt' } },
            {
              $toString: {
                $ceil: { $divide: [{ $month: '$createdAt' }, 3] },
              },
            },
          ],
        };
        break;
      case PerformanceGranularity.MONTH:
      default:
        dateProjection = {
          $dateToString: { format: '%Y-%m', date: '$createdAt' },
        };
        break;
    }

    const pipeline: PipelineStage[] = [
      { $match: matchFilter },
      {
        $project: {
          period: dateProjection,
          status: 1,
          amount: 1,
          currency: 1,
        },
      },
      {
        $group: {
          _id: '$period',
          dealsCreated: { $sum: 1 },
          dealsWon: {
            $sum: { $cond: [{ $eq: ['$status', DealStatus.WON] }, 1, 0] },
          },
          dealsClosed: {
            $sum: {
              $cond: [
                { $in: ['$status', [DealStatus.WON, DealStatus.LOST]] },
                1,
                0,
              ],
            },
          },
          revenueWon: {
            $sum: {
              $cond: [{ $eq: ['$status', DealStatus.WON] }, '$amount', 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const results = await this.dealModel
      .aggregate<{
        _id: string;
        dealsCreated: number;
        dealsWon: number;
        dealsClosed: number;
        revenueWon: number;
      }>(pipeline)
      .exec();

    let totalRevenueWon = 0;
    let peakPeriod = '';
    let peakPeriodRevenue = 0;

    const trends = results.map((r) => {
      const revenue = scope.canViewFinancial
        ? Number(r.revenueWon.toFixed(2))
        : 0;
      totalRevenueWon += revenue;
      if (revenue > peakPeriodRevenue) {
        peakPeriodRevenue = revenue;
        peakPeriod = r._id;
      }

      return {
        period: r._id,
        dealsCreated: r.dealsCreated,
        dealsWon: r.dealsWon,
        dealsClosed: r.dealsClosed,
        revenueWon: revenue,
      };
    });

    const avgRevenue =
      trends.length > 0
        ? Number((totalRevenueWon / trends.length).toFixed(2))
        : 0;

    return {
      granularity,
      currency: currencyFilter || DEFAULT_CURRENCY,
      financialDataHidden: !scope.canViewFinancial,
      trends,
      summary: {
        totalRevenueWon: Number(totalRevenueWon.toFixed(2)),
        avgPeriodRevenue: avgRevenue,
        peakPeriod,
        peakPeriodRevenue: Number(peakPeriodRevenue.toFixed(2)),
      },
    };
  }

  async getForecast(
    scope: DataScope,
    year?: number,
    quarter?: number,
    currencyFilter?: string,
  ) {
    const targetYear = year || new Date().getFullYear();
    const targetQuarter = quarter || Math.ceil((new Date().getMonth() + 1) / 3);

    const qStartMonth = (targetQuarter - 1) * 3;
    const qEndMonth = qStartMonth + 3;

    const quarterStartDate = new Date(Date.UTC(targetYear, qStartMonth, 1));
    const quarterEndDate = new Date(
      Date.UTC(targetYear, qEndMonth, 0, 23, 59, 59, 999),
    );

    const matchFilter: Record<string, unknown> = {
      ownerId: { $in: scope.ownerIds },
      deletedAt: null,
      status: DealStatus.OPEN,
    };

    if (currencyFilter) {
      matchFilter.currency = currencyFilter.toUpperCase();
    }

    const openDeals = await this.dealModel
      .find(matchFilter)
      .select(
        'title amount currency probability expectedCloseDate stage updatedAt',
      )
      .lean()
      .exec();

    let pipelineValue = 0;
    let weightedForecast = 0;
    let closingThisQuarterCount = 0;
    let closingThisQuarterAmount = 0;
    let closingThisQuarterWeighted = 0;

    const now = Date.now();
    const atRiskDeals: Array<{
      dealId: string;
      name: string;
      expectedCloseDate: string | null;
      daysStalled: number;
      amount: number;
      stage: string;
    }> = [];

    for (const deal of openDeals) {
      const amt = scope.canViewFinancial ? deal.amount : 0;
      const prob = deal.probability || 10;
      pipelineValue += amt;
      weightedForecast += (amt * prob) / 100;

      if (deal.expectedCloseDate) {
        const closeDate = new Date(deal.expectedCloseDate);
        if (closeDate >= quarterStartDate && closeDate <= quarterEndDate) {
          closingThisQuarterCount++;
          closingThisQuarterAmount += amt;
          closingThisQuarterWeighted += (amt * prob) / 100;
        }

        // Stalled detection: expectedCloseDate in past OR updatedAt > 14 days ago in early stage
        const updatedDate = deal.updatedAt
          ? new Date(deal.updatedAt)
          : new Date();
        const daysStalled = Math.max(
          0,
          Math.floor((now - updatedDate.getTime()) / (1000 * 60 * 60 * 24)),
        );

        if (closeDate < new Date() || daysStalled >= 14) {
          atRiskDeals.push({
            dealId: deal._id.toString(),
            name: deal.title,
            expectedCloseDate: deal.expectedCloseDate
              ? deal.expectedCloseDate.toISOString().slice(0, 10)
              : null,
            daysStalled,
            amount: amt,
            stage: deal.stage,
          });
        }
      }
    }

    // Confidence heuristic
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    if (atRiskDeals.length > openDeals.length * 0.4) {
      confidence = 'LOW';
    } else if (
      weightedForecast > 0 &&
      atRiskDeals.length <= openDeals.length * 0.15
    ) {
      confidence = 'HIGH';
    }

    return {
      forecastPeriod: `Q${targetQuarter}-${targetYear}`,
      currency: currencyFilter || DEFAULT_CURRENCY,
      financialDataHidden: !scope.canViewFinancial,
      pipelineValue: Number(pipelineValue.toFixed(2)),
      weightedForecast: Number(weightedForecast.toFixed(2)),
      closingThisQuarter: {
        count: closingThisQuarterCount,
        pipelineAmount: Number(closingThisQuarterAmount.toFixed(2)),
        weightedAmount: Number(closingThisQuarterWeighted.toFixed(2)),
      },
      atRiskDeals: atRiskDeals.slice(0, 10),
      confidence,
      confidenceNote: `Calculated from ${openDeals.length} active open opportunities across scope.`,
    };
  }

  async getDealsClosingThisWeekCount(scope: DataScope): Promise<number> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    return this.dealModel
      .countDocuments({
        ownerId: { $in: scope.ownerIds },
        status: DealStatus.OPEN,
        deletedAt: null,
        expectedCloseDate: { $gte: today, $lte: nextWeek },
      })
      .exec();
  }

  async getDealsByOwnerForLeaderboard(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
  ) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ownerId: { $in: scope.ownerIds },
          status: DealStatus.WON,
          deletedAt: null,
          ...this.buildDateFilter(startDate, endDate),
        },
      },
      {
        $group: {
          _id: '$ownerId',
          dealsWon: { $sum: 1 },
          revenueGenerated: { $sum: '$amount' },
        },
      },
    ];

    const results = await this.dealModel
      .aggregate<{
        _id: Types.ObjectId;
        dealsWon: number;
        revenueGenerated: number;
      }>(pipeline)
      .exec();
    return new Map<string, { dealsWon: number; revenueGenerated: number }>(
      results.map((r) => [
        r._id.toString(),
        { dealsWon: r.dealsWon, revenueGenerated: r.revenueGenerated },
      ]),
    );
  }

  async getWonDealsByOwnerForRep(ownerId: Types.ObjectId) {
    const deals = await this.dealModel
      .find({
        ownerId,
        deletedAt: null,
      })
      .select('status amount currency')
      .lean()
      .exec();

    let total = 0;
    let won = 0;
    let lost = 0;
    let open = 0;
    let wonRevenue = 0;
    let currency = DEFAULT_CURRENCY;

    for (const d of deals) {
      total++;
      if (d.status === DealStatus.WON) {
        won++;
        wonRevenue += d.amount;
        if (d.currency) currency = d.currency;
      } else if (d.status === DealStatus.LOST) {
        lost++;
      } else {
        open++;
      }
    }

    return {
      total,
      won,
      lost,
      open,
      wonRevenue: Number(wonRevenue.toFixed(2)),
      currency,
    };
  }
}
