import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

export const CURRENCY_PRECISION_MAP: Record<string, number> = {
  INR: 2, // 1 INR = 100 paise
  USD: 2, // 1 USD = 100 cents
  EUR: 2, // 1 EUR = 100 cents
  GBP: 2, // 1 GBP = 100 pence
  AED: 2, // 1 AED = 100 fils
  SAR: 2, // 1 SAR = 100 halalas
  JPY: 0, // 1 JPY = 1 yen
  KWD: 3, // 1 KWD = 1000 fils
  BHD: 3, // 1 BHD = 1000 fils
  OMR: 3, // 1 OMR = 1000 baisa
};

export const QUANTITY_SCALE = 1000; // 3 decimal places for quantities (e.g. 2.500 hrs = 2500)

export function validateCurrency(currency: string): string {
  const code = (currency || 'INR').trim().toUpperCase();
  if (CURRENCY_PRECISION_MAP[code] === undefined) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Unsupported currency: ${currency}. Allowed: ${Object.keys(CURRENCY_PRECISION_MAP).join(', ')}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return code;
}

export function parseDecimalStringToMinor(
  amountStr: string | number,
  currency: string,
): number {
  const code = validateCurrency(currency);
  const precision = CURRENCY_PRECISION_MAP[code];

  const str = typeof amountStr === 'number' ? amountStr.toString() : amountStr.trim();
  const regex = /^\d+(\.\d+)?$/;
  if (!regex.test(str)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid monetary decimal format: ${amountStr}`,
      HttpStatus.BAD_REQUEST,
    );
  }

  const parts = str.split('.');
  const integerPart = BigInt(parts[0]);
  let fractionPartStr = parts[1] || '';
  if (fractionPartStr.length > precision) {
    fractionPartStr = fractionPartStr.slice(0, precision);
  } else {
    fractionPartStr = fractionPartStr.padEnd(precision, '0');
  }

  const multiplier = BigInt(Math.pow(10, precision));
  const minorBigInt = integerPart * multiplier + (fractionPartStr ? BigInt(fractionPartStr) : 0n);

  if (minorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Monetary value exceeds safe numeric limits',
      HttpStatus.BAD_REQUEST,
    );
  }

  return Number(minorBigInt);
}

export function fromMinorUnits(minorUnits: number, currency = 'INR'): number {
  const code = validateCurrency(currency);
  const precision = CURRENCY_PRECISION_MAP[code];
  const factor = Math.pow(10, precision);
  return Number((minorUnits / factor).toFixed(precision));
}

export function scaleQuantity(quantity: number): number {
  if (quantity < 0.001 || quantity > 1000000) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Quantity must be between 0.001 and 1,000,000. Received: ${quantity}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return Math.round(quantity * QUANTITY_SCALE);
}

export function unscaleQuantity(scaledQuantity: number): number {
  return Number((scaledQuantity / QUANTITY_SCALE).toFixed(3));
}

export interface LineItemCalculation {
  unitPriceMinor: number;
  costPriceMinor: number;
  quantityScaled: number;
  lineSubtotalMinor: number;
  discountBasisPoints: number;
  discountMinor: number;
  netLineTotalMinor: number;
  taxBasisPoints: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalTaxMinor: number;
  lineGrandTotalMinor: number;
}

export function calculateLineTaxes(
  unitPriceMinor: number,
  costPriceMinor: number,
  quantity: number,
  discountPercent: number,
  taxRatePercent: number,
  isInterState: boolean,
): LineItemCalculation {
  const quantityScaled = scaleQuantity(quantity);
  const discountBasisPoints = Math.round(discountPercent * 100);
  const taxBasisPoints = Math.round(taxRatePercent * 100);

  // 1. Line subtotal = floor((unitPriceMinor * quantityScaled) / 1000)
  const lineSubtotalMinor = Math.floor((unitPriceMinor * quantityScaled) / QUANTITY_SCALE);

  // 2. Line discount = floor((lineSubtotalMinor * discountBasisPoints) / 10000)
  const discountMinor = Math.floor((lineSubtotalMinor * discountBasisPoints) / 10000);
  const netLineTotalMinor = lineSubtotalMinor - discountMinor;

  // 3. Line total tax = floor((netLineTotalMinor * taxBasisPoints) / 10000)
  const totalTaxMinor = Math.floor((netLineTotalMinor * taxBasisPoints) / 10000);

  let cgstMinor = 0;
  let sgstMinor = 0;
  let igstMinor = 0;

  if (isInterState) {
    igstMinor = totalTaxMinor;
  } else {
    cgstMinor = Math.floor(totalTaxMinor / 2);
    sgstMinor = totalTaxMinor - cgstMinor; // Penny balancing: exact sum guaranteed
  }

  const lineGrandTotalMinor = netLineTotalMinor + totalTaxMinor;

  return {
    unitPriceMinor,
    costPriceMinor,
    quantityScaled,
    lineSubtotalMinor,
    discountBasisPoints,
    discountMinor,
    netLineTotalMinor,
    taxBasisPoints,
    cgstMinor,
    sgstMinor,
    igstMinor,
    totalTaxMinor,
    lineGrandTotalMinor,
  };
}
