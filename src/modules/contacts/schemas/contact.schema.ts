import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ContactStatus } from '../constants/contact-status.constant';
import { DecisionRole } from '../constants/decision-role.constant';
import { ContactNote, ContactNoteSchema } from './contact-note.schema';
import {
  ContactDocument,
  ContactDocumentSchema,
} from './contact-document.schema';
import {
  AddressSubdocument,
  AddressSubdocumentSchema,
} from '../../../common/schemas/address.schema';
import {
  SocialLinksSubdocument,
  SocialLinksSubdocumentSchema,
} from '../../../common/schemas/social-links.schema';

export type ContactDocumentType = HydratedDocument<Contact>;

@Schema({ _id: false })
export class LabeledEntry {
  @Prop({ type: String, required: true, trim: true })
  label!: string;

  @Prop({ type: String, required: true, trim: true })
  value!: string;
}

export const LabeledEntrySchema = SchemaFactory.createForClass(LabeledEntry);

@Schema({
  collection: 'contacts',
  timestamps: true,
  versionKey: false,
})
export class Contact {
  @Prop({ type: String, required: true, trim: true })
  firstName!: string;

  @Prop({ type: String, required: true, trim: true })
  lastName!: string;

  @Prop({
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email!: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  phone!: string;

  @Prop({ type: String, trim: true, default: null })
  mobilePhone?: string | null;

  @Prop({ type: String, trim: true, default: null })
  workPhone?: string | null;

  @Prop({ type: [LabeledEntrySchema], default: [] })
  additionalPhones!: LabeledEntry[];

  @Prop({ type: String, lowercase: true, trim: true, default: null })
  alternateEmail?: string | null;

  @Prop({ type: [LabeledEntrySchema], default: [] })
  additionalEmails!: LabeledEntry[];

  @Prop({ type: Types.ObjectId, ref: 'Company', default: null, index: true })
  companyId!: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  jobTitle?: string | null;

  @Prop({ type: String, trim: true, default: null })
  department?: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  isPrimaryContact!: boolean;

  @Prop({
    type: String,
    enum: Object.values(DecisionRole),
    default: DecisionRole.INFLUENCER,
  })
  decisionRole!: DecisionRole;

  @Prop({ type: AddressSubdocumentSchema, default: () => ({}) })
  address?: AddressSubdocument;

  @Prop({ type: SocialLinksSubdocumentSchema, default: () => ({}) })
  socialLinks?: SocialLinksSubdocument;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  ownerId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Lead', default: null, index: true })
  leadId?: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: Object.values(ContactStatus),
    default: ContactStatus.ACTIVE,
    index: true,
  })
  status!: ContactStatus;

  @Prop({ type: [String], default: [], index: true })
  tags!: string[];

  // Embedded Subdocuments with Safety Caps (Max 100 notes, max 50 documents total)
  @Prop({ type: [ContactNoteSchema], default: [] })
  notes!: ContactNote[];

  @Prop({ type: [ContactDocumentSchema], default: [] })
  documents!: ContactDocument[];

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

export const ContactSchema = SchemaFactory.createForClass(Contact);

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL DATABASE-LEVEL CONSTRAINTS
// ─────────────────────────────────────────────────────────────────────────────

// 1. UNIQUE ACTIVE EMAIL (Strict Database Level Concurrency Protection)
ContactSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $type: 'string', $gt: '' },
      deletedAt: null,
    },
    name: 'uniq_contact_email_active',
  },
);

// 2. AT MOST ONE PRIMARY CONTACT PER COMPANY (Strict Unique Partial Index)
ContactSchema.index(
  { companyId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isPrimaryContact: true,
      companyId: { $type: 'objectId' },
      deletedAt: null,
    },
    name: 'uniq_company_active_primary_contact',
  },
);

// Performance Compound Indexes
ContactSchema.index(
  { phone: 1, deletedAt: 1 },
  { name: 'idx_contacts_phone_deleted' },
);
ContactSchema.index(
  { companyId: 1, deletedAt: 1 },
  { name: 'idx_contacts_company_deleted' },
);
ContactSchema.index(
  { ownerId: 1, status: 1, deletedAt: 1 },
  { name: 'idx_contacts_owner_status' },
);
ContactSchema.index(
  { tags: 1, deletedAt: 1 },
  { name: 'idx_contacts_tags_deleted' },
);
