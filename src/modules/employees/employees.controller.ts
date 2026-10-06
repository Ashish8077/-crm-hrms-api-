import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmploymentStatusDto } from './dto/update-employment-status.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PermissionModule,
  PermissionAction,
  PermissionKey,
} from '../permissions/constants/permission.constant';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('Employees')
@ApiBearerAuth('access-token')
@Controller({
  path: 'employees',
  version: '1',
})
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new employee' })
  @ApiCreatedResponse({
    description: 'The employee has been successfully created.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.CREATE),
  )
  async create(
    @Body() dto: CreateEmployeeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const employee = await this.employeesService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: employee };
  }

  @Get()
  @ApiOperation({ summary: 'List all employees' })
  @ApiOkResponse({ description: 'List of employees with pagination.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.VIEW),
  )
  async list(@Query() query: ListEmployeesQueryDto) {
    const result = await this.employeesService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee by ID' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiOkResponse({ description: 'The employee details.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.VIEW),
  )
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const employee = await this.employeesService.getById(id);
    return { success: true, data: employee };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee details' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiOkResponse({
    description: 'The employee has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.EDIT),
  )
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateEmployeeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const employee = await this.employeesService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: employee };
  }

  @Get(':id/bank-details')
  @ApiOperation({ summary: 'Get employee bank details' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiOkResponse({ description: 'The employee bank details.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.VIEW), // Could be a more restricted permission in the future
  )
  async getBankDetails(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const bankDetails = await this.employeesService.getBankDetails(id);
    return { success: true, data: bankDetails };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update employee employment status' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiOkResponse({
    description: 'The employee status has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.EDIT),
  )
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateEmploymentStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const employee = await this.employeesService.updateStatus(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: employee };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete an employee' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiOkResponse({
    description: 'The employee has been successfully deleted.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.DELETE),
  )
  async delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.employeesService.delete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Employee successfully deleted' };
  }
}
