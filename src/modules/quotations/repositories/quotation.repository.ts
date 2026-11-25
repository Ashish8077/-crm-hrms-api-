import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Quotation, QuotationDocument } from '../schemas/quotation.schema';
import { QuotationStatus } from '../constants/quotation-status.constant';
import { ListQuotationsQueryDto } from '../dto/list-quotations-query.dto';
import {
  calculateSkip,
  buildPaginationMeta,
} from '../../../common/pagination/pagination.util';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';

export type QuotationLean = Quotation & { _id: Types.ObjectId };

export interface QuotationSummaryResult {
  byStatus: Array<{ _id: string; count: number; totalValueMinor: number }>;
  byApprovalStatus: Array<{ _id: string; count: number }>;
  pipelineMetrics: Array<{
    _id: null;
    totalQuotations: number;
    totalPipelineMinor: number;
    averageDiscountMinor: number | null;
  }>;
}

@Injectable()
export class QuotationRepository {
  constructor(
    @InjectModel(Quotation.name)
    private readonly quotationModel: Model<QuotationDocument>,
  ) {}

  async create(
    data: Partial<Quotation>,
    session?: ClientSession,
  ): Promise<QuotationLean> {
    const docs = await this.quotationModel.create([data], { session });
    return docs[0].toObject();
  }

  async findScopedById(
    id: Types.ObjectId,
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<QuotationLean | null> {
    const query = this.quotationModel.findOne({
      _id: id,
      companyId,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<QuotationLean>().exec();
  }

  async findScopedByIdPopulated(
    id: Types.ObjectId,
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<QuotationLean | null> {
    const query = this.quotationModel
      .findOne({ _id: id, companyId, deletedAt: null })
      .populate('contactId', 'firstName lastName email phone')
      .populate('dealId', 'title stage status amount')
      .populate('leadId', 'firstName lastName company')
      .populate('ownerId', 'email')
      .populate('approvalRequestedBy', 'email')
      .populate('convertedBy', 'email');
    if (session) query.session(session);
    return query.lean<QuotationLean>().exec();
  }

  async findById(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<QuotationLean | null> {
    return this.findScopedByIdPopulated(id, companyId, session);
  }

  async findByPortalTokenHash(
    portalTokenHash: string,
  ): Promise<QuotationLean | null> {
    return this.quotationModel
      .findOne({ portalTokenHash, deletedAt: null })
      .populate('contactId', 'firstName lastName email phone')
      .populate('ownerId', 'email')
      .lean<QuotationLean>()
      .exec();
  }

  async findList(
    companyId: Types.ObjectId,
    query: ListQuotationsQueryDto,
  ): Promise<PaginatedResult<QuotationLean>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = calculateSkip(page, limit);

    const filter: Record<string, any> = {
      companyId,
      deletedAt: null,
    };

    if (query.status) {
      filter.status = query.status;
    }
    if (query.approvalStatus) {
      filter.approvalStatus = query.approvalStatus;
    }
    if (query.contactId) {
      filter.contactId = new Types.ObjectId(query.contactId);
    }
    if (query.dealId) {
      filter.dealId = new Types.ObjectId(query.dealId);
    }
    if (query.leadId) {
      filter.leadId = new Types.ObjectId(query.leadId);
    }
    if (query.ownerId) {
      filter.ownerId = new Types.ObjectId(query.ownerId);
    }
    if (query.isLatestRevision !== undefined) {
      filter.isLatestRevision = query.isLatestRevision;
    }

    if (query.startDate || query.endDate) {
      const dateRange: { $gte?: Date; $lte?: Date } = {};
      if (query.startDate) dateRange.$gte = new Date(query.startDate);
      if (query.endDate) dateRange.$lte = new Date(query.endDate);
      filter.createdAt = dateRange;
    }

    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { quoteNumber: { $regex: escaped, $options: 'i' } },
        { title: { $regex: escaped, $options: 'i' } },
        { notes: { $regex: escaped, $options: 'i' } },
        { termsAndConditions: { $regex: escaped, $options: 'i' } },
      ];
    }

    const sortField = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    const [data, totalItems] = await Promise.all([
      this.quotationModel
        .find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('contactId', 'firstName lastName email phone')
        .populate('dealId', 'title stage status amount')
        .populate('ownerId', 'email')
        .lean<QuotationLean[]>()
        .exec(),
      this.quotationModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(totalItems, page, limit),
    };
  }

  async findAllWithPagination(
    companyId: Types.ObjectId,
    query: ListQuotationsQueryDto,
  ): Promise<PaginatedResult<QuotationLean>> {
    return this.findList(companyId, query);
  }

  async findExpired(
    companyId: Types.ObjectId,
    query: ListQuotationsQueryDto,
  ): Promise<PaginatedResult<QuotationLean>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = calculateSkip(page, limit);

    const filter: Record<string, any> = {
      companyId,
      deletedAt: null,
      $or: [
        { status: QuotationStatus.EXPIRED },
        {
          status: { $in: [QuotationStatus.SENT, QuotationStatus.VIEWED] },
          expiryDate: { $lte: new Date() },
        },
      ],
    };

    const [data, totalItems] = await Promise.all([
      this.quotationModel
        .find(filter)
        .sort({ expiryDate: -1 })
        .skip(skip)
        .limit(limit)
        .populate('contactId', 'firstName lastName email')
        .populate('ownerId', 'email')
        .lean<QuotationLean[]>()
        .exec(),
      this.quotationModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(totalItems, page, limit),
    };
  }

  async findRevisionChain(
    rootQuoteId: Types.ObjectId,
    companyId: Types.ObjectId,
  ): Promise<QuotationLean[]> {
    return this.quotationModel
      .find({
        rootQuoteId,
        companyId,
        deletedAt: null,
      })
      .sort({ revisionNumber: 1 })
      .populate('contactId', 'firstName lastName email')
      .populate('ownerId', 'email')
      .lean<QuotationLean[]>()
      .exec();
  }

  async findRevisionsByRootId(
    companyId: Types.ObjectId,
    rootQuoteId: Types.ObjectId,
  ): Promise<QuotationLean[]> {
    return this.findRevisionChain(rootQuoteId, companyId);
  }

  async findSummary(
    companyId: Types.ObjectId,
  ): Promise<QuotationSummaryResult> {
    const result = await this.quotationModel.aggregate<QuotationSummaryResult>([
      { $match: { companyId, deletedAt: null, isLatestRevision: true } },
      {
        $facet: {
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalValueMinor: { $sum: '$grandTotalMinor' },
              },
            },
          ],
          byApprovalStatus: [
            {
              $group: {
                _id: '$approvalStatus',
                count: { $sum: 1 },
              },
            },
          ],
          pipelineMetrics: [
            {
              $group: {
                _id: null,
                totalQuotations: { $sum: 1 },
                totalPipelineMinor: { $sum: '$grandTotalMinor' },
                averageDiscountMinor: { $avg: '$totalDiscountMinor' },
              },
            },
          ],
        },
      },
    ]);

    return (
      result[0] || { byStatus: [], byApprovalStatus: [], pipelineMetrics: [] }
    );
  }

  async getSummary(companyId: Types.ObjectId): Promise<QuotationSummaryResult> {
    return this.findSummary(companyId);
  }

  async findExpiringPendingReminders(
    windowHours = 48,
    limit = 50,
  ): Promise<QuotationLean[]> {
    const now = new Date();
    const threshold = new Date(now.getTime() + windowHours * 3600000);

    return this.quotationModel
      .find({
        status: { $in: [QuotationStatus.SENT, QuotationStatus.VIEWED] },
        reminderSentAt: null,
        expiryDate: { $gt: now, $lte: threshold },
        deletedAt: null,
      })
      .limit(limit)
      .populate('contactId', 'firstName lastName email')
      .lean<QuotationLean[]>()
      .exec();
  }

  async stampReminderSent(id: Types.ObjectId): Promise<void> {
    await this.quotationModel.updateOne(
      { _id: id },
      { $set: { reminderSentAt: new Date() } },
    );
  }

  async batchExpireQuotes(now = new Date()): Promise<number> {
    const result = await this.quotationModel.updateMany(
      {
        status: { $in: [QuotationStatus.SENT, QuotationStatus.VIEWED] },
        expiryDate: { $lte: now },
        deletedAt: null,
      },
      {
        $set: {
          status: QuotationStatus.EXPIRED,
          portalTokenRevoked: true,
        },
      },
    );
    return result.modifiedCount;
  }

  async updateById(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    updateData: Record<string, any>,
    session?: ClientSession,
  ): Promise<QuotationLean | null> {
    const query = this.quotationModel.findOneAndUpdate(
      { _id: id, companyId, deletedAt: null },
      { $set: updateData },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<QuotationLean>().exec();
  }

  async markConvertedToOrder(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    salesOrderId: Types.ObjectId,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<QuotationLean | null> {
    const query = this.quotationModel.findOneAndUpdate(
      { _id: id, companyId, convertedToOrder: false, deletedAt: null },
      {
        $set: {
          convertedToOrder: true,
          salesOrderId,
          convertedAt: new Date(),
          convertedBy: actorId,
          updatedBy: actorId,
        },
      },
      { new: true },
    );
    if (session) query.session(session);
    return query.lean<QuotationLean>().exec();
  }

  async softDelete(
    companyId: Types.ObjectId,
    id: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<QuotationLean | null> {
    const query = this.quotationModel.findOneAndUpdate(
      {
        _id: id,
        companyId,
        status: { $nin: [QuotationStatus.ACCEPTED] },
        convertedToOrder: false,
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
        },
      },
      { new: true },
    );
    if (session) query.session(session);
    return query.lean<QuotationLean>().exec();
  }
}
