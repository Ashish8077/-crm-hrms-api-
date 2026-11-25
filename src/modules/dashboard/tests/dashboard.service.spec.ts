import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DashboardService } from '../dashboard.service';
import { DashboardCacheService } from '../services/dashboard-cache.service';
import { LeadAnalyticsService } from '../services/lead-analytics.service';
import { DealAnalyticsService } from '../services/deal-analytics.service';
import { ActivityAnalyticsService } from '../services/activity-analytics.service';
import { QuotaService } from '../services/quota.service';
import { ExportService } from '../services/export.service';
import { Lead } from '../../leads/schemas/lead.schema';
import { Deal } from '../../deals/schemas/deal.schema';
import { Employee } from '../../employees/schemas/employee.schema';
import { DataScope } from '../types/data-scope.types';

describe('DashboardService', () => {
  let service: DashboardService;

  const mockCacheService = {
    getOrSet: jest
      .fn()
      .mockImplementation(
        (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
          fetcher(),
      ),
    del: jest.fn(),
  };

  const mockLeadAnalyticsService = {
    getLeadKpiSummary: jest.fn().mockResolvedValue({
      totalLeads: 100,
      newLeads: 20,
      qualifiedLeads: 40,
      convertedLeads: 15,
      lostLeads: 10,
      conversionRate: 15.0,
      qualificationRate: 40.0,
    }),
    getLeadFunnel: jest.fn().mockResolvedValue({
      stages: [{ stage: 'new', count: 20, percentOfTotal: 20.0 }],
      totalLeads: 100,
      leadQualificationRate: 40.0,
      leadToWonRate: 15.0,
    }),
    getConversionAnalysis: jest.fn().mockResolvedValue({
      period: { start: null, end: null },
      leadToQualifiedRate: 40.0,
      leadToWonRate: 15.0,
      conversionBySource: [],
    }),
    getLeadsNeedingAttentionCount: jest.fn().mockResolvedValue(4),
  };

  const mockDealAnalyticsService = {
    getDealKpiSummary: jest.fn().mockResolvedValue({
      dealMetrics: {
        totalDeals: 30,
        openDeals: 15,
        wonDeals: 10,
        lostDeals: 5,
        winRate: 66.67,
        avgSalesCycleDays: 21,
      },
      financialMetrics: {
        totalRevenue: { USD: 150000 },
        avgDealSize: { USD: 15000 },
        pipelineValue: { USD: 300000 },
      },
      financialDataHidden: false,
    }),
    getDealPipeline: jest.fn().mockResolvedValue({
      stages: [
        {
          stage: 'CLOSED_WON',
          count: 10,
          totalAmountByCurrency: { USD: 150000 },
          avgProbability: 100,
        },
      ],
      financialDataHidden: false,
      currency: 'USD',
    }),
    getPerformanceTrends: jest.fn().mockResolvedValue({
      granularity: 'month',
      currency: 'USD',
      financialDataHidden: false,
      trends: [],
      summary: {
        totalRevenueWon: 150000,
        avgPeriodRevenue: 15000,
        peakPeriod: '2026-11',
        peakPeriodRevenue: 50000,
      },
    }),
    getForecast: jest.fn().mockResolvedValue({
      forecastPeriod: 'Q4-2026',
      currency: 'USD',
      financialDataHidden: false,
      pipelineValue: 300000,
      weightedForecast: 180000,
      closingThisQuarter: {
        count: 5,
        pipelineAmount: 120000,
        weightedAmount: 72000,
      },
      atRiskDeals: [],
      confidence: 'HIGH',
      confidenceNote: 'Strong pipeline',
    }),
    getDealsClosingThisWeekCount: jest.fn().mockResolvedValue(2),
    getDealsByOwnerForLeaderboard: jest.fn().mockResolvedValue(new Map()),
    getWonDealsByOwnerForRep: jest.fn().mockResolvedValue({
      total: 10,
      won: 4,
      lost: 2,
      open: 4,
      wonRevenue: 60000,
      currency: 'USD',
    }),
  };

  const mockActivityAnalyticsService = {
    getActivityKpis: jest.fn().mockResolvedValue({
      activityBreakdown: [{ type: 'call', count: 50, percentOfTotal: 50.0 }],
      totalActivities: 100,
      tasksOverdue: 3,
      tasksCompletedOnTime: 25,
      taskCompletionRate: 85.0,
    }),
    getOverdueTasksCount: jest.fn().mockResolvedValue(3),
    getTasksDueTodayCount: jest.fn().mockResolvedValue(5),
    getFollowUpsDueTodayCount: jest.fn().mockResolvedValue(2),
    getRecentActivities: jest.fn().mockResolvedValue([]),
    getActivitiesByOwnerForLeaderboard: jest.fn().mockResolvedValue(new Map()),
  };

  const mockQuotaService = {
    getQuotaComparison: jest.fn().mockResolvedValue({
      year: 2026,
      currency: 'USD',
      financialDataHidden: false,
      quotaRecords: [],
    }),
    getRepQuotaAttainment: jest.fn().mockResolvedValue({
      quotaAmount: 100000,
      quotaExists: true,
    }),
    setQuota: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockExportService = {
    exportReport: jest.fn().mockResolvedValue(undefined),
  };

  const mockLeadModel = {
    aggregate: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    find: jest.fn().mockReturnValue({
      select: () => ({
        sort: () => ({
          limit: () => ({
            lean: () => ({ exec: jest.fn().mockResolvedValue([]) }),
          }),
        }),
      }),
    }),
  };

  const mockDealModel = {
    aggregate: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    find: jest.fn().mockReturnValue({
      select: () => ({
        sort: () => ({
          limit: () => ({
            lean: () => ({ exec: jest.fn().mockResolvedValue([]) }),
          }),
        }),
      }),
    }),
  };

  const mockEmployeeModel = {
    find: jest.fn().mockReturnValue({
      select: () => ({
        lean: () => ({ exec: jest.fn().mockResolvedValue([]) }),
      }),
    }),
    findOne: jest.fn().mockReturnValue({
      select: () => ({
        lean: () => ({ exec: jest.fn().mockResolvedValue(null) }),
      }),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: DashboardCacheService, useValue: mockCacheService },
        { provide: LeadAnalyticsService, useValue: mockLeadAnalyticsService },
        { provide: DealAnalyticsService, useValue: mockDealAnalyticsService },
        {
          provide: ActivityAnalyticsService,
          useValue: mockActivityAnalyticsService,
        },
        { provide: QuotaService, useValue: mockQuotaService },
        { provide: ExportService, useValue: mockExportService },
        { provide: getModelToken(Lead.name), useValue: mockLeadModel },
        { provide: getModelToken(Deal.name), useValue: mockDealModel },
        { provide: getModelToken(Employee.name), useValue: mockEmployeeModel },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  const dummyScope: DataScope = {
    scopeLevel: 'ORGANIZATION',
    ownerIds: [new Types.ObjectId()],
    callerUserId: new Types.ObjectId(),
    canViewFinancial: true,
  };

  it('getKpis: should return combined KPIs across leads, deals, activities and financials', async () => {
    const result = await service.getKpis(dummyScope, {});

    expect(result.leadMetrics.totalLeads).toBe(100);
    expect(result.dealMetrics.totalDeals).toBe(30);
    expect(result.financialMetrics).toBeDefined();
    expect(result.activityMetrics.totalActivities).toBe(100);
  });

  it('getFunnel: should combine lead funnel and deal pipeline in a single response', async () => {
    const result = await service.getFunnel(dummyScope, {});

    expect(result.leadFunnel).toBeDefined();
    expect(result.dealPipeline).toBeDefined();
    expect(result.leadFunnel.stages).toHaveLength(1);
    expect(result.dealPipeline.stages).toHaveLength(1);
  });

  it('getDailySummary: should return actionable daily priorities and counts', async () => {
    const result = await service.getDailySummary(dummyScope);

    expect(result.tasksOverdue).toBe(3);
    expect(result.tasksDueToday).toBe(5);
    expect(result.followUpsDueToday).toBe(2);
    expect(result.leadsNeedingAttention).toBe(4);
    expect(result.dealsExpectedToCloseThisWeek).toBe(2);
  });

  it('getRepDashboard: should reject with ForbiddenException if targetUserId is outside scope', async () => {
    const permittedId = new Types.ObjectId();
    const forbiddenId = new Types.ObjectId();

    const restrictedScope: DataScope = {
      scopeLevel: 'SELF',
      ownerIds: [permittedId],
      callerUserId: permittedId,
      canViewFinancial: true,
    };

    await expect(
      service.getRepDashboard(restrictedScope, forbiddenId.toString()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('runCustomReport: should reject with BadRequestException for non-allowlisted fields', async () => {
    await expect(
      service.runCustomReport(dummyScope, {
        entity: 'deals',
        fields: ['title', 'maliciousField__proto__'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('runCustomReport: should accept permitted fields and return results', async () => {
    const result = await service.runCustomReport(dummyScope, {
      entity: 'deals',
      fields: ['title', 'amount', 'stage'],
    });

    expect(result.entity).toBe('deals');
    expect(result.rows).toBeDefined();
  });
});
