import { Types } from 'mongoose';
import { Deal } from '../schemas/deal.schema';
import { DealProduct } from '../schemas/deal-product.schema';
import { DealProductDto } from '../dto/create-deal.dto';
import { fromMinorUnits, toMinorUnits } from '../constants/deal.constant';

export type DealLean = Deal & { _id: Types.ObjectId };

export interface DealProductResponse {
  id?: string;
  name: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  discount?: number;
  total: number;
  description?: string | null;
}

export interface DealNoteResponse {
  id: string;
  content: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ClosureHistoryResponse {
  id: string;
  closedAt: Date;
  closedBy: string;
  closedStatus: string;
  closedStage: string;
  lostReason?: string | null;
  lostCompetitor?: string | null;
  reopenedAt?: Date | null;
  reopenedBy?: string | null;
  reopenReason?: string | null;
}

export interface DealResponse {
  id: string;
  title: string;
  description?: string | null;
  pipeline: string;
  stage: string;
  status: string;
  amount: number;
  currency: string;
  probability: number;
  weightedAmount: number;
  expectedCloseDate?: Date | null;
  actualCloseDate?: Date | null;
  companyId?: string | null;
  company?: { id: string; name: string } | null;
  contactId?: string | null;
  contact?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  } | null;
  ownerId?: string | null;
  owner?: { id: string; email?: string } | null;
  leadId?: string | null;
  products: DealProductResponse[];
  notesCount: number;
  notes?: DealNoteResponse[];
  closureHistory: ClosureHistoryResponse[];
  lostReason?: string | null;
  lostCompetitor?: string | null;
  tags: string[];
  priority: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class DealMapper {
  static calculateProductTotals(
    products: DealProductDto[],
    currency: string,
  ): DealProduct[] {
    return products.map((p) => {
      const unitPriceMinor = toMinorUnits(p.unitPrice, currency);
      const discount = p.discount ?? 0;
      const factor = (100 - discount) / 100;
      const itemTotalMinor = Math.round(p.quantity * unitPriceMinor * factor);
      const total = fromMinorUnits(itemTotalMinor, currency);

      return {
        _id: new Types.ObjectId(),
        name: p.name.trim(),
        sku: p.sku ? p.sku.trim() : null,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        discount,
        total,
        description: p.description ? p.description.trim() : null,
      };
    });
  }

  static calculateWeightedAmount(
    amount: number,
    probability: number,
    currency: string,
  ): number {
    const amountMinor = toMinorUnits(amount, currency);
    const weightedMinor = Math.round(amountMinor * (probability / 100));
    return fromMinorUnits(weightedMinor, currency);
  }

  static toResponse(
    deal: DealLean,
    options?: { includeNotes?: boolean },
  ): DealResponse {
    const dealId = deal._id ? deal._id.toString() : '';
    const currency = deal.currency ?? 'USD';
    const probability = deal.probability ?? 0;
    const amount = deal.amount ?? 0;
    const weightedAmount = this.calculateWeightedAmount(
      amount,
      probability,
      currency,
    );

    const activeNotes = (deal.notes ?? []).filter((n) => !n.deletedAt);

    // Support populated references if available
    let companySummary: { id: string; name: string } | null = null;
    if (
      deal.companyId &&
      typeof deal.companyId === 'object' &&
      'name' in deal.companyId
    ) {
      const comp = deal.companyId as unknown as {
        _id: Types.ObjectId;
        name: string;
      };
      companySummary = { id: comp._id.toString(), name: comp.name };
    }

    let contactSummary: {
      id: string;
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
    } | null = null;
    if (
      deal.contactId &&
      typeof deal.contactId === 'object' &&
      'firstName' in deal.contactId
    ) {
      const cont = deal.contactId as unknown as {
        _id: Types.ObjectId;
        firstName: string;
        lastName: string;
        email?: string;
        phone?: string;
      };
      contactSummary = {
        id: cont._id.toString(),
        firstName: cont.firstName,
        lastName: cont.lastName,
        email: cont.email,
        phone: cont.phone,
      };
    }

    let ownerSummary: { id: string; email?: string } | null = null;
    if (
      deal.ownerId &&
      typeof deal.ownerId === 'object' &&
      'email' in deal.ownerId
    ) {
      const usr = deal.ownerId as unknown as {
        _id: Types.ObjectId;
        email?: string;
      };
      ownerSummary = { id: usr._id.toString(), email: usr.email };
    }

    const extractId = (val: unknown): string | null => {
      if (!val) return null;
      if (typeof val === 'object' && '_id' in val) {
        const objWithId = val as { _id: Types.ObjectId };
        return objWithId._id.toString();
      }
      return (val as Types.ObjectId).toString();
    };

    const companyIdStr = extractId(deal.companyId);
    const contactIdStr = extractId(deal.contactId);
    const ownerIdStr = extractId(deal.ownerId);
    const leadIdStr = extractId(deal.leadId);

    const response: DealResponse = {
      id: dealId,
      title: deal.title,
      description: deal.description ?? null,
      pipeline: deal.pipeline,
      stage: deal.stage,
      status: deal.status,
      amount,
      currency,
      probability,
      weightedAmount,
      expectedCloseDate: deal.expectedCloseDate ?? null,
      actualCloseDate: deal.actualCloseDate ?? null,
      companyId: companyIdStr,
      company: companySummary,
      contactId: contactIdStr,
      contact: contactSummary,
      ownerId: ownerIdStr,
      owner: ownerSummary,
      leadId: leadIdStr,
      products: (deal.products ?? []).map((p) => ({
        id: p._id ? p._id.toString() : undefined,
        name: p.name,
        sku: p.sku ?? null,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        discount: p.discount ?? 0,
        total: p.total,
        description: p.description ?? null,
      })),
      notesCount: activeNotes.length,
      closureHistory: (deal.closureHistory ?? []).map((ch) => ({
        id: ch._id ? ch._id.toString() : '',
        closedAt: ch.closedAt,
        closedBy: ch.closedBy ? ch.closedBy.toString() : '',
        closedStatus: ch.closedStatus,
        closedStage: ch.closedStage,
        lostReason: ch.lostReason ?? null,
        lostCompetitor: ch.lostCompetitor ?? null,
        reopenedAt: ch.reopenedAt ?? null,
        reopenedBy: ch.reopenedBy ? ch.reopenedBy.toString() : null,
        reopenReason: ch.reopenReason ?? null,
      })),
      lostReason: deal.lostReason ?? null,
      lostCompetitor: deal.lostCompetitor ?? null,
      tags: deal.tags ?? [],
      priority: deal.priority,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt,
    };

    if (options?.includeNotes) {
      response.notes = activeNotes.map((n) => ({
        id: n._id ? n._id.toString() : '',
        content: n.content,
        createdBy: n.createdBy ? n.createdBy.toString() : '',
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
    }

    return response;
  }

  static toResponseList(deals: DealLean[]): DealResponse[] {
    return deals.map((d) => this.toResponse(d));
  }
}
