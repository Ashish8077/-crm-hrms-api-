import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Company, CompanyDocumentType } from '../schemas/company.schema';
import { CompanyLean } from '../mappers/company.mapper';
export type { CompanyLean };
import { CompanyNote } from '../schemas/company-note.schema';
import { CompanyDocument } from '../schemas/company-document.schema';
import { ListCompaniesQueryDto } from '../dto/list-companies-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import {
  calculateSkip,
  buildPaginationMeta,
} from '../../../common/pagination/pagination.util';
import { normalizeRegistrationNumber } from '../../../common/utils/string-normalization.util';

@Injectable()
export class CompanyRepository {
  constructor(
    @InjectModel(Company.name)
    private readonly companyModel: Model<CompanyDocumentType>,
  ) {}

  async create(
    data: Partial<Company>,
    session?: ClientSession,
  ): Promise<CompanyLean> {
    const docs = await this.companyModel.create([data], { session });
    return docs[0].toObject();
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CompanyLean | null> {
    const query = this.companyModel.findOne({ _id: id, deletedAt: null });
    if (session) query.session(session);
    return query.lean<CompanyLean>().exec();
  }

  private buildFilterQuery(dto: ListCompaniesQueryDto): Record<string, any> {
    const query: Record<string, any> = { deletedAt: null };

    if (dto.status) {
      query.status = dto.status;
    }
    if (dto.industry) {
      query.industry = dto.industry;
    }
    if (dto.type) {
      query.type = dto.type;
    }
    if (dto.ownerId) {
      query.ownerId = new Types.ObjectId(dto.ownerId);
    }
    if (dto.tag) {
      query.tags = dto.tag.trim().toLowerCase();
    }
    if (dto.search) {
      const searchRegex = new RegExp(dto.search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { domain: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { registrationNumber: searchRegex },
        { taxId: searchRegex },
      ];
    }

    return query;
  }

  async findList(
    queryDto: ListCompaniesQueryDto,
  ): Promise<PaginatedResult<CompanyLean>> {
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
      this.companyModel
        .find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean<CompanyLean[]>()
        .exec(),
      this.companyModel.countDocuments(query).exec(),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateById(
    id: Types.ObjectId,
    data: Record<string, any>,
    session?: ClientSession,
  ): Promise<CompanyLean | null> {
    const query = this.companyModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<CompanyLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CompanyLean | null> {
    const query = this.companyModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<CompanyLean>().exec();
  }

  async checkDuplicate(
    registrationNumber?: string | null,
    domain?: string | null,
    email?: string | null,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CompanyLean | null> {
    const conditions: Array<Record<string, any>> = [];

    const normalizedReg = normalizeRegistrationNumber(registrationNumber);
    if (normalizedReg) {
      conditions.push({ registrationNumber: normalizedReg });
      conditions.push({ taxId: normalizedReg });
    }
    if (domain) {
      conditions.push({ domain: domain.trim().toLowerCase() });
    }
    if (email) {
      conditions.push({ email: email.trim().toLowerCase() });
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

    const mongooseQuery = this.companyModel.findOne(query);
    if (session) mongooseQuery.session(session);
    return mongooseQuery.lean<CompanyLean>().exec();
  }

  async addNote(
    companyId: Types.ObjectId,
    note: Partial<CompanyNote>,
    session?: ClientSession,
  ): Promise<CompanyLean | null> {
    const query = this.companyModel.findOneAndUpdate(
      { _id: companyId, deletedAt: null },
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
    if (session) query.session(session);
    return query.lean<CompanyLean>().exec();
  }

  async softDeleteNote(
    companyId: Types.ObjectId,
    noteId: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CompanyLean | null> {
    const query = this.companyModel.findOneAndUpdate(
      {
        _id: companyId,
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
    if (session) query.session(session);
    return query.lean<CompanyLean>().exec();
  }

  async addDocument(
    companyId: Types.ObjectId,
    doc: Partial<CompanyDocument>,
    session?: ClientSession,
  ): Promise<CompanyLean | null> {
    const query = this.companyModel.findOneAndUpdate(
      { _id: companyId, deletedAt: null },
      {
        $push: {
          documents: {
            _id: new Types.ObjectId(),
            fileName: doc.fileName,
            fileKey: doc.fileKey,
            fileType: doc.fileType ?? null,
            fileSize: doc.fileSize ?? 0,
            uploadedBy: doc.uploadedBy,
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
    if (session) query.session(session);
    return query.lean<CompanyLean>().exec();
  }

  async findDocumentById(
    companyId: Types.ObjectId,
    documentId: Types.ObjectId,
  ): Promise<CompanyDocument | null> {
    const company = await this.companyModel
      .findOne(
        {
          _id: companyId,
          deletedAt: null,
          'documents._id': documentId,
          'documents.deletedAt': null,
        },
        { 'documents.$': 1 },
      )
      .lean<CompanyLean>()
      .exec();

    if (!company || !company.documents || company.documents.length === 0) {
      return null;
    }
    return company.documents[0];
  }

  async softDeleteDocument(
    companyId: Types.ObjectId,
    documentId: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CompanyDocument | null> {
    const doc = await this.findDocumentById(companyId, documentId);
    if (!doc) return null;

    const query = this.companyModel.findOneAndUpdate(
      {
        _id: companyId,
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
    if (session) query.session(session);
    await query.exec();

    return doc;
  }

  async updateOwner(
    companyId: Types.ObjectId,
    ownerId: Types.ObjectId,
    updatedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CompanyLean | null> {
    const query = this.companyModel.findOneAndUpdate(
      { _id: companyId, deletedAt: null },
      { $set: { ownerId, updatedBy } },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<CompanyLean>().exec();
  }
}
