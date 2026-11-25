import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PayrollSettingsService } from './services/payroll-settings.service';
import { PayrollCalculationRuleService } from './services/payroll-calculation-rule.service';
import {
  PayrollCalculationService,
  PayrollPreviewResult,
} from './services/payroll-calculation.service';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import { UpdateCalculationRulesDto } from './dto/update-calculation-rules.dto';
import { CalculatePayrollPreviewDto } from './dto/calculate-payroll-preview.dto';
import {
  PayrollCalculationRuleResponse,
  PayrollSettingsResponse,
} from './mappers/payroll-configuration.mapper';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('Payroll Configuration')
@ApiBearerAuth('access-token')
@Controller({
  path: 'payroll/configuration',
  version: '1',
})
export class PayrollConfigurationController {
  constructor(
    private readonly settingsService: PayrollSettingsService,
    private readonly calculationRuleService: PayrollCalculationRuleService,
    private readonly calculationService: PayrollCalculationService,
  ) {}

  // ── Company Payroll Settings ─────────────────────────────────────────────

  @Get('settings')
  @ApiOperation({ summary: 'Get active company payroll settings' })
  @ApiOkResponse({ description: 'Company payroll settings retrieved.' })
  @RequirePermissions(PermissionKeys.PAYROLL_SETTINGS_VIEW)
  async getSettings(): Promise<{
    success: true;
    data: PayrollSettingsResponse;
  }> {
    const data = await this.settingsService.getSettings();
    return { success: true, data };
  }

  @Put('settings')
  @ApiOperation({ summary: 'Create or update company payroll settings' })
  @ApiOkResponse({ description: 'Company payroll settings saved.' })
  @RequirePermissions(PermissionKeys.PAYROLL_SETTINGS_EDIT)
  async updateSettings(
    @Body() dto: UpdatePayrollSettingsDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: PayrollSettingsResponse }> {
    const data = await this.settingsService.updateSettings(
      dto,
      request.user.userId,
      {
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
    return { success: true, data };
  }

  // ── Calculation Rules & Preview ──────────────────────────────────────────

  @Get('calculation-rules')
  @ApiOperation({ summary: 'Get active payroll calculation & proration rules' })
  @ApiOkResponse({ description: 'Payroll calculation rules retrieved.' })
  @RequirePermissions(PermissionKeys.PAYROLL_SETTINGS_VIEW)
  async getCalculationRules(): Promise<{
    success: true;
    data: PayrollCalculationRuleResponse;
  }> {
    const data = await this.calculationRuleService.getCalculationRules();
    return { success: true, data };
  }

  @Put('calculation-rules')
  @ApiOperation({ summary: 'Update payroll calculation & proration rules' })
  @ApiOkResponse({ description: 'Payroll calculation rules updated.' })
  @RequirePermissions(PermissionKeys.PAYROLL_SETTINGS_EDIT)
  async updateCalculationRules(
    @Body() dto: UpdateCalculationRulesDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: PayrollCalculationRuleResponse }> {
    const data = await this.calculationRuleService.updateCalculationRules(
      dto,
      request.user.userId,
      {
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
    return { success: true, data };
  }

  @Post('calculate-preview')
  @ApiOperation({
    summary:
      'Calculate and preview payroll gross earnings, deductions, net salary, and proration without persisting',
  })
  @ApiOkResponse({ description: 'Payroll calculation preview computed.' })
  @RequirePermissions(PermissionKeys.PAYROLL_SETTINGS_VIEW)
  async calculatePreview(
    @Body() dto: CalculatePayrollPreviewDto,
  ): Promise<{ success: true; data: PayrollPreviewResult }> {
    const data = await this.calculationService.calculatePreview(dto);
    return { success: true, data };
  }
}
