import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Res,
  Query,
  HttpStatus,
  HttpCode,
  Ip,
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
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { QuotationsService } from './services/quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { UpdateQuotationStatusDto } from './dto/update-quotation-status.dto';
import { ListQuotationsQueryDto } from './dto/list-quotations-query.dto';
import { SendQuotationEmailDto } from './dto/send-quotation-email.dto';
import { SpawnRevisionDto } from './dto/spawn-revision.dto';
import { ExtendValidityDto } from './dto/extend-validity.dto';
import { SubmitApprovalDto } from './dto/submit-approval.dto';
import { ReviewApprovalDto } from './dto/review-approval.dto';
import { CustomerResponseDto } from './dto/customer-response.dto';
import { ConvertToOrderDto } from './dto/convert-to-order.dto';
import { EmailWebhookDto } from './dto/email-webhook.dto';

@ApiTags('CRM - Quotations')
@ApiBearerAuth('access-token')
@Controller('quotes')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  private resolveCompanyId(
    req: AuthenticatedRequest,
    explicitCompanyId?: string,
  ): Types.ObjectId {
    if (explicitCompanyId && Types.ObjectId.isValid(explicitCompanyId)) {
      return new Types.ObjectId(explicitCompanyId);
    }
    const headerCompanyId = req.headers['x-company-id'] as string;
    if (headerCompanyId && Types.ObjectId.isValid(headerCompanyId)) {
      return new Types.ObjectId(headerCompanyId);
    }
    return new Types.ObjectId((req.user as any)?.companyId || req.user.userId);
  }

  // =========================================================================
  // PUBLIC PORTAL & WEBHOOK ROUTES (Placed First Before Dynamic :id)
  // =========================================================================

  @Public()
  @Get('portal/:token')
  @ApiOperation({ summary: 'Customer Portal: View proposal online by secure token' })
  @ApiParam({ name: 'token', description: 'Hex-encoded random portal token' })
  async getPortalView(@Param('token') token: string) {
    return this.quotationsService.getPortalView(token);
  }

  @Public()
  @Post('portal/:token/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer Portal: Accept or reject quotation proposal' })
  @ApiParam({ name: 'token', description: 'Hex-encoded random portal token' })
  async respondPortal(
    @Param('token') token: string,
    @Body() dto: CustomerResponseDto,
    @Ip() clientIp?: string,
  ) {
    return this.quotationsService.respondPortal(token, dto, clientIp);
  }

  @Public()
  @Post('webhooks/email-delivery')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook: Email delivery, bounce and engagement events' })
  async handleEmailWebhook(@Body() payload: EmailWebhookDto) {
    return this.quotationsService.handleEmailWebhook(payload);
  }

  // =========================================================================
  // STATIC ANALYTICS & QUERY ROUTES (Placed Before Dynamic :id)
  // =========================================================================

  @Get('expired')
  @RequirePermissions(PermissionKeys.QUOTES_VIEW)
  @ApiOperation({ summary: 'List expired quotations for tenant' })
  async findExpired(
    @Query() query: ListQuotationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req, query.companyId);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.findExpired(companyId, query, isAdminOrManager);
  }

  @Get('summary')
  @RequirePermissions(PermissionKeys.QUOTES_VIEW)
  @ApiOperation({ summary: 'Quotation pipeline and summary metrics ($facet)' })
  async findSummary(@Req() req: AuthenticatedRequest) {
    const companyId = this.resolveCompanyId(req);
    return this.quotationsService.findSummary(companyId);
  }

  // =========================================================================
  // CORE CRUD ROUTES
  // =========================================================================

  @Post()
  @RequirePermissions(PermissionKeys.QUOTES_CREATE)
  @ApiOperation({ summary: 'Create a new quotation proposal (v1 Draft)' })
  @ApiCreatedResponse({ description: 'Quotation created successfully' })
  async create(
    @Body() dto: CreateQuotationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req, dto.companyId);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.create(
      dto,
      new Types.ObjectId(req.user.userId),
      companyId,
      isAdminOrManager,
    );
  }

  @Get()
  @RequirePermissions(PermissionKeys.QUOTES_VIEW)
  @ApiOperation({ summary: 'List quotations with filtering, pagination and sorting' })
  async findAll(
    @Query() query: ListQuotationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req, query.companyId);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.findAll(companyId, query, isAdminOrManager);
  }

  @Get(':id')
  @RequirePermissions(PermissionKeys.QUOTES_VIEW)
  @ApiOperation({ summary: 'Get quotation details by ID' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async findById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.findById(companyId, id, isAdminOrManager);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.QUOTES_EDIT)
  @ApiOperation({ summary: 'Update quotation draft (before approval/acceptance)' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateQuotationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.update(
      companyId,
      id,
      dto,
      new Types.ObjectId(req.user.userId),
      isAdminOrManager,
    );
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionKeys.QUOTES_EDIT)
  @ApiOperation({ summary: 'Update quotation status via state machine' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateQuotationStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.updateStatus(
      companyId,
      id,
      dto,
      new Types.ObjectId(req.user.userId),
      isAdminOrManager,
    );
  }

  // =========================================================================
  // PDF GENERATION & DOWNLOAD
  // =========================================================================

  @Post(':id/pdf')
  @RequirePermissions(PermissionKeys.QUOTES_EXPORT)
  @ApiOperation({ summary: 'Generate quotation PDF and persist to storage' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async generatePdf(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    await this.quotationsService.generatePdf(companyId, id);
    return { success: true, message: 'PDF generated successfully' };
  }

  @Get(':id/pdf')
  @RequirePermissions(PermissionKeys.QUOTES_VIEW)
  @ApiOperation({ summary: 'Download generated quotation PDF document' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async downloadPdf(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const companyId = this.resolveCompanyId(req);
    const { buffer, filename } = await this.quotationsService.downloadPdf(companyId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // =========================================================================
  // EMAIL DISPATCH
  // =========================================================================

  @Post(':id/send')
  @RequirePermissions(PermissionKeys.QUOTES_EDIT)
  @ApiOperation({ summary: 'Send quotation email to client with portal link & PDF attachment' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async sendEmail(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: SendQuotationEmailDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    return this.quotationsService.sendEmail(
      companyId,
      id,
      dto,
      new Types.ObjectId(req.user.userId),
    );
  }

  @Post(':id/resend')
  @RequirePermissions(PermissionKeys.QUOTES_EDIT)
  @ApiOperation({ summary: 'Resend quotation email' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async resendEmail(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    return this.quotationsService.resendEmail(
      companyId,
      id,
      new Types.ObjectId(req.user.userId),
    );
  }

  // =========================================================================
  // REVISIONS & CLONING
  // =========================================================================

  @Post(':id/duplicate')
  @RequirePermissions(PermissionKeys.QUOTES_CREATE)
  @ApiOperation({ summary: 'Duplicate quotation into a new draft' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async duplicate(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.duplicate(
      companyId,
      id,
      new Types.ObjectId(req.user.userId),
      isAdminOrManager,
    );
  }

  @Get(':id/revisions')
  @RequirePermissions(PermissionKeys.QUOTES_VIEW)
  @ApiOperation({ summary: 'Get full revision history chain (v1, v2, ...)' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async findRevisions(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.findRevisions(companyId, id, isAdminOrManager);
  }

  @Post(':id/revisions')
  @RequirePermissions(PermissionKeys.QUOTES_CREATE)
  @ApiOperation({ summary: 'Spawn a new revision v(n+1) from this quotation' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async spawnRevision(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: SpawnRevisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.spawnRevision(
      companyId,
      id,
      dto,
      new Types.ObjectId(req.user.userId),
      isAdminOrManager,
    );
  }

  @Patch(':id/validity')
  @RequirePermissions(PermissionKeys.QUOTES_EDIT)
  @ApiOperation({ summary: 'Extend validity expiration date of quotation' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async extendValidity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ExtendValidityDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.extendValidity(
      companyId,
      id,
      dto,
      new Types.ObjectId(req.user.userId),
      isAdminOrManager,
    );
  }

  // =========================================================================
  // MULTI-TIER APPROVALS
  // =========================================================================

  @Post(':id/approval')
  @RequirePermissions(PermissionKeys.QUOTES_EDIT)
  @ApiOperation({ summary: 'Submit quotation for manager approval' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async submitApproval(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: SubmitApprovalDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.submitApproval(
      companyId,
      id,
      dto,
      new Types.ObjectId(req.user.userId),
      isAdminOrManager,
    );
  }

  @Patch(':id/approval')
  @RequirePermissions(PermissionKeys.QUOTES_APPROVE)
  @ApiOperation({ summary: 'Review quotation approval (Approve or Reject)' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async reviewApproval(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ReviewApprovalDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.reviewApproval(
      companyId,
      id,
      dto,
      new Types.ObjectId(req.user.userId),
      isAdminOrManager,
    );
  }

  // =========================================================================
  // ORDER CONVERSION (O2C)
  // =========================================================================

  @Post(':id/convert-to-order')
  @RequirePermissions(PermissionKeys.QUOTES_EDIT)
  @ApiOperation({ summary: 'Convert accepted quotation into a confirmed Sales Order' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async convertToOrder(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ConvertToOrderDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    const isAdminOrManager = await this.quotationsService.isUserAdminOrManager(req.user.roleIds);
    return this.quotationsService.convertToOrder(
      companyId,
      id,
      dto,
      new Types.ObjectId(req.user.userId),
      isAdminOrManager,
    );
  }

  // =========================================================================
  // AUDIT & COMMUNICATION HISTORY
  // =========================================================================

  @Get(':id/emails')
  @RequirePermissions(PermissionKeys.QUOTES_VIEW)
  @ApiOperation({ summary: 'Get quotation email dispatch and delivery history' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async getEmailHistory(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    return this.quotationsService.getEmailHistory(companyId, id);
  }

  @Get(':id/activities')
  @RequirePermissions(PermissionKeys.QUOTES_VIEW)
  @ApiOperation({ summary: 'Get quotation lifecycle activity and audit history' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async getActivityHistory(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    return this.quotationsService.getActivityHistory(companyId, id);
  }

  // =========================================================================
  // SOFT DELETE
  // =========================================================================

  @Delete(':id')
  @RequirePermissions(PermissionKeys.QUOTES_DELETE)
  @ApiOperation({ summary: 'Soft-delete a quotation (if not accepted/converted)' })
  @ApiParam({ name: 'id', description: 'Quotation ObjectId' })
  async softDelete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() req: AuthenticatedRequest,
  ) {
    const companyId = this.resolveCompanyId(req);
    return this.quotationsService.softDelete(
      companyId,
      id,
      new Types.ObjectId(req.user.userId),
    );
  }
}
