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
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { UpdateBranchStatusDto } from './dto/update-branch-status.dto';
import { ListBranchesQueryDto } from './dto/list-branches-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PermissionModule,
  PermissionAction,
  PermissionKey,
} from '../permissions/constants/permission.constant';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('Branches')
@ApiBearerAuth('access-token')
@Controller({
  path: 'branches',
  version: '1',
})
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new branch' })
  @ApiCreatedResponse({
    description: 'The branch has been successfully created.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.BRANCHES, PermissionAction.CREATE),
  )
  async create(
    @Body() dto: CreateBranchDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const branch = await this.branchesService.create(dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, data: branch };
  }

  @Get()
  @ApiOperation({ summary: 'List all branches' })
  @ApiOkResponse({ description: 'List of branches with pagination.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.BRANCHES, PermissionAction.VIEW),
  )
  async list(@Query() query: ListBranchesQueryDto) {
    const result = await this.branchesService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get branch by ID' })
  @ApiParam({ name: 'id', description: 'Branch ID', type: String })
  @ApiOkResponse({ description: 'The branch details.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.BRANCHES, PermissionAction.VIEW),
  )
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const branch = await this.branchesService.getById(id);
    return { success: true, data: branch };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update branch' })
  @ApiParam({ name: 'id', description: 'Branch ID', type: String })
  @ApiOkResponse({
    description: 'The branch has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.BRANCHES, PermissionAction.EDIT),
  )
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateBranchDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const branch = await this.branchesService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: branch };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update branch status (activate/deactivate)' })
  @ApiParam({ name: 'id', description: 'Branch ID', type: String })
  @ApiOkResponse({
    description: 'The branch status has been successfully updated.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.BRANCHES, PermissionAction.EDIT),
  )
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateBranchStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const branch = await this.branchesService.updateStatus(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: branch };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a branch' })
  @ApiParam({ name: 'id', description: 'Branch ID', type: String })
  @ApiOkResponse({
    description: 'The branch has been successfully deleted.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.BRANCHES, PermissionAction.DELETE),
  )
  async delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.branchesService.delete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Branch successfully deleted' };
  }
}
