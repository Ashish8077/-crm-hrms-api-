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
import { CompOffService } from './services/comp-off.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { ClaimCompOffDto } from './dto/claim-comp-off.dto';
import { ReviewCompOffDto } from './dto/review-comp-off.dto';
import { ListCompOffQueryDto } from './dto/list-comp-off-query.dto';
import { CompOffMapper } from './mappers/comp-off.mapper';

@ApiTags('Compensatory Off')
@ApiBearerAuth('access-token')
@Controller({
  path: 'leaves/comp-off',
  version: '1',
})
export class CompOffController {
  constructor(private readonly compOffService: CompOffService) {}

  @Post('claim')
  @ApiOperation({
    summary: 'Claim compensatory off for weekend/holiday work or overtime',
  })
  @ApiCreatedResponse({ description: 'Comp-off claim submitted.' })
  @RequirePermissions(PermissionKeys.COMP_OFF_CLAIM)
  async claimCompOff(
    @Body() dto: ClaimCompOffDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.compOffService.claimCompOff(
      request.user.userId,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: CompOffMapper.toResponse(result) };
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get comp-off records for the authenticated employee',
  })
  @ApiOkResponse({ description: 'Employee own comp-off records.' })
  @RequirePermissions(PermissionKeys.COMP_OFF_VIEW_OWN)
  async getMyCompOff(
    @Query() query: ListCompOffQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.compOffService.getMyCompOff(
      request.user.userId,
      query,
    );
    return {
      success: true,
      data: CompOffMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List comp-off records (Scoping: HR or Manager direct reports)',
  })
  @ApiOkResponse({ description: 'Paginated comp-off records.' })
  @RequirePermissions(PermissionKeys.COMP_OFF_VIEW_TEAM)
  async listCompOff(
    @Query() query: ListCompOffQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.compOffService.listCompOff(
      request.user.userId,
      query,
    );
    return {
      success: true,
      data: CompOffMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get comp-off claim details by ID' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'CompOffRecord ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({ description: 'Comp-off details.' })
  @RequirePermissions(PermissionKeys.COMP_OFF_VIEW)
  async getCompOffById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.compOffService.getCompOffById(
      request.user.userId,
      id,
    );
    return { success: true, data: CompOffMapper.toResponse(result) };
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Approve or reject a comp-off claim' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'CompOffRecord ObjectId',
    example: '6650b2f8a123456789abcdef',
  })
  @ApiOkResponse({
    description: 'Comp-off claim reviewed and balance credited if approved.',
  })
  @RequirePermissions(PermissionKeys.COMP_OFF_REVIEW)
  async reviewCompOff(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ReviewCompOffDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.compOffService.reviewCompOff(
      request.user.userId,
      id,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: CompOffMapper.toResponse(result) };
  }
}
