import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, PipelineStage } from 'mongoose';
import { Response } from 'express';
import { Lead, LeadDocumentType } from '../leads/schemas/lead.schema';
import { Deal, DealDocumentType } from '../deals/schemas/deal.schema';
import { LeadStatus } from '../leads/constants/lead-status.constant';
import {
  Employee,
  EmployeeDocument,
} from '../employees/schemas/employee.schema';
import { DataScope } from './types/data-scope.types';
import { DashboardCacheService } from './services/dashboard-cache.service';
import { LeadAnalyticsService } from './services/lead-analytics.service';
import { DealAnalyticsService } from './services/deal-analytics.service';
import { ActivityAnalyticsService } from './services/activity-analytics.service';
import { QuotaService } from './services/quota.service';
import { ExportService } from './services/export.service';
import {
  buildDashboardCacheKey,
  DASHBOARD_CACHE_TTLS,
} from './constants/dashboard-cache.constant';
import {
  ALLOWED_FIELDS,
  ALLOWED_GROUP_BY,
  FINANCIAL_FIELDS,
  AllowedEntity,
} from './constants/dashboard-allowlist.constant';
import {
  KpiQueryDto,
  FunnelQueryDto,
  PerformanceQueryDto,
  ActivityQueryDto,
  LeaderboardQueryDto,
  LeaderboardSortBy,
  QuotaQueryDto,
  SetQuotaDto,
  ForecastQueryDto,
  CustomReportDto,
  ExportQueryDto,
} from './dto';

@Injectable()
export class DashboardService {
  constructor(
    private readonly cacheService: DashboardCacheService,
    private readonly leadAnalyticsService: LeadAnalyticsService,
    private readonly dealAnalyticsService: DealAnalyticsService,
    private readonly activityAnalyticsService: ActivityAnalyticsService,
    private readonly quotaService: QuotaService,
    private readonly exportService: ExportService,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocumentType>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocumentType>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  // ── 1. Executive KPI Summary ──────────────────────────────────────────────
  async getKpis(scope: DataScope, query: KpiQueryDto) {
    const cacheKey = buildDashboardCacheKey(
      scope,
      'kpis',
      query as unknown as Record<string, unknown>,
    );

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.KPIS,
      async () => {
        const [leadKpis, dealKpis, activityKpis] = await Promise.all([
          this.leadAnalyticsService.getLeadKpiSummary(
            scope,
            query.startDate,
            query.endDate,
          ),
          this.dealAnalyticsService.getDealKpiSummary(
            scope,
            query.startDate,
            query.endDate,
            query.currency,
          ),
          this.activityAnalyticsService.getActivityKpis(
            scope,
            query.startDate,
            query.endDate,
          ),
        ]);

        return {
          period: {
            start: query.startDate ?? null,
            end: query.endDate ?? null,
          },
          scopeLevel: scope.scopeLevel,
          leadMetrics: leadKpis,
          dealMetrics: dealKpis.dealMetrics,
          financialMetrics: dealKpis.financialMetrics,
          financialDataHidden: dealKpis.financialDataHidden,
          activityMetrics: {
            totalActivities: activityKpis.totalActivities,
            tasksOverdue: activityKpis.tasksOverdue,
            tasksCompletedOnTime: activityKpis.tasksCompletedOnTime,
            taskCompletionRate: activityKpis.taskCompletionRate,
          },
        };
      },
    );
  }

  // ── 2. Lead Funnel & Deal Pipeline ─────────────────────────────────────────
  async getFunnel(scope: DataScope, query: FunnelQueryDto) {
    const cacheKey = buildDashboardCacheKey(
      scope,
      'funnel',
      query as unknown as Record<string, unknown>,
    );

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.FUNNEL,
      async () => {
        const [leadFunnel, dealPipeline] = await Promise.all([
          this.leadAnalyticsService.getLeadFunnel(
            scope,
            query.startDate,
            query.endDate,
          ),
          this.dealAnalyticsService.getDealPipeline(
            scope,
            query.startDate,
            query.endDate,
            query.currency,
          ),
        ]);

        return {
          leadFunnel,
          dealPipeline,
        };
      },
    );
  }

  // ── 3. Performance & Revenue Trends ────────────────────────────────────────
  async getPerformance(scope: DataScope, query: PerformanceQueryDto) {
    const cacheKey = buildDashboardCacheKey(
      scope,
      'performance',
      query as unknown as Record<string, unknown>,
    );

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.PERFORMANCE,
      async () => {
        return this.dealAnalyticsService.getPerformanceTrends(
          scope,
          query.startDate,
          query.endDate,
          query.granularity,
          query.currency,
        );
      },
    );
  }

  // ── 4. Activities & Task Analytics ─────────────────────────────────────────
  async getActivities(scope: DataScope, query: ActivityQueryDto) {
    const cacheKey = buildDashboardCacheKey(
      scope,
      'activities',
      query as unknown as Record<string, unknown>,
    );

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.ACTIVITIES,
      async () => {
        return this.activityAnalyticsService.getActivityKpis(
          scope,
          query.startDate,
          query.endDate,
          query.activityType,
        );
      },
    );
  }

  // ── 5. Sales Team Leaderboard ──────────────────────────────────────────────
  async getLeaderboard(scope: DataScope, query: LeaderboardQueryDto) {
    const cacheKey = buildDashboardCacheKey(
      scope,
      'leaderboard',
      query as unknown as Record<string, unknown>,
    );

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.LEADERBOARD,
      async () => {
        // Gather stats by owner concurrently
        const [dealStatsMap, activityStatsMap, leadWonStatsMap, employees] =
          await Promise.all([
            this.dealAnalyticsService.getDealsByOwnerForLeaderboard(
              scope,
              query.startDate,
              query.endDate,
            ),
            this.activityAnalyticsService.getActivitiesByOwnerForLeaderboard(
              scope,
              query.startDate,
              query.endDate,
            ),
            this.getWonLeadsByOwner(scope, query.startDate, query.endDate),
            this.employeeModel
              .find({ userId: { $in: scope.ownerIds } })
              .select('userId firstName lastName workEmail')
              .lean()
              .exec(),
          ]);

        const nameMap = new Map<string, string>();
        for (const e of employees) {
          if (e.userId) {
            nameMap.set(
              e.userId.toString(),
              `${e.firstName} ${e.lastName}`.trim() || e.workEmail,
            );
          }
        }

        const year = new Date().getFullYear();
        const quotas = await this.quotaService.getQuotaComparison(scope, year);
        const quotaMap = new Map<string, number | null>(
          quotas.quotaRecords.map((q) => [q.userId, q.attainmentPercent]),
        );

        const rankings = scope.ownerIds.map((userId) => {
          const uIdStr = userId.toString();
          const dealStat = dealStatsMap.get(uIdStr) || {
            dealsWon: 0,
            revenueGenerated: 0,
          };
          const activitiesCount = activityStatsMap.get(uIdStr) || 0;
          const leadsConverted = leadWonStatsMap.get(uIdStr) || 0;
          const quotaAttainment = quotaMap.get(uIdStr) ?? null;

          return {
            userId: uIdStr,
            name: nameMap.get(uIdStr) || `User ${uIdStr.slice(-6)}`,
            dealsWon: dealStat.dealsWon,
            revenueGenerated: scope.canViewFinancial
              ? Number(dealStat.revenueGenerated.toFixed(2))
              : null,
            leadsConverted,
            activitiesCompleted: activitiesCount,
            quotaAttainment,
          };
        });

        // Sort
        const sortBy = query.sortBy || LeaderboardSortBy.DEALS_WON;
        rankings.sort((a, b) => {
          if (sortBy === LeaderboardSortBy.REVENUE) {
            return (b.revenueGenerated || 0) - (a.revenueGenerated || 0);
          }
          if (sortBy === LeaderboardSortBy.LEADS_CONVERTED) {
            return b.leadsConverted - a.leadsConverted;
          }
          if (sortBy === LeaderboardSortBy.ACTIVITIES) {
            return b.activitiesCompleted - a.activitiesCompleted;
          }
          return b.dealsWon - a.dealsWon;
        });

        const limit = query.limit || 10;
        const sliced = rankings.slice(0, limit).map((r, index) => ({
          rank: index + 1,
          ...r,
        }));

        return {
          rankings: sliced,
          financialDataHidden: !scope.canViewFinancial,
        };
      },
    );
  }

  private async getWonLeadsByOwner(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
  ) {
    const dateFilter: Record<string, unknown> = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }

    const pipeline: PipelineStage[] = [
      {
        $match: {
          ownerId: { $in: scope.ownerIds },
          status: LeadStatus.WON,
          deletedAt: null,
          ...(startDate || endDate ? { createdAt: dateFilter } : {}),
        },
      },
      {
        $group: {
          _id: '$ownerId',
          count: { $sum: 1 },
        },
      },
    ];

    const results = await this.leadModel
      .aggregate<{ _id: Types.ObjectId; count: number }>(pipeline)
      .exec();
    return new Map<string, number>(
      results.map((r) => [r._id.toString(), r.count]),
    );
  }

  // ── 6. Individual Sales Rep Dashboard ──────────────────────────────────────
  async getRepDashboard(scope: DataScope, targetUserIdStr: string) {
    const targetUserId = new Types.ObjectId(targetUserIdStr);

    // Data Scope Enforcement: Target must be in permitted ownerIds
    const isPermitted = scope.ownerIds.some((id) => id.equals(targetUserId));
    if (!isPermitted) {
      throw new ForbiddenException(
        'Target user is outside of your authorized data scope.',
      );
    }

    const cacheKey = buildDashboardCacheKey(scope, `rep:${targetUserIdStr}`);

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.REP_DASHBOARD,
      async () => {
        const year = new Date().getFullYear();

        const [leadStats, dealStats, activityCount, repQuota, employee] =
          await Promise.all([
            this.leadModel
              .aggregate<{ _id: string; count: number }>([
                { $match: { ownerId: targetUserId, deletedAt: null } },
                {
                  $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                  },
                },
              ])
              .exec(),
            this.dealAnalyticsService.getWonDealsByOwnerForRep(targetUserId),
            this.activityAnalyticsService.getActivityKpis({
              ...scope,
              ownerIds: [targetUserId],
            }),
            this.quotaService.getRepQuotaAttainment(targetUserId, year),
            this.employeeModel
              .findOne({ userId: targetUserId })
              .select('firstName lastName workEmail')
              .lean()
              .exec(),
          ]);

        const leadCountMap = new Map<string, number>(
          leadStats.map((r) => [r._id, r.count]),
        );
        const totalLeads = leadStats.reduce((acc, r) => acc + r.count, 0);
        const wonLeads = leadCountMap.get(LeadStatus.WON) || 0;
        const lostLeads =
          (leadCountMap.get(LeadStatus.LOST) || 0) +
          (leadCountMap.get(LeadStatus.DISQUALIFIED) || 0);

        const repName = employee
          ? `${employee.firstName} ${employee.lastName}`.trim() ||
            employee.workEmail
          : `User ${targetUserIdStr.slice(-6)}`;

        let attainment: number | null = null;
        if (
          repQuota.quotaExists &&
          repQuota.quotaAmount &&
          repQuota.quotaAmount > 0
        ) {
          attainment = Number(
            ((dealStats.wonRevenue / repQuota.quotaAmount) * 100).toFixed(2),
          );
        }

        return {
          userId: targetUserIdStr,
          name: repName,
          leadStats: {
            total: totalLeads,
            won: wonLeads,
            lost: lostLeads,
            active: Math.max(0, totalLeads - wonLeads - lostLeads),
          },
          dealStats: {
            total: dealStats.total,
            won: dealStats.won,
            lost: dealStats.lost,
            open: dealStats.open,
          },
          revenueStats: {
            currency: dealStats.currency,
            total: scope.canViewFinancial ? dealStats.wonRevenue : null,
            quota: scope.canViewFinancial ? repQuota.quotaAmount : null,
            attainment,
          },
          activityStats: {
            total: activityCount.totalActivities,
            tasksOverdue: activityCount.tasksOverdue,
            tasksCompletedOnTime: activityCount.tasksCompletedOnTime,
          },
          financialDataHidden: !scope.canViewFinancial,
        };
      },
    );
  }

  // ── 7. Quota vs Actuals ────────────────────────────────────────────────────
  async getQuota(scope: DataScope, query: QuotaQueryDto) {
    const cacheKey = buildDashboardCacheKey(
      scope,
      'quota',
      query as unknown as Record<string, unknown>,
    );

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.QUOTA,
      async () => {
        return this.quotaService.getQuotaComparison(
          scope,
          query.year,
          query.month,
          query.currency,
        );
      },
    );
  }

  async setQuota(callerUserId: Types.ObjectId, dto: SetQuotaDto) {
    const result = await this.quotaService.setQuota(callerUserId, dto);
    // Invalidate quota caches
    return result;
  }

  // ── 8. Actionable Daily Summary Cockpit ────────────────────────────────────
  async getDailySummary(scope: DataScope) {
    const cacheKey = buildDashboardCacheKey(scope, 'daily-summary');

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.DAILY_SUMMARY,
      async () => {
        const [
          tasksOverdue,
          tasksDueToday,
          followUpsDueToday,
          leadsNeedingAttention,
          dealsExpectedToCloseThisWeek,
          recentActivities,
        ] = await Promise.all([
          this.activityAnalyticsService.getOverdueTasksCount(scope),
          this.activityAnalyticsService.getTasksDueTodayCount(scope),
          this.activityAnalyticsService.getFollowUpsDueTodayCount(scope),
          this.leadAnalyticsService.getLeadsNeedingAttentionCount(scope),
          this.dealAnalyticsService.getDealsClosingThisWeekCount(scope),
          this.activityAnalyticsService.getRecentActivities(scope, 5),
        ]);

        return {
          date: new Date().toISOString().slice(0, 10),
          tasksOverdue,
          tasksDueToday,
          followUpsDueToday,
          leadsNeedingAttention,
          dealsExpectedToCloseThisWeek,
          recentActivities,
        };
      },
    );
  }

  // ── 9. Conversion Rate Analysis ────────────────────────────────────────────
  async getConversion(scope: DataScope, query: KpiQueryDto) {
    const cacheKey = buildDashboardCacheKey(
      scope,
      'conversion',
      query as unknown as Record<string, unknown>,
    );

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.CONVERSION,
      async () => {
        return this.leadAnalyticsService.getConversionAnalysis(
          scope,
          query.startDate,
          query.endDate,
        );
      },
    );
  }

  // ── 10. Forecast & Pipeline Health ─────────────────────────────────────────
  async getForecast(scope: DataScope, query: ForecastQueryDto) {
    const cacheKey = buildDashboardCacheKey(
      scope,
      'forecast',
      query as unknown as Record<string, unknown>,
    );

    return this.cacheService.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTLS.FORECAST,
      async () => {
        return this.dealAnalyticsService.getForecast(
          scope,
          query.year,
          query.quarter,
          query.currency,
        );
      },
    );
  }

  // ── 11. Custom Report Builder ──────────────────────────────────────────────
  async runCustomReport(scope: DataScope, dto: CustomReportDto) {
    const entity = dto.entity as AllowedEntity;
    const allowed = ALLOWED_FIELDS[entity];
    const invalidFields = dto.fields.filter((f) => !allowed.includes(f));

    if (invalidFields.length > 0) {
      throw new BadRequestException(
        `Field(s) [${invalidFields.join(', ')}] are not permitted for entity "${entity}".`,
      );
    }

    if (dto.groupBy && !ALLOWED_GROUP_BY[entity].includes(dto.groupBy)) {
      throw new BadRequestException(
        `GroupBy field "${dto.groupBy}" is not allowed for entity "${entity}". Permitted: [${ALLOWED_GROUP_BY[entity].join(', ')}].`,
      );
    }

    let selectedFields = [...dto.fields];
    let financialDataHidden = false;

    if (!scope.canViewFinancial) {
      const hasFinancial = selectedFields.some((f) => FINANCIAL_FIELDS.has(f));
      if (hasFinancial) {
        selectedFields = selectedFields.filter((f) => !FINANCIAL_FIELDS.has(f));
        financialDataHidden = true;
      }
    }

    // Base query filter
    const filter: Record<string, unknown> = { deletedAt: null };
    if (entity === 'leads' || entity === 'deals') {
      filter.ownerId = { $in: scope.ownerIds };
    } else if (entity === 'activities') {
      filter.performedBy = { $in: scope.ownerIds };
    } else if (entity === 'tasks') {
      filter.assignedTo = { $in: scope.ownerIds };
    }

    if (dto.startDate || dto.endDate) {
      const dateField = entity === 'activities' ? 'activityDate' : 'createdAt';
      const range: Record<string, Date> = {};
      if (dto.startDate) range.$gte = new Date(dto.startDate);
      if (dto.endDate) {
        const end = new Date(dto.endDate);
        end.setUTCHours(23, 59, 59, 999);
        range.$lte = end;
      }
      filter[dateField] = range;
    }

    const limit = Math.min(dto.limit || 100, 1000);

    if (dto.groupBy) {
      const groupPipeline: PipelineStage[] = [
        { $match: filter },
        {
          $group: {
            _id: `$${dto.groupBy}`,
            count: { $sum: 1 },
            ...(selectedFields.includes('amount')
              ? { totalAmount: { $sum: '$amount' } }
              : {}),
          },
        },
        { $sort: { count: dto.sortOrder === 'asc' ? 1 : -1 } },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            [dto.groupBy]: '$_id',
            count: 1,
            ...(selectedFields.includes('amount') ? { totalAmount: 1 } : {}),
          },
        },
      ];

      let results: unknown[] = [];
      if (entity === 'leads') {
        results = await this.leadModel.aggregate(groupPipeline).exec();
      } else if (entity === 'deals') {
        results = await this.dealModel.aggregate(groupPipeline).exec();
      }

      return {
        entity,
        groupBy: dto.groupBy,
        totalRows: results.length,
        rows: results,
        financialDataHidden,
        generatedAt: new Date().toISOString(),
      };
    }

    // Tabular projection
    const sortField = dto.sortBy || 'createdAt';
    const sortDirection = dto.sortOrder === 'asc' ? 1 : -1;

    let rows: unknown[] = [];
    if (entity === 'leads') {
      rows = await this.leadModel
        .find(filter)
        .select(selectedFields.join(' '))
        .sort({ [sortField]: sortDirection })
        .limit(limit)
        .lean()
        .exec();
    } else if (entity === 'deals') {
      rows = await this.dealModel
        .find(filter)
        .select(selectedFields.join(' '))
        .sort({ [sortField]: sortDirection })
        .limit(limit)
        .lean()
        .exec();
    }

    return {
      entity,
      totalRows: rows.length,
      rows,
      financialDataHidden,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 12. Streaming Export Report ────────────────────────────────────────────
  async exportReport(scope: DataScope, dto: ExportQueryDto, res: Response) {
    return this.exportService.exportReport(scope, dto, res);
  }
}
