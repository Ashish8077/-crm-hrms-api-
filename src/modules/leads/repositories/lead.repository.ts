import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Lead } from '../schemas/lead.schema';
import { LeadNote } from '../schemas/lead-note.schema';
import { LeadFollowUp } from '../schemas/lead-follow-up.schema';
import { LeadDocument } from '../schemas/lead-document.schema';
import { ListLeadsQueryDto } from '../dto/list-leads-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { escapeRegExp } from '../../../common/utils/regex.util';
import {
  buildPaginationMeta,
  calculateSkip,
} from '../../../common/pagination/pagination.util';

export type LeadLean = Lead & { _id: Types.ObjectId };

@Injectable()
export class LeadRepository {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
  ) {}

  async create(
    data: Partial<Lead>,
    session?: ClientSession,
  ): Promise<LeadLean> {
    const created = new this.leadModel(data);
    const saved = await created.save({ session });
    return saved.toObject();
  }

  async findById(
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const query = this.leadModel.findOne({ _id: id, deletedAt: null });
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }

  private buildFilterQuery(queryDto: ListLeadsQueryDto): Record<string, any> {
    const query: Record<string, any> = {
      deletedAt: null,
    };

    const {
      search,
      status,
      source,
      ownerId,
      minScore,
      maxScore,
      tag,
      startDate,
      endDate,
    } = queryDto;

    if (search) {
      const cleanSearch = escapeRegExp(search.trim());
      const searchRegex = new RegExp(cleanSearch, 'i');
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { companyName: searchRegex },
      ];
    }

    if (status) {
      query.status = status;
    }

    if (source) {
      query.source = source;
    }

    if (ownerId) {
      query.ownerId = new Types.ObjectId(ownerId);
    }

    if (minScore !== undefined || maxScore !== undefined) {
      const scoreFilter: Record<string, number> = {};
      if (minScore !== undefined) {
        scoreFilter.$gte = minScore;
      }
      if (maxScore !== undefined) {
        scoreFilter.$lte = maxScore;
      }
      query.score = scoreFilter;
    }

    if (tag) {
      query.tags = tag.trim();
    }

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) {
        dateFilter.$gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.$lte = new Date(endDate);
      }
      query.createdAt = dateFilter;
    }

    return query;
  }

  async findList(
    queryDto: ListLeadsQueryDto,
  ): Promise<PaginatedResult<LeadLean>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = queryDto;

    const query = this.buildFilterQuery(queryDto);
    const skip = calculateSkip(page, limit);
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sortOptions: Record<string, 1 | -1> = { [sortBy]: sortDirection };

    const [data, total] = await Promise.all([
      this.leadModel
        .find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean<LeadLean[]>()
        .exec(),
      this.leadModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findForExport(queryDto: ListLeadsQueryDto): Promise<LeadLean[]> {
    const query = this.buildFilterQuery(queryDto);
    const { sortBy = 'createdAt', sortOrder = 'desc' } = queryDto;
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    return this.leadModel
      .find(query)
      .sort({ [sortBy]: sortDirection })
      .lean<LeadLean[]>()
      .exec();
  }

  async updateById(
    id: Types.ObjectId,
    data: Record<string, any>,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const query = this.leadModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const query = this.leadModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }

  async checkDuplicate(
    email?: string,
    phone?: string,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const conditions: Array<Record<string, any>> = [];

    if (email) {
      conditions.push({ email: email.trim().toLowerCase() });
    }
    if (phone) {
      conditions.push({ phone: phone.trim() });
    }

    if (conditions.length === 0) {
      return null;
    }

    const query: Record<string, any> = {
      deletedAt: null,
      $or: conditions,
    };

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const mongooseQuery = this.leadModel.findOne(query);
    if (session) {
      mongooseQuery.session(session);
    }
    return mongooseQuery.lean<LeadLean>().exec();
  }

  async bulkAssign(
    leadIds: Types.ObjectId[],
    ownerId: Types.ObjectId,
    updatedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const result = await this.leadModel
      .updateMany(
        {
          _id: { $in: leadIds },
          deletedAt: null,
        },
        {
          $set: {
            ownerId,
            updatedBy,
          },
        },
        { session },
      )
      .exec();

    return result.modifiedCount;
  }

  async addNote(
    leadId: Types.ObjectId,
    note: Partial<LeadNote>,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const query = this.leadModel.findOneAndUpdate(
      { _id: leadId, deletedAt: null },
      {
        $push: {
          notes: {
            _id: new Types.ObjectId(),
            content: note.content,
            createdBy: note.createdBy,
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }

  async deleteNote(
    leadId: Types.ObjectId,
    noteId: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const query = this.leadModel.findOneAndUpdate(
      {
        _id: leadId,
        deletedAt: null,
        'notes._id': noteId,
        'notes.deletedAt': null,
      },
      {
        $set: {
          'notes.$.deletedAt': new Date(),
          'notes.$.deletedBy': deletedBy,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }

  async addFollowUp(
    leadId: Types.ObjectId,
    followUp: Partial<LeadFollowUp>,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const query = this.leadModel.findOneAndUpdate(
      { _id: leadId, deletedAt: null },
      {
        $push: {
          followUps: {
            _id: new Types.ObjectId(),
            scheduledAt: followUp.scheduledAt,
            assignedTo: followUp.assignedTo,
            status: followUp.status,
            notes: followUp.notes ?? null,
            createdBy: followUp.createdBy,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }

  async updateFollowUp(
    leadId: Types.ObjectId,
    followUpId: Types.ObjectId,
    data: Partial<LeadFollowUp>,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const setFields: Record<string, any> = {
      'followUps.$.updatedAt': new Date(),
    };

    if (data.scheduledAt !== undefined) {
      setFields['followUps.$.scheduledAt'] = data.scheduledAt;
    }
    if (data.assignedTo !== undefined) {
      setFields['followUps.$.assignedTo'] = data.assignedTo;
    }
    if (data.status !== undefined) {
      setFields['followUps.$.status'] = data.status;
    }
    if (data.notes !== undefined) {
      setFields['followUps.$.notes'] = data.notes;
    }

    const query = this.leadModel.findOneAndUpdate(
      {
        _id: leadId,
        deletedAt: null,
        'followUps._id': followUpId,
      },
      { $set: setFields },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }

  async addDocument(
    leadId: Types.ObjectId,
    document: Partial<LeadDocument>,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const query = this.leadModel.findOneAndUpdate(
      { _id: leadId, deletedAt: null },
      {
        $push: {
          documents: {
            _id: new Types.ObjectId(),
            fileName: document.fileName,
            fileUrl: document.fileUrl,
            fileType: document.fileType ?? null,
            fileSize: document.fileSize ?? 0,
            uploadedBy: document.uploadedBy,
            uploadedAt: new Date(),
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }

  async deleteDocument(
    leadId: Types.ObjectId,
    documentId: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<LeadLean | null> {
    const query = this.leadModel.findOneAndUpdate(
      {
        _id: leadId,
        deletedAt: null,
        'documents._id': documentId,
        'documents.deletedAt': null,
      },
      {
        $set: {
          'documents.$.deletedAt': new Date(),
          'documents.$.deletedBy': deletedBy,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<LeadLean>().exec();
  }
}
