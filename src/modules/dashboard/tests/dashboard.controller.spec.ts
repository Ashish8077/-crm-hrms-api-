import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { DashboardController } from '../dashboard.controller';
import { DashboardService } from '../dashboard.service';
import { DataScopeService } from '../services/data-scope.service';
import { AuthenticatedRequest } from '../../auth/types/auth-request.type';
import { DataScope } from '../types/data-scope.types';

describe('DashboardController', () => {
  let controller: DashboardController;

  const mockDataScope: DataScope = {
    scopeLevel: 'ORGANIZATION',
    ownerIds: [new Types.ObjectId()],
    callerUserId: new Types.ObjectId(),
    canViewFinancial: true,
  };

  const mockDataScopeService = {
    resolveCallerDataScope: jest.fn().mockResolvedValue(mockDataScope),
  };

  const mockDashboardService = {
    getKpis: jest.fn().mockResolvedValue({ totalLeads: 100 }),
    getFunnel: jest.fn().mockResolvedValue({ leadFunnel: {}, dealPipeline: {} }),
    getPerformance: jest.fn().mockResolvedValue({ trends: [] }),
    getActivities: jest.fn().mockResolvedValue({ totalActivities: 50 }),
    getLeaderboard: jest.fn().mockResolvedValue({ rankings: [] }),
    getRepDashboard: jest.fn().mockResolvedValue({ userId: '123' }),
    getQuota: jest.fn().mockResolvedValue({ quotaRecords: [] }),
    setQuota: jest.fn().mockResolvedValue({ success: true }),
    getDailySummary: jest.fn().mockResolvedValue({ tasksDueToday: 5 }),
    getConversion: jest.fn().mockResolvedValue({ conversionBySource: [] }),
    getForecast: jest.fn().mockResolvedValue({ forecastPeriod: 'Q4-2026' }),
    runCustomReport: jest.fn().mockResolvedValue({ totalRows: 10 }),
    exportReport: jest.fn().mockResolvedValue(undefined),
  };

  const mockReq = {
    user: {
      userId: new Types.ObjectId(),
      roleIds: [new Types.ObjectId()],
      sessionId: new Types.ObjectId(),
    },
  } as unknown as AuthenticatedRequest;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DataScopeService, useValue: mockDataScopeService },
        { provide: DashboardService, useValue: mockDashboardService },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
  });

  it('getKpis: should resolve scope and return wrapped response', async () => {
    const res = await controller.getKpis({}, mockReq);
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(mockDataScopeService.resolveCallerDataScope).toHaveBeenCalled();
    expect(mockDashboardService.getKpis).toHaveBeenCalledWith(mockDataScope, {});
  });

  it('getFunnel: should return combined funnel data', async () => {
    const res = await controller.getFunnel({}, mockReq);
    expect(res.success).toBe(true);
    expect(res.data.leadFunnel).toBeDefined();
    expect(res.data.dealPipeline).toBeDefined();
  });

  it('getDailySummary: should return daily priorities', async () => {
    const res = await controller.getDailySummary(mockReq);
    expect(res.success).toBe(true);
    expect(res.data.tasksDueToday).toBe(5);
  });

  it('setQuota: should delegate to service with caller user id', async () => {
    const dto = {
      userId: new Types.ObjectId().toString(),
      year: 2026,
      quotaAmount: 500000,
    };
    const res = await controller.setQuota(dto, mockReq);
    expect(res.success).toBe(true);
    expect(mockDashboardService.setQuota).toHaveBeenCalledWith(mockReq.user.userId, dto);
  });
});

