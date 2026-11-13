import {
  calculateLineTaxes,
  fromMinorUnits,
  parseDecimalStringToMinor,
  scaleQuantity,
  unscaleQuantity,
  validateCurrency,
} from '../constants/quotation-financial.constant';
import { AppError } from '../../../common/errors/app-error';

describe('Quotation Financial Engine', () => {
  describe('Currency Validation', () => {
    it('should allow supported currencies and normalize to uppercase', () => {
      expect(validateCurrency('inr')).toBe('INR');
      expect(validateCurrency('USD')).toBe('USD');
      expect(validateCurrency('eur')).toBe('EUR');
    });

    it('should throw AppError on unsupported currency', () => {
      expect(() => validateCurrency('XYZ')).toThrow(AppError);
    });
  });

  describe('Decimal String to Minor Units Conversion', () => {
    it('should correctly convert decimal strings to minor units with exact precision', () => {
      expect(parseDecimalStringToMinor('100.50', 'INR')).toBe(10050);
      expect(parseDecimalStringToMinor('0.99', 'USD')).toBe(99);
      expect(parseDecimalStringToMinor('1234.567', 'KWD')).toBe(1234567);
      expect(parseDecimalStringToMinor('500', 'JPY')).toBe(500);
    });

    it('should throw AppError on invalid decimal format', () => {
      expect(() => parseDecimalStringToMinor('abc.50', 'INR')).toThrow(AppError);
      expect(() => parseDecimalStringToMinor('-100.50', 'INR')).toThrow(AppError);
    });
  });

  describe('Minor Units to Major Units Conversion', () => {
    it('should format minor units to major units without drift', () => {
      expect(fromMinorUnits(10050, 'INR')).toBe(100.5);
      expect(fromMinorUnits(99, 'USD')).toBe(0.99);
      expect(fromMinorUnits(500, 'JPY')).toBe(500);
    });
  });

  describe('Quantity Scaling', () => {
    it('should scale quantity by 1000 for integer storage', () => {
      expect(scaleQuantity(2.5)).toBe(2500);
      expect(scaleQuantity(1)).toBe(1000);
      expect(scaleQuantity(0.001)).toBe(1);
    });

    it('should unscale quantity correctly', () => {
      expect(unscaleQuantity(2500)).toBe(2.5);
      expect(unscaleQuantity(1000)).toBe(1);
    });

    it('should throw on out-of-range quantities', () => {
      expect(() => scaleQuantity(0)).toThrow(AppError);
      expect(() => scaleQuantity(2000000)).toThrow(AppError);
    });
  });

  describe('calculateLineTaxes & GST Penny Balancing', () => {
    it('should perform exact intra-state GST split with penny balancing', () => {
      // 1 unit at ₹100.01 (10001 minor), 0% discount, 18% GST (18.0018 => odd tax)
      const calc = calculateLineTaxes(
        10001, // unitPriceMinor
        5000,  // costPriceMinor
        1,     // quantity
        0,     // discountPercent
        18,    // taxRatePercent
        false, // isInterState (Intra-state: CGST + SGST)
      );

      expect(calc.lineSubtotalMinor).toBe(10001);
      expect(calc.discountMinor).toBe(0);
      expect(calc.netLineTotalMinor).toBe(10001);

      // Total tax = floor(10001 * 1800 / 10000) = floor(1800.18) = 1800
      expect(calc.totalTaxMinor).toBe(1800);

      // Penny balancing test: CGST + SGST must ALWAYS exactly equal totalTaxMinor
      expect(calc.cgstMinor + calc.sgstMinor).toBe(calc.totalTaxMinor);
      expect(calc.cgstMinor).toBe(900);
      expect(calc.sgstMinor).toBe(900);
      expect(calc.igstMinor).toBe(0);
      expect(calc.lineGrandTotalMinor).toBe(11801);
    });

    it('should handle odd tax totals with penny balancing without 1-paisa drift', () => {
      // Net line total where 18% tax gives odd number of paise
      // e.g. net line total ₹99.95 (9995 minor) * 18% = 1799.1 -> 1799 paise (odd!)
      const calc = calculateLineTaxes(
        9995,
        4000,
        1,
        0,
        18,
        false,
      );

      expect(calc.totalTaxMinor).toBe(1799);
      expect(calc.cgstMinor).toBe(899); // floor(1799 / 2)
      expect(calc.sgstMinor).toBe(900); // 1799 - 899 = 900
      expect(calc.cgstMinor + calc.sgstMinor).toBe(1799); // Exact match!
      expect(calc.lineGrandTotalMinor).toBe(9995 + 1799);
    });

    it('should apply inter-state IGST correctly', () => {
      const calc = calculateLineTaxes(
        10000,
        5000,
        2,
        10, // 10% discount
        18,
        true, // isInterState
      );

      // Line subtotal = 2 * 10000 = 20000
      expect(calc.lineSubtotalMinor).toBe(20000);
      // Discount = 10% of 20000 = 2000
      expect(calc.discountMinor).toBe(2000);
      // Net line total = 18000
      expect(calc.netLineTotalMinor).toBe(18000);
      // IGST = 18% of 18000 = 3240
      expect(calc.igstMinor).toBe(3240);
      expect(calc.cgstMinor).toBe(0);
      expect(calc.sgstMinor).toBe(0);
      expect(calc.totalTaxMinor).toBe(3240);
      expect(calc.lineGrandTotalMinor).toBe(21240);
    });
  });
});

