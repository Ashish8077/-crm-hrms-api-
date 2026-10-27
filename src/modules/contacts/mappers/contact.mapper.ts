import { Types } from 'mongoose';
import { Contact } from '../schemas/contact.schema';
import { ContactStatus } from '../constants/contact-status.constant';
import { CreateContactDto } from '../dto/create-contact.dto';
import { UpdateContactDto } from '../dto/update-contact.dto';
import { normalizeEmail } from '../../../common/utils/string-normalization.util';

export interface ContactCompanyRef {
  _id: Types.ObjectId | string;
  name: string;
  domain?: string | null;
  deletedAt?: Date | null;
}

export interface ContactOwnerRef {
  _id?: Types.ObjectId | string;
  id?: string;
  email?: string;
}

export type ContactLean = Contact & { _id: Types.ObjectId };

export interface ContactResponse {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  mobilePhone?: string | null;
  workPhone?: string | null;
  additionalPhones: Array<{ label: string; value: string }>;
  alternateEmail?: string | null;
  additionalEmails: Array<{ label: string; value: string }>;
  companyId?: string | null;
  company?: {
    id: string;
    name: string;
    domain?: string | null;
    isDeleted?: boolean;
  } | null;
  jobTitle?: string | null;
  department?: string | null;
  isPrimaryContact: boolean;
  decisionRole: string;
  address?: Record<string, any>;
  socialLinks?: Record<string, any>;
  ownerId?: string | null;
  owner?: { id: string; email?: string } | null;
  leadId?: string | null;
  status: string;
  tags: string[];
  notesCount: number;
  documentsCount: number;
  notes?: Array<{
    id: string;
    content: string;
    createdBy: string;
    createdAt: Date;
  }>;
  documents?: Array<{
    id: string;
    fileName: string;
    fileType?: string | null;
    fileSize?: number;
    uploadedBy: string;
    uploadedAt: Date;
  }>;
  createdAt?: Date;
  updatedAt?: Date;
}

export class ContactMapper {
  static toCreateData(
    dto: CreateContactDto,
    actorId: Types.ObjectId,
  ): Partial<Contact> {
    return {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: normalizeEmail(dto.email)!,
      phone: dto.phone.trim(),
      mobilePhone: dto.mobilePhone ? dto.mobilePhone.trim() : null,
      workPhone: dto.workPhone ? dto.workPhone.trim() : null,
      additionalPhones: dto.additionalPhones
        ? dto.additionalPhones.map((p) => ({
            label: p.label.trim(),
            value: p.value.trim(),
          }))
        : [],
      alternateEmail: normalizeEmail(dto.alternateEmail),
      additionalEmails: dto.additionalEmails
        ? dto.additionalEmails.map((e) => ({
            label: e.label.trim(),
            value: normalizeEmail(e.value)!,
          }))
        : [],
      companyId: dto.companyId ? new Types.ObjectId(dto.companyId) : null,
      jobTitle: dto.jobTitle ? dto.jobTitle.trim() : null,
      department: dto.department ? dto.department.trim() : null,
      isPrimaryContact: dto.isPrimaryContact ?? false,
      decisionRole: dto.decisionRole,
      address: dto.address ?? {},
      socialLinks: dto.socialLinks ?? {},
      ownerId: dto.ownerId ? new Types.ObjectId(dto.ownerId) : null,
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : null,
      status: dto.status ?? ContactStatus.ACTIVE,
      tags: dto.tags
        ? Array.from(new Set(dto.tags.map((t) => t.trim().toLowerCase())))
        : [],
      notes: [],
      documents: [],
      deletedAt: null,
      createdBy: actorId,
      updatedBy: actorId,
    };
  }

  static toUpdateData(
    dto: UpdateContactDto,
    actorId: Types.ObjectId,
  ): Record<string, any> {
    const data: Record<string, any> = {
      updatedBy: actorId,
    };

    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.email !== undefined) data.email = normalizeEmail(dto.email)!;
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.mobilePhone !== undefined)
      data.mobilePhone = dto.mobilePhone ? dto.mobilePhone.trim() : null;
    if (dto.workPhone !== undefined)
      data.workPhone = dto.workPhone ? dto.workPhone.trim() : null;
    if (dto.additionalPhones !== undefined) {
      data.additionalPhones = dto.additionalPhones.map((p) => ({
        label: p.label.trim(),
        value: p.value.trim(),
      }));
    }
    if (dto.alternateEmail !== undefined) {
      data.alternateEmail = normalizeEmail(dto.alternateEmail);
    }
    if (dto.additionalEmails !== undefined) {
      data.additionalEmails = dto.additionalEmails.map((e) => ({
        label: e.label.trim(),
        value: normalizeEmail(e.value)!,
      }));
    }
    if (dto.companyId !== undefined) {
      data.companyId = dto.companyId ? new Types.ObjectId(dto.companyId) : null;
    }
    if (dto.jobTitle !== undefined)
      data.jobTitle = dto.jobTitle ? dto.jobTitle.trim() : null;
    if (dto.department !== undefined)
      data.department = dto.department ? dto.department.trim() : null;
    if (dto.isPrimaryContact !== undefined)
      data.isPrimaryContact = dto.isPrimaryContact;
    if (dto.decisionRole !== undefined) data.decisionRole = dto.decisionRole;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.socialLinks !== undefined) data.socialLinks = dto.socialLinks;
    if (dto.ownerId !== undefined) {
      data.ownerId = dto.ownerId ? new Types.ObjectId(dto.ownerId) : null;
    }
    if (dto.leadId !== undefined) {
      data.leadId = dto.leadId ? new Types.ObjectId(dto.leadId) : null;
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.tags !== undefined) {
      data.tags = Array.from(
        new Set(dto.tags.map((t) => t.trim().toLowerCase())),
      );
    }

    return data;
  }

  static toResponse(
    contact: ContactLean,
    company?: ContactCompanyRef | null,
    owner?: ContactOwnerRef | null,
  ): ContactResponse {
    const activeNotes = (contact.notes || []).filter((n) => !n.deletedAt);
    const activeDocuments = (contact.documents || []).filter(
      (d) => !d.deletedAt,
    );

    return {
      id: contact._id.toString(),
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: `${contact.firstName} ${contact.lastName}`,
      email: contact.email,
      phone: contact.phone,
      mobilePhone: contact.mobilePhone ?? null,
      workPhone: contact.workPhone ?? null,
      additionalPhones: contact.additionalPhones || [],
      alternateEmail: contact.alternateEmail ?? null,
      additionalEmails: contact.additionalEmails || [],
      companyId: contact.companyId ? contact.companyId.toString() : null,
      company: company
        ? {
            id: company._id.toString(),
            name: company.name,
            domain: company.domain ?? null,
            isDeleted: !!company.deletedAt,
          }
        : null,
      jobTitle: contact.jobTitle ?? null,
      department: contact.department ?? null,
      isPrimaryContact: contact.isPrimaryContact || false,
      decisionRole: contact.decisionRole,
      address: contact.address || {},
      socialLinks: contact.socialLinks || {},
      ownerId: contact.ownerId ? contact.ownerId.toString() : null,
      owner: owner
        ? {
            id: owner._id ? owner._id.toString() : (owner.id ?? ''),
            email: owner.email,
          }
        : contact.ownerId
          ? { id: contact.ownerId.toString() }
          : null,
      leadId: contact.leadId ? contact.leadId.toString() : null,
      status: contact.status,
      tags: contact.tags || [],
      notesCount: activeNotes.length,
      documentsCount: activeDocuments.length,
      notes: activeNotes.map((n) => ({
        id: n._id.toString(),
        content: n.content,
        createdBy: n.createdBy.toString(),
        createdAt: n.createdAt || new Date(),
      })),
      documents: activeDocuments.map((d) => ({
        id: d._id.toString(),
        fileName: d.fileName,
        fileType: d.fileType ?? null,
        fileSize: d.fileSize ?? 0,
        uploadedBy: d.uploadedBy.toString(),
        uploadedAt: d.uploadedAt || new Date(),
      })),
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
  }
}
