import { BillingCycle } from '../constants/billing-cycle.constant';
import { PricingType } from '../constants/pricing-type.constant';
import { ProductType } from '../constants/product-type.constant';
import {
  BundleItem,
  PriceHistoryEntry,
  PricingTier,
  ProductLean,
} from '../schemas/product.schema';

export interface ProductResponse {
  id: string;
  name: string;
  sku: string;
  type: ProductType;
  categoryId: string;
  category?: {
    id: string;
    name: string;
    code: string;
  };
  description?: string | null;
  isActive: boolean;
  unitPrice: number;
  costPrice?: number;
  floorPrice?: number;
  grossMarginPercent?: number;
  currency: string;
  pricingType: PricingType;
  billingCycle: BillingCycle;
  unit: string;
  pricingTiers: PricingTier[];
  repMaxDiscountPercent: number;
  managerMaxDiscountPercent: number;
  hsnSacCode?: string | null;
  taxRate: number;
  isTaxInclusive: boolean;
  estimatedDeliveryHours?: number | null;
  requiredSkillRole?: string | null;
  bundleItems: BundleItem[];
  tags: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PriceHistoryResponseItem {
  oldUnitPrice: number;
  newUnitPrice: number;
  oldCostPrice?: number | null;
  newCostPrice?: number | null;
  reason: string;
  changedBy: string;
  changedAt: Date;
}

export class ProductMapper {
  static toResponse(
    doc: ProductLean,
    callerIsAdminOrManager: boolean,
  ): ProductResponse {
    const cost = doc.costPrice || 0;
    const marginPercent =
      doc.unitPrice > 0
        ? Math.round(
            (((doc.unitPrice - cost) / doc.unitPrice) * 100 + Number.EPSILON) *
              100,
          ) / 100
        : 0;

    let categoryObj:
      | {
          id: string;
          name: string;
          code: string;
        }
      | undefined;

    if (
      doc.categoryId &&
      typeof doc.categoryId === 'object' &&
      'name' in doc.categoryId
    ) {
      const populatedCat = doc.categoryId as unknown as {
        _id: { toString(): string };
        name: string;
        code: string;
      };
      categoryObj = {
        id: populatedCat._id.toString(),
        name: populatedCat.name,
        code: populatedCat.code,
      };
    } else if (doc.category) {
      categoryObj = {
        id: doc.category._id.toString(),
        name: doc.category.name,
        code: doc.category.code,
      };
    }

    let categoryIdStr = '';
    if (doc.categoryId) {
      const catAny = doc.categoryId as unknown;
      if (typeof catAny === 'object' && catAny !== null && '_id' in catAny) {
        categoryIdStr = String(catAny._id);
      } else {
        categoryIdStr = String(catAny);
      }
    }

    return {
      id: doc._id.toString(),
      name: doc.name,
      sku: doc.sku,
      type: doc.type,
      categoryId: categoryIdStr,
      ...(categoryObj ? { category: categoryObj } : {}),
      description: doc.description ?? null,
      isActive: doc.isActive,
      unitPrice: doc.unitPrice,
      // Sensitive financial masking
      costPrice: callerIsAdminOrManager ? doc.costPrice : undefined,
      floorPrice: callerIsAdminOrManager ? doc.floorPrice : undefined,
      grossMarginPercent: callerIsAdminOrManager ? marginPercent : undefined,
      currency: doc.currency,
      pricingType: doc.pricingType,
      billingCycle: doc.billingCycle,
      unit: doc.unit,
      pricingTiers: doc.pricingTiers || [],
      repMaxDiscountPercent: doc.repMaxDiscountPercent,
      managerMaxDiscountPercent: doc.managerMaxDiscountPercent,
      hsnSacCode: doc.hsnSacCode ?? null,
      taxRate: doc.taxRate,
      isTaxInclusive: doc.isTaxInclusive,
      estimatedDeliveryHours: doc.estimatedDeliveryHours ?? null,
      requiredSkillRole: doc.requiredSkillRole ?? null,
      bundleItems: doc.bundleItems || [],
      tags: doc.tags || [],
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  static toPriceHistoryResponse(
    history: PriceHistoryEntry[],
    callerIsAdminOrManager: boolean,
  ): PriceHistoryResponseItem[] {
    return history.map((entry) => ({
      oldUnitPrice: entry.oldUnitPrice,
      newUnitPrice: entry.newUnitPrice,
      oldCostPrice: callerIsAdminOrManager
        ? (entry.oldCostPrice ?? null)
        : undefined,
      newCostPrice: callerIsAdminOrManager
        ? (entry.newCostPrice ?? null)
        : undefined,
      reason: entry.reason,
      changedBy: entry.changedBy ? entry.changedBy.toString() : '',
      changedAt: entry.changedAt,
    }));
  }
}
