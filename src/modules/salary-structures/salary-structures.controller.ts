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
import { SalaryStructuresService } from './services/salary-structures.service';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { UpdateSalaryStructureDto } from './dto/update-salary-structure.dto';
import { UpdateSalaryStructureStatusDto } from './dto/update-salary-structure-status.dto';
import { CalculateSalaryStructureDto } from './dto/calculate-salary-structure.dto';
import { ListSalaryStructuresQueryDto } from './dto/list-salary-structures-query.dto';
import {
  SalaryStructureCreateResponseDto,
  SalaryStructureDetailResponseDto,
  SalaryStructureListItemResponseDto,
} from './dto/salary-structure-response.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { SalaryStructureBreakupResult } from './services/salary-structure-calculation.service';
import { PaginationMeta } from '../../common/pagination/types/pagination.types';

@ApiTags('Salary Structures')
@ApiBearerAuth('access-token')
@Controller({
  path: 'salary-structures',
  version: '1',
})
export class SalaryStructuresController {
  constructor(
    private readonly salaryStructuresService: SalaryStructuresService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new salary structure template' })
  @ApiCreatedResponse({
    description: 'The salary structure has been successfully created.',
    type: SalaryStructureCreateResponseDto,
  })
  @RequirePermissions(PermissionKeys.SALARY_STRUCTURES_CREATE)
  async create(
    @Body() dto: CreateSalaryStructureDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: SalaryStructureCreateResponseDto }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const structure = await this.salaryStructuresService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: structure };
  }

  @Post('calculate')
  @ApiOperation({
    summary:
      'Calculate and preview salary breakup without persisting to database',
  })
  @ApiOkResponse({
    description: 'Detailed itemized calculation breakup.',
  })
  @RequirePermissions(PermissionKeys.SALARY_STRUCTURES_VIEW)
  async calculatePreview(
    @Body() dto: CalculateSalaryStructureDto,
  ): Promise<{ success: true; data: SalaryStructureBreakupResult }> {
    const breakup = await this.salaryStructuresService.calculatePreview(dto);
    return { success: true, data: breakup };
  }

  @Get()
  @ApiOperation({
    summary: 'List salary structures with filtering & pagination',
  })
  @ApiOkResponse({
    description: 'Paginated list of salary structures.',
    type: [SalaryStructureListItemResponseDto],
  })
  @RequirePermissions(PermissionKeys.SALARY_STRUCTURES_VIEW)
  async list(@Query() query: ListSalaryStructuresQueryDto): Promise<{
    success: true;
    data: SalaryStructureListItemResponseDto[];
    meta: PaginationMeta;
  }> {
    const result = await this.salaryStructuresService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get salary structure by ID with calculated breakup',
  })
  @ApiParam({ name: 'id', description: 'Salary Structure ID', type: String })
  @ApiOkResponse({
    description:
      'Detailed salary structure with calculated component breakup and authoritative summary.',
    type: SalaryStructureDetailResponseDto,
  })
  @RequirePermissions(PermissionKeys.SALARY_STRUCTURES_VIEW)
  async getById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ): Promise<{ success: true; data: SalaryStructureDetailResponseDto }> {
    const structure = await this.salaryStructuresService.getById(id);
    return { success: true, data: structure };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing salary structure template' })
  @ApiParam({ name: 'id', description: 'Salary Structure ID', type: String })
  @ApiOkResponse({
    description: 'The salary structure has been successfully updated.',
    type: SalaryStructureDetailResponseDto,
  })
  @RequirePermissions(PermissionKeys.SALARY_STRUCTURES_EDIT)
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateSalaryStructureDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: SalaryStructureDetailResponseDto }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const structure = await this.salaryStructuresService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: structure };
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Activate or deactivate a salary structure template',
  })
  @ApiParam({ name: 'id', description: 'Salary Structure ID', type: String })
  @ApiOkResponse({
    description: 'The salary structure status has been successfully updated.',
    type: SalaryStructureDetailResponseDto,
  })
  @RequirePermissions(PermissionKeys.SALARY_STRUCTURES_EDIT)
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateSalaryStructureStatusDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ success: true; data: SalaryStructureDetailResponseDto }> {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const structure = await this.salaryStructuresService.updateStatus(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: structure };
  }
}
