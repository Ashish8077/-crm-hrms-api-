import { ProductType } from './product-type.constant';

export const PRODUCT_DEFAULT_PAGE = 1;
export const PRODUCT_DEFAULT_LIMIT = 20;
export const PRODUCT_MAX_LIMIT = 100;

export const PRODUCT_DEFAULT_CURRENCY = 'INR';
export const PRODUCT_DEFAULT_TAX_RATE = 18;
export const PRODUCT_DEFAULT_UNIT = 'UNIT';

export const PRICE_HISTORY_MAX_ENTRIES = 100;
export const BUNDLE_MAX_DEPTH = 1;

export enum DiscountApprovalStatus {
  APPROVED = 'APPROVED',
  MANAGER_APPROVAL_REQUIRED = 'MANAGER_APPROVAL_REQUIRED',
  REJECTED_FLOOR_BREACH = 'REJECTED_FLOOR_BREACH',
}

export const SKU_PREFIX_MAP: Record<ProductType, string> = {
  [ProductType.PRODUCT]: 'PRD',
  [ProductType.SERVICE]: 'SRV',
  [ProductType.BUNDLE]: 'BDL',
};

export const SKU_REGEX = /^[A-Z0-9_-]{3,50}$/;
export const DEFAULT_CATEGORY_CODE = 'GEN';
