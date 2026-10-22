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
  UseInterceptors,
  UploadedFile,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiParam,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import { AssignCompanyDto } from './dto/assign-company.dto';
import { AddCompanyNoteDto } from './dto/add-company-note.dto';
import { LogCompanyActivityDto } from './dto/log-company-activity.dto';
import { UpdateCompanyActivityDto } from './dto/update-company-activity.dto';
import { UploadCompanyDocumentDto } from './dto/upload-company-document.dto';
import { CheckDuplicateCompanyDto } from './dto/check-duplicate-company.dto';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PermissionModule,
  PermissionAction,
  PermissionKey,
} from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ContactRepository } from '../contacts/repositories/contact.repository';
import { ContactMapper } from '../contacts/mappers/contact.mapper';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

@ApiTags('CRM - Companies')
@ApiBearerAuth('access-token')
@Controller({
  path: 'companies',
  version: '1',
})
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly contactRepository: ContactRepository,
  ) {}

  // 1. Create Company
  @Post()
  @ApiOperation({ summary: 'Create a new company' })
  @ApiCreatedResponse({ description: 'Company successfully created.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.CREATE))
  async create(
    @Body() dto: CreateCompanyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const company = await this.companiesService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: company };
  }

  // 2. List Companies
  @Get()
  @ApiOperation({ summary: 'List companies with filters, search, and pagination' })
  @ApiOkResponse({ description: 'List of companies.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.VIEW))
  async list(@Query() query: ListCompaniesQueryDto) {
    const result = await this.companiesService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  // 17. Check Duplicate
  @Post('check-duplicate')
  @ApiOperation({ summary: 'Check if registration number, domain, or email already exists' })
  @ApiOkResponse({ description: 'Duplicate check result.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.VIEW))
  async checkDuplicate(@Body() dto: CheckDuplicateCompanyDto) {
    const result = await this.companiesService.checkDuplicate(dto);
    return { success: true, data: result };
  }

  // 3. Get Company by ID
  @Get(':id')
  @ApiOperation({ summary: 'Get company details by ID' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiOkResponse({ description: 'Company details.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.VIEW))
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const company = await this.companiesService.getById(id);
    const primaryContact = await this.contactRepository.findPrimaryContactByCompanyId(id);
    if (primaryContact) {
      company.primaryContact = {
        id: primaryContact._id.toString(),
        firstName: primaryContact.firstName,
        lastName: primaryContact.lastName,
        email: primaryContact.email,
        phone: primaryContact.phone,
        jobTitle: primaryContact.jobTitle ?? null,
      };
    }
    return { success: true, data: company };
  }

  // 4. Update Company
  @Patch(':id')
  @ApiOperation({ summary: 'Update company details' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiOkResponse({ description: 'Company updated successfully.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.EDIT))
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateCompanyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const company = await this.companiesService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: company };
  }

  // 5. Soft Delete Company
  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a company' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiOkResponse({ description: 'Company successfully deleted.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.DELETE))
  async delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.companiesService.softDelete(
      id,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, message: 'Company successfully deleted' };
  }

  // 6. List Contacts for Company
  @Get(':id/contacts')
  @ApiOperation({ summary: 'Get all contacts linked to a company' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiOkResponse({ description: 'List of contacts linked to this company.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.VIEW))
  async getContacts(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const contacts = await this.contactRepository.findByCompanyId(id);
    return {
      success: true,
      data: contacts.map((c) => ContactMapper.toResponse(c)),
    };
  }

  // 7. Assign Company Owner
  @Patch(':id/owner')
  @ApiOperation({ summary: 'Reassign company account manager' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiOkResponse({ description: 'Owner reassigned successfully.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.EDIT))
  async assignOwner(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AssignCompanyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const company = await this.companiesService.assignOwner(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: company };
  }

  // 8. Add Note
  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to the company' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiCreatedResponse({ description: 'Note added successfully.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.EDIT))
  async addNote(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AddCompanyNoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const company = await this.companiesService.addNote(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: company };
  }

  // 9. Delete Note
  @Delete(':id/notes/:noteId')
  @ApiOperation({ summary: 'Delete a note from the company' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiParam({ name: 'noteId', description: 'Note ID', type: String })
  @ApiOkResponse({ description: 'Note successfully deleted.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.DELETE))
  async deleteNote(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('noteId', ParseObjectIdPipe) noteId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.companiesService.deleteNote(
      id,
      noteId,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, message: 'Note successfully deleted' };
  }

  // 10. Upload Document
  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return callback(
            new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  @ApiOperation({ summary: 'Upload a document for the company' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Document (PDF, JPEG, PNG, DOCX max 10MB)' },
        fileName: { type: 'string', description: 'Custom document name' },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Document uploaded successfully.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.EDIT))
  async uploadDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadCompanyDocumentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const company = await this.companiesService.uploadDocument(
      id,
      file,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: company };
  }

  // 11. Download Document
  @Get(':id/documents/:docId/download')
  @ApiOperation({ summary: 'Generate pre-signed S3 download URL for company document' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiParam({ name: 'docId', description: 'Document ID', type: String })
  @ApiOkResponse({ description: 'Pre-signed download URL.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.VIEW))
  async downloadDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('docId', ParseObjectIdPipe) docId: Types.ObjectId,
  ) {
    const result = await this.companiesService.getDocumentDownloadUrl(id, docId);
    return { success: true, data: result };
  }

  // 12. Delete Document
  @Delete(':id/documents/:docId')
  @ApiOperation({ summary: 'Delete a document from the company' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiParam({ name: 'docId', description: 'Document ID', type: String })
  @ApiOkResponse({ description: 'Document successfully deleted.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.DELETE))
  async deleteDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('docId', ParseObjectIdPipe) docId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.companiesService.deleteDocument(
      id,
      docId,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, message: 'Document successfully deleted' };
  }

  // 13. Log Activity
  @Post(':id/activities')
  @ApiOperation({ summary: 'Log a communication / activity for the company' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiCreatedResponse({ description: 'Activity logged successfully.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.EDIT))
  async logActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: LogCompanyActivityDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const activity = await this.companiesService.logActivity(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: activity };
  }

  // 14. Get Activities Timeline
  @Get(':id/activities')
  @ApiOperation({ summary: 'Get paginated communication timeline for the company' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiOkResponse({ description: 'Paginated timeline activities.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.VIEW))
  async getActivities(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.companiesService.getActivities(id, query);
    return { success: true, data: result.data, meta: result.meta };
  }

  // 15. Update Activity
  @Patch(':id/activities/:activityId')
  @ApiOperation({ summary: 'Update an activity for the company (Author or Admin only)' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiParam({ name: 'activityId', description: 'Activity ID', type: String })
  @ApiOkResponse({ description: 'Activity updated successfully.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.EDIT))
  async updateActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('activityId', ParseObjectIdPipe) activityId: Types.ObjectId,
    @Body() dto: UpdateCompanyActivityDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const activity = await this.companiesService.updateActivity(
      id,
      activityId,
      dto,
      request.user.userId,
    );
    return { success: true, data: activity };
  }

  // 16. Delete Activity
  @Delete(':id/activities/:activityId')
  @ApiOperation({ summary: 'Delete an activity for the company (Author or Admin only)' })
  @ApiParam({ name: 'id', description: 'Company ID', type: String })
  @ApiParam({ name: 'activityId', description: 'Activity ID', type: String })
  @ApiOkResponse({ description: 'Activity successfully deleted.' })
  @RequirePermissions(PermissionKey.of(PermissionModule.COMPANIES, PermissionAction.DELETE))
  async deleteActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('activityId', ParseObjectIdPipe) activityId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.companiesService.deleteActivity(
      id,
      activityId,
      request.user.userId,
    );
    return { success: true, message: 'Activity successfully deleted' };
  }
}
