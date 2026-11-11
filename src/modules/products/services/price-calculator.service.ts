import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { BillingCycle } from '../constants/billing-cycle.constant';
import { PricingType } from '../constants/pricing-type.constant';
import { DiscountApprovalStatus } from '../constants/product.constant';
import { PricingTier, ProductLean } from '../schemas/product.schema';

export function roundCurrency(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export interface GstSplitResult {
  taxableAmount: number;
  taxRate: number;
  isTaxInclusive: boolean;
  isInterState: boolean;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  totalTax: number;
  grandTotal: number;
}

export interface DiscountGuardrailResult {
  status: DiscountApprovalStatus;
  effectiveDiscountPercent: number;
  unitPriceAfterDiscount: number;
  discountPerUnit: number;
  totalDiscount: number;
  reason?: string;
}

export interface CalculatedQuoteLineItem {
  productId: string;
  name: string;
  sku: string;
  type: string;
  quantity: number;
  baseUnitPrice: number;
  effectiveUnitPrice: number;
  requestedDiscountPercent: number;
  guardrail: DiscountGuardrailResult;
  netLineTotal: number;
  gst: GstSplitResult;
  mrr: number;
  arr: number;
}

export interface QuoteCalculationSummary {
  lineItems: CalculatedQuoteLineItem[];
  totalBaseAmount: number;
  totalDiscountAmount: number;
  totalTaxableAmount: number;
  totalCgstAmount: number;
  totalSgstAmount: number;
  totalIgstAmount: number;
  totalTaxAmount: number;
  grandTotal: number;
  totalMrr: number;
  totalArr: number;
  requiresManagerApproval: boolean;
  hasRejections: boolean;
}

@Injectable()
export class PriceCalculatorService {
  roundCurrency(val: number): number {
    return roundCurrency(val);
  }

  validateAndSortPricingTiers(tiers: PricingTier[]): PricingTier[] {
    if (!tiers || tiers.length === 0) return [];

    // Sort ascending by minQuantity
    const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];

      if (current.minQuantity < 1) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid tier slab: minQuantity must be at least 1, received ${current.minQuantity}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (current.unitPrice < 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid tier slab: unitPrice cannot be negative`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (current.maxQuantity !== null && current.maxQuantity !== undefined) {
        if (current.minQuantity > current.maxQuantity) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid tier slab: minQuantity (${current.minQuantity}) cannot exceed maxQuantity (${current.maxQuantity})`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      if (i > 0) {
        const prev = sorted[i - 1];
        if (prev.maxQuantity === null || prev.maxQuantity === undefined) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Invalid tier configuration: Unbounded tier (null maxQuantity) must be the final tier',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (current.minQuantity <= prev.maxQuantity) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Overlapping tier slabs detected: Tier starting at ${current.minQuantity} overlaps with previous tier ending at ${prev.maxQuantity}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    return sorted;
  }

  resolveEffectiveUnitPrice(
    product: { unitPrice: number; pricingTiers?: PricingTier[] },
    quantity: number,
  ): number {
    if (!product.pricingTiers || product.pricingTiers.length === 0) {
      return roundCurrency(product.unitPrice);
    }

    const matchingTier = product.pricingTiers.find((tier) => {
      const minSatisfied = quantity >= tier.minQuantity;
      const maxSatisfied =
        tier.maxQuantity === null ||
        tier.maxQuantity === undefined ||
        quantity <= tier.maxQuantity;
      return minSatisfied && maxSatisfied;
    });

    return roundCurrency(
      matchingTier ? matchingTier.unitPrice : product.unitPrice,
    );
  }

  evaluateDiscountGuardrail(
    product: {
      floorPrice: number;
      repMaxDiscountPercent: number;
      managerMaxDiscountPercent: number;
    },
    requestedDiscountPercent: number,
    effectiveUnitPrice: number,
    isManagerOrAdmin: boolean,
  ): DiscountGuardrailResult {
    const discountPercent = Math.max(
      0,
      Math.min(100, requestedDiscountPercent || 0),
    );
    const discountAmount = roundCurrency(
      (effectiveUnitPrice * discountPercent) / 100,
    );
    const discountedPrice = roundCurrency(effectiveUnitPrice - discountAmount);

    // Check 1: Floor Price Breach (Absolute Guardrail)
    if (product.floorPrice > 0 && discountedPrice < product.floorPrice) {
      return {
        status: DiscountApprovalStatus.REJECTED_FLOOR_BREACH,
        effectiveDiscountPercent: discountPercent,
        unitPriceAfterDiscount: discountedPrice,
        discountPerUnit: discountAmount,
        totalDiscount: discountAmount,
        reason: `Discounted price (${discountedPrice}) is below absolute floor price (${product.floorPrice})`,
      };
    }

    // Check 2: Exceeds Manager Maximum Limit
    if (discountPercent > product.managerMaxDiscountPercent) {
      return {
        status: DiscountApprovalStatus.REJECTED_FLOOR_BREACH,
        effectiveDiscountPercent: discountPercent,
        unitPriceAfterDiscount: discountedPrice,
        discountPerUnit: discountAmount,
        totalDiscount: discountAmount,
        reason: `Requested discount (${discountPercent}%) exceeds maximum allowable manager limit (${product.managerMaxDiscountPercent}%)`,
      };
    }

    // Check 3: Within Sales Rep Quota
    if (discountPercent <= product.repMaxDiscountPercent) {
      return {
        status: DiscountApprovalStatus.APPROVED,
        effectiveDiscountPercent: discountPercent,
        unitPriceAfterDiscount: discountedPrice,
        discountPerUnit: discountAmount,
        totalDiscount: discountAmount,
      };
    }

    // Check 4: Between Rep Quota and Manager Limit (Manager/Admin Caller)
    if (isManagerOrAdmin) {
      return {
        status: DiscountApprovalStatus.APPROVED,
        effectiveDiscountPercent: discountPercent,
        unitPriceAfterDiscount: discountedPrice,
        discountPerUnit: discountAmount,
        totalDiscount: discountAmount,
      };
    }

    // Check 5: Requires Manager Approval (Sales Rep Caller)
    return {
      status: DiscountApprovalStatus.MANAGER_APPROVAL_REQUIRED,
      effectiveDiscountPercent: discountPercent,
      unitPriceAfterDiscount: discountedPrice,
      discountPerUnit: discountAmount,
      totalDiscount: discountAmount,
      reason: `Requested discount (${discountPercent}%) exceeds sales rep quota (${product.repMaxDiscountPercent}%) but is within manager limit (${product.managerMaxDiscountPercent}%)`,
    };
  }

  computeGstSplit(
    netAmountAfterDiscount: number,
    taxRate: number,
    isTaxInclusive: boolean,
    sellerState?: string,
    buyerState?: string,
  ): GstSplitResult {
    const netAmount = roundCurrency(netAmountAfterDiscount);
    const sState = (sellerState || 'MH').trim().toUpperCase();
    const bState = (buyerState || sellerState || 'MH').trim().toUpperCase();
    const isInterState = sState !== bState;

    let taxableAmount: number;
    let totalTax: number;
    let grandTotal: number;

    if (isTaxInclusive) {
      // Reverse tax calculation
      taxableAmount = roundCurrency(netAmount / (1 + taxRate / 100));
      totalTax = roundCurrency(netAmount - taxableAmount);
      grandTotal = netAmount;
    } else {
      // Forward tax calculation
      taxableAmount = netAmount;
      totalTax = roundCurrency((taxableAmount * taxRate) / 100);
      grandTotal = roundCurrency(taxableAmount + totalTax);
    }

    let cgstRate = 0;
    let cgstAmount = 0;
    let sgstRate = 0;
    let sgstAmount = 0;
    let igstRate = 0;
    let igstAmount = 0;

    if (isInterState) {
      igstRate = taxRate;
      igstAmount = totalTax;
    } else {
      cgstRate = roundCurrency(taxRate / 2);
      sgstRate = roundCurrency(taxRate / 2);
      cgstAmount = roundCurrency(totalTax / 2);
      // Exact penny balancing: sgstAmount = totalTax - cgstAmount
      sgstAmount = roundCurrency(totalTax - cgstAmount);
    }

    return {
      taxableAmount,
      taxRate,
      isTaxInclusive,
      isInterState,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      totalTax,
      grandTotal,
    };
  }

  calculateRecurringRevenue(
    netAmount: number,
    pricingType: PricingType,
    billingCycle: BillingCycle,
  ): { mrr: number; arr: number } {
    if (pricingType !== PricingType.RECURRING) {
      return { mrr: 0, arr: 0 };
    }

    switch (billingCycle) {
      case BillingCycle.MONTHLY:
        return {
          mrr: roundCurrency(netAmount),
          arr: roundCurrency(netAmount * 12),
        };
      case BillingCycle.QUARTERLY:
        return {
          mrr: roundCurrency(netAmount / 3),
          arr: roundCurrency(netAmount * 4),
        };
      case BillingCycle.ANNUALLY:
        return {
          mrr: roundCurrency(netAmount / 12),
          arr: roundCurrency(netAmount),
        };
      default:
        return { mrr: 0, arr: 0 };
    }
  }

  calculateQuote(
    items: Array<{
      product: ProductLean;
      quantity: number;
      requestedDiscountPercent?: number;
    }>,
    sellerState?: string,
    buyerState?: string,
    isManagerOrAdmin: boolean = false,
  ): QuoteCalculationSummary {
    const lineItems: CalculatedQuoteLineItem[] = [];

    let totalBaseAmount = 0;
    let totalDiscountAmount = 0;
    let totalTaxableAmount = 0;
    let totalCgstAmount = 0;
    let totalSgstAmount = 0;
    let totalIgstAmount = 0;
    let totalTaxAmount = 0;
    let grandTotal = 0;
    let totalMrr = 0;
    let totalArr = 0;
    let requiresManagerApproval = false;
    let hasRejections = false;

    for (const item of items) {
      const prod = item.product;
      const qty = item.quantity;
      const requestedDiscount = item.requestedDiscountPercent || 0;

      // 1. Resolve effective unit price from slabs
      const effectiveUnitPrice = this.resolveEffectiveUnitPrice(prod, qty);
      const lineBaseTotal = roundCurrency(effectiveUnitPrice * qty);

      // 2. Evaluate discount guardrail
      const guardrail = this.evaluateDiscountGuardrail(
        prod,
        requestedDiscount,
        effectiveUnitPrice,
        isManagerOrAdmin,
      );

      const lineTotalDiscount = roundCurrency(guardrail.discountPerUnit * qty);
      const netLineTotal = roundCurrency(
        guardrail.unitPriceAfterDiscount * qty,
      );

      if (
        guardrail.status === DiscountApprovalStatus.MANAGER_APPROVAL_REQUIRED
      ) {
        requiresManagerApproval = true;
      }
      if (guardrail.status === DiscountApprovalStatus.REJECTED_FLOOR_BREACH) {
        hasRejections = true;
      }

      // 3. Compute Indian GST split
      const gst = this.computeGstSplit(
        netLineTotal,
        prod.taxRate || 18,
        prod.isTaxInclusive || false,
        sellerState,
        buyerState,
      );

      // 4. MRR / ARR calculation
      const { mrr, arr } = this.calculateRecurringRevenue(
        netLineTotal,
        prod.pricingType,
        prod.billingCycle,
      );

      totalBaseAmount = roundCurrency(totalBaseAmount + lineBaseTotal);
      totalDiscountAmount = roundCurrency(
        totalDiscountAmount + lineTotalDiscount,
      );
      totalTaxableAmount = roundCurrency(
        totalTaxableAmount + gst.taxableAmount,
      );
      totalCgstAmount = roundCurrency(totalCgstAmount + gst.cgstAmount);
      totalSgstAmount = roundCurrency(totalSgstAmount + gst.sgstAmount);
      totalIgstAmount = roundCurrency(totalIgstAmount + gst.igstAmount);
      totalTaxAmount = roundCurrency(totalTaxAmount + gst.totalTax);
      grandTotal = roundCurrency(grandTotal + gst.grandTotal);
      totalMrr = roundCurrency(totalMrr + mrr);
      totalArr = roundCurrency(totalArr + arr);

      lineItems.push({
        productId: prod._id.toString(),
        name: prod.name,
        sku: prod.sku,
        type: prod.type,
        quantity: qty,
        baseUnitPrice: prod.unitPrice,
        effectiveUnitPrice,
        requestedDiscountPercent: requestedDiscount,
        guardrail: {
          ...guardrail,
          totalDiscount: lineTotalDiscount,
        },
        netLineTotal,
        gst,
        mrr,
        arr,
      });
    }

    return {
      lineItems,
      totalBaseAmount,
      totalDiscountAmount,
      totalTaxableAmount,
      totalCgstAmount,
      totalSgstAmount,
      totalIgstAmount,
      totalTaxAmount,
      grandTotal,
      totalMrr,
      totalArr,
      requiresManagerApproval,
      hasRejections,
    };
  }
}
