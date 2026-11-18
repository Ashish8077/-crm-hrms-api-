import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { RoleRepository } from '../../roles/repositories/role.repository';
import { SystemRole } from '../../roles/constants/role.constant';
import { ProductRepository } from '../../products/repositories/product.repository';
import { PriceCalculatorService } from '../../products/services/price-calculator.service';
import { DealsService } from '../../deals/deals.service';
import { DealRepository } from '../../deals/repositories/deal.repository';
import { DealStage } from '../../deals/constants/deal-stage.constant';
import { StorageService } from '../../storage/storage.service';
import { RedisService } from '../../../common/redis/redis.service';
import { QuotationRepository, QuotationLean } from '../repositories/quotation.repository';
import { QuotationSequenceRepository } from '../repositories/quotation-sequence.repository';
import { SalesOrderRepository } from '../repositories/sales-order.repository';
import { SalesOrderSequenceRepository } from '../repositories/sales-order-sequence.repository';
import { EmailOutboxRepository } from '../repositories/email-outbox.repository';
import { QuotationActivityLogRepository } from '../repositories/quotation-activity-log.repository';
import { PdfGeneratorService } from './pdf-generator.service';
import { EmailOutboxProcessorService } from './email-outbox-processor.service';
import { QuotationMapper, QuotationResponse, PublicPortalQuotationResponse } from '../mappers/quotation.mapper';
import {
  ApprovalTierLevel,
  CustomerResponseAction,
  EmailDeliveryStatus,
  QuotationApprovalStatus,
  QuotationStatus,
  SalesOrderStatus,
} from '../constants/quotation-status.constant';
import {
  calculateLineTaxes,
  validateCurrency,
} from '../constants/quotation-financial.constant';
import { CreateQuotationDto } from '../dto/create-quotation.dto';
import { UpdateQuotationDto } from '../dto/update-quotation.dto';
import { UpdateQuotationStatusDto } from '../dto/update-quotation-status.dto';
import { ListQuotationsQueryDto } from '../dto/list-quotations-query.dto';
import { SendQuotationEmailDto } from '../dto/send-quotation-email.dto';
import { SpawnRevisionDto } from '../dto/spawn-revision.dto';
import { ExtendValidityDto } from '../dto/extend-validity.dto';
import { SubmitApprovalDto } from '../dto/submit-approval.dto';
import { ReviewApprovalDto } from '../dto/review-approval.dto';
import { CustomerResponseDto } from '../dto/customer-response.dto';
import { ConvertToOrderDto } from '../dto/convert-to-order.dto';
import { EmailWebhookDto } from '../dto/email-webhook.dto';
import { QuotationItem } from '../schemas/quotation-item.schema';

@Injectable()
export class QuotationsService {
  private readonly logger = new Logger(QuotationsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly quotationRepository: QuotationRepository,
    private readonly quotationSequenceRepository: QuotationSequenceRepository,
    private readonly salesOrderRepository: SalesOrderRepository,
    private readonly salesOrderSequenceRepository: SalesOrderSequenceRepository,
    private readonly emailOutboxRepository: EmailOutboxRepository,
    private readonly activityLogRepository: QuotationActivityLogRepository,
    private readonly productRepository: ProductRepository,
    private readonly priceCalculatorService: PriceCalculatorService,
    private readonly dealsService: DealsService,
    private readonly dealRepository: DealRepository,
    private readonly roleRepository: RoleRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly pdfGeneratorService: PdfGeneratorService,
    private readonly emailOutboxProcessorService: EmailOutboxProcessorService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: Admin/Manager Permission Check
  // ─────────────────────────────────────────────────────────────────────────────
  async isUserAdminOrManager(roleIds: Types.ObjectId[]): Promise<boolean> {
    if (!roleIds || roleIds.length === 0) return false;
    const activeRoles = await this.roleRepository.findActiveByIds(roleIds);
    const privilegedRoles = new Set<string>([
      SystemRole.SUPER_ADMIN,
      SystemRole.ADMIN,
      SystemRole.SALES_MANAGER,
      SystemRole.FINANCE,
    ]);
    return activeRoles.some((r) => privilegedRoles.has(r.key));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Create Quotation (Draft v1)
  // ─────────────────────────────────────────────────────────────────────────────
  async create(
    dto: CreateQuotationDto,
    actorId: Types.ObjectId,
    companyId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const currency = validateCurrency(dto.currency || 'INR');
    const quoteDate = new Date();
    const expiryDate = new Date(dto.expiryDate);

    if (expiryDate <= quoteDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Expiry date must be in the future',
        HttpStatus.BAD_REQUEST,
      );
    }

    const sellerState = (dto.sellerState || 'DL').trim().toUpperCase();
    const buyerState = dto.buyerState.trim().toUpperCase();
    const isInterState = sellerState !== buyerState;

    // Validate Deal if provided
    let dealId: Types.ObjectId | null = null;
    if (dto.dealId) {
      dealId = new Types.ObjectId(dto.dealId);
      const deal = await this.dealRepository.findById(dealId);
      if (!deal) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Associated deal not found',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    // Process line items & CPQ calculations
    const processedItems: QuotationItem[] = [];
    let subtotalMinor = 0;
    let totalDiscountMinor = 0;
    let taxableAmountMinor = 0;
    let cgstAmountMinor = 0;
    let sgstAmountMinor = 0;
    let igstAmountMinor = 0;
    let totalTaxAmountMinor = 0;
    let grandTotalMinor = 0;
    let totalMrrMinor = 0;
    let totalArrMinor = 0;

    for (const itemDto of dto.items) {
      const productId = new Types.ObjectId(itemDto.productId);
      const product = await this.productRepository.findById(productId);
      if (!product) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Product not found: ${itemDto.productId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      const unitPriceMinor = Math.round(Number(product.unitPrice || 0) * 100);
      const costPriceMinor = Math.round(Number(product.costPrice || 0) * 100);
      const taxRatePercent = Number(product.taxRate ?? 18);
      const discountPercent = Number(itemDto.discountPercent ?? 0);

      const calc = calculateLineTaxes(
        unitPriceMinor,
        costPriceMinor,
        itemDto.quantity,
        discountPercent,
        taxRatePercent,
        isInterState,
      );

      const quotationItem: QuotationItem = {
        _id: new Types.ObjectId(),
        productId,
        name: product.name,
        sku: product.sku,
        hsnSacCode: product.hsnSacCode ?? null,
        type: product.type || 'PRODUCT',
        quantityScaled: calc.quantityScaled,
        unitPriceMinor: calc.unitPriceMinor,
        costPriceMinor: calc.costPriceMinor,
        discountBasisPoints: calc.discountBasisPoints,
        discountMinor: calc.discountMinor,
        netLineTotalMinor: calc.netLineTotalMinor,
        taxBasisPoints: calc.taxBasisPoints,
        cgstMinor: calc.cgstMinor,
        sgstMinor: calc.sgstMinor,
        igstMinor: calc.igstMinor,
        totalTaxMinor: calc.totalTaxMinor,
        lineGrandTotalMinor: calc.lineGrandTotalMinor,
      };

      processedItems.push(quotationItem);

      subtotalMinor += calc.lineSubtotalMinor;
      totalDiscountMinor += calc.discountMinor;
      taxableAmountMinor += calc.netLineTotalMinor;
      cgstAmountMinor += calc.cgstMinor;
      sgstAmountMinor += calc.sgstMinor;
      igstAmountMinor += calc.igstMinor;
      totalTaxAmountMinor += calc.totalTaxMinor;
      grandTotalMinor += calc.lineGrandTotalMinor;

      // Recurring MRR/ARR
      if (product.billingCycle) {
        const cycle = product.billingCycle.toUpperCase();
        if (cycle === 'MONTHLY') {
          totalMrrMinor += calc.netLineTotalMinor;
          totalArrMinor += calc.netLineTotalMinor * 12;
        } else if (cycle === 'ANNUAL' || cycle === 'YEARLY') {
          totalMrrMinor += Math.round(calc.netLineTotalMinor / 12);
          totalArrMinor += calc.netLineTotalMinor;
        } else if (cycle === 'QUARTERLY') {
          totalMrrMinor += Math.round(calc.netLineTotalMinor / 3);
          totalArrMinor += calc.netLineTotalMinor * 4;
        }
      }
    }

    // Determine required approval tiers
    const requiredApprovalTiers = this.determineApprovalTiers(
      totalDiscountMinor,
      subtotalMinor,
      grandTotalMinor,
    );

    // Sequence & IDs
    const quoteNumber = await this.quotationSequenceRepository.getNextSequence(companyId);
    const quoteId = new Types.ObjectId();

    // Generate secure customer portal token
    const portalTokenRaw = randomBytes(32).toString('hex');
    const portalTokenHash = createHash('sha256').update(portalTokenRaw).digest('hex');

    const quoteDoc = {
      _id: quoteId,
      quoteNumber,
      title: dto.title || `Quotation ${quoteNumber}`,
      parentQuoteId: null,
      rootQuoteId: quoteId,
      revisionNumber: 1,
      isLatestRevision: true,
      companyId,
      contactId: new Types.ObjectId(dto.contactId),
      ownerId: dto.ownerId ? new Types.ObjectId(dto.ownerId) : actorId,
      dealId,
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : null,
      status: QuotationStatus.DRAFT,
      approvalStatus:
        requiredApprovalTiers.length > 0
          ? QuotationApprovalStatus.NOT_SUBMITTED
          : QuotationApprovalStatus.NOT_REQUIRED,
      requiredApprovalTiers,
      currentApprovalTier: requiredApprovalTiers.length > 0 ? requiredApprovalTiers[0] : 1,
      quoteDate,
      expiryDate,
      items: processedItems,
      subtotalMinor,
      totalDiscountMinor,
      taxableAmountMinor,
      cgstAmountMinor,
      sgstAmountMinor,
      igstAmountMinor,
      totalTaxAmountMinor,
      grandTotalMinor,
      currency,
      sellerState,
      buyerState,
      isInterState,
      totalMrrMinor,
      totalArrMinor,
      portalTokenHash,
      portalTokenExpiresAt: expiryDate,
      portalTokenUsed: false,
      portalTokenRevoked: false,
      termsAndConditions: dto.termsAndConditions || null,
      notes: dto.notes || null,
      createdBy: actorId,
      updatedBy: actorId,
    };

    const created = await this.quotationRepository.create(quoteDoc as any);

    // Activity Log
    await this.activityLogRepository.logActivity(
      companyId,
      quoteId,
      'CREATED',
      'Quotation draft created',
      actorId,
      { quoteNumber, grandTotalMinor, itemsCount: processedItems.length },
    );

    // Audit Log
    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.QUOTATION_CREATED,
      targetId: quoteId,
      targetModel: AuditTargetModel.QUOTATION,
      details: { quoteNumber, grandTotalMinor, currency },
      ipAddress: null,
      userAgent: null,
    });

    const populated = await this.quotationRepository.findById(companyId, quoteId);
    return QuotationMapper.toResponse(populated || created, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Find All Quotations (Paginated)
  // ─────────────────────────────────────────────────────────────────────────────
  async findAll(
    companyId: Types.ObjectId,
    query: ListQuotationsQueryDto,
    callerIsAdminOrManager: boolean,
  ) {
    const result = await this.quotationRepository.findAllWithPagination(companyId, query);
    return {
      data: QuotationMapper.toResponseList(result.data, callerIsAdminOrManager),
      meta: result.meta,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Find Expired Quotations
  // ─────────────────────────────────────────────────────────────────────────────
  async findExpired(
    companyId: Types.ObjectId,
    query: ListQuotationsQueryDto,
    callerIsAdminOrManager: boolean,
  ) {
    const expiredQuery: ListQuotationsQueryDto = {
      ...query,
      status: QuotationStatus.EXPIRED,
    };
    return this.findAll(companyId, expiredQuery, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Find Summary Dashboard Metrics ($facet)
  // ─────────────────────────────────────────────────────────────────────────────
  async findSummary(companyId: Types.ObjectId) {
    return this.quotationRepository.getSummary(companyId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Find Single Quotation by ID
  // ─────────────────────────────────────────────────────────────────────────────
  async findById(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return QuotationMapper.toResponse(quote, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Update Quotation
  // ─────────────────────────────────────────────────────────────────────────────
  async update(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    dto: UpdateQuotationDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (
      quote.status !== QuotationStatus.DRAFT &&
      quote.status !== QuotationStatus.PENDING_APPROVAL
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot edit quotation in ${quote.status} status. Spawn a revision instead.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const updateData: Record<string, any> = {
      updatedBy: actorId,
    };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.contactId !== undefined) updateData.contactId = new Types.ObjectId(dto.contactId);
    if (dto.dealId !== undefined) updateData.dealId = dto.dealId ? new Types.ObjectId(dto.dealId) : null;
    if (dto.leadId !== undefined) updateData.leadId = dto.leadId ? new Types.ObjectId(dto.leadId) : null;
    if (dto.ownerId !== undefined) updateData.ownerId = new Types.ObjectId(dto.ownerId);
    if (dto.termsAndConditions !== undefined) updateData.termsAndConditions = dto.termsAndConditions;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    if (dto.expiryDate !== undefined) {
      const newExpiry = new Date(dto.expiryDate);
      if (newExpiry <= new Date()) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Expiry date must be in the future',
          HttpStatus.BAD_REQUEST,
        );
      }
      updateData.expiryDate = newExpiry;
      updateData.portalTokenExpiresAt = newExpiry;
    }

    // Recalculate if items or states changed
    if (dto.items || dto.buyerState || dto.sellerState || dto.currency) {
      const currency = validateCurrency(dto.currency || quote.currency || 'INR');
      const sellerState = (dto.sellerState || quote.sellerState || 'DL').trim().toUpperCase();
      const buyerState = (dto.buyerState || quote.buyerState).trim().toUpperCase();
      const isInterState = sellerState !== buyerState;

      const itemsToProcess = dto.items || quote.items;
      const processedItems: QuotationItem[] = [];
      let subtotalMinor = 0;
      let totalDiscountMinor = 0;
      let taxableAmountMinor = 0;
      let cgstAmountMinor = 0;
      let sgstAmountMinor = 0;
      let igstAmountMinor = 0;
      let totalTaxAmountMinor = 0;
      let grandTotalMinor = 0;
      let totalMrrMinor = 0;
      let totalArrMinor = 0;

      for (const itemDto of itemsToProcess) {
        const productId = new Types.ObjectId(itemDto.productId);
        const product = await this.productRepository.findById(productId);
        if (!product) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            `Product not found: ${itemDto.productId}`,
            HttpStatus.NOT_FOUND,
          );
        }

        const unitPriceMinor = Math.round(Number(product.unitPrice || 0) * 100);
        const costPriceMinor = Math.round(Number(product.costPrice || 0) * 100);
        const taxRatePercent = Number(product.taxRate ?? 18);
        const discountPercent =
          'discountPercent' in itemDto && (itemDto as any).discountPercent !== undefined
            ? Number((itemDto as any).discountPercent)
            : Number(((itemDto as any).discountBasisPoints ?? 0) / 100);
        const qty =
          'quantity' in itemDto && (itemDto as any).quantity !== undefined
            ? Number((itemDto as any).quantity)
            : Number(((itemDto as any).quantityScaled ?? 1000) / 1000);

        const calc = calculateLineTaxes(
          unitPriceMinor,
          costPriceMinor,
          qty,
          discountPercent,
          taxRatePercent,
          isInterState,
        );

        processedItems.push({
          _id: (itemDto as any)._id || new Types.ObjectId(),
          productId,
          name: product.name,
          sku: product.sku,
          hsnSacCode: product.hsnSacCode ?? null,
          type: product.type || 'PRODUCT',
          quantityScaled: calc.quantityScaled,
          unitPriceMinor: calc.unitPriceMinor,
          costPriceMinor: calc.costPriceMinor,
          discountBasisPoints: calc.discountBasisPoints,
          discountMinor: calc.discountMinor,
          netLineTotalMinor: calc.netLineTotalMinor,
          taxBasisPoints: calc.taxBasisPoints,
          cgstMinor: calc.cgstMinor,
          sgstMinor: calc.sgstMinor,
          igstMinor: calc.igstMinor,
          totalTaxMinor: calc.totalTaxMinor,
          lineGrandTotalMinor: calc.lineGrandTotalMinor,
        });

        subtotalMinor += calc.lineSubtotalMinor;
        totalDiscountMinor += calc.discountMinor;
        taxableAmountMinor += calc.netLineTotalMinor;
        cgstAmountMinor += calc.cgstMinor;
        sgstAmountMinor += calc.sgstMinor;
        igstAmountMinor += calc.igstMinor;
        totalTaxAmountMinor += calc.totalTaxMinor;
        grandTotalMinor += calc.lineGrandTotalMinor;

        if (product.billingCycle) {
          const cycle = product.billingCycle.toUpperCase();
          if (cycle === 'MONTHLY') {
            totalMrrMinor += calc.netLineTotalMinor;
            totalArrMinor += calc.netLineTotalMinor * 12;
          } else if (cycle === 'ANNUAL' || cycle === 'YEARLY') {
            totalMrrMinor += Math.round(calc.netLineTotalMinor / 12);
            totalArrMinor += calc.netLineTotalMinor;
          }
        }
      }

      updateData.currency = currency;
      updateData.sellerState = sellerState;
      updateData.buyerState = buyerState;
      updateData.isInterState = isInterState;
      updateData.items = processedItems;
      updateData.subtotalMinor = subtotalMinor;
      updateData.totalDiscountMinor = totalDiscountMinor;
      updateData.taxableAmountMinor = taxableAmountMinor;
      updateData.cgstAmountMinor = cgstAmountMinor;
      updateData.sgstAmountMinor = sgstAmountMinor;
      updateData.igstAmountMinor = igstAmountMinor;
      updateData.totalTaxAmountMinor = totalTaxAmountMinor;
      updateData.grandTotalMinor = grandTotalMinor;
      updateData.totalMrrMinor = totalMrrMinor;
      updateData.totalArrMinor = totalArrMinor;

      // Re-evaluate approval tiers
      const requiredApprovalTiers = this.determineApprovalTiers(
        totalDiscountMinor,
        subtotalMinor,
        grandTotalMinor,
      );
      updateData.requiredApprovalTiers = requiredApprovalTiers;
      updateData.approvalStatus =
        requiredApprovalTiers.length > 0
          ? QuotationApprovalStatus.NOT_SUBMITTED
          : QuotationApprovalStatus.NOT_REQUIRED;
    }

    const updated = await this.quotationRepository.updateById(companyId, id, updateData);
    if (!updated) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Quotation update conflict or version mismatch. Please retry.',
        HttpStatus.CONFLICT,
      );
    }

    await this.activityLogRepository.logActivity(
      companyId,
      id,
      'UPDATED',
      'Quotation updated',
      actorId,
      { grandTotalMinor: updated.grandTotalMinor },
    );

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.QUOTATION_UPDATED,
      targetId: id,
      targetModel: AuditTargetModel.QUOTATION,
      ipAddress: null,
      userAgent: null,
    });

    return QuotationMapper.toResponse(updated, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Update Quotation Status
  // ─────────────────────────────────────────────────────────────────────────────
  async updateStatus(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    dto: UpdateQuotationStatusDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const currentStatus = quote.status;
    const targetStatus = dto.status;

    // Validate state machine transitions
    const validTransitions: Record<QuotationStatus, QuotationStatus[]> = {
      [QuotationStatus.DRAFT]: [
        QuotationStatus.PENDING_APPROVAL,
        QuotationStatus.APPROVED,
        QuotationStatus.SENT,
        QuotationStatus.CANCELLED,
      ],
      [QuotationStatus.PENDING_APPROVAL]: [
        QuotationStatus.APPROVED,
        QuotationStatus.REJECTED,
        QuotationStatus.CANCELLED,
      ],
      [QuotationStatus.APPROVED]: [QuotationStatus.SENT, QuotationStatus.CANCELLED],
      [QuotationStatus.SENT]: [
        QuotationStatus.VIEWED,
        QuotationStatus.ACCEPTED,
        QuotationStatus.REJECTED,
        QuotationStatus.EXPIRED,
        QuotationStatus.CANCELLED,
      ],
      [QuotationStatus.VIEWED]: [
        QuotationStatus.ACCEPTED,
        QuotationStatus.REJECTED,
        QuotationStatus.EXPIRED,
        QuotationStatus.CANCELLED,
      ],
      [QuotationStatus.ACCEPTED]: [QuotationStatus.CANCELLED],
      [QuotationStatus.REJECTED]: [],
      [QuotationStatus.EXPIRED]: [QuotationStatus.SENT],
      [QuotationStatus.SUPERSEDED]: [],
      [QuotationStatus.CANCELLED]: [],
    };

    const allowed = validTransitions[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid status transition from ${currentStatus} to ${targetStatus}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const updateData: Record<string, any> = {
      status: targetStatus,
      updatedBy: actorId,
    };

    if (targetStatus === QuotationStatus.ACCEPTED) {
      updateData.acceptedAt = new Date();
    } else if (targetStatus === QuotationStatus.REJECTED) {
      updateData.rejectedAt = new Date();
      if (dto.rejectionReason) updateData.rejectionReason = dto.rejectionReason;
    }

    const updated = await this.quotationRepository.updateById(companyId, id, updateData);
    if (!updated) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Failed to update status due to concurrency conflict.',
        HttpStatus.CONFLICT,
      );
    }

    // Auto-close deal as CLOSED_WON if quote accepted and deal is linked
    if (targetStatus === QuotationStatus.ACCEPTED && quote.dealId) {
      try {
        await this.dealServiceCloseDealWon(quote.dealId, actorId);
      } catch (err: any) {
        this.logger.warn(`Could not auto-close deal ${quote.dealId} as WON: ${err.message}`);
      }
    }

    await this.activityLogRepository.logActivity(
      companyId,
      id,
      'STATUS_CHANGED',
      `Status changed from ${currentStatus} to ${targetStatus}`,
      actorId,
      { from: currentStatus, to: targetStatus, reason: dto.rejectionReason },
    );

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.QUOTATION_STATUS_CHANGED,
      targetId: id,
      targetModel: AuditTargetModel.QUOTATION,
      details: { from: currentStatus, to: targetStatus },
      ipAddress: null,
      userAgent: null,
    });

    return QuotationMapper.toResponse(updated, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Generate PDF
  // ─────────────────────────────────────────────────────────────────────────────
  async generatePdf(companyId: Types.ObjectId, id: Types.ObjectId): Promise<Buffer> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const pdfBuffer = await this.pdfGeneratorService.generatePdfBuffer(quote);

    let pdfKey: string | undefined;
    try {
      const folder = `employees/quotations/${companyId.toString()}`;
      const uploadResult = await this.storageService.uploadFile(
        {
          buffer: pdfBuffer,
          mimetype: 'application/pdf',
          originalname: `${quote.quoteNumber}.pdf`,
          size: pdfBuffer.length,
        } as any,
        folder,
        ['application/pdf'],
      );
      pdfKey = uploadResult.key;
    } catch (err: any) {
      this.logger.warn(`Storage upload warning for quote PDF ${id}: ${err.message || err}. Retaining in-memory buffer.`);
    }

    if (pdfKey) {
      await this.quotationRepository.updateById(companyId, id, {
        pdfKey,
      });
    }

    return pdfBuffer;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. Download PDF
  // ─────────────────────────────────────────────────────────────────────────────
  async downloadPdf(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const buffer = await this.pdfGeneratorService.generatePdfBuffer(quote);
    return {
      buffer,
      filename: `${quote.quoteNumber}.pdf`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Send Email (Outbox Pattern)
  // ─────────────────────────────────────────────────────────────────────────────
  async sendEmail(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    dto: SendQuotationEmailDto,
    actorId: Types.ObjectId,
  ): Promise<{ message: string; outboxId: string; portalToken?: string; portalLink?: string }> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (quote.status === QuotationStatus.EXPIRED || quote.status === QuotationStatus.SUPERSEDED) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot send email for ${quote.status} quotation.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const portalTokenRaw = randomBytes(32).toString('hex');
    const portalTokenHash = createHash('sha256').update(portalTokenRaw).digest('hex');

    await this.quotationRepository.updateById(companyId, id, {
      status: quote.status === QuotationStatus.DRAFT ? QuotationStatus.SENT : quote.status,
      portalTokenHash,
      portalTokenExpiresAt: quote.expiryDate,
      portalTokenRevoked: false,
      updatedBy: actorId,
    });

    const recipientEmail =
      dto.recipientEmail ||
      (quote.contactId && typeof quote.contactId === 'object' && (quote.contactId as any).email) ||
      '';

    if (!recipientEmail) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'No valid recipient email provided or linked to contact.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const idempotencyKey = `quote-send-${id.toString()}-${Date.now()}`;
    const subject = dto.subject || `Quotation #${quote.quoteNumber} from Enterprise CRM`;
    const portalLink = `${process.env.APP_BASE_URL || 'https://crm.local'}/portal/quotes/${portalTokenRaw}`;

    const defaultHtml = `
      <p>Dear Customer,</p>
      <p>Please find attached quotation <strong>#${quote.quoteNumber}</strong>.</p>
      <p>You can also review, accept, or reject this quotation online using the secure portal link below:</p>
      <p><a href="${portalLink}" style="padding: 10px 18px; background: #2563EB; color: #fff; text-decoration: none; border-radius: 4px;">View Quotation Online</a></p>
      <p>Valid until: <strong>${quote.expiryDate.toISOString().split('T')[0]}</strong></p>
    `;

    const outboxRecord = await this.emailOutboxRepository.createOutboxRecord({
      companyId,
      quotationId: id,
      recipientEmail,
      subject,
      htmlBody: dto.message ? `<p>${dto.message}</p>${defaultHtml}` : defaultHtml,
      idempotencyKey,
      status: EmailDeliveryStatus.PENDING,
      retryCount: 0,
      nextRetryAt: new Date(),
    });

    setImmediate(() => {
      this.emailOutboxProcessorService.processPendingOutbox().catch((e) => {
        this.logger.error(`Immediate outbox processing error: ${e.message}`);
      });
    });

    await this.activityLogRepository.logActivity(
      companyId,
      id,
      'EMAIL_SENT',
      `Quotation sent to ${recipientEmail}`,
      actorId,
      { recipientEmail, subject, outboxId: outboxRecord._id.toString() },
    );

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.QUOTATION_SENT,
      targetId: id,
      targetModel: AuditTargetModel.QUOTATION,
      details: { recipientEmail },
      ipAddress: null,
      userAgent: null,
    });

    return {
      message: 'Quotation email enqueued successfully',
      outboxId: outboxRecord._id.toString(),
      portalToken: portalTokenRaw,
      portalLink,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. Resend Email
  // ─────────────────────────────────────────────────────────────────────────────
  async resendEmail(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    actorId: Types.ObjectId,
  ): Promise<{ message: string; outboxId: string; portalToken?: string; portalLink?: string }> {
    return this.sendEmail(companyId, id, {}, actorId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. Duplicate Quotation (Clone into fresh draft)
  // ─────────────────────────────────────────────────────────────────────────────
  async duplicate(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const original = await this.quotationRepository.findById(companyId, id);
    if (!original) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Original quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const quoteNumber = await this.quotationSequenceRepository.getNextSequence(companyId);
    const newId = new Types.ObjectId();
    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const portalTokenRaw = randomBytes(32).toString('hex');
    const portalTokenHash = createHash('sha256').update(portalTokenRaw).digest('hex');

    const clonedItems = original.items.map((item) => ({
      ...item,
      _id: new Types.ObjectId(),
    }));

    const clonedDoc = {
      _id: newId,
      quoteNumber,
      title: `${original.title || 'Quotation'} (Copy)`,
      parentQuoteId: null,
      rootQuoteId: newId,
      revisionNumber: 1,
      isLatestRevision: true,
      companyId,
      contactId: original.contactId,
      ownerId: actorId,
      dealId: original.dealId ?? null,
      leadId: original.leadId ?? null,
      status: QuotationStatus.DRAFT,
      approvalStatus: QuotationApprovalStatus.NOT_SUBMITTED,
      requiredApprovalTiers: original.requiredApprovalTiers,
      currentApprovalTier: 1,
      quoteDate: new Date(),
      expiryDate,
      items: clonedItems,
      subtotalMinor: original.subtotalMinor,
      totalDiscountMinor: original.totalDiscountMinor,
      taxableAmountMinor: original.taxableAmountMinor,
      cgstAmountMinor: original.cgstAmountMinor,
      sgstAmountMinor: original.sgstAmountMinor,
      igstAmountMinor: original.igstAmountMinor,
      totalTaxAmountMinor: original.totalTaxAmountMinor,
      grandTotalMinor: original.grandTotalMinor,
      currency: original.currency,
      sellerState: original.sellerState,
      buyerState: original.buyerState,
      isInterState: original.isInterState,
      totalMrrMinor: original.totalMrrMinor,
      totalArrMinor: original.totalArrMinor,
      portalTokenHash,
      portalTokenExpiresAt: expiryDate,
      portalTokenUsed: false,
      portalTokenRevoked: false,
      termsAndConditions: original.termsAndConditions,
      notes: original.notes,
      createdBy: actorId,
      updatedBy: actorId,
    };

    const created = await this.quotationRepository.create(clonedDoc as any);

    await this.activityLogRepository.logActivity(
      companyId,
      newId,
      'CREATED',
      `Cloned from ${original.quoteNumber}`,
      actorId,
      { sourceQuoteNumber: original.quoteNumber },
    );

    return QuotationMapper.toResponse(created, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. Find Revision Chain
  // ─────────────────────────────────────────────────────────────────────────────
  async findRevisions(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse[]> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const revisions = await this.quotationRepository.findRevisionsByRootId(
      companyId,
      quote.rootQuoteId,
    );
    return QuotationMapper.toResponseList(revisions, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. Spawn Revision (v(n+1) Immutable Version Control)
  // ─────────────────────────────────────────────────────────────────────────────
  async spawnRevision(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    dto: SpawnRevisionDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const session = await this.connection.startSession();
    let createdRevision: QuotationLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const current = await this.quotationRepository.findById(companyId, id, s);
        if (!current) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Quotation not found',
            HttpStatus.NOT_FOUND,
          );
        }

        if (current.status === QuotationStatus.SUPERSEDED) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Cannot revise a superseded quotation. Revise the latest revision instead.',
            HttpStatus.BAD_REQUEST,
          );
        }

        // 1. Mark current as superseded & revoke current portal token
        await this.quotationRepository.updateById(
          companyId,
          id,
          {
            isLatestRevision: false,
            status: QuotationStatus.SUPERSEDED,
            portalTokenRevoked: true,
            updatedBy: actorId,
          },
          s,
        );

        // 2. Generate new revision
        const nextRevisionNumber = current.revisionNumber + 1;
        const newQuoteId = new Types.ObjectId();
        const portalTokenRaw = randomBytes(32).toString('hex');
        const portalTokenHash = createHash('sha256').update(portalTokenRaw).digest('hex');
        const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        let finalItems: QuotationItem[] = [];
        let subtotalMinor = current.subtotalMinor;
        let totalDiscountMinor = current.totalDiscountMinor;
        let taxableAmountMinor = current.taxableAmountMinor;
        let cgstAmountMinor = current.cgstAmountMinor;
        let sgstAmountMinor = current.sgstAmountMinor;
        let igstAmountMinor = current.igstAmountMinor;
        let totalTaxAmountMinor = current.totalTaxAmountMinor;
        let grandTotalMinor = current.grandTotalMinor;
        let totalMrrMinor = current.totalMrrMinor;
        let totalArrMinor = current.totalArrMinor;

        if (dto.items && dto.items.length > 0) {
          subtotalMinor = 0;
          totalDiscountMinor = 0;
          taxableAmountMinor = 0;
          cgstAmountMinor = 0;
          sgstAmountMinor = 0;
          igstAmountMinor = 0;
          totalTaxAmountMinor = 0;
          grandTotalMinor = 0;
          totalMrrMinor = 0;
          totalArrMinor = 0;

          for (const itemDto of dto.items) {
            const productId = new Types.ObjectId(itemDto.productId);
            const product = await this.productRepository.findById(productId, s);
            if (!product) {
              throw new AppError(
                ErrorCode.RESOURCE_NOT_FOUND,
                `Product not found: ${itemDto.productId}`,
                HttpStatus.NOT_FOUND,
              );
            }

            const unitPriceMinor = Math.round(Number(product.unitPrice || 0) * 100);
            const costPriceMinor = Math.round(Number(product.costPrice || 0) * 100);
            const taxRatePercent = Number(product.taxRate ?? 18);
            const discountPercent =
              itemDto.discountPercent !== undefined
                ? Number(itemDto.discountPercent)
                : 0;
            const qty = Number(itemDto.quantity || 1);

            const calc = calculateLineTaxes(
              unitPriceMinor,
              costPriceMinor,
              qty,
              discountPercent,
              taxRatePercent,
              current.isInterState,
            );

            finalItems.push({
              _id: new Types.ObjectId(),
              productId,
              name: product.name,
              sku: product.sku,
              hsnSacCode: product.hsnSacCode ?? null,
              type: product.type || 'PRODUCT',
              quantityScaled: calc.quantityScaled,
              unitPriceMinor: calc.unitPriceMinor,
              costPriceMinor: calc.costPriceMinor,
              discountBasisPoints: calc.discountBasisPoints,
              discountMinor: calc.discountMinor,
              netLineTotalMinor: calc.netLineTotalMinor,
              taxBasisPoints: calc.taxBasisPoints,
              cgstMinor: calc.cgstMinor,
              sgstMinor: calc.sgstMinor,
              igstMinor: calc.igstMinor,
              totalTaxMinor: calc.totalTaxMinor,
              lineGrandTotalMinor: calc.lineGrandTotalMinor,
            });

            subtotalMinor += calc.lineSubtotalMinor;
            totalDiscountMinor += calc.discountMinor;
            taxableAmountMinor += calc.netLineTotalMinor;
            cgstAmountMinor += calc.cgstMinor;
            sgstAmountMinor += calc.sgstMinor;
            igstAmountMinor += calc.igstMinor;
            totalTaxAmountMinor += calc.totalTaxMinor;
            grandTotalMinor += calc.lineGrandTotalMinor;

            if (product.billingCycle) {
              const cycle = product.billingCycle.toUpperCase();
              if (cycle === 'MONTHLY') {
                totalMrrMinor += calc.netLineTotalMinor;
                totalArrMinor += calc.netLineTotalMinor * 12;
              } else if (cycle === 'ANNUAL' || cycle === 'YEARLY') {
                totalMrrMinor += Math.round(calc.netLineTotalMinor / 12);
                totalArrMinor += calc.netLineTotalMinor;
              } else if (cycle === 'QUARTERLY') {
                totalMrrMinor += Math.round(calc.netLineTotalMinor / 3);
                totalArrMinor += calc.netLineTotalMinor * 4;
              }
            }
          }
        } else {
          finalItems = current.items.map((item: any) => ({
            ...item,
            _id: new Types.ObjectId(),
          }));
        }

        const requiredApprovalTiers = this.determineApprovalTiers(
          totalDiscountMinor,
          subtotalMinor,
          grandTotalMinor,
        );

        const reasonText = dto.revisionReason || dto.reason || 'None provided';

        const newRevisionDoc = {
          _id: newQuoteId,
          quoteNumber: current.quoteNumber,
          title: current.title,
          parentQuoteId: current._id,
          rootQuoteId: current.rootQuoteId,
          revisionNumber: nextRevisionNumber,
          isLatestRevision: true,
          companyId,
          contactId: current.contactId,
          ownerId: current.ownerId,
          dealId: current.dealId ?? null,
          leadId: current.leadId ?? null,
          status: QuotationStatus.DRAFT,
          approvalStatus:
            requiredApprovalTiers.length > 0
              ? QuotationApprovalStatus.NOT_SUBMITTED
              : QuotationApprovalStatus.NOT_REQUIRED,
          requiredApprovalTiers,
          currentApprovalTier: requiredApprovalTiers.length > 0 ? requiredApprovalTiers[0] : 1,
          quoteDate: new Date(),
          expiryDate,
          items: finalItems,
          subtotalMinor,
          totalDiscountMinor,
          taxableAmountMinor,
          cgstAmountMinor,
          sgstAmountMinor,
          igstAmountMinor,
          totalTaxAmountMinor,
          grandTotalMinor,
          currency: current.currency,
          sellerState: current.sellerState,
          buyerState: current.buyerState,
          isInterState: current.isInterState,
          totalMrrMinor,
          totalArrMinor,
          portalTokenHash,
          portalTokenExpiresAt: expiryDate,
          portalTokenUsed: false,
          portalTokenRevoked: false,
          termsAndConditions: current.termsAndConditions,
          notes: dto.notes !== undefined ? dto.notes : current.notes,
          createdBy: actorId,
          updatedBy: actorId,
        };

        createdRevision = await this.quotationRepository.create(newRevisionDoc as any, s);

        await this.activityLogRepository.logActivity(
          companyId,
          newQuoteId,
          'REVISED',
          `Revision v${nextRevisionNumber} spawned from v${current.revisionNumber}. Reason: ${reasonText}`,
          actorId,
          { parentQuoteId: current._id.toString(), reason: reasonText },
          s,
        );

        await this.auditLogsService.createAuditLog({
          actorId,
          action: AuditAction.QUOTATION_REVISED,
          targetId: newQuoteId,
          targetModel: AuditTargetModel.QUOTATION,
          details: { revisionNumber: nextRevisionNumber, reason: reasonText },
          ipAddress: null,
          userAgent: null,
        });
      });
    } finally {
      await session.endSession();
    }

    return QuotationMapper.toResponse(createdRevision!, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 15. Extend Validity
  // ─────────────────────────────────────────────────────────────────────────────
  async extendValidity(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    dto: ExtendValidityDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const newExpiry = new Date(dto.newExpiryDate);
    if (newExpiry <= new Date()) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'New expiry date must be strictly in the future.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updateData: Record<string, any> = {
      expiryDate: newExpiry,
      portalTokenExpiresAt: newExpiry,
      updatedBy: actorId,
    };

    if (quote.status === QuotationStatus.EXPIRED) {
      updateData.status = QuotationStatus.SENT;
    }

    const updated = await this.quotationRepository.updateById(companyId, id, updateData);

    await this.activityLogRepository.logActivity(
      companyId,
      id,
      'VALIDITY_EXTENDED',
      `Validity extended to ${newExpiry.toISOString().split('T')[0]}. Reason: ${dto.reason || 'None provided'}`,
      actorId,
      { newExpiryDate: newExpiry, reason: dto.reason },
    );

    return QuotationMapper.toResponse(updated!, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 16. Submit for Multi-Tier Approval
  // ─────────────────────────────────────────────────────────────────────────────
  async submitApproval(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    dto: SubmitApprovalDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (
      quote.approvalStatus === QuotationApprovalStatus.APPROVED ||
      quote.status === QuotationStatus.ACCEPTED
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Quotation is already approved or accepted.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.quotationRepository.updateById(companyId, id, {
      status: QuotationStatus.PENDING_APPROVAL,
      approvalStatus: QuotationApprovalStatus.PENDING_APPROVAL,
      approvalRequestedBy: actorId,
      approvalRequestedAt: new Date(),
      approvalRequestNote: dto.notes || null,
      updatedBy: actorId,
    });

    await this.activityLogRepository.logActivity(
      companyId,
      id,
      'APPROVAL_REQUESTED',
      `Quotation submitted for tier-${quote.currentApprovalTier} approval`,
      actorId,
      { tier: quote.currentApprovalTier, notes: dto.notes },
    );

    return QuotationMapper.toResponse(updated!, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 17. Review Approval (Approve / Reject)
  // ─────────────────────────────────────────────────────────────────────────────
  async reviewApproval(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    dto: ReviewApprovalDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<QuotationResponse> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Guard: Approver cannot approve their own quotation
    if (quote.ownerId && quote.ownerId.toString() === actorId.toString()) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Self-approval prohibition: You cannot approve or review your own quotation.',
        HttpStatus.FORBIDDEN,
      );
    }

    if (quote.approvalStatus !== QuotationApprovalStatus.PENDING_APPROVAL) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Quotation is not pending approval (current status: ${quote.approvalStatus})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const action = dto.action.toUpperCase();
    const updateData: Record<string, any> = {
      updatedBy: actorId,
    };

    if (action === 'APPROVE') {
      updateData.approvalStatus = QuotationApprovalStatus.APPROVED;
      updateData.status = QuotationStatus.APPROVED;
    } else if (action === 'REJECT') {
      updateData.approvalStatus = QuotationApprovalStatus.REJECTED;
      updateData.status = QuotationStatus.REJECTED;
      updateData.rejectionReason = dto.rejectionReason || null;
    } else {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid review action: ${dto.action}. Must be APPROVE or REJECT.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.quotationRepository.updateById(companyId, id, updateData);

    await this.activityLogRepository.logActivity(
      companyId,
      id,
      action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      `Quotation ${action === 'APPROVE' ? 'approved' : 'rejected'} by manager`,
      actorId,
      { action, rejectionReason: dto.rejectionReason },
    );

    return QuotationMapper.toResponse(updated!, callerIsAdminOrManager);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 18. Customer Portal: View Quotation by Token (Public)
  // ─────────────────────────────────────────────────────────────────────────────
  async getPortalView(token: string): Promise<PublicPortalQuotationResponse> {
    const hash = createHash('sha256').update(token).digest('hex');
    const quote = await this.quotationRepository.findByPortalTokenHash(hash);

    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found or link is invalid.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (quote.portalTokenRevoked) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'This proposal version has been superseded by a newer revision. Please check your latest email.',
        HttpStatus.GONE,
      );
    }

    if (new Date() > quote.portalTokenExpiresAt) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'This quotation proposal link has expired.',
        HttpStatus.GONE,
      );
    }

    // Record first customer view
    if (!quote.clientViewedAt) {
      await this.quotationRepository.updateById(quote.companyId, quote._id, {
        clientViewedAt: new Date(),
        status: quote.status === QuotationStatus.SENT ? QuotationStatus.VIEWED : quote.status,
      });

      await this.activityLogRepository.logActivity(
        quote.companyId,
        quote._id,
        'CLIENT_VIEWED',
        'Quotation viewed by customer via secure portal',
        null,
      );
    }

    return QuotationMapper.toPortalResponse(quote);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 19. Customer Portal: Accept or Reject Quotation (Public)
  // ─────────────────────────────────────────────────────────────────────────────
  async respondPortal(
    token: string,
    dto: CustomerResponseDto,
    clientIp?: string,
  ): Promise<{ success: boolean; message: string; quoteNumber: string; status: string }> {
    const hash = createHash('sha256').update(token).digest('hex');
    const quote = await this.quotationRepository.findByPortalTokenHash(hash);

    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Invalid or expired portal token.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (quote.portalTokenUsed) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'This quotation has already received a customer response and cannot be modified.',
        HttpStatus.CONFLICT,
      );
    }

    if (new Date() > quote.portalTokenExpiresAt) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'This quotation proposal has expired.',
        HttpStatus.GONE,
      );
    }

    const action = dto.action.toUpperCase();
    const updateData: Record<string, any> = {
      portalTokenUsed: true,
      digitalSignatureIp: clientIp || null,
    };

    const reason = dto.rejectionReason || dto.customerFeedback || null;

    if (action === CustomerResponseAction.ACCEPT) {
      if (!dto.digitalSignatureName || dto.digitalSignatureName.trim().length < 2) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'A valid digitalSignatureName is mandatory when accepting a quotation proposal.',
          HttpStatus.BAD_REQUEST,
        );
      }
      updateData.status = QuotationStatus.ACCEPTED;
      updateData.acceptedAt = new Date();
      updateData.digitalSignatureName = dto.digitalSignatureName.trim();

      // Trigger deal won if deal is linked
      if (quote.dealId) {
        try {
          await this.dealServiceCloseDealWon(quote.dealId, quote.ownerId);
        } catch (err: any) {
          this.logger.warn(`Could not close linked deal ${quote.dealId} as WON: ${err.message}`);
        }
      }
    } else if (action === CustomerResponseAction.REJECT) {
      updateData.status = QuotationStatus.REJECTED;
      updateData.rejectedAt = new Date();
      updateData.rejectionReason = reason;
    } else {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid customer action: ${dto.action}. Must be ACCEPT or REJECT.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.quotationRepository.updateById(
      quote.companyId,
      quote._id,
      updateData,
    );

    await this.activityLogRepository.logActivity(
      quote.companyId,
      quote._id,
      action === CustomerResponseAction.ACCEPT ? 'ACCEPTED' : 'REJECTED',
      `Customer ${action === CustomerResponseAction.ACCEPT ? 'accepted' : 'rejected'} proposal via portal`,
      null,
      {
        action,
        signerName: dto.digitalSignatureName,
        rejectionReason: reason,
        clientIp,
      },
    );

    return {
      success: true,
      message: `Quotation ${quote.quoteNumber} has been successfully ${action === CustomerResponseAction.ACCEPT ? 'accepted' : 'rejected'}.`,
      quoteNumber: quote.quoteNumber,
      status: updated!.status,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 20. Convert to Sales Order (O2C Transaction)
  // ─────────────────────────────────────────────────────────────────────────────
  async convertToOrder(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    dto: ConvertToOrderDto,
    actorId: Types.ObjectId,
    callerIsAdminOrManager: boolean,
  ): Promise<{ salesOrder: any; quotation: QuotationResponse }> {
    const session = await this.connection.startSession();
    let createdOrder: any = null;
    let updatedQuote: QuotationLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const quote = await this.quotationRepository.findById(companyId, id, s);
        if (!quote) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Quotation not found',
            HttpStatus.NOT_FOUND,
          );
        }

        if (quote.status !== QuotationStatus.ACCEPTED) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Only ACCEPTED quotations can be converted to Sales Orders. Current status: ${quote.status}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        if (quote.convertedToOrder) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Quotation has already been converted to a Sales Order.',
            HttpStatus.CONFLICT,
          );
        }

        const orderNumber = await this.salesOrderSequenceRepository.getNextSequence(companyId, s);
        const orderId = new Types.ObjectId();

        const casResult = await this.quotationRepository.markConvertedToOrder(
          companyId,
          id,
          orderId,
          actorId,
          s,
        );

        if (!casResult) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Quotation was concurrently converted to an order or modified. Aborting.',
            HttpStatus.CONFLICT,
          );
        }
        updatedQuote = casResult;

        createdOrder = await this.salesOrderRepository.createSalesOrder(
          {
            _id: orderId,
            orderNumber,
            quotationId: id,
            companyId,
            contactId: quote.contactId,
            dealId: quote.dealId ?? null,
            ownerId: quote.ownerId,
            status: SalesOrderStatus.CONFIRMED,
            items: quote.items,
            subtotalMinor: quote.subtotalMinor,
            totalDiscountMinor: quote.totalDiscountMinor,
            taxableAmountMinor: quote.taxableAmountMinor,
            cgstAmountMinor: quote.cgstAmountMinor,
            sgstAmountMinor: quote.sgstAmountMinor,
            igstAmountMinor: quote.igstAmountMinor,
            totalTaxAmountMinor: quote.totalTaxAmountMinor,
            grandTotalMinor: quote.grandTotalMinor,
            currency: quote.currency,
            billingAddress: dto.billingAddress,
            shippingAddress: dto.shippingAddress,
            notes: dto.notes || dto.orderNotes || quote.notes || null,
            createdBy: actorId,
          },
          s,
        );

        await this.activityLogRepository.logActivity(
          companyId,
          id,
          'CONVERTED_TO_ORDER',
          `Quotation converted to Sales Order #${orderNumber}`,
          actorId,
          { orderId: orderId.toString(), orderNumber },
          s,
        );

        await this.auditLogsService.createAuditLog({
          actorId,
          action: AuditAction.SALES_ORDER_CREATED,
          targetId: orderId,
          targetModel: AuditTargetModel.SALES_ORDER,
          details: { orderNumber, quotationId: id.toString() },
          ipAddress: null,
          userAgent: null,
        });
      });
    } finally {
      await session.endSession();
    }

    return {
      salesOrder: createdOrder,
      quotation: QuotationMapper.toResponse(updatedQuote!, callerIsAdminOrManager),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 21. Email & Activity History
  // ─────────────────────────────────────────────────────────────────────────────
  async getEmailHistory(companyId: Types.ObjectId, id: Types.ObjectId) {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.emailOutboxRepository.findByQuotationId(companyId, id);
  }

  async getActivityHistory(companyId: Types.ObjectId, id: Types.ObjectId) {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.activityLogRepository.findByQuotationId(companyId, id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 22. Soft Delete Quotation
  // ─────────────────────────────────────────────────────────────────────────────
  async softDelete(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    actorId: Types.ObjectId,
  ): Promise<{ message: string }> {
    const quote = await this.quotationRepository.findById(companyId, id);
    if (!quote) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Quotation not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (quote.status === QuotationStatus.ACCEPTED || quote.convertedToOrder) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot delete an accepted or converted quotation.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.quotationRepository.softDelete(companyId, id, actorId);

    await this.activityLogRepository.logActivity(
      companyId,
      id,
      'STATUS_CHANGED',
      'Quotation soft-deleted',
      actorId,
    );

    await this.auditLogsService.createAuditLog({
      actorId,
      action: AuditAction.QUOTATION_DELETED,
      targetId: id,
      targetModel: AuditTargetModel.QUOTATION,
      ipAddress: null,
      userAgent: null,
    });

    return { message: 'Quotation deleted successfully' };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 23. Webhook: Email Delivery Events
  // ─────────────────────────────────────────────────────────────────────────────
  async handleEmailWebhook(payload: EmailWebhookDto): Promise<{ success: boolean }> {
    const { messageId, event } = payload;
    if (!messageId) return { success: true };

    let status = EmailDeliveryStatus.DELIVERED;
    if (event === 'delivered') status = EmailDeliveryStatus.DELIVERED;
    else if (event === 'opened') status = EmailDeliveryStatus.OPENED;
    else if (event === 'clicked') status = EmailDeliveryStatus.CLICKED;
    else if (event === 'bounced') status = EmailDeliveryStatus.BOUNCED;

    await this.emailOutboxRepository.updateDeliveryStatusByMessageId(messageId, status);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helper: Approval Tier Calculation
  // ─────────────────────────────────────────────────────────────────────────────
  private determineApprovalTiers(
    totalDiscountMinor: number,
    subtotalMinor: number,
    grandTotalMinor: number,
  ): ApprovalTierLevel[] {
    const tiers: ApprovalTierLevel[] = [];
    const discountPercent =
      subtotalMinor > 0 ? (totalDiscountMinor / subtotalMinor) * 100 : 0;

    // Thresholds
    // Tier 3: Discount > 30% or Value > 5,000,000 INR (500000000 minor)
    if (discountPercent > 30 || grandTotalMinor > 500000000) {
      tiers.push(ApprovalTierLevel.TIER_3_DIRECTOR);
    }
    // Tier 2: Discount > 20% or Value > 1,000,000 INR (100000000 minor)
    if (discountPercent > 20 || grandTotalMinor > 100000000) {
      tiers.push(ApprovalTierLevel.TIER_2_VP_FINANCE);
    }
    // Tier 1: Discount > 10% or Value > 250,000 INR (25000000 minor)
    if (discountPercent > 10 || grandTotalMinor > 25000000) {
      tiers.push(ApprovalTierLevel.TIER_1_MANAGER);
    }

    return Array.from(new Set(tiers)).sort((a, b) => b - a); // highest tier first
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helper: Auto Close Deal Won
  // ─────────────────────────────────────────────────────────────────────────────
  private async dealServiceCloseDealWon(
    dealId: Types.ObjectId,
    actorId: Types.ObjectId,
  ): Promise<void> {
    try {
      await this.dealRepository.updateStage(
        dealId,
        DealStage.CLOSED_WON,
        100,
        actorId,
      );
    } catch (err: any) {
      this.logger.warn(`Could not update deal ${dealId} stage: ${err.message}`);
    }
  }
}
