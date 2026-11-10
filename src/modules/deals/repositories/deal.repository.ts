import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Deal, DealDocumentType } from '../schemas/deal.schema';
import { DealLean } from '../mappers/deal.mapper';
import { DealNote } from '../schemas/deal-note.schema';
import { ListDealsQueryDto } from '../dto/list-deals-query.dto';
import { DealStage, OPEN_STAGES } from '../constants/deal-stage.constant';
import { DealStatus } from '../constants/deal-status.constant';
import {
  DEFAULT_PIPELINE,
  fromMinorUnits,
  toMinorUnits,
} from '../constants/deal.constant';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import {
  calculateSkip,
  buildPaginationMeta,
} from '../../../common/pagination/pagination.util';
import { ForecastQueryDto } from '../dto/forecast-query.dto';

export type { DealLean };

@Injectable()
export class DealRepository {
  constructor(
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocumentType>,
  ) {}

  async create(
    data: Partial<Deal>,
    session?: ClientSession,
  ): Promise<DealLean> {
    const docs = await this.dealModel.create([data], { session });
    return docs[0].toObject();
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const query = this.dealModel.findOne({ _id: id, deletedAt: null });
    if (session) query.session(session);
    return query.lean<DealLean>().exec();
  }

  async findByIdPopulated(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const query = this.dealModel
      .findOne({ _id: id, deletedAt: null })
      .populate('companyId', 'name')
      .populate('contactId', 'firstName lastName email phone')
      .populate('ownerId', 'email');
    if (session) query.session(session);
    return query.lean<DealLean>().exec();
  }

  buildFilterQuery(
    dto: ListDealsQueryDto,
    scopedOwnerId?: Types.ObjectId,
  ): Record<string, any> {
    const query: Record<string, any> = { deletedAt: null };

    if (scopedOwnerId) {
      query.ownerId = scopedOwnerId;
    } else if (dto.ownerId) {
      query.ownerId = new Types.ObjectId(dto.ownerId);
    }

    if (dto.pipeline) {
      query.pipeline = dto.pipeline;
    }

    if (dto.stage) {
      query.stage = dto.stage;
    }

    if (dto.status) {
      query.status = dto.status;
    }

    if (dto.companyId) {
      query.companyId = new Types.ObjectId(dto.companyId);
    }

    if (dto.contactId) {
      query.contactId = new Types.ObjectId(dto.contactId);
    }

    if (dto.priority) {
      query.priority = dto.priority;
    }

    if (dto.currency) {
      query.currency = dto.currency.toUpperCase();
    }

    if (dto.tag) {
      query.tags = dto.tag.trim().toLowerCase();
    }

    if (dto.minAmount !== undefined || dto.maxAmount !== undefined) {
      const amountFilter: Record<string, number> = {};
      if (dto.minAmount !== undefined) amountFilter.$gte = dto.minAmount;
      if (dto.maxAmount !== undefined) amountFilter.$lte = dto.maxAmount;
      query.amount = amountFilter;
    }

    if (dto.startDate || dto.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (dto.startDate) dateFilter.$gte = new Date(dto.startDate);
      if (dto.endDate) dateFilter.$lte = new Date(dto.endDate);
      query.expectedCloseDate = dateFilter;
    }

    if (dto.search) {
      const searchRegex = new RegExp(dto.search.trim(), 'i');
      query.$or = [{ title: searchRegex }, { description: searchRegex }];
    }

    return query;
  }

  async findList(
    dto: ListDealsQueryDto,
    scopedOwnerId?: Types.ObjectId,
  ): Promise<PaginatedResult<DealLean>> {
    const query = this.buildFilterQuery(dto, scopedOwnerId);
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = calculateSkip(page, limit);

    const sortOrder = dto.sortOrder === 'asc' ? 1 : -1;
    const sortField = dto.sortBy || 'createdAt';
    const sort: Record<string, 1 | -1> = { [sortField]: sortOrder };

    const [data, total] = await Promise.all([
      this.dealModel
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('companyId', 'name')
        .populate('contactId', 'firstName lastName email phone')
        .populate('ownerId', 'email')
        .lean<DealLean[]>()
        .exec(),
      this.dealModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findForExport(
    dto: ListDealsQueryDto,
    scopedOwnerId?: Types.ObjectId,
    maxLimit = 1000,
  ): Promise<DealLean[]> {
    const query = this.buildFilterQuery(dto, scopedOwnerId);
    const sortOrder = dto.sortOrder === 'asc' ? 1 : -1;
    const sortField = dto.sortBy || 'createdAt';

    return this.dealModel
      .find(query)
      .sort({ [sortField]: sortOrder })
      .limit(maxLimit)
      .populate('companyId', 'name')
      .populate('contactId', 'firstName lastName email phone')
      .populate('ownerId', 'email')
      .lean<DealLean[]>()
      .exec();
  }

  async updateById(
    id: Types.ObjectId,
    data: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const query = this.dealModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<DealLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const query = this.dealModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
        },
      },
      { new: true },
    );
    if (session) query.session(session);
    return query.lean<DealLean>().exec();
  }

  async updateStage(
    id: Types.ObjectId,
    stage: DealStage,
    probability: number,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const query = this.dealModel.findOneAndUpdate(
      { _id: id, status: DealStatus.OPEN, deletedAt: null },
      {
        $set: {
          stage,
          probability,
          updatedBy: actorId,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<DealLean>().exec();
  }

  async closeDeal(
    id: Types.ObjectId,
    stage: DealStage.CLOSED_WON | DealStage.CLOSED_LOST,
    status: DealStatus.WON | DealStatus.LOST,
    lostReason: string | null,
    lostCompetitor: string | null,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const now = new Date();
    const query = this.dealModel.findOneAndUpdate(
      {
        _id: id,
        status: DealStatus.OPEN, // Atomic precondition: MUST be currently OPEN
        deletedAt: null,
      },
      {
        $set: {
          stage,
          status,
          probability: stage === DealStage.CLOSED_WON ? 100 : 0,
          actualCloseDate: now,
          lostReason: lostReason ?? null,
          lostCompetitor: lostCompetitor ?? null,
          updatedBy: actorId,
        },
        $push: {
          closureHistory: {
            _id: new Types.ObjectId(),
            closedAt: now,
            closedBy: actorId,
            closedStatus: status,
            closedStage: stage,
            lostReason: lostReason ?? null,
            lostCompetitor: lostCompetitor ?? null,
            reopenedAt: null,
            reopenedBy: null,
            reopenReason: null,
          },
        },
      },
      { new: true, runValidators: true, session },
    );
    return query.lean<DealLean>().exec();
  }

  async reopenDeal(
    id: Types.ObjectId,
    targetStage: DealStage,
    probability: number,
    reopenReason: string,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const now = new Date();
    const query = this.dealModel.findOneAndUpdate(
      {
        _id: id,
        status: { $in: [DealStatus.WON, DealStatus.LOST] }, // Atomic precondition: MUST be closed
        deletedAt: null,
      },
      {
        $set: {
          stage: targetStage,
          status: DealStatus.OPEN,
          probability,
          actualCloseDate: null,
          lostReason: null,
          lostCompetitor: null,
          updatedBy: actorId,
          'closureHistory.$[elem].reopenedAt': now,
          'closureHistory.$[elem].reopenedBy': actorId,
          'closureHistory.$[elem].reopenReason': reopenReason,
        },
      },
      {
        arrayFilters: [{ 'elem.reopenedAt': null }],
        new: true,
        runValidators: true,
        session,
      },
    );
    return query.lean<DealLean>().exec();
  }

  async updateOwner(
    id: Types.ObjectId,
    newOwnerId: Types.ObjectId,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const query = this.dealModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { ownerId: newOwnerId, updatedBy: actorId } },
      { new: true },
    );
    if (session) query.session(session);
    return query.lean<DealLean>().exec();
  }

  async bulkUpdateOwner(
    dealIds: Types.ObjectId[],
    newOwnerId: Types.ObjectId,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const query = this.dealModel.updateMany(
      { _id: { $in: dealIds }, deletedAt: null },
      { $set: { ownerId: newOwnerId, updatedBy: actorId } },
    );
    if (session) query.session(session);
    const result = await query.exec();
    return result.modifiedCount;
  }

  async getPipelineKanban(
    pipeline = DEFAULT_PIPELINE,
    scopedOwnerId?: Types.ObjectId,
  ): Promise<
    Array<{
      stage: DealStage;
      count: number;
      totalAmount: number;
      deals: DealLean[];
    }>
  > {
    const match: Record<string, any> = {
      pipeline,
      deletedAt: null,
    };
    if (scopedOwnerId) {
      match.ownerId = scopedOwnerId;
    }

    const deals = await this.dealModel
      .find(match)
      .sort({ createdAt: -1 })
      .populate('companyId', 'name')
      .populate('contactId', 'firstName lastName email phone')
      .populate('ownerId', 'email')
      .lean<DealLean[]>()
      .exec();

    // Group by all stages to return a consistent Kanban structure
    const stages = Object.values(DealStage);
    return stages.map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage);
      const totalAmount = stageDeals.reduce(
        (sum, d) => sum + (d.amount || 0),
        0,
      );
      return {
        stage,
        count: stageDeals.length,
        totalAmount,
        deals: stageDeals,
      };
    });
  }

  async getForecast(
    queryDto: ForecastQueryDto,
    scopedOwnerId?: Types.ObjectId,
  ): Promise<{
    currency: string;
    totalPipeline: number;
    weightedPipeline: number;
    count: number;
    byStage: Array<{
      stage: DealStage;
      count: number;
      totalAmount: number;
      weightedAmount: number;
    }>;
  }> {
    const currency = (queryDto.currency || 'USD').toUpperCase();
    const match: Record<string, any> = {
      status: DealStatus.OPEN,
      currency,
      deletedAt: null,
    };

    if (queryDto.pipeline) {
      match.pipeline = queryDto.pipeline;
    }

    if (scopedOwnerId) {
      match.ownerId = scopedOwnerId;
    } else if (queryDto.ownerId) {
      match.ownerId = new Types.ObjectId(queryDto.ownerId);
    }

    if (queryDto.startDate || queryDto.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (queryDto.startDate) dateFilter.$gte = new Date(queryDto.startDate);
      if (queryDto.endDate) dateFilter.$lte = new Date(queryDto.endDate);
      match.expectedCloseDate = dateFilter;
    }

    const deals = await this.dealModel.find(match).lean<DealLean[]>().exec();

    const openStages = OPEN_STAGES;
    let totalPipelineMinor = 0;
    let weightedPipelineMinor = 0;

    const byStage = openStages.map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage);
      let stageTotalMinor = 0;
      let stageWeightedMinor = 0;

      for (const deal of stageDeals) {
        const amtMinor = toMinorUnits(deal.amount || 0, currency);
        const wMinor = Math.round(amtMinor * ((deal.probability || 0) / 100));
        stageTotalMinor += amtMinor;
        stageWeightedMinor += wMinor;
      }

      totalPipelineMinor += stageTotalMinor;
      weightedPipelineMinor += stageWeightedMinor;

      return {
        stage,
        count: stageDeals.length,
        totalAmount: fromMinorUnits(stageTotalMinor, currency),
        weightedAmount: fromMinorUnits(stageWeightedMinor, currency),
      };
    });

    return {
      currency,
      totalPipeline: fromMinorUnits(totalPipelineMinor, currency),
      weightedPipeline: fromMinorUnits(weightedPipelineMinor, currency),
      count: deals.length,
      byStage,
    };
  }

  async addNote(
    dealId: Types.ObjectId,
    note: Partial<DealNote>,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const query = this.dealModel.findOneAndUpdate(
      { _id: dealId, deletedAt: null },
      { $push: { notes: note } },
      { new: true, session },
    );
    return query.lean<DealLean>().exec();
  }

  async deleteNote(
    dealId: Types.ObjectId,
    noteId: Types.ObjectId,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<DealLean | null> {
    const query = this.dealModel.findOneAndUpdate(
      {
        _id: dealId,
        deletedAt: null,
        'notes._id': noteId,
        'notes.deletedAt': null,
      },
      {
        $set: {
          'notes.$.deletedAt': new Date(),
          'notes.$.deletedBy': actorId,
        },
      },
      { new: true, session },
    );
    return query.lean<DealLean>().exec();
  }
}
