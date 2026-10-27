import { Types } from 'mongoose';
import { Company } from '../schemas/company.schema';
import { CreateCompanyDto } from '../dto/create-company.dto';
import { UpdateCompanyDto } from '../dto/update-company.dto';
import { normalizeRegistrationNumber } from '../../../common/utils/string-normalization.util';
import { CompanyStatus } from '../constants/company-status.constant';

export interface CompanyOwnerRef {
  _id?: Types.ObjectId | string;
  id?: string;
  email?: string;
}

export interface ParentCompanyRef {
  _id: Types.ObjectId | string;
  name: string;
}

export interface PrimaryContactRef {
  _id: Types.ObjectId | string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle?: string | null;
}

export type CompanyLean = Company & { _id: Types.ObjectId };

export interface CompanyResponse {
  id: string;
  name: string;
  legalName?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
  status: string;
  industry: string;
  type: string;
  tier: string;
  domain?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  additionalPhones?: Array<{ label: string; value: string }>;
  additionalEmails?: Array<{ label: string; value: string }>;
  address?: Record<string, any>;
  billingAddress?: Record<string, any>;
  shippingAddress?: Record<string, any>;
  socialLinks?: Record<string, any>;
  annualRevenue: number;
  currency: string;
  employeeCount?: number | null;
  employeeCountRange?: string | null;
  ownerId?: string | null;
  owner?: { id: string; email?: string } | null;
  parentCompanyId?: string | null;
  parentCompany?: { id: string; name: string } | null;
  primaryContact?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    jobTitle?: string | null;
  } | null;
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

export class CompanyMapper {
  static toCreateData(
    dto: CreateCompanyDto,
    actorId: Types.ObjectId,
  ): Partial<Company> {
    const regNumber = normalizeRegistrationNumber(
      dto.registrationNumber || dto.taxId,
    );
    const taxIdValue = dto.taxId ? dto.taxId.trim().toUpperCase() : regNumber;

    const mainAddress = dto.address ?? dto.billingAddress ?? {};
    const billing = dto.billingAddress ?? dto.address ?? {};
    const shipping = dto.shippingAddress ?? dto.address ?? {};

    let empCount: number | null = null;
    let empRange = dto.employeeCountRange
      ? dto.employeeCountRange.trim()
      : null;
    if (dto.employeeCount !== undefined && dto.employeeCount !== null) {
      const parsed = Number(dto.employeeCount);
      if (!isNaN(parsed)) {
        empCount = parsed;
        if (!empRange) {
          if (parsed <= 10) empRange = '1-10';
          else if (parsed <= 50) empRange = '11-50';
          else if (parsed <= 200) empRange = '51-200';
          else if (parsed <= 500) empRange = '201-500';
          else if (parsed <= 1000) empRange = '501-1000';
          else empRange = '1000+';
        }
      }
    }

    return {
      name: dto.name.trim(),
      legalName: dto.legalName ? dto.legalName.trim() : null,
      registrationNumber: regNumber,
      taxId: taxIdValue,
      status: dto.status ?? CompanyStatus.ACTIVE,
      industry: dto.industry,
      type: dto.type,
      tier: dto.tier,
      domain: dto.domain ? dto.domain.trim().toLowerCase() : null,
      website: dto.website ? dto.website.trim() : null,
      email: dto.email ? dto.email.trim().toLowerCase() : null,
      phone: dto.phone ? dto.phone.trim() : null,
      additionalPhones: dto.additionalPhones ?? [],
      additionalEmails: dto.additionalEmails ?? [],
      address: mainAddress,
      billingAddress: billing,
      shippingAddress: shipping,
      socialLinks: dto.socialLinks ?? {},
      annualRevenue: dto.annualRevenue ?? 0,
      currency: dto.currency ? dto.currency.trim().toUpperCase() : 'USD',
      employeeCount: empCount,
      employeeCountRange: empRange,
      ownerId: dto.ownerId ? new Types.ObjectId(dto.ownerId) : null,
      parentCompanyId: dto.parentCompanyId
        ? new Types.ObjectId(dto.parentCompanyId)
        : null,
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
    dto: UpdateCompanyDto,
    actorId: Types.ObjectId,
  ): Record<string, any> {
    const data: Record<string, any> = {
      updatedBy: actorId,
    };

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.legalName !== undefined)
      data.legalName = dto.legalName ? dto.legalName.trim() : null;
    if (dto.registrationNumber !== undefined) {
      data.registrationNumber = normalizeRegistrationNumber(
        dto.registrationNumber,
      );
    }
    if (dto.taxId !== undefined) {
      data.taxId = dto.taxId ? dto.taxId.trim().toUpperCase() : null;
      if (!data.registrationNumber && dto.taxId) {
        data.registrationNumber = normalizeRegistrationNumber(dto.taxId);
      }
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.industry !== undefined) data.industry = dto.industry;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.tier !== undefined) data.tier = dto.tier;
    if (dto.domain !== undefined)
      data.domain = dto.domain ? dto.domain.trim().toLowerCase() : null;
    if (dto.website !== undefined)
      data.website = dto.website ? dto.website.trim() : null;
    if (dto.email !== undefined)
      data.email = dto.email ? dto.email.trim().toLowerCase() : null;
    if (dto.phone !== undefined)
      data.phone = dto.phone ? dto.phone.trim() : null;
    if (dto.additionalPhones !== undefined)
      data.additionalPhones = dto.additionalPhones;
    if (dto.additionalEmails !== undefined)
      data.additionalEmails = dto.additionalEmails;
    if (dto.address !== undefined) {
      data.address = dto.address;
      if (!data.billingAddress) data.billingAddress = dto.address;
    }
    if (dto.billingAddress !== undefined)
      data.billingAddress = dto.billingAddress;
    if (dto.shippingAddress !== undefined)
      data.shippingAddress = dto.shippingAddress;
    if (dto.socialLinks !== undefined) data.socialLinks = dto.socialLinks;
    if (dto.annualRevenue !== undefined) data.annualRevenue = dto.annualRevenue;
    if (dto.currency !== undefined)
      data.currency = dto.currency ? dto.currency.trim().toUpperCase() : 'USD';
    if (dto.employeeCount !== undefined) {
      const parsed = Number(dto.employeeCount);
      data.employeeCount = isNaN(parsed) ? null : parsed;
    }
    if (dto.employeeCountRange !== undefined) {
      data.employeeCountRange = dto.employeeCountRange
        ? dto.employeeCountRange.trim()
        : null;
    }
    if (dto.ownerId !== undefined) {
      data.ownerId = dto.ownerId ? new Types.ObjectId(dto.ownerId) : null;
    }
    if (dto.parentCompanyId !== undefined) {
      data.parentCompanyId = dto.parentCompanyId
        ? new Types.ObjectId(dto.parentCompanyId)
        : null;
    }
    if (dto.tags !== undefined) {
      data.tags = Array.from(
        new Set(dto.tags.map((t) => t.trim().toLowerCase())),
      );
    }

    return data;
  }

  static toResponse(
    company: CompanyLean,
    primaryContact?: PrimaryContactRef | null,
    owner?: CompanyOwnerRef | null,
    parentCompany?: ParentCompanyRef | null,
  ): CompanyResponse {
    const activeNotes = (company.notes || []).filter((n) => !n.deletedAt);
    const activeDocuments = (company.documents || []).filter(
      (d) => !d.deletedAt,
    );

    return {
      id: company._id.toString(),
      name: company.name,
      legalName: company.legalName ?? null,
      registrationNumber: company.registrationNumber ?? null,
      taxId: company.taxId ?? null,
      status: company.status,
      industry: company.industry,
      type: company.type,
      tier: company.tier,
      domain: company.domain ?? null,
      website: company.website ?? null,
      email: company.email ?? null,
      phone: company.phone ?? null,
      additionalPhones: company.additionalPhones || [],
      additionalEmails: company.additionalEmails || [],
      address: company.address || {},
      billingAddress: company.billingAddress || {},
      shippingAddress: company.shippingAddress || {},
      socialLinks: company.socialLinks || {},
      annualRevenue: company.annualRevenue ?? 0,
      currency: company.currency || 'USD',
      employeeCount: company.employeeCount ?? null,
      employeeCountRange: company.employeeCountRange ?? null,
      ownerId: company.ownerId ? company.ownerId.toString() : null,
      owner: owner
        ? {
            id: owner._id ? owner._id.toString() : (owner.id ?? ''),
            email: owner.email,
          }
        : company.ownerId
          ? { id: company.ownerId.toString() }
          : null,
      parentCompanyId: company.parentCompanyId
        ? company.parentCompanyId.toString()
        : null,
      parentCompany: parentCompany
        ? { id: parentCompany._id.toString(), name: parentCompany.name }
        : null,
      primaryContact: primaryContact
        ? {
            id: primaryContact._id.toString(),
            firstName: primaryContact.firstName,
            lastName: primaryContact.lastName,
            email: primaryContact.email,
            phone: primaryContact.phone,
            jobTitle: primaryContact.jobTitle ?? null,
          }
        : null,
      tags: company.tags || [],
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
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }
}
