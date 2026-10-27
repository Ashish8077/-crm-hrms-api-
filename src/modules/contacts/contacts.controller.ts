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
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts-query.dto';
import { LinkCompanyDto } from './dto/link-company.dto';
import { AssignContactDto } from './dto/assign-contact.dto';
import { AddContactNoteDto } from './dto/add-contact-note.dto';
import { LogContactActivityDto } from './dto/log-contact-activity.dto';
import { UpdateContactActivityDto } from './dto/update-contact-activity.dto';
import { UploadContactDocumentDto } from './dto/upload-contact-document.dto';
import { CheckDuplicateContactDto } from './dto/check-duplicate-contact.dto';
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

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

@ApiTags('CRM - Contacts')
@ApiBearerAuth('access-token')
@Controller({
  path: 'contacts',
  version: '1',
})
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  // 18. Create Contact
  @Post()
  @ApiOperation({ summary: 'Create a new contact' })
  @ApiCreatedResponse({ description: 'Contact successfully created.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.CREATE),
  )
  async create(
    @Body() dto: CreateContactDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const contact = await this.contactsService.create(
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: contact };
  }

  // 19. List Contacts
  @Get()
  @ApiOperation({
    summary: 'List contacts with filters, search, and pagination',
  })
  @ApiOkResponse({ description: 'List of contacts.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.VIEW),
  )
  async list(@Query() query: ListContactsQueryDto) {
    const result = await this.contactsService.list(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  // 26. Check Duplicate
  @Post('check-duplicate')
  @ApiOperation({ summary: 'Check if email or phone already exists' })
  @ApiOkResponse({ description: 'Duplicate check result.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.VIEW),
  )
  async checkDuplicate(@Body() dto: CheckDuplicateContactDto) {
    const result = await this.contactsService.checkDuplicate(dto);
    return { success: true, data: result };
  }

  // 20. Get Contact by ID
  @Get(':id')
  @ApiOperation({ summary: 'Get contact details by ID' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiOkResponse({ description: 'Contact details.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.VIEW),
  )
  async getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    const contact = await this.contactsService.getById(id);
    return { success: true, data: contact };
  }

  // 21. Update Contact
  @Patch(':id')
  @ApiOperation({ summary: 'Update contact details' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiOkResponse({ description: 'Contact updated successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.EDIT),
  )
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateContactDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const contact = await this.contactsService.update(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: contact };
  }

  // 22. Soft Delete Contact
  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a contact' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiOkResponse({ description: 'Contact successfully deleted.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.DELETE),
  )
  async delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.contactsService.softDelete(id, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Contact successfully deleted' };
  }

  // 23. Link Contact to Company
  @Post(':id/link-company')
  @ApiOperation({ summary: 'Link or transfer contact to a company' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiOkResponse({ description: 'Contact linked to company successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.EDIT),
  )
  async linkCompany(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: LinkCompanyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const contact = await this.contactsService.linkCompany(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: contact };
  }

  // 24. Unlink Contact from Company
  @Delete(':id/unlink-company')
  @ApiOperation({ summary: 'Unlink contact from company' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiOkResponse({ description: 'Contact unlinked from company successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.EDIT),
  )
  async unlinkCompany(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const contact = await this.contactsService.unlinkCompany(
      id,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: contact };
  }

  // 25. Assign Contact Owner
  @Patch(':id/owner')
  @ApiOperation({ summary: 'Reassign contact sales representative' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiOkResponse({ description: 'Owner reassigned successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.EDIT),
  )
  async assignOwner(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AssignContactDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const contact = await this.contactsService.assignOwner(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: contact };
  }

  // 27. Add Note
  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to the contact' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiCreatedResponse({ description: 'Note added successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.EDIT),
  )
  async addNote(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AddContactNoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const contact = await this.contactsService.addNote(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: contact };
  }

  // 28. Delete Note
  @Delete(':id/notes/:noteId')
  @ApiOperation({ summary: 'Delete a note from the contact' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiParam({ name: 'noteId', description: 'Note ID', type: String })
  @ApiOkResponse({ description: 'Note successfully deleted.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.DELETE),
  )
  async deleteNote(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('noteId', ParseObjectIdPipe) noteId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.contactsService.deleteNote(id, noteId, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Note successfully deleted' };
  }

  // 29. Upload Document
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
  @ApiOperation({ summary: 'Upload a document for the contact' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document (PDF, JPEG, PNG, DOCX max 10MB)',
        },
        fileName: { type: 'string', description: 'Custom document name' },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Document uploaded successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.EDIT),
  )
  async uploadDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadContactDocumentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const contact = await this.contactsService.uploadDocument(
      id,
      file,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: contact };
  }

  // 30. Download Document
  @Get(':id/documents/:docId/download')
  @ApiOperation({
    summary: 'Generate pre-signed S3 download URL for contact document',
  })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiParam({ name: 'docId', description: 'Document ID', type: String })
  @ApiOkResponse({ description: 'Pre-signed download URL.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.VIEW),
  )
  async downloadDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('docId', ParseObjectIdPipe) docId: Types.ObjectId,
  ) {
    const result = await this.contactsService.getDocumentDownloadUrl(id, docId);
    return { success: true, data: result };
  }

  // 31. Delete Document
  @Delete(':id/documents/:docId')
  @ApiOperation({ summary: 'Delete a document from the contact' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiParam({ name: 'docId', description: 'Document ID', type: String })
  @ApiOkResponse({ description: 'Document successfully deleted.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.DELETE),
  )
  async deleteDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('docId', ParseObjectIdPipe) docId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.contactsService.deleteDocument(id, docId, request.user.userId, {
      ipAddress,
      userAgent,
    });
    return { success: true, message: 'Document successfully deleted' };
  }

  // 32. Log Activity
  @Post(':id/activities')
  @ApiOperation({ summary: 'Log a communication / activity for the contact' })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiCreatedResponse({ description: 'Activity logged successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.EDIT),
  )
  async logActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: LogContactActivityDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const activity = await this.contactsService.logActivity(
      id,
      dto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: activity };
  }

  // 33. Get Activities Timeline
  @Get(':id/activities')
  @ApiOperation({
    summary: 'Get paginated communication timeline for the contact',
  })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiOkResponse({ description: 'Paginated timeline activities.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.VIEW),
  )
  async getActivities(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.contactsService.getActivities(id, query);
    return { success: true, data: result.data, meta: result.meta };
  }

  // 34. Update Activity
  @Patch(':id/activities/:activityId')
  @ApiOperation({
    summary: 'Update an activity for the contact (Author or Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiParam({ name: 'activityId', description: 'Activity ID', type: String })
  @ApiOkResponse({ description: 'Activity updated successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.EDIT),
  )
  async updateActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('activityId', ParseObjectIdPipe) activityId: Types.ObjectId,
    @Body() dto: UpdateContactActivityDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const activity = await this.contactsService.updateActivity(
      id,
      activityId,
      dto,
      request.user.userId,
    );
    return { success: true, data: activity };
  }

  // 35. Delete Activity
  @Delete(':id/activities/:activityId')
  @ApiOperation({
    summary: 'Delete an activity for the contact (Author or Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Contact ID', type: String })
  @ApiParam({ name: 'activityId', description: 'Activity ID', type: String })
  @ApiOkResponse({ description: 'Activity successfully deleted.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.CONTACTS, PermissionAction.DELETE),
  )
  async deleteActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('activityId', ParseObjectIdPipe) activityId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contactsService.deleteActivity(
      id,
      activityId,
      request.user.userId,
    );
    return { success: true, message: 'Activity successfully deleted' };
  }
}
