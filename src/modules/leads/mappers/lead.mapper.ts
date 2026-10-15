import { Types } from 'mongoose';
import { Lead } from '../schemas/lead.schema';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { UpdateLeadDto } from '../dto/update-lead.dto';
import { LeadSource } from '../constants/lead-source.constant';
import { LeadStatus } from '../constants/lead-status.constant';

export type LeadMapperInput = Lead & { _id: Types.ObjectId };

export interface LeadNoteResponse {
  id: string;
  content: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LeadFollowUpResponse {
  id: string;
  scheduledAt: Date;
  assignedTo: string;
  status: string;
  notes?: string | null;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LeadDocumentResponse {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType?: string | null;
  fileSize?: number;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface LeadResponse {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName?: string | null;
  jobTitle?: string | null;
  source: string;
  status: string;
  score: number;
  tags: string[];
  ownerId: string | null;
  notes: LeadNoteResponse[];
  followUps: LeadFollowUpResponse[];
  documents: LeadDocumentResponse[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class LeadMapper {
  static toResponse(lead: LeadMapperInput): LeadResponse {
    const activeNotes = (lead.notes || []).filter((n) => !n.deletedAt);
    const activeDocuments = (lead.documents || []).filter((d) => !d.deletedAt);
    const followUps = lead.followUps || [];

    return {
      id: lead._id.toString(),
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      companyName: lead.companyName ?? null,
      jobTitle: lead.jobTitle ?? null,
      source: lead.source,
      status: lead.status,
      score: lead.score ?? 0,
      tags: lead.tags ?? [],
      ownerId: lead.ownerId ? lead.ownerId.toString() : null,
      notes: activeNotes.map((note) => ({
        id: note._id.toString(),
        content: note.content,
        createdBy: note.createdBy.toString(),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
      followUps: followUps.map((fu) => ({
        id: fu._id.toString(),
        scheduledAt: fu.scheduledAt,
        assignedTo: fu.assignedTo.toString(),
        status: fu.status,
        notes: fu.notes ?? null,
        createdBy: fu.createdBy.toString(),
        createdAt: fu.createdAt,
        updatedAt: fu.updatedAt,
      })),
      documents: activeDocuments.map((doc) => ({
        id: doc._id.toString(),
        fileName: doc.fileName,
        fileUrl: doc.fileUrl,
        fileType: doc.fileType ?? null,
        fileSize: doc.fileSize ?? 0,
        uploadedBy: doc.uploadedBy.toString(),
        uploadedAt: doc.uploadedAt,
      })),
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
  }

  static toCreateData(
    dto: CreateLeadDto,
    createdBy?: Types.ObjectId,
  ): Partial<Lead> {
    const cleanTags = dto.tags
      ? Array.from(new Set(dto.tags.map((t) => t.trim()))).filter(Boolean)
      : [];

    return {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: dto.email.trim().toLowerCase(),
      phone: dto.phone.trim(),
      companyName: dto.companyName?.trim() ?? null,
      jobTitle: dto.jobTitle?.trim() ?? null,
      source: dto.source ?? LeadSource.OTHER,
      status: dto.status ?? LeadStatus.NEW,
      score: dto.score ?? 0,
      tags: cleanTags,
      ownerId: dto.ownerId ? new Types.ObjectId(dto.ownerId) : null,
      notes: [],
      followUps: [],
      documents: [],
      createdBy: createdBy ?? null,
      updatedBy: createdBy ?? null,
    };
  }

  static toUpdateData(
    dto: UpdateLeadDto,
    updatedBy?: Types.ObjectId,
  ): Record<string, any> {
    const data: Record<string, any> = {};

    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.companyName !== undefined)
      data.companyName = dto.companyName ? dto.companyName.trim() : null;
    if (dto.jobTitle !== undefined)
      data.jobTitle = dto.jobTitle ? dto.jobTitle.trim() : null;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.score !== undefined) data.score = dto.score;
    if (dto.tags !== undefined) {
      data.tags = Array.from(new Set(dto.tags.map((t) => t.trim()))).filter(
        Boolean,
      );
    }
    if (dto.ownerId !== undefined) {
      data.ownerId = dto.ownerId ? new Types.ObjectId(dto.ownerId) : null;
    }
    if (updatedBy) {
      data.updatedBy = updatedBy;
    }

    return data;
  }

  static toUpdateAuditDetails(
    before: LeadMapperInput,
    after: LeadMapperInput,
  ): Record<string, any> {
    const changes: Record<string, { from: any; to: any }> = {};

    const checkField = (field: keyof LeadMapperInput) => {
      const beforeVal = before[field];
      const afterVal = after[field];
      const strBefore =
        beforeVal instanceof Types.ObjectId ? beforeVal.toString() : beforeVal;
      const strAfter =
        afterVal instanceof Types.ObjectId ? afterVal.toString() : afterVal;

      if (JSON.stringify(strBefore) !== JSON.stringify(strAfter)) {
        changes[field as string] = { from: beforeVal, to: afterVal };
      }
    };

    checkField('firstName');
    checkField('lastName');
    checkField('email');
    checkField('phone');
    checkField('companyName');
    checkField('jobTitle');
    checkField('source');
    checkField('status');
    checkField('score');
    checkField('ownerId');

    return { changes };
  }
}
