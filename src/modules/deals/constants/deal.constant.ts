export const DEFAULT_PIPELINE = 'STANDARD';
export const DEFAULT_CURRENCY = 'USD';

export enum DealPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export const CURRENCY_PRECISION_MAP: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
  KRW: 0,
  VND: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

export function getCurrencyPrecision(currency: string): number {
  return CURRENCY_PRECISION_MAP[currency.toUpperCase()] ?? 2;
}

export function getCurrencyMultiplier(currency: string): number {
  const precision = getCurrencyPrecision(currency);
  return Math.pow(10, precision);
}

export function toMinorUnits(amount: number, currency: string): number {
  const multiplier = getCurrencyMultiplier(currency);
  return Math.round(amount * multiplier);
}

export function fromMinorUnits(minorUnits: number, currency: string): number {
  const multiplier = getCurrencyMultiplier(currency);
  return Number(
    (minorUnits / multiplier).toFixed(getCurrencyPrecision(currency)),
  );
}

export const DEAL_CACHE_KEYS = {
  DETAIL: (id: string) => `crm:deals:detail:${id}`,
  PIPELINE: (pipeline: string, ownerId?: string) =>
    `crm:deals:pipeline:${pipeline}:${ownerId ?? 'all'}`,
};
