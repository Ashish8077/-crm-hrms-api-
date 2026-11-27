import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationMeta } from '../../common/pagination/types/pagination.types';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import {
  ListPayslipsQueryDto,
  PayslipListItemDto,
  PayslipResponseDto,
} from './dto/payslip.dto';
import { PayslipsService } from './services/payslips.service';

@ApiTags('Payslips')
@ApiBearerAuth('access-token')
@Controller({
  path: 'payroll/periods',
  version: '1',
})
export class PayslipsController {
  constructor(private readonly payslipsService: PayslipsService) {}

  @Post(':periodId/payslips/:employeeId/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate or retrieve idempotent payslip PDF for an employee',
    description:
      'Validates that the payroll period is FINALIZED and the employee PayrollRecord is APPROVED, renders a deterministic PDF from the immutable payroll snapshot, stores it in object storage, and persists payslip metadata.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiParam({ name: 'employeeId', description: 'Employee ID', type: String })
  @ApiOkResponse({
    description: 'Payslip generated or retrieved idempotently.',
    type: PayslipResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Payroll period or employee payroll record not found.',
  })
  @ApiConflictResponse({
    description:
      'Period is not FINALIZED, payroll record is unapproved/invalidated, or concurrent modification occurred.',
  })
  @RequirePermissions(PermissionKeys.PAYSLIPS_CREATE)
  async generatePayslip(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Param('employeeId', ParseObjectIdPipe) employeeId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: PayslipResponseDto }> {
    const data = await this.payslipsService.generatePayslip(
      periodId,
      employeeId,
      request.user.userId,
      {
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        requestId:
          typeof request.headers['x-request-id'] === 'string'
            ? request.headers['x-request-id']
            : null,
      },
    );
    return { success: true, data };
  }

  @Get(':periodId/payslips')
  @ApiOperation({
    summary: 'List generated payslips for a payroll period',
    description:
      'Returns paginated payslip metadata for a payroll period with employee code/name search filtering. Binary PDF content is excluded.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiOkResponse({
    description: 'Paginated list of generated payslips for the period.',
    type: [PayslipListItemDto],
  })
  @ApiNotFoundResponse({ description: 'Payroll period not found.' })
  @RequirePermissions(PermissionKeys.PAYSLIPS_VIEW)
  async listPeriodPayslips(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Query() query: ListPayslipsQueryDto,
  ): Promise<{
    success: true;
    data: PayslipListItemDto[];
    meta: PaginationMeta;
  }> {
    const result = await this.payslipsService.listPeriodPayslips(
      periodId,
      query,
    );
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':periodId/payslips/:employeeId')
  @ApiOperation({
    summary: 'Get generated payslip metadata for one employee in a period',
    description:
      'Returns sanitized payslip metadata for an HR/payroll viewer or for the authenticated employee accessing their own payslip.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiParam({ name: 'employeeId', description: 'Employee ID', type: String })
  @ApiOkResponse({
    description: 'Payslip metadata retrieved successfully.',
    type: PayslipResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Not authorized to access this employee payslip.',
  })
  @ApiNotFoundResponse({
    description: 'Payroll period, payroll record, or payslip not found.',
  })
  async getPayslip(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Param('employeeId', ParseObjectIdPipe) employeeId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: PayslipResponseDto }> {
    const data = await this.payslipsService.getPayslip(
      periodId,
      employeeId,
      request.user.userId,
      request.user.roleIds,
    );
    return { success: true, data };
  }

  @Get(':periodId/payslips/:employeeId/download')
  @ApiOperation({
    summary: 'Download employee payslip PDF document',
    description:
      'Streams the verified PDF payslip with safe Content-Disposition headers for authorized HR/payroll users or employees downloading their own payslip.',
  })
  @ApiParam({
    name: 'periodId',
    description: 'Payroll Period ID',
    type: String,
  })
  @ApiParam({ name: 'employeeId', description: 'Employee ID', type: String })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'Payslip PDF stream.' })
  @ApiForbiddenResponse({
    description: 'Not authorized to download this employee payslip.',
  })
  @ApiNotFoundResponse({
    description: 'Payslip metadata or stored PDF file not found.',
  })
  async downloadPayslip(
    @Param('periodId', ParseObjectIdPipe) periodId: Types.ObjectId,
    @Param('employeeId', ParseObjectIdPipe) employeeId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName, mimeType } =
      await this.payslipsService.downloadPayslip(
        periodId,
        employeeId,
        request.user.userId,
        request.user.roleIds,
        {
          ipAddress: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
          requestId:
            typeof request.headers['x-request-id'] === 'string'
              ? request.headers['x-request-id']
              : null,
        },
      );

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buffer);
  }
}
