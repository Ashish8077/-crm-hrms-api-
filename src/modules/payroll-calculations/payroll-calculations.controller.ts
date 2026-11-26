import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import {
  CalculateEmployeePayrollDto,
  CalculatePayrollPreviewInputDto,
} from './dto/calculate-employee-payroll.dto';
import {
  PayrollCalculationPreviewResponseDto,
  PayrollRecordResponseDto,
} from './dto/payroll-calculation-response.dto';
import { PayrollCalculationService } from './services/payroll-calculation.service';

@ApiTags('Payroll Calculations')
@ApiBearerAuth('access-token')
@Controller({
  path: 'payroll/calculations',
  version: '1',
})
export class PayrollCalculationsController {
  constructor(
    private readonly payrollCalculationService: PayrollCalculationService,
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview employee payroll calculation without persisting',
    description:
      'Resolves server-side employee, period, salary assignment, salary structure, and payroll configuration to calculate earnings, deductions, employer contributions, proration, and net salary without persisting a PayrollRecord.',
  })
  @ApiOkResponse({
    description: 'Employee payroll calculation preview computed successfully.',
    type: PayrollCalculationPreviewResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'Payroll period, employee, salary assignment, or salary structure not found.',
  })
  @ApiConflictResponse({
    description:
      'Payroll period is finalized/invalid or salary assignment conflict detected.',
  })
  @RequirePermissions(PermissionKeys.PAYROLL_CALCULATIONS_VIEW)
  async preview(
    @Body() dto: CalculatePayrollPreviewInputDto,
  ): Promise<{ success: true; data: PayrollCalculationPreviewResponseDto }> {
    const data = await this.payrollCalculationService.preview(dto);
    return { success: true, data };
  }

  @Post('employee')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Calculate and persist payroll record for one employee',
    description:
      'Calculates employee payroll using server-side authoritative salary assignment and configuration, builds an immutable audit snapshot, and persists a PayrollRecord for the employee and payroll period.',
  })
  @ApiOkResponse({
    description: 'Employee payroll calculated and persisted successfully.',
    type: PayrollRecordResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'Payroll period, employee, salary assignment, or salary structure not found.',
  })
  @ApiConflictResponse({
    description:
      'Payroll record already exists (unless recalculate=true), concurrent modification, or finalized period.',
  })
  @RequirePermissions(PermissionKeys.PAYROLL_CALCULATIONS_CREATE)
  async calculateEmployee(
    @Body() dto: CalculateEmployeePayrollDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: PayrollRecordResponseDto }> {
    const data =
      await this.payrollCalculationService.calculateAndPersistEmployeePayroll(
        dto,
        request.user.userId,
        {
          ipAddress: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        },
      );
    return { success: true, data };
  }
}
