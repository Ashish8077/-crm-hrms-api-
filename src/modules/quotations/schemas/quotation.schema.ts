import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ApprovalTierLevel,
  QuotationApprovalStatus,
  QuotationStatus,
} from '../constants/quotation-status.constant';
import { QuotationItem, QuotationItemSchema } from './quotation-item.schema';

export type QuotationDocument = HydratedDocument<Quotation>;

@Schema({
  collection: 'quotations',
  timestamps: true,
  optimisticConcurrency: true,
  versionKey: 'version',
})
export class Quotation {
  // ── Identification & Versioning ──────────────────────────────────────────
  @Prop({ type: String, required: true, uppercase: true, trim: true })
  quoteNumber!: string;

  @Prop({ type: String, trim: true, default: null })
  title?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'Quotation', default: null, index: true })
  parentQuoteId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Quotation', required: true, index: true })
  rootQuoteId!: Types.ObjectId;

  @Prop({ type: Number, required: true, default: 1, min: 1 })
  revisionNumber!: number;

  @Prop({ type: Boolean, required: true, default: true, index: true })
  isLatestRevision!: boolean;

  // ── Multi-Tenant & Scoping References ────────────────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true, index: true })
  contactId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Deal', default: null, index: true })
  dealId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Lead', default: null, index: true })
  leadId?: Types.ObjectId | null;

  // ── Lifecycle & Approval Status ──────────────────────────────────────────
  @Prop({
    type: String,
    enum: Object.values(QuotationStatus),
    default: QuotationStatus.DRAFT,
    index: true,
  })
  status!: QuotationStatus;

  @Prop({
    type: String,
    enum: Object.values(QuotationApprovalStatus),
    default: QuotationApprovalStatus.NOT_SUBMITTED,
    index: true,
  })
  approvalStatus!: QuotationApprovalStatus;

  @Prop({ type: [Number], default: [] })
  requiredApprovalTiers!: ApprovalTierLevel[];

  @Prop({ type: Number, default: 1 })
  currentApprovalTier!: number;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  approvalRequestedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  approvalRequestedAt?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  approvalRequestNote?: string | null;

  // ── Dates ────────────────────────────────────────────────────────────────
  @Prop({ type: Date, required: true, default: Date.now, index: true })
  quoteDate!: Date;

  @Prop({ type: Date, required: true, index: true })
  expiryDate!: Date;

  @Prop({ type: Date, default: null })
  reminderSentAt?: Date | null;

  // ── Commercial Snapshot & CPQ Line Items ────────────────────────────────
  @Prop({ type: [QuotationItemSchema], required: true, default: [] })
  items!: QuotationItem[];

  // Integer Minor Unit Financial Summaries
  @Prop({ type: Number, required: true, min: 0 })
  subtotalMinor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  totalDiscountMinor!: number;

  @Prop({ type: Number, required: true, min: 0 })
  taxableAmountMinor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  cgstAmountMinor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  sgstAmountMinor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  igstAmountMinor!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  totalTaxAmountMinor!: number;

  @Prop({ type: Number, required: true, min: 0 })
  grandTotalMinor!: number;

  @Prop({ type: String, default: 'INR', uppercase: true, trim: true })
  currency!: string;

  // ── Tax Context ──────────────────────────────────────────────────────────
  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    default: 'DL',
  })
  sellerState!: string;

  @Prop({ type: String, required: true, trim: true, uppercase: true })
  buyerState!: string;

  @Prop({ type: Boolean, required: true, default: false })
  isInterState!: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  totalMrrMinor!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalArrMinor!: number;

  // ── Customer Public Portal Security ──────────────────────────────────────
  @Prop({ type: String, required: true, unique: true, index: true })
  portalTokenHash!: string;

  @Prop({ type: Date, required: true })
  portalTokenExpiresAt!: Date;

  @Prop({ type: Boolean, default: false })
  portalTokenUsed!: boolean;

  @Prop({ type: Boolean, default: false })
  portalTokenRevoked!: boolean;

  @Prop({ type: Date, default: null })
  clientViewedAt?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  digitalSignatureName?: string | null;

  @Prop({ type: String, trim: true, default: null })
  digitalSignatureIp?: string | null;

  @Prop({ type: Date, default: null })
  acceptedAt?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  rejectionReason?: string | null;

  @Prop({ type: Date, default: null })
  rejectedAt?: Date | null;

  // ── Order-to-Cash (O2C) Atomic Guard ─────────────────────────────────────
  @Prop({ type: Boolean, required: true, default: false, index: true })
  convertedToOrder!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'SalesOrder', default: null })
  salesOrderId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  convertedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  convertedBy?: Types.ObjectId | null;

  // ── Terms & PDF ──────────────────────────────────────────────────────────
  @Prop({ type: String, trim: true, default: null })
  termsAndConditions?: string | null;

  @Prop({ type: String, trim: true, default: null })
  notes?: string | null;

  @Prop({ type: String, trim: true, default: null })
  pdfKey?: string | null;

  version!: number;

  // ── Audit Fields ─────────────────────────────────────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy?: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const QuotationSchema = SchemaFactory.createForClass(Quotation);

// Compound ESR Indexes
QuotationSchema.index(
  { companyId: 1, quoteNumber: 1 },
  { unique: true, name: 'uidx_quotes_company_number' },
);

QuotationSchema.index(
  { companyId: 1, isLatestRevision: 1, status: 1, deletedAt: 1 },
  { name: 'idx_quotes_tenant_latest_status' },
);

QuotationSchema.index(
  { companyId: 1, ownerId: 1, status: 1, quoteDate: -1, deletedAt: 1 },
  { name: 'idx_quotes_rep_portfolio' },
);

QuotationSchema.index(
  { companyId: 1, dealId: 1, isLatestRevision: 1, deletedAt: 1 },
  { name: 'idx_quotes_deal_latest' },
);

QuotationSchema.index(
  { status: 1, expiryDate: 1, deletedAt: 1 },
  { name: 'idx_quotes_expiry_cron' },
);

QuotationSchema.index(
  { companyId: 1, rootQuoteId: 1, revisionNumber: 1, deletedAt: 1 },
  { name: 'idx_quotes_revision_chain' },
);

QuotationSchema.index(
  { rootQuoteId: 1, isLatestRevision: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isLatestRevision: true,
      rootQuoteId: { $exists: true, $type: 'objectId' },
      deletedAt: null,
    },
    name: 'uidx_quotes_single_latest_revision',
  },
);

QuotationSchema.index(
  { companyId: 1, approvalStatus: 1, currentApprovalTier: 1, deletedAt: 1 },
  { name: 'idx_quotes_approval_queue' },
);
