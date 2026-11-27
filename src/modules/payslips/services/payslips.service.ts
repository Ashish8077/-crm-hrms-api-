import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { buildPaginationMeta } from '../../../common/pagination/pagination.util';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { detectMimeTypeFromBuffer } from '../../../common/utils/file-signature.util';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { AuthorizationService } from '../../authorization/authorization.service';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { DepartmentRepository } from '../../departments/repositories/department.repository';
import { DesignationRepository } from '../../designations/repositories/designation.repository';
import { EmployeeRepository } from '../../employees/repositories/employee.repository';
import { PayrollRecordStatus } from '../../payroll-calculations/constants/payroll-calculation.constant';
import { PayrollRecordRepository } from '../../payroll-calculations/repositories/payroll-record.repository';
import { PayrollRecordLean } from '../../payroll-calculations/schemas/payroll-record.schema';
import { PayrollPeriodStatus } from '../../payroll-periods/constants/payroll-period.constant';
import { PayrollPeriodRepository } from '../../payroll-periods/repositories/payroll-period.repository';
import { PayrollPeriodLean } from '../../payroll-periods/schemas/payroll-period.schema';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import {
  FailedStorageOperation,
  FailedStorageOperationDocument,
  FailedStorageStatus,
  StorageOperationType,
} from '../../storage/schemas/failed-storage-operation.schema';
import { StorageService } from '../../storage/storage.service';
import {
  PAYSLIP_CONSTANTS,
  PAYSLIP_TEMPLATE_VERSION,
  buildSafePayslipFilename,
} from '../constants/payslip.constant';
import {
  ListPayslipsQueryDto,
  PayslipListItemDto,
  PayslipResponseDto,
} from '../dto/payslip.dto';
import {
  PayslipMapper,
  PayslipOrganizationInfo,
} from '../mappers/payslip.mapper';
import { PayslipRepository } from '../repositories/payslip.repository';
import { PayslipLean } from '../schemas/payslip.schema';
import { PayslipPdfRendererService } from './payslip-pdf-renderer.service';

@Injectable()
export class PayslipsService {
  private readonly logger = new Logger(PayslipsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly payslipRepository: PayslipRepository,
    private readonly payrollPeriodRepository: PayrollPeriodRepository,
    private readonly payrollRecordRepository: PayrollRecordRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly departmentRepository: DepartmentRepository,
    private readonly designationRepository: DesignationRepository,
    private readonly branchRepository: BranchRepository,
    private readonly authorizationService: AuthorizationService,
    private readonly auditLogsService: AuditLogsService,
    private readonly storageService: StorageService,
    @InjectModel(FailedStorageOperation.name)
    private readonly failedStorageModel: Model<FailedStorageOperationDocument>,
    private readonly pdfRendererService: PayslipPdfRendererService,
    private readonly configService: ConfigService,
  ) {}

  async generatePayslip(
    periodId: Types.ObjectId,
    employeeId: Types.ObjectId,
    actorId: Types.ObjectId,
    clientMetadata?: ClientMetadata,
  ): Promise<PayslipResponseDto> {
    const { period, record } = await this.validateEligibility(
      periodId,
      employeeId,
    );

    const existingPayslip =
      await this.payslipRepository.findByPeriodAndEmployee(
        periodId,
        employeeId,
      );

    let isRegeneration = false;
    let previousFileKey: string | null = null;

    if (existingPayslip) {
      const sameVersionAndTemplate =
        existingPayslip.payrollCalculationVersion ===
          record.calculationVersion &&
        existingPayslip.templateVersion === PAYSLIP_TEMPLATE_VERSION;

      if (sameVersionAndTemplate) {
        const usable = await this.isStoredPdfValid(
          existingPayslip,
          clientMetadata?.requestId,
        );
        if (usable) {
          return PayslipMapper.toResponseDto(existingPayslip, record);
        }
      }

      isRegeneration = true;
      previousFileKey = existingPayslip.fileKey;
    }

    const orgInfo = await this.resolveOrganizationDisplayInfo(employeeId);
    const renderData = PayslipMapper.buildRenderData(period, record, orgInfo);
    const pdfBuffer = await this.pdfRendererService.renderPdfBuffer(renderData);

    if (
      pdfBuffer.length === 0 ||
      pdfBuffer.length > PAYSLIP_CONSTANTS.MAX_PDF_SIZE_BYTES ||
      detectMimeTypeFromBuffer(pdfBuffer) !== PAYSLIP_CONSTANTS.MIME_TYPE
    ) {
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Generated payslip PDF buffer failed format or size verification.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const checksumSha256 = this.computeSha256(pdfBuffer);
    const folder = `${PAYSLIP_CONSTANTS.STORAGE_FOLDER_PREFIX}/${periodId.toHexString()}/${employeeId.toHexString()}`;

    const uploadResult = await this.storageService.uploadFile(
      {
        buffer: pdfBuffer,
        mimetype: PAYSLIP_CONSTANTS.MIME_TYPE,
        originalname: renderData.fileName,
        size: pdfBuffer.length,
      } as unknown as Express.Multer.File,
      folder,
      [PAYSLIP_CONSTANTS.MIME_TYPE],
      PAYSLIP_CONSTANTS.MAX_PDF_SIZE_BYTES,
      '.pdf',
      clientMetadata?.requestId,
    );
    const uploadedKey = uploadResult.key;

    const generatedAt = new Date();
    let persistedPayslip: PayslipLean;

    try {
      persistedPayslip = await this.runInTransaction(async (session) => {
        const currentCheck = await this.validateEligibility(
          periodId,
          employeeId,
          session,
        );

        let saved: PayslipLean | null;
        if (isRegeneration && existingPayslip) {
          saved = await this.payslipRepository.updateRegeneratedAtomically(
            existingPayslip._id,
            existingPayslip.__v ?? 0,
            {
              payrollRecordId: currentCheck.record._id,
              payrollCalculationVersion: currentCheck.record.calculationVersion,
              templateVersion: PAYSLIP_TEMPLATE_VERSION,
              fileKey: uploadedKey,
              fileName: renderData.fileName,
              mimeType: PAYSLIP_CONSTANTS.MIME_TYPE,
              fileSize: pdfBuffer.length,
              checksumSha256,
              generatedAt,
              generatedBy: actorId,
            },
            session,
          );
          if (!saved) {
            throw new AppError(
              ErrorCode.CONCURRENT_MODIFICATION,
              'Concurrent payslip regeneration detected. Please refresh and try again.',
              HttpStatus.CONFLICT,
            );
          }
        } else {
          saved = await this.payslipRepository.create(
            {
              payrollPeriodId: periodId,
              payrollRecordId: currentCheck.record._id,
              employeeId,
              payrollCalculationVersion: currentCheck.record.calculationVersion,
              templateVersion: PAYSLIP_TEMPLATE_VERSION,
              fileKey: uploadedKey,
              fileName: renderData.fileName,
              mimeType: PAYSLIP_CONSTANTS.MIME_TYPE,
              fileSize: pdfBuffer.length,
              checksumSha256,
              generatedAt,
              generatedBy: actorId,
            },
            session,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: isRegeneration
              ? AuditAction.PAYSLIP_REGENERATED
              : AuditAction.PAYSLIP_GENERATED,
            targetId: saved._id,
            targetModel: AuditTargetModel.PAYSLIP,
            details: {
              payrollPeriodId: periodId.toHexString(),
              periodCode: currentCheck.period.periodCode,
              payrollRecordId: currentCheck.record._id.toHexString(),
              employeeId: employeeId.toHexString(),
              employeeCode:
                currentCheck.record.calculationSnapshot.employeeCode,
              calculationVersion: currentCheck.record.calculationVersion,
              templateVersion: PAYSLIP_TEMPLATE_VERSION,
              fileName: renderData.fileName,
              fileSize: pdfBuffer.length,
            },
            ipAddress: clientMetadata?.ipAddress ?? null,
            userAgent: clientMetadata?.userAgent ?? null,
          },
          session,
        );

        return saved;
      });
    } catch (error: unknown) {
      await this.compensatingDeleteStorageFile(
        uploadedKey,
        clientMetadata?.requestId,
      );

      if (
        !isRegeneration &&
        this.payslipRepository.isDuplicateKeyError(error)
      ) {
        const winner = await this.payslipRepository.findByPeriodAndEmployee(
          periodId,
          employeeId,
        );
        if (
          winner &&
          (await this.isStoredPdfValid(winner, clientMetadata?.requestId))
        ) {
          return PayslipMapper.toResponseDto(winner, record);
        }
        throw new AppError(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Concurrent payslip generation detected. Please retry the request.',
          HttpStatus.CONFLICT,
        );
      }

      throw error;
    }

    if (
      isRegeneration &&
      previousFileKey &&
      previousFileKey !== persistedPayslip.fileKey
    ) {
      await this.compensatingDeleteStorageFile(
        previousFileKey,
        clientMetadata?.requestId,
      );
    }

    return PayslipMapper.toResponseDto(persistedPayslip, record);
  }

  async getPayslip(
    periodId: Types.ObjectId,
    employeeId: Types.ObjectId,
    actorUserId: Types.ObjectId,
    roleIds: Types.ObjectId[],
  ): Promise<PayslipResponseDto> {
    await this.authorizeEmployeePayslipAccess(
      actorUserId,
      roleIds,
      employeeId,
      PermissionKeys.PAYSLIPS_VIEW,
    );

    const { record } = await this.validateEligibility(periodId, employeeId);
    const payslip = await this.payslipRepository.findByPeriodAndEmployee(
      periodId,
      employeeId,
    );

    if (!payslip) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payslip has not been generated yet for this employee and payroll period.',
        HttpStatus.NOT_FOUND,
      );
    }

    return PayslipMapper.toResponseDto(payslip, record);
  }

  async downloadPayslip(
    periodId: Types.ObjectId,
    employeeId: Types.ObjectId,
    actorUserId: Types.ObjectId,
    roleIds: Types.ObjectId[],
    clientMetadata?: ClientMetadata,
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    await this.authorizeEmployeePayslipAccess(
      actorUserId,
      roleIds,
      employeeId,
      PermissionKeys.PAYSLIPS_EXPORT,
    );

    const { period, record } = await this.validateEligibility(
      periodId,
      employeeId,
    );
    const payslip = await this.payslipRepository.findByPeriodAndEmployee(
      periodId,
      employeeId,
    );

    if (!payslip) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payslip has not been generated yet for this employee and payroll period.',
        HttpStatus.NOT_FOUND,
      );
    }

    let buffer: Buffer;
    try {
      buffer = await this.storageService.downloadFile(
        payslip.fileKey,
        clientMetadata?.requestId,
      );
    } catch (error: unknown) {
      if (
        error instanceof AppError &&
        error.code === ErrorCode.RESOURCE_NOT_FOUND
      ) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Payslip file is missing from storage. Please regenerate the payslip.',
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }

    if (!this.verifyPdfBufferIntegrity(buffer, payslip)) {
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Stored payslip file failed integrity verification and may be corrupted. Please regenerate the payslip.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    await this.auditLogsService.createAuditLog({
      actorId: actorUserId,
      action: AuditAction.PAYSLIP_DOWNLOADED,
      targetId: payslip._id,
      targetModel: AuditTargetModel.PAYSLIP,
      details: {
        payrollPeriodId: periodId.toHexString(),
        periodCode: period.periodCode,
        payrollRecordId: record._id.toHexString(),
        employeeId: employeeId.toHexString(),
        employeeCode: record.calculationSnapshot.employeeCode,
        fileName: payslip.fileName,
      },
      ipAddress: clientMetadata?.ipAddress ?? null,
      userAgent: clientMetadata?.userAgent ?? null,
    });

    return {
      buffer,
      fileName: buildSafePayslipFilename(
        record.calculationSnapshot.periodCode,
        record.calculationSnapshot.employeeCode,
      ),
      mimeType: PAYSLIP_CONSTANTS.MIME_TYPE,
    };
  }

  async listPeriodPayslips(
    periodId: Types.ObjectId,
    query: ListPayslipsQueryDto,
  ): Promise<PaginatedResult<PayslipListItemDto>> {
    const period = await this.payrollPeriodRepository.findById(periodId);
    if (!period || period.deletedAt != null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { data, total } = await this.payslipRepository.findPaginatedByPeriod(
      periodId,
      { page, limit, search: query.search },
    );

    return {
      data: data.map((row) => PayslipMapper.toListItemDto(row)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  private async validateEligibility(
    periodId: Types.ObjectId,
    employeeId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ period: PayrollPeriodLean; record: PayrollRecordLean }> {
    // Sequential execution preserves single-session transaction safety on MongoDB replica sets
    const period = await this.payrollPeriodRepository.findById(
      periodId,
      session,
    );
    const record = await this.payrollRecordRepository.findByPeriodAndEmployee(
      periodId,
      employeeId,
      session,
    );

    if (!period || period.deletedAt != null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll period not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (period.status !== PayrollPeriodStatus.FINALIZED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payslips can only be accessed or generated for FINALIZED payroll periods (current status: '${period.status}').`,
        HttpStatus.CONFLICT,
      );
    }

    if (!record || record.deletedAt != null) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Payroll record not found for the requested employee and payroll period.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (
      !record.payrollPeriodId.equals(period._id) ||
      !record.employeeId.equals(employeeId)
    ) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Payroll record ownership does not match requested payroll period or employee.',
        HttpStatus.CONFLICT,
      );
    }

    if (record.status === PayrollRecordStatus.INVALIDATED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Cannot generate or access payslip for an INVALIDATED payroll record.',
        HttpStatus.CONFLICT,
      );
    }

    if (record.status !== PayrollRecordStatus.APPROVED) {
      throw new AppError(
        ErrorCode.CONCURRENT_MODIFICATION,
        `Payslips require an APPROVED payroll record (current status: '${String(record.status)}').`,
        HttpStatus.CONFLICT,
      );
    }

    return { period, record };
  }

  private async authorizeEmployeePayslipAccess(
    actorUserId: Types.ObjectId,
    roleIds: Types.ObjectId[],
    targetEmployeeId: Types.ObjectId,
    orgPermissionKey: string,
  ): Promise<void> {
    const [hasOrgPermission, hasOwnPermission] = await Promise.all([
      this.authorizationService.hasPermissions(roleIds, [orgPermissionKey]),
      this.authorizationService.hasPermissions(roleIds, [
        PermissionKeys.PAYSLIPS_VIEW_OWN,
      ]),
    ]);

    if (hasOrgPermission) {
      return;
    }

    if (hasOwnPermission) {
      const linkedEmployee =
        await this.employeeRepository.findByUserId(actorUserId);
      if (linkedEmployee && linkedEmployee._id.equals(targetEmployeeId)) {
        return;
      }
    }

    throw new AppError(
      ErrorCode.FORBIDDEN,
      'You are not authorized to access this payslip.',
      HttpStatus.FORBIDDEN,
    );
  }

  private async resolveOrganizationDisplayInfo(
    employeeId: Types.ObjectId,
  ): Promise<PayslipOrganizationInfo> {
    const companyName =
      this.configService?.get<string>('app.companyName') ?? null;
    const companyAddress =
      this.configService?.get<string>('app.companyAddress') ?? null;

    const employee = await this.employeeRepository.findById(employeeId);
    if (!employee) {
      return { companyName, companyAddress };
    }

    const [dept, designation, branch] = await Promise.all([
      employee.departmentId
        ? this.departmentRepository
            .findById(employee.departmentId)
            .catch(() => null)
        : Promise.resolve(null),
      employee.designationId
        ? this.designationRepository
            .findById(employee.designationId)
            .catch(() => null)
        : Promise.resolve(null),
      employee.branchId
        ? this.branchRepository.findById(employee.branchId).catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      companyName,
      companyAddress,
      departmentName: dept?.name ?? null,
      designationName: designation?.name ?? null,
      branchName: branch?.name ?? null,
      branchAddress: branch?.address ?? null,
    };
  }

  private async isStoredPdfValid(
    payslip: PayslipLean,
    requestId?: string | null,
  ): Promise<boolean> {
    try {
      const buffer = await this.storageService.downloadFile(
        payslip.fileKey,
        requestId,
      );
      return this.verifyPdfBufferIntegrity(buffer, payslip);
    } catch (error: unknown) {
      if (
        error instanceof AppError &&
        error.code === ErrorCode.RESOURCE_NOT_FOUND
      ) {
        return false;
      }
      throw error;
    }
  }

  private verifyPdfBufferIntegrity(
    buffer: Buffer,
    payslip: Pick<PayslipLean, 'checksumSha256' | 'fileSize'>,
  ): boolean {
    if (!buffer || buffer.length === 0) {
      return false;
    }
    if (buffer.length !== payslip.fileSize) {
      return false;
    }
    if (detectMimeTypeFromBuffer(buffer) !== PAYSLIP_CONSTANTS.MIME_TYPE) {
      return false;
    }
    return this.computeSha256(buffer) === payslip.checksumSha256;
  }

  private computeSha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private async compensatingDeleteStorageFile(
    fileKey: string,
    requestId?: string | null,
  ): Promise<void> {
    try {
      await this.storageService.deleteFile(fileKey, requestId);
    } catch (deleteErr: unknown) {
      const message =
        deleteErr instanceof Error
          ? deleteErr.message
          : 'Storage delete failed';
      try {
        await this.failedStorageModel.create({
          fileKey,
          operation: StorageOperationType.DELETE,
          status: FailedStorageStatus.PENDING,
          lastError: message,
          nextRetryAt: new Date(Date.now() + 60_000),
        });
      } catch (outboxErr: unknown) {
        this.logger.error(
          { requestId: requestId ?? null, fileKey },
          `Failed to enqueue orphan storage cleanup: ${(outboxErr as Error).message}`,
        );
      }
    }
  }

  private async runInTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(work);
    } finally {
      await session.endSession();
    }
  }
}
