import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CompanyIndustry } from '../constants/company-industry.constant';
import { CompanyType } from '../constants/company-type.constant';
import { CompanyTier } from '../constants/company-tier.constant';
import { CompanyStatus } from '../constants/company-status.constant';
import { CompanyNote, CompanyNoteSchema } from './company-note.schema';
import { CompanyDocument, CompanyDocumentSchema } from './company-document.schema';
import { AddressSubdocument, AddressSubdocumentSchema } from '../../../common/schemas/address.schema';
import { SocialLinksSubdocument, SocialLinksSubdocumentSchema } from '../../../common/schemas/social-links.schema';

export type CompanyDocumentType = HydratedDocument<Company>;

@Schema({
  collection: 'companies',
  timestamps: true,
  versionKey: false,
})
export class Company {
  @Prop({ type: String, required: true, trim: true, index: true })
  name!: string;

  @Prop({ type: String, trim: true, default: null })
  legalName?: string | null;

  @Prop({ type: String, trim: true, uppercase: true, default: null })
  registrationNumber?: string | null; // Canonical normalized

  @Prop({ type: String, trim: true, uppercase: true, default: null })
  taxId?: string | null;

  @Prop({
    type: String,
    enum: Object.values(CompanyStatus),
    default: CompanyStatus.ACTIVE,
    index: true,
  })
  status!: CompanyStatus;

  @Prop({
    type: String,
    enum: Object.values(CompanyIndustry),
    default: CompanyIndustry.OTHER,
    index: true,
  })
  industry!: CompanyIndustry;

  @Prop({
    type: String,
    enum: Object.values(CompanyType),
    default: CompanyType.PROSPECT,
    index: true,
  })
  type!: CompanyType;

  @Prop({
    type: String,
    enum: Object.values(CompanyTier),
    default: CompanyTier.STANDARD,
  })
  tier!: CompanyTier;

  @Prop({ type: String, trim: true, lowercase: true, default: null, index: true })
  domain?: string | null;

  @Prop({ type: String, trim: true, default: null })
  website?: string | null;

  @Prop({ type: String, lowercase: true, trim: true, default: null, index: true })
  email?: string | null;

  @Prop({ type: String, trim: true, default: null, index: true })
  phone?: string | null;

  @Prop({
    type: [
      {
        label: { type: String, required: true },
        value: { type: String, required: true },
      },
    ],
    default: [],
  })
  additionalPhones!: Array<{ label: string; value: string }>;

  @Prop({
    type: [
      {
        label: { type: String, required: true },
        value: { type: String, required: true },
      },
    ],
    default: [],
  })
  additionalEmails!: Array<{ label: string; value: string }>;

  @Prop({ type: AddressSubdocumentSchema, default: () => ({}) })
  address?: AddressSubdocument;

  @Prop({ type: AddressSubdocumentSchema, default: () => ({}) })
  billingAddress?: AddressSubdocument;

  @Prop({ type: AddressSubdocumentSchema, default: () => ({}) })
  shippingAddress?: AddressSubdocument;

  @Prop({ type: SocialLinksSubdocumentSchema, default: () => ({}) })
  socialLinks?: SocialLinksSubdocument;

  @Prop({ type: Number, default: 0, min: 0 })
  annualRevenue?: number;

  @Prop({ type: String, default: 'USD', uppercase: true })
  currency!: string;

  @Prop({ type: Number, default: null })
  employeeCount?: number | null;

  @Prop({ type: String, trim: true, default: null })
  employeeCountRange?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  ownerId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Company', default: null, index: true })
  parentCompanyId?: Types.ObjectId | null;

  @Prop({ type: [String], default: [], index: true })
  tags!: string[];

  @Prop({ type: [CompanyNoteSchema], default: [] })
  notes!: CompanyNote[];

  @Prop({ type: [CompanyDocumentSchema], default: [] })
  documents!: CompanyDocument[];

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CompanySchema = SchemaFactory.createForClass(Company);

// Database Unique Constraint on Active Canonical Registration Number
CompanySchema.index(
  { registrationNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      registrationNumber: { $type: 'string', $gt: '' },
      deletedAt: null,
    },
    name: 'uniq_company_reg_number_active',
  },
);

// Performance Compound Indexes
CompanySchema.index({ name: 1, deletedAt: 1 }, { name: 'idx_companies_name_deleted' });
CompanySchema.index({ ownerId: 1, status: 1, deletedAt: 1 }, { name: 'idx_companies_owner_status' });
CompanySchema.index({ domain: 1, deletedAt: 1 }, { name: 'idx_companies_domain' });
CompanySchema.index({ industry: 1, type: 1, deletedAt: 1 }, { name: 'idx_companies_industry_type' });
