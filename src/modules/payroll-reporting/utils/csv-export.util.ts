import { Types } from 'mongoose';

/**
 * Sanitizes CSV cell values against spreadsheet formula injection (=, +, -, @, leading tab/CR)
 * and formats MongoDB ObjectId / Decimal128 / Date safely without converting Decimal128 to JS float.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let raw: string;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    raw = String(value);
  } else if (value instanceof Date) {
    raw = value.toISOString();
  } else if (value instanceof Types.ObjectId) {
    raw = value.toHexString();
  } else if (
    typeof value === 'object' &&
    'toString' in value &&
    typeof (value as { toString: () => string }).toString === 'function'
  ) {
    raw = (value as { toString: () => string }).toString();
  } else {
    raw = '';
  }

  // Normalize line breaks inside cells to single spaces to avoid broken CSV rows
  const normalized = raw.replace(/\r?\n/g, ' ');

  // Neutralize formula injection: =, +, -, @ (including after leading tabs/spaces/CR)
  if (/^[\t\r ]*[=+\-@]/.test(normalized) || /^[\t\r]/.test(normalized)) {
    return `'${normalized}`;
  }

  return normalized;
}

export function escapeCsvCell(value: unknown): string {
  const safe = sanitizeCsvCell(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

export function formatCsvRow(values: unknown[]): string {
  return `${values.map((v) => escapeCsvCell(v)).join(',')}\r\n`;
}

export function buildSafeCsvFilename(prefix: string): string {
  const cleanedPrefix =
    prefix
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'payroll-report';
  const dateTag = new Date().toISOString().slice(0, 10);
  return `${cleanedPrefix}-${dateTag}.csv`;
}
