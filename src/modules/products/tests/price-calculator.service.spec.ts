import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { BillingCycle } from '../constants/billing-cycle.constant';
import { PricingType } from '../constants/pricing-type.constant';
import { DiscountApprovalStatus } from '../constants/product.constant';
import { ProductType } from '../constants/product-type.constant';
import { PricingTier, ProductLean } from '../schemas/product.schema';
import {
  PriceCalculatorService,
  roundCurrency,
} from '../services/price-calculator.service';

describe('PriceCalculatorService', () => {
  let service: PriceCalculatorService;

  beforeEach(() => {
    service = new PriceCalculatorService();
  });

  describe('Financial Rounding (roundCurrency)', () => {
    it('should round numbers to strictly 2 decimal places with EPSILON accuracy', () => {
      expect(roundCurrency(10.005)).toBe(10.01);
      expect(roundCurrency(10.004)).toBe(10);
      expect(roundCurrency(1234.5678)).toBe(1234.57);
      expect(roundCurrency(0)).toBe(0);
    });
  });

  describe('Non-Overlapping Tier Slabs Resolution', () => {
    it('should sort tiers ascending by minQuantity', () => {
      const unsortedTiers: PricingTier[] = [
        { minQuantity: 51, maxQuantity: null, unitPrice: 700 },
        { minQuantity: 1, maxQuantity: 10, unitPrice: 1000 },
        { minQuantity: 11, maxQuantity: 50, unitPrice: 850 },
      ];

      const sorted = service.validateAndSortPricingTiers(unsortedTiers);
      expect(sorted[0].minQuantity).toBe(1);
      expect(sorted[1].minQuantity).toBe(11);
      expect(sorted[2].minQuantity).toBe(51);
    });

    it('should reject tiers where minQuantity > maxQuantity with 400 Bad Request', () => {
      const invalidTiers: PricingTier[] = [
        { minQuantity: 20, maxQuantity: 10, unitPrice: 500 },
      ];

      expect(() => service.validateAndSortPricingTiers(invalidTiers)).toThrow(
        AppError,
      );
      try {
        service.validateAndSortPricingTiers(invalidTiers);
      } catch (err) {
        expect((err as AppError).statusCode).toBe(HttpStatus.BAD_REQUEST);
      }
    });

    it('should reject overlapping tier slabs with 400 Bad Request', () => {
      const overlappingTiers: PricingTier[] = [
        { minQuantity: 1, maxQuantity: 15, unitPrice: 1000 },
        { minQuantity: 10, maxQuantity: 30, unitPrice: 800 },
      ];

      expect(() =>
        service.validateAndSortPricingTiers(overlappingTiers),
      ).toThrow(AppError);
      try {
        service.validateAndSortPricingTiers(overlappingTiers);
      } catch (err) {
        expect((err as AppError).statusCode).toBe(HttpStatus.BAD_REQUEST);
      }
    });

    it('should reject unbounded tier in middle of slabs', () => {
      const invalidTiers: PricingTier[] = [
        { minQuantity: 1, maxQuantity: null, unitPrice: 1000 },
        { minQuantity: 11, maxQuantity: 20, unitPrice: 800 },
      ];

      expect(() => service.validateAndSortPricingTiers(invalidTiers)).toThrow(
        AppError,
      );
    });

    it('should resolve correct slab unit price based on quantity', () => {
      const product = {
        unitPrice: 1200,
        pricingTiers: [
          { minQuantity: 1, maxQuantity: 10, unitPrice: 1000 },
          { minQuantity: 11, maxQuantity: 50, unitPrice: 850 },
          { minQuantity: 51, maxQuantity: null, unitPrice: 700 },
        ],
      };

      expect(service.resolveEffectiveUnitPrice(product, 5)).toBe(1000);
      expect(service.resolveEffectiveUnitPrice(product, 10)).toBe(1000);
      expect(service.resolveEffectiveUnitPrice(product, 25)).toBe(850);
      expect(service.resolveEffectiveUnitPrice(product, 50)).toBe(850);
      expect(service.resolveEffectiveUnitPrice(product, 100)).toBe(700);
    });

    it('should fall back to standard unitPrice when no tiers configured', () => {
      const product = { unitPrice: 1200, pricingTiers: [] };
      expect(service.resolveEffectiveUnitPrice(product, 15)).toBe(1200);
    });
  });

  describe('3-Level Discount Guardrail Engine', () => {
    const product = {
      floorPrice: 500,
      repMaxDiscountPercent: 10,
      managerMaxDiscountPercent: 25,
    };

    it('should return APPROVED when discount is within sales rep quota', () => {
      const result = service.evaluateDiscountGuardrail(product, 8, 1000, false);
      expect(result.status).toBe(DiscountApprovalStatus.APPROVED);
      expect(result.unitPriceAfterDiscount).toBe(920);
    });

    it('should require MANAGER_APPROVAL_REQUIRED when discount exceeds rep quota but within manager limit for sales rep', () => {
      const result = service.evaluateDiscountGuardrail(
        product,
        20,
        1000,
        false,
      );
      expect(result.status).toBe(
        DiscountApprovalStatus.MANAGER_APPROVAL_REQUIRED,
      );
      expect(result.unitPriceAfterDiscount).toBe(800);
      expect(result.reason).toBeDefined();
    });

    it('should return APPROVED when discount exceeds rep quota but caller is Manager/Admin', () => {
      const result = service.evaluateDiscountGuardrail(product, 20, 1000, true);
      expect(result.status).toBe(DiscountApprovalStatus.APPROVED);
      expect(result.unitPriceAfterDiscount).toBe(800);
    });

    it('should return REJECTED_FLOOR_BREACH when discount exceeds manager maximum limit', () => {
      const result = service.evaluateDiscountGuardrail(product, 30, 1000, true);
      expect(result.status).toBe(DiscountApprovalStatus.REJECTED_FLOOR_BREACH);
      expect(result.reason).toContain(
        'exceeds maximum allowable manager limit',
      );
    });

    it('should return REJECTED_FLOOR_BREACH when discounted price breaches floor price', () => {
      const highFloorProduct = {
        floorPrice: 900,
        repMaxDiscountPercent: 20,
        managerMaxDiscountPercent: 25,
      };
      // 15% off 1000 = 850, which is below floorPrice 900
      const result = service.evaluateDiscountGuardrail(
        highFloorProduct,
        15,
        1000,
        true,
      );
      expect(result.status).toBe(DiscountApprovalStatus.REJECTED_FLOOR_BREACH);
      expect(result.reason).toContain('below absolute floor price');
    });
  });

  describe('Smart Indian GST Split (Inclusive & Exclusive)', () => {
    it('should compute forward GST for intra-state sale (MH to MH, exclusive)', () => {
      const result = service.computeGstSplit(1000, 18, false, 'MH', 'MH');
      expect(result.taxableAmount).toBe(1000);
      expect(result.totalTax).toBe(180);
      expect(result.grandTotal).toBe(1180);
      expect(result.isInterState).toBe(false);
      expect(result.cgstRate).toBe(9);
      expect(result.cgstAmount).toBe(90);
      expect(result.sgstRate).toBe(9);
      expect(result.sgstAmount).toBe(90);
      expect(result.igstAmount).toBe(0);
    });

    it('should compute forward GST for inter-state sale (MH to DL, exclusive)', () => {
      const result = service.computeGstSplit(1000, 18, false, 'MH', 'DL');
      expect(result.taxableAmount).toBe(1000);
      expect(result.totalTax).toBe(180);
      expect(result.grandTotal).toBe(1180);
      expect(result.isInterState).toBe(true);
      expect(result.igstRate).toBe(18);
      expect(result.igstAmount).toBe(180);
      expect(result.cgstAmount).toBe(0);
      expect(result.sgstAmount).toBe(0);
    });

    it('should compute reverse GST for tax-inclusive pricing (1180 inclusive at 18%)', () => {
      const result = service.computeGstSplit(1180, 18, true, 'MH', 'MH');
      expect(result.taxableAmount).toBe(1000);
      expect(result.totalTax).toBe(180);
      expect(result.grandTotal).toBe(1180);
      expect(result.cgstAmount).toBe(90);
      expect(result.sgstAmount).toBe(90);
    });

    it('should guarantee exact penny balancing for odd tax amounts', () => {
      // 100 net at 5% GST = 5 total tax. CGST = 2.50, SGST = 2.50
      const result = service.computeGstSplit(100, 5, false, 'MH', 'MH');
      expect(result.cgstAmount + result.sgstAmount).toBe(result.totalTax);
    });
  });

  describe('Recurring Revenue Calculations (MRR / ARR)', () => {
    it('should calculate MRR and ARR for monthly recurring items', () => {
      const result = service.calculateRecurringRevenue(
        5000,
        PricingType.RECURRING,
        BillingCycle.MONTHLY,
      );
      expect(result.mrr).toBe(5000);
      expect(result.arr).toBe(60000);
    });

    it('should calculate MRR and ARR for quarterly recurring items', () => {
      const result = service.calculateRecurringRevenue(
        6000,
        PricingType.RECURRING,
        BillingCycle.QUARTERLY,
      );
      expect(result.mrr).toBe(2000);
      expect(result.arr).toBe(24000);
    });

    it('should calculate MRR and ARR for annual recurring items', () => {
      const result = service.calculateRecurringRevenue(
        12000,
        PricingType.RECURRING,
        BillingCycle.ANNUALLY,
      );
      expect(result.mrr).toBe(1000);
      expect(result.arr).toBe(12000);
    });

    it('should return 0 MRR/ARR for ONE_TIME pricing', () => {
      const result = service.calculateRecurringRevenue(
        50000,
        PricingType.ONE_TIME,
        BillingCycle.ONE_OFF,
      );
      expect(result.mrr).toBe(0);
      expect(result.arr).toBe(0);
    });
  });

  describe('Comprehensive Quote Calculation (calculateQuote)', () => {
    it('should calculate totals for multiple items with tiers, guardrails, and GST', () => {
      const productA: ProductLean = {
        _id: new Types.ObjectId(),
        name: 'CRM Enterprise SaaS',
        sku: 'PRD-SAAS-101A',
        type: ProductType.PRODUCT,
        categoryId: new Types.ObjectId(),
        isActive: true,
        unitPrice: 1000,
        costPrice: 400,
        floorPrice: 700,
        currency: 'INR',
        pricingType: PricingType.RECURRING,
        billingCycle: BillingCycle.MONTHLY,
        unit: 'USER',
        pricingTiers: [
          { minQuantity: 1, maxQuantity: 10, unitPrice: 1000 },
          { minQuantity: 11, maxQuantity: null, unitPrice: 800 },
        ],
        repMaxDiscountPercent: 10,
        managerMaxDiscountPercent: 20,
        taxRate: 18,
        isTaxInclusive: false,
        bundleItems: [],
        priceHistory: [],
        tags: [],
        createdBy: new Types.ObjectId(),
      };

      const quote = service.calculateQuote(
        [{ product: productA, quantity: 20, requestedDiscountPercent: 5 }],
        'MH',
        'DL',
        false,
      );

      // Effective unit price for qty 20 is 800. 5% discount = 40/unit -> 760/unit.
      // Net line total = 760 * 20 = 15200.
      // 18% IGST on 15200 = 2736. Grand total = 17936.
      expect(quote.lineItems[0].effectiveUnitPrice).toBe(800);
      expect(quote.lineItems[0].netLineTotal).toBe(15200);
      expect(quote.totalTaxableAmount).toBe(15200);
      expect(quote.totalIgstAmount).toBe(2736);
      expect(quote.grandTotal).toBe(17936);
      expect(quote.totalMrr).toBe(15200);
      expect(quote.totalArr).toBe(182400);
      expect(quote.requiresManagerApproval).toBe(false);
      expect(quote.hasRejections).toBe(false);
    });
  });
});
