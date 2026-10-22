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
import { EmployeeDocumentsService } from './employee-documents.service';
import { UploadEmployeeDocumentDto } from './dto/upload-employee-document.dto';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
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
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES,
  EmployeeDocumentCategory,
  MAX_DOCUMENT_FILE_SIZE,
} from './constants/employee-document.constant';
import { Types } from 'mongoose';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmploymentStatusDto } from './dto/update-employment-status.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { LinkEmployeeDto } from './dto/link-employee.dto';
import { GetEmployeeStatusHistoryQueryDto } from './dto/get-employee-status-history-query.dto';
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
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly employeeDocumentsService: EmployeeDocumentsService,
  ) {}

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

  @Get(':id/status-history')
  @ApiOperation({ summary: 'Get employee status history' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiOkResponse({ description: 'The employee status history.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.VIEW),
  )
  async getStatusHistory(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: GetEmployeeStatusHistoryQueryDto,
  ) {
    const result = await this.employeesService.getStatusHistory(id, query);
    return { success: true, data: result.data, meta: result.meta };
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

  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_DOCUMENT_FILE_SIZE,
      },
      fileFilter: (_req, file, callback) => {
        if (
          !ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES.includes(
            file.mimetype as (typeof ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES)[number],
          )
        ) {
          return callback(
            new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Invalid file type. Allowed: ${ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES.join(', ')}`,
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  @ApiOperation({ summary: 'Upload an employee document' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'category'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file (PDF, JPEG, PNG, max 10MB)',
        },
        category: {
          type: 'string',
          enum: Object.values(EmployeeDocumentCategory),
          description:
            'Category of the document (e.g. ID_PROOF, RESUME, OFFER_LETTER, CERTIFICATE)',
          example: EmployeeDocumentCategory.ID_PROOF,
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Document uploaded successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.EDIT),
  )
  async uploadDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadEmployeeDocumentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const document = await this.employeeDocumentsService.uploadDocument(
      id,
      request.user.userId,
      file,
      dto,
      { ipAddress, userAgent },
    );
    return { success: true, data: document };
  }

  @Get(':id/documents')
  @ApiOperation({ summary: 'List employee documents' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiOkResponse({ description: 'List of documents.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.VIEW),
  )
  async listDocuments(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: PaginationQueryDto,
  ) {
    const result = await this.employeeDocumentsService.listDocuments(id, query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id/documents/:documentId/download')
  @ApiOperation({ summary: 'Get document download URL' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiParam({ name: 'documentId', description: 'Document ID', type: String })
  @ApiOkResponse({ description: 'Pre-signed download URL.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.VIEW),
  )
  async downloadDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('documentId', ParseObjectIdPipe) documentId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const result = await this.employeeDocumentsService.getDocumentDownloadUrl(
      id,
      documentId,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: result };
  }

  @Delete(':id/documents/:documentId')
  @ApiOperation({ summary: 'Delete an employee document' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiParam({ name: 'documentId', description: 'Document ID', type: String })
  @ApiOkResponse({ description: 'Document deleted successfully.' })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.EDIT),
  )
  async deleteDocument(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('documentId', ParseObjectIdPipe) documentId: Types.ObjectId,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.employeeDocumentsService.deleteDocument(
      id,
      documentId,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, message: 'Document successfully deleted' };
  }

  @Post(':id/link-user')
  @ApiOperation({ summary: 'Link an existing user to an employee' })
  @ApiParam({ name: 'id', description: 'Employee ID', type: String })
  @ApiOkResponse({
    description: 'User linked to employee successfully.',
  })
  @RequirePermissions(
    PermissionKey.of(PermissionModule.EMPLOYEES, PermissionAction.ASSIGN),
  )
  async linkUser(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: LinkEmployeeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    const employee = await this.employeesService.linkUser(
      id,
      new Types.ObjectId(dto.userId),
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, data: employee };
  }
}
