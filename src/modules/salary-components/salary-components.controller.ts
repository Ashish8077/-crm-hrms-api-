import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { SalaryComponentsService } from './services/salary-components.service';
import { CreateSalaryComponentDto } from './dto/create-salary-component.dto';
import { UpdateSalaryComponentDto } from './dto/update-salary-component.dto';
import { UpdateSalaryComponentStatusDto } from './dto/update-salary-component-status.dto';
import { ListSalaryComponentsQueryDto } from './dto/list-salary-components-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { SalaryComponentResponse } from './mappers/salary-component.mapper';
import { PaginationMeta } from '../../common/pagination/types/pagination.types';

@ApiTags('Salary Components')
@ApiBearerAuth('access-token')
@Controller({
  path: 'salary-components',
  version: '1',
})
export class SalaryComponentsController {
  constructor(
    private readonly salaryComponentsService: SalaryComponentsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new salary component' })
  @ApiCreatedResponse({
    description: 'The salary component has been successfully created.',
  })
  @RequirePermissions(PermissionKeys.SALARY_COMPONENTS_CREATE)
  async create(
    @Body() dto: CreateSalaryComponentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: SalaryComponentResponse }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const component = await this.salaryComponentsService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: component };
  }

  @Get()
  @ApiOperation({
    summary: 'List salary components with filtering & pagination',
  })
  @ApiOkResponse({
    description: 'Paginated list of salary components.',
  })
  @RequirePermissions(PermissionKeys.SALARY_COMPONENTS_VIEW)
  async list(@Query() query: ListSalaryComponentsQueryDto): Promise<{
    success: true;
    data: SalaryComponentResponse[];
    meta: PaginationMeta;
  }> {
    const result = await this.salaryComponentsService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get salary component by ID' })
  @ApiParam({ name: 'id', description: 'Salary Component ID', type: String })
  @ApiOkResponse({ description: 'The salary component details.' })
  @RequirePermissions(PermissionKeys.SALARY_COMPONENTS_VIEW)
  async getById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ): Promise<{ success: true; data: SalaryComponentResponse }> {
    const component = await this.salaryComponentsService.getById(id);
    return { success: true, data: component };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing salary component' })
  @ApiParam({ name: 'id', description: 'Salary Component ID', type: String })
  @ApiOkResponse({
    description: 'The salary component has been successfully updated.',
  })
  @RequirePermissions(PermissionKeys.SALARY_COMPONENTS_EDIT)
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateSalaryComponentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: SalaryComponentResponse }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const component = await this.salaryComponentsService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: component };
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Activate or deactivate a salary component',
  })
  @ApiParam({ name: 'id', description: 'Salary Component ID', type: String })
  @ApiOkResponse({
    description: 'The salary component status has been successfully updated.',
  })
  @RequirePermissions(PermissionKeys.SALARY_COMPONENTS_EDIT)
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateSalaryComponentStatusDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: SalaryComponentResponse }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const component = await this.salaryComponentsService.updateStatus(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: component };
  }
}
