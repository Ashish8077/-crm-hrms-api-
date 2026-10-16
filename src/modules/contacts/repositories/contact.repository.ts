import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { Contact, ContactDocumentType } from '../schemas/contact.schema';
import { ContactLean } from '../mappers/contact.mapper';
export type { ContactLean };
import { ContactNote } from '../schemas/contact-note.schema';
import { ContactDocument } from '../schemas/contact-document.schema';
import { ListContactsQueryDto } from '../dto/list-contacts-query.dto';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import {
  calculateSkip,
  buildPaginationMeta,
} from '../../../common/pagination/pagination.util';
import { normalizeEmail } from '../../../common/utils/string-normalization.util';

@Injectable()
export class ContactRepository {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocumentType>,
  ) {}

  async create(
    data: Partial<Contact>,
    session?: ClientSession,
  ): Promise<ContactLean> {
    const docs = await this.contactModel.create([data], { session });
    return docs[0].toObject() as ContactLean;
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOne({ _id: id, deletedAt: null });
    if (session) query.session(session);
    return query.lean<ContactLean>().exec();
  }

  async findPrimaryContactByCompanyId(
    companyId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOne({
      companyId,
      isPrimaryContact: true,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<ContactLean>().exec();
  }

  async findByCompanyId(
    companyId: Types.ObjectId,
  ): Promise<ContactLean[]> {
    return this.contactModel
      .find({ companyId, deletedAt: null })
      .sort({ isPrimaryContact: -1, createdAt: 1 })
      .lean<ContactLean[]>()
      .exec();
  }

  private buildFilterQuery(dto: ListContactsQueryDto): Record<string, any> {
    const query: Record<string, any> = { deletedAt: null };

    if (dto.companyId) {
      query.companyId = new Types.ObjectId(dto.companyId);
    }
    if (dto.ownerId) {
      query.ownerId = new Types.ObjectId(dto.ownerId);
    }
    if (dto.status) {
      query.status = dto.status;
    }
    if (dto.decisionRole) {
      query.decisionRole = dto.decisionRole;
    }
    if (dto.tag) {
      query.tags = dto.tag.trim().toLowerCase();
    }
    if (dto.search) {
      const searchRegex = new RegExp(dto.search.trim(), 'i');
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { jobTitle: searchRegex },
      ];
    }

    return query;
  }

  async findList(
    queryDto: ListContactsQueryDto,
  ): Promise<PaginatedResult<ContactLean>> {
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
      this.contactModel
        .find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean<ContactLean[]>()
        .exec(),
      this.contactModel.countDocuments(query).exec(),
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
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: data },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<ContactLean>().exec();
  }

  async softDelete(
    id: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy,
          isPrimaryContact: false,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<ContactLean>().exec();
  }

  async checkDuplicate(
    email?: string | null,
    phone?: string | null,
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const conditions: Array<Record<string, any>> = [];

    const normEmail = normalizeEmail(email);
    if (normEmail) {
      conditions.push({ email: normEmail });
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

    const mongooseQuery = this.contactModel.findOne(query);
    if (session) mongooseQuery.session(session);
    return mongooseQuery.lean<ContactLean>().exec();
  }

  async checkEmailCollision(
    emails: string[],
    excludeId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    if (!emails || emails.length === 0) return null;

    const normalizedList = emails.map((e) => normalizeEmail(e)!).filter(Boolean);
    if (normalizedList.length === 0) return null;

    const query: Record<string, any> = {
      deletedAt: null,
      $or: [
        { email: { $in: normalizedList } },
        { alternateEmail: { $in: normalizedList } },
        { 'additionalEmails.value': { $in: normalizedList } },
      ],
    };

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const mongooseQuery = this.contactModel.findOne(query);
    if (session) mongooseQuery.session(session);
    return mongooseQuery.lean<ContactLean>().exec();
  }

  async transferCompanyAndPrimary(
    contactId: Types.ObjectId,
    newCompanyId: Types.ObjectId,
    isPrimaryInNewCompany: boolean,
    jobTitle?: string | null,
    department?: string | null,
    actorId?: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    // 1. Fetch current contact
    const current = await this.contactModel.findOne({ _id: contactId, deletedAt: null }).session(session || null);
    if (!current) return null;

    const oldCompanyId = current.companyId;

    // 2. Clear old company primary status if contact was primary in old company
    if (oldCompanyId && current.isPrimaryContact && !oldCompanyId.equals(newCompanyId)) {
      await this.contactModel.updateOne(
        { _id: contactId },
        { $set: { isPrimaryContact: false, updatedBy: actorId } },
        { session },
      );
    }

    // 3. Unset existing primary contact in new company if target is designated primary
    if (isPrimaryInNewCompany) {
      await this.contactModel.updateMany(
        { companyId: newCompanyId, isPrimaryContact: true, deletedAt: null },
        { $set: { isPrimaryContact: false, updatedBy: actorId } },
        { session },
      );
    }

    // 4. Update target contact with new company link & primary status
    const updateFields: Record<string, any> = {
      companyId: newCompanyId,
      isPrimaryContact: isPrimaryInNewCompany,
      updatedBy: actorId,
    };
    if (jobTitle !== undefined) updateFields.jobTitle = jobTitle;
    if (department !== undefined) updateFields.department = department;

    const query = this.contactModel.findOneAndUpdate(
      { _id: contactId, deletedAt: null },
      { $set: updateFields },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<ContactLean>().exec();
  }

  async unlinkCompany(
    contactId: Types.ObjectId,
    actorId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOneAndUpdate(
      { _id: contactId, deletedAt: null },
      {
        $set: {
          companyId: null,
          isPrimaryContact: false,
          updatedBy: actorId,
        },
      },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<ContactLean>().exec();
  }

  async addNote(
    contactId: Types.ObjectId,
    note: Partial<ContactNote>,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOneAndUpdate(
      { _id: contactId, deletedAt: null },
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
    return query.lean<ContactLean>().exec();
  }

  async softDeleteNote(
    contactId: Types.ObjectId,
    noteId: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOneAndUpdate(
      {
        _id: contactId,
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
    return query.lean<ContactLean>().exec();
  }

  async addDocument(
    contactId: Types.ObjectId,
    doc: Partial<ContactDocument>,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOneAndUpdate(
      { _id: contactId, deletedAt: null },
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
    return query.lean<ContactLean>().exec();
  }

  async findDocumentById(
    contactId: Types.ObjectId,
    documentId: Types.ObjectId,
  ): Promise<ContactDocument | null> {
    const contact = await this.contactModel.findOne(
      {
        _id: contactId,
        deletedAt: null,
        'documents._id': documentId,
        'documents.deletedAt': null,
      },
      { 'documents.$': 1 },
    ).lean<ContactLean>().exec();

    if (!contact || !contact.documents || contact.documents.length === 0) {
      return null;
    }
    return contact.documents[0];
  }

  async softDeleteDocument(
    contactId: Types.ObjectId,
    documentId: Types.ObjectId,
    deletedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactDocument | null> {
    const doc = await this.findDocumentById(contactId, documentId);
    if (!doc) return null;

    const query = this.contactModel.findOneAndUpdate(
      {
        _id: contactId,
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
    contactId: Types.ObjectId,
    ownerId: Types.ObjectId,
    updatedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ContactLean | null> {
    const query = this.contactModel.findOneAndUpdate(
      { _id: contactId, deletedAt: null },
      { $set: { ownerId, updatedBy } },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean<ContactLean>().exec();
  }
}
