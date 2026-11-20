import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { DataScopeService } from './services/data-scope.service';
import { DashboardService } from './dashboard.service';
import {
  KpiQueryDto,
  FunnelQueryDto,
  PerformanceQueryDto,
  ActivityQueryDto,
  LeaderboardQueryDto,
  QuotaQueryDto,
  SetQuotaDto,
  ForecastQueryDto,
  CustomReportDto,
  ExportQueryDto,
} from './dto';

@ApiTags('CRM - Analytics & Reports')
@ApiBearerAuth('access-token')
@Controller({ path: 'analytics', version: '1' })
export class DashboardController {
  constructor(
    private readonly dataScopeService: DataScopeService,
    private readonly dashboardService: DashboardService,
  ) {}

  @Get('kpis')
  @ApiOperation({ summary: 'Executive KPI summary across all CRM modules' })
  @ApiOkResponse({ description: 'Executive aggregated KPIs' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getKpis(
    @Query() query: KpiQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getKpis(scope, query);
    return { success: true, data };
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Lead Funnel & Deal Pipeline combined stages analytics' })
  @ApiOkResponse({ description: 'Lead funnel and opportunity pipeline distribution' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getFunnel(
    @Query() query: FunnelQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getFunnel(scope, query);
    return { success: true, data };
  }

  @Get('performance')
  @ApiOperation({ summary: 'Sales performance and revenue trends over time' })
  @ApiOkResponse({ description: 'Historical revenue and conversion trends' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getPerformance(
    @Query() query: PerformanceQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getPerformance(scope, query);
    return { success: true, data };
  }

  @Get('activities')
  @ApiOperation({ summary: 'CRM activities breakdown and task completion analytics' })
  @ApiOkResponse({ description: 'Activity metrics and task completion rates' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getActivities(
    @Query() query: ActivityQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getActivities(scope, query);
    return { success: true, data };
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Sales team performance leaderboard rankings' })
  @ApiOkResponse({ description: 'Ranked sales representative performance metrics' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getLeaderboard(
    @Query() query: LeaderboardQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getLeaderboard(scope, query);
    return { success: true, data };
  }

  @Get('rep/:userId')
  @ApiOperation({ summary: 'Individual sales representative operational cockpit' })
  @ApiParam({ name: 'userId', description: 'User ObjectId of sales rep', example: '6af1234567890abcdef12345' })
  @ApiOkResponse({ description: 'Individual sales rep KPIs and attainment' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getRepDashboard(
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getRepDashboard(scope, userId);
    return { success: true, data };
  }

  @Get('quota')
  @ApiOperation({ summary: 'Sales quota attainment vs actual closed revenue' })
  @ApiOkResponse({ description: 'Quota attainment records' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getQuota(
    @Query() query: QuotaQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getQuota(scope, query);
    return { success: true, data };
  }

  @Post('quota')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set or update sales quota target for a representative' })
  @ApiCreatedResponse({ description: 'Quota assigned successfully' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async setQuota(
    @Body() dto: SetQuotaDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerUserId = new Types.ObjectId(req.user.userId);
    const data = await this.dashboardService.setQuota(callerUserId, dto);
    return { success: true, data };
  }

  @Get('daily-summary')
  @ApiOperation({ summary: 'Actionable daily summary for immediate focus and follow-ups' })
  @ApiOkResponse({ description: 'Daily summary counts and priorities' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getDailySummary(@Req() req: AuthenticatedRequest) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getDailySummary(scope);
    return { success: true, data };
  }

  @Get('conversion')
  @ApiOperation({ summary: 'Comprehensive lead and deal stage conversion rate analysis' })
  @ApiOkResponse({ description: 'Conversion analytics across channels and stages' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getConversion(
    @Query() query: KpiQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getConversion(scope, query);
    return { success: true, data };
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Weighted revenue forecast and at-risk pipeline health' })
  @ApiOkResponse({ description: 'Forecast projections and stalled opportunities' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async getForecast(
    @Query() query: ForecastQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.getForecast(scope, query);
    return { success: true, data };
  }

  @Post('custom-report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'On-demand custom tabular and grouped report generator' })
  @ApiOkResponse({ description: 'Custom report data payload' })
  @RequirePermissions(PermissionKeys.REPORTS_VIEW)
  async runCustomReport(
    @Body() dto: CustomReportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    const data = await this.dashboardService.runCustomReport(scope, dto);
    return { success: true, data };
  }

  @Get('export')
  @ApiOperation({ summary: 'Stream report data export in CSV or XLSX format' })
  @ApiOkResponse({ description: 'Downloadable stream response' })
  @RequirePermissions(PermissionKeys.REPORTS_EXPORT)
  async exportReport(
    @Query() query: ExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const scope = await this.dataScopeService.resolveCallerDataScope(req.user);
    await this.dashboardService.exportReport(scope, query, res);
  }
}

