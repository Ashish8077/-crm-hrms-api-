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
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { UpdateLeadScoreDto } from './dto/update-lead-score.dto';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { TransferLeadDto } from './dto/transfer-lead.dto';
import { BulkAssignLeadsDto } from './dto/bulk-assign-leads.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { CheckDuplicateDto } from './dto/check-duplicate.dto';
import { AddLeadNoteDto } from './dto/add-lead-note.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import { AddLeadDocumentDto } from './dto/add-lead-document.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@ApiTags('CRM - Leads')
@ApiBearerAuth('access-token')
@Controller({
  path: 'leads',
  version: '1',
})
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new lead' })
  @ApiCreatedResponse({ description: 'Lead successfully created.' })
  @RequirePermissions(PermissionKeys.LEADS_CREATE)
  async create(
    @Body() dto: CreateLeadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.create(dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, data: lead };
  }

  @Get()
  @ApiOperation({ summary: 'List leads with filters, search, and pagination' })
  @ApiOkResponse({ description: 'List of leads returned successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_VIEW)
  async list(@Query() query: ListLeadsQueryDto) {
    const result = await this.leadsService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Post('import')
  @ApiOperation({ summary: 'Import multiple leads with duplicate detection' })
  @ApiCreatedResponse({ description: 'Import process completed.' })
  @RequirePermissions(PermissionKeys.LEADS_CREATE)
  async import(
    @Body() dto: ImportLeadsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leadsService.importLeads(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Get('export')
  @ApiOperation({ summary: 'Export leads according to query filters' })
  @ApiOkResponse({ description: 'Exported leads dataset.' })
  @RequirePermissions(PermissionKeys.LEADS_EXPORT)
  async export(@Query() query: ListLeadsQueryDto) {
    const data = await this.leadsService.exportLeads(query);
    return { success: true, data };
  }

  @Post('check-duplicate')
  @ApiOperation({
    summary: 'Check for potential lead duplicate by email or phone',
  })
  @ApiOkResponse({ description: 'Duplicate check outcome.' })
  @RequirePermissions(PermissionKeys.LEADS_VIEW)
  async checkDuplicate(@Body() dto: CheckDuplicateDto) {
    const result = await this.leadsService.checkDuplicate(dto);
    return { success: true, data: result };
  }

  @Post('bulk-assign')
  @ApiOperation({ summary: 'Bulk assign multiple leads to an owner' })
  @ApiOkResponse({ description: 'Leads assigned successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_ASSIGN)
  async bulkAssign(
    @Body() dto: BulkAssignLeadsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.leadsService.bulkAssign(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead details by ID' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiOkResponse({ description: 'Lead details retrieved successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_VIEW)
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const lead = await this.leadsService.findById(id);
    return { success: true, data: lead };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update lead details' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiOkResponse({ description: 'Lead updated successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateLeadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.update(id, dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, data: lead };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update lead status' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiOkResponse({ description: 'Lead status updated successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateLeadStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.updateStatus(
      id,
      dto.status,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  @Patch(':id/score')
  @ApiOperation({ summary: 'Update lead score' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiOkResponse({ description: 'Lead score updated successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async updateScore(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateLeadScoreDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.updateScore(
      id,
      dto.score,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign lead owner' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiOkResponse({ description: 'Lead owner assigned successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_ASSIGN)
  async assignOwner(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AssignLeadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.assignOwner(
      id,
      new Types.ObjectId(dto.ownerId),
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  @Post(':id/transfer')
  @ApiOperation({ summary: 'Transfer lead ownership with audit' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiOkResponse({ description: 'Lead ownership transferred successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_ASSIGN)
  async transferOwner(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: TransferLeadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.transferOwner(
      id,
      new Types.ObjectId(dto.newOwnerId),
      dto.reason,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a lead' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiOkResponse({ description: 'Lead successfully deleted.' })
  @RequirePermissions(PermissionKeys.LEADS_DELETE)
  async delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.leadsService.softDelete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Lead successfully deleted' };
  }

  // Notes
  @Post(':id/notes')
  @ApiOperation({ summary: 'Add note to a lead' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiCreatedResponse({ description: 'Note added successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async addNote(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AddLeadNoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.addNote(id, dto, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, data: lead };
  }

  @Delete(':id/notes/:noteId')
  @ApiOperation({ summary: 'Delete a note from lead' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiParam({ name: 'noteId', description: 'Note ID', type: String })
  @ApiOkResponse({ description: 'Note removed successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async deleteNote(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('noteId', ParseObjectIdPipe) noteId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.deleteNote(
      id,
      noteId,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  // Follow-ups
  @Post(':id/follow-ups')
  @ApiOperation({ summary: 'Schedule a follow-up for lead' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiCreatedResponse({ description: 'Follow-up created successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async addFollowUp(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: CreateFollowUpDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.addFollowUp(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  @Patch(':id/follow-ups/:followUpId')
  @ApiOperation({ summary: 'Update follow-up status or schedule' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiParam({ name: 'followUpId', description: 'Follow-up ID', type: String })
  @ApiOkResponse({ description: 'Follow-up updated successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async updateFollowUp(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('followUpId', ParseObjectIdPipe) followUpId: Types.ObjectId,
    @Body() dto: UpdateFollowUpDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.updateFollowUp(
      id,
      followUpId,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  // Documents
  @Post(':id/documents')
  @ApiOperation({ summary: 'Attach a document metadata to lead' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiCreatedResponse({ description: 'Document attached successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async addDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AddLeadDocumentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.addDocument(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  @Delete(':id/documents/:documentId')
  @ApiOperation({ summary: 'Delete document from lead' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiParam({ name: 'documentId', description: 'Document ID', type: String })
  @ApiOkResponse({ description: 'Document deleted successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_EDIT)
  async deleteDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('documentId', ParseObjectIdPipe) documentId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const lead = await this.leadsService.deleteDocument(
      id,
      documentId,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: lead };
  }

  // Activity Timeline
  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get lead activity timeline (audit events)' })
  @ApiParam({ name: 'id', description: 'Lead ID', type: String })
  @ApiOkResponse({ description: 'Lead timeline returned successfully.' })
  @RequirePermissions(PermissionKeys.LEADS_VIEW)
  async getTimeline(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const timeline = await this.leadsService.getTimeline(id);
    return { success: true, data: timeline };
  }
}
