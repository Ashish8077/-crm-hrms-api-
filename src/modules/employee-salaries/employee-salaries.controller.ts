import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { EmployeeSalariesService } from './services/employee-salaries.service';
import { AssignSalaryDto } from './dto/assign-salary.dto';
import {
  EmployeeSalaryListItemDto,
  EmployeeSalaryResponseDto,
} from './dto/employee-salary-response.dto';
import { EmployeeSalaryMapper } from './mappers/employee-salary.mapper';
import { EmployeeSalaryHistoryQueryDto } from './dto/employee-salary-history-query.dto';
import { PaginationMeta } from '../../common/pagination/types/pagination.types';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('Employee Salaries')
@ApiBearerAuth('access-token')
@Controller({
  path: 'employees/:id/salary-assignments',
  version: '1',
})
export class EmployeeSalariesController {
  constructor(
    private readonly employeeSalariesService: EmployeeSalariesService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Assign a salary structure or create a salary revision',
    description:
      'Assigns a salary structure template to an employee. For existing assignments, atomically creates a new revision, closes the prior active assignment, and updates statuses within a MongoDB transaction.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId of the Employee',
    type: String,
  })
  @ApiCreatedResponse({
    description:
      'Salary assignment created successfully with immutable snapshot.',
    type: EmployeeSalaryResponseDto,
  })
  @RequirePermissions(PermissionKeys.EMPLOYEE_SALARIES_ASSIGN)
  async assignSalary(
    @Param('id', ParseObjectIdPipe) employeeId: Types.ObjectId,
    @Body() dto: AssignSalaryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: EmployeeSalaryResponseDto }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;

    const assignment = await this.employeeSalariesService.assignSalary(
      employeeId,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );

    return {
      success: true,
      data: EmployeeSalaryMapper.toResponseDto(assignment),
    };
  }

  @Get('current')
  @ApiOperation({
    summary: 'Get currently effective salary assignment',
    description:
      'Returns the salary assignment active on the given business date (defaults to current UTC date). Future-dated revisions are excluded until their effective date arrives.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId of the Employee',
    type: String,
  })
  @ApiQuery({
    name: 'asOfDate',
    required: false,
    description:
      'Optional evaluation date in YYYY-MM-DD format. Defaults to current date.',
    example: '2026-07-01',
  })
  @ApiOkResponse({
    description:
      'Currently effective salary assignment, or null if unassigned.',
    type: EmployeeSalaryResponseDto,
  })
  @RequirePermissions(PermissionKeys.EMPLOYEE_SALARIES_VIEW)
  async getCurrentSalary(
    @Param('id', ParseObjectIdPipe) employeeId: Types.ObjectId,
    @Query('asOfDate') asOfDate?: string,
  ): Promise<{ success: true; data: EmployeeSalaryResponseDto | null }> {
    const assignment = await this.employeeSalariesService.getCurrentSalary(
      employeeId,
      asOfDate,
    );

    return {
      success: true,
      data: assignment ? EmployeeSalaryMapper.toResponseDto(assignment) : null,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List salary assignment history for an employee',
    description:
      'Returns paginated salary assignment history for the employee, sorted newest effective date first.',
  })
  @ApiParam({
    name: 'id',
    description: 'MongoDB ObjectId of the Employee',
    type: String,
  })
  @ApiOkResponse({
    description: 'Paginated list of salary assignments.',
    type: [EmployeeSalaryListItemDto],
  })
  @RequirePermissions(PermissionKeys.EMPLOYEE_SALARIES_VIEW)
  async getSalaryHistory(
    @Param('id', ParseObjectIdPipe) employeeId: Types.ObjectId,
    @Query() query: EmployeeSalaryHistoryQueryDto,
  ): Promise<{
    success: true;
    data: EmployeeSalaryListItemDto[];
    meta: PaginationMeta;
  }> {
    const result = await this.employeeSalariesService.getSalaryHistory(
      employeeId,
      query,
    );

    return {
      success: true,
      data: result.data.map((doc) => EmployeeSalaryMapper.toListItemDto(doc)),
      meta: result.meta,
    };
  }
}
