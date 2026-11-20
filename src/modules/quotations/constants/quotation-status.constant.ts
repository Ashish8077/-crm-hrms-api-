export enum QuotationStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  SENT = 'SENT',
  VIEWED = 'VIEWED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  SUPERSEDED = 'SUPERSEDED',
  CANCELLED = 'CANCELLED',
}

export enum QuotationApprovalStatus {
  NOT_REQUIRED = 'NOT_REQUIRED',
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum ApprovalTierLevel {
  TIER_1_MANAGER = 1,
  TIER_2_VP_FINANCE = 2,
  TIER_3_DIRECTOR = 3,
  TIER_3_EXEC = 3,
}

export enum EmailDeliveryStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  OPENED = 'OPENED',
  CLICKED = 'CLICKED',
  BOUNCED = 'BOUNCED',
  FAILED = 'FAILED',
  FAILED_PERMANENT = 'FAILED_PERMANENT',
}

export enum EmailEngagementEvent {
  OPENED = 'OPENED',
  LINK_CLICKED = 'LINK_CLICKED',
  PDF_DOWNLOADED = 'PDF_DOWNLOADED',
}

export enum CustomerResponseAction {
  ACCEPT = 'ACCEPT',
  REJECT = 'REJECT',
}

export enum SalesOrderStatus {
  CONFIRMED = 'CONFIRMED',
  PENDING_FULFILLMENT = 'PENDING_FULFILLMENT',
  PARTIALLY_DELIVERED = 'PARTIALLY_DELIVERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const QUOTATION_CACHE_KEYS = {
  DETAIL: (companyId: string, id: string) => `crm:quotes:detail:${companyId}:${id}`,
  SUMMARY: (companyId: string) => `crm:quotes:summary:${companyId}`,
  CRON_LOCK: 'lock:cron:quotation-expiry',
};

export const DEFAULT_APPROVAL_THRESHOLDS = {
  repMaxDiscountPercent: 10.0,
  managerMaxDiscountPercent: 25.0,
  directorMaxDiscountPercent: 35.0,
  highValueThresholdMinor: 50000000, // ₹5,00,000 in paise
  defaultValidityDays: 30,
};
