import { Types } from 'mongoose';
import { QuotationLean } from '../repositories/quotation.repository';
import {
  fromMinorUnits,
  unscaleQuantity,
} from '../constants/quotation-financial.constant';

export interface QuotationItemResponse {
  id?: string;
  productId: string;
  name: string;
  sku: string;
  hsnSacCode?: string | null;
  type: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  discountPercent: number;
  discountAmount: number;
  netLineTotal: number;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTaxAmount: number;
  lineGrandTotal: number;
}

export interface QuotationResponse {
  id: string;
  quoteNumber: string;
  parentQuoteId?: string | null;
  rootQuoteId: string;
  revisionNumber: number;
  isLatestRevision: boolean;
  companyId: string;
  contactId: string;
  contact?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  } | null;
  ownerId: string;
  owner?: { id: string; email?: string } | null;
  dealId?: string | null;
  deal?: { id: string; title: string; stage?: string } | null;
  leadId?: string | null;
  status: string;
  approvalStatus: string;
  requiredApprovalTiers: number[];
  currentApprovalTier: number;
  approvalRequestedAt?: Date | null;
  approvalRequestNote?: string | null;
  quoteDate: Date;
  expiryDate: Date;
  items: QuotationItemResponse[];
  subtotalAmount: number;
  totalDiscountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTaxAmount: number;
  grandTotal: number;
  currency: string;
  sellerState: string;
  buyerState: string;
  isInterState: boolean;
  totalMrr: number;
  totalArr: number;
  clientViewedAt?: Date | null;
  acceptedAt?: Date | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  convertedToOrder: boolean;
  salesOrderId?: string | null;
  convertedAt?: Date | null;
  termsAndConditions?: string | null;
  notes?: string | null;
  pdfKey?: string | null;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PublicPortalQuotationResponse {
  quoteNumber: string;
  revisionNumber: number;
  quoteDate: Date;
  expiryDate: Date;
  items: Array<{
    name: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    netLineTotal: number;
    taxRate: number;
    totalTaxAmount: number;
    lineGrandTotal: number;
  }>;
  subtotalAmount: number;
  totalDiscountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTaxAmount: number;
  grandTotal: number;
  currency: string;
  sellerState: string;
  buyerState: string;
  isInterState: boolean;
  status: string;
  termsAndConditions?: string | null;
  notes?: string | null;
}

export class QuotationMapper {
  static toResponse(
    quote: QuotationLean,
    callerIsAdminOrManager = false,
  ): QuotationResponse {
    const currency = quote.currency || 'INR';

    const items: QuotationItemResponse[] = (quote.items || []).map((item) => {
      const resp: QuotationItemResponse = {
        id: item._id ? item._id.toString() : undefined,
        productId: item.productId ? item.productId.toString() : '',
        name: item.name,
        sku: item.sku,
        hsnSacCode: item.hsnSacCode ?? null,
        type: item.type,
        quantity: unscaleQuantity(item.quantityScaled),
        unitPrice: fromMinorUnits(item.unitPriceMinor, currency),
        discountPercent: Number((item.discountBasisPoints / 100).toFixed(2)),
        discountAmount: fromMinorUnits(item.discountMinor, currency),
        netLineTotal: fromMinorUnits(item.netLineTotalMinor, currency),
        taxRate: Number((item.taxBasisPoints / 100).toFixed(2)),
        cgstAmount: fromMinorUnits(item.cgstMinor, currency),
        sgstAmount: fromMinorUnits(item.sgstMinor, currency),
        igstAmount: fromMinorUnits(item.igstMinor, currency),
        totalTaxAmount: fromMinorUnits(item.totalTaxMinor, currency),
        lineGrandTotal: fromMinorUnits(item.lineGrandTotalMinor, currency),
      };

      if (callerIsAdminOrManager && item.costPriceMinor !== undefined) {
        resp.costPrice = fromMinorUnits(item.costPriceMinor, currency);
      }

      return resp;
    });

    let contactSummary: any = null;
    if (quote.contactId && typeof quote.contactId === 'object' && 'firstName' in quote.contactId) {
      const c = quote.contactId as any;
      contactSummary = {
        id: c._id.toString(),
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
      };
    }

    let dealSummary: any = null;
    if (quote.dealId && typeof quote.dealId === 'object' && 'title' in quote.dealId) {
      const d = quote.dealId as any;
      dealSummary = {
        id: d._id.toString(),
        title: d.title,
        stage: d.stage,
      };
    }

    let ownerSummary: any = null;
    if (quote.ownerId && typeof quote.ownerId === 'object' && 'email' in quote.ownerId) {
      const u = quote.ownerId as any;
      ownerSummary = {
        id: u._id.toString(),
        email: u.email,
      };
    }

    const extractId = (val: any): string | null => {
      if (!val) return null;
      if (typeof val === 'object' && '_id' in val) {
        return val._id.toString();
      }
      return val.toString();
    };

    return {
      id: quote._id.toString(),
      quoteNumber: quote.quoteNumber,
      parentQuoteId: extractId(quote.parentQuoteId),
      rootQuoteId: extractId(quote.rootQuoteId) || quote._id.toString(),
      revisionNumber: quote.revisionNumber,
      isLatestRevision: quote.isLatestRevision,
      companyId: extractId(quote.companyId) || '',
      contactId: extractId(quote.contactId) || '',
      contact: contactSummary,
      ownerId: extractId(quote.ownerId) || '',
      owner: ownerSummary,
      dealId: extractId(quote.dealId),
      deal: dealSummary,
      leadId: extractId(quote.leadId),
      status: quote.status,
      approvalStatus: quote.approvalStatus,
      requiredApprovalTiers: quote.requiredApprovalTiers || [],
      currentApprovalTier: quote.currentApprovalTier || 1,
      approvalRequestedAt: quote.approvalRequestedAt ?? null,
      approvalRequestNote: quote.approvalRequestNote ?? null,
      quoteDate: quote.quoteDate,
      expiryDate: quote.expiryDate,
      items,
      subtotalAmount: fromMinorUnits(quote.subtotalMinor, currency),
      totalDiscountAmount: fromMinorUnits(quote.totalDiscountMinor, currency),
      taxableAmount: fromMinorUnits(quote.taxableAmountMinor, currency),
      cgstAmount: fromMinorUnits(quote.cgstAmountMinor, currency),
      sgstAmount: fromMinorUnits(quote.sgstAmountMinor, currency),
      igstAmount: fromMinorUnits(quote.igstAmountMinor, currency),
      totalTaxAmount: fromMinorUnits(quote.totalTaxAmountMinor, currency),
      grandTotal: fromMinorUnits(quote.grandTotalMinor, currency),
      currency,
      sellerState: quote.sellerState,
      buyerState: quote.buyerState,
      isInterState: quote.isInterState,
      totalMrr: fromMinorUnits(quote.totalMrrMinor || 0, currency),
      totalArr: fromMinorUnits(quote.totalArrMinor || 0, currency),
      clientViewedAt: quote.clientViewedAt ?? null,
      acceptedAt: quote.acceptedAt ?? null,
      rejectedAt: quote.rejectedAt ?? null,
      rejectionReason: quote.rejectionReason ?? null,
      convertedToOrder: quote.convertedToOrder || false,
      salesOrderId: extractId(quote.salesOrderId),
      convertedAt: quote.convertedAt ?? null,
      termsAndConditions: quote.termsAndConditions ?? null,
      notes: quote.notes ?? null,
      pdfKey: quote.pdfKey ?? null,
      version: quote.version,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }

  static toResponseList(
    quotes: QuotationLean[],
    callerIsAdminOrManager = false,
  ): QuotationResponse[] {
    return quotes.map((q) => this.toResponse(q, callerIsAdminOrManager));
  }

  static toPortalResponse(quote: QuotationLean): PublicPortalQuotationResponse {
    const currency = quote.currency || 'INR';

    return {
      quoteNumber: quote.quoteNumber,
      revisionNumber: quote.revisionNumber,
      quoteDate: quote.quoteDate,
      expiryDate: quote.expiryDate,
      items: (quote.items || []).map((item) => ({
        name: item.name,
        sku: item.sku,
        quantity: unscaleQuantity(item.quantityScaled),
        unitPrice: fromMinorUnits(item.unitPriceMinor, currency),
        discountPercent: Number((item.discountBasisPoints / 100).toFixed(2)),
        netLineTotal: fromMinorUnits(item.netLineTotalMinor, currency),
        taxRate: Number((item.taxBasisPoints / 100).toFixed(2)),
        totalTaxAmount: fromMinorUnits(item.totalTaxMinor, currency),
        lineGrandTotal: fromMinorUnits(item.lineGrandTotalMinor, currency),
      })),
      subtotalAmount: fromMinorUnits(quote.subtotalMinor, currency),
      totalDiscountAmount: fromMinorUnits(quote.totalDiscountMinor, currency),
      taxableAmount: fromMinorUnits(quote.taxableAmountMinor, currency),
      cgstAmount: fromMinorUnits(quote.cgstAmountMinor, currency),
      sgstAmount: fromMinorUnits(quote.sgstAmountMinor, currency),
      igstAmount: fromMinorUnits(quote.igstAmountMinor, currency),
      totalTaxAmount: fromMinorUnits(quote.totalTaxAmountMinor, currency),
      grandTotal: fromMinorUnits(quote.grandTotalMinor, currency),
      currency,
      sellerState: quote.sellerState,
      buyerState: quote.buyerState,
      isInterState: quote.isInterState,
      status: quote.status,
      termsAndConditions: quote.termsAndConditions ?? null,
      notes: quote.notes ?? null,
    };
  }
}

