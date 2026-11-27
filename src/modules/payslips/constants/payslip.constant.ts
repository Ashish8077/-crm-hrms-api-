import { Decimal } from '../../../common/utils/financial-math.util';

export const PAYSLIP_TEMPLATE_VERSION = '1.0.0';

export const PAYSLIP_CONSTANTS = {
  MIME_TYPE: 'application/pdf',
  MAX_PDF_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB safety bound per generated payslip
  STORAGE_FOLDER_PREFIX: 'hrms/payroll/payslips',
} as const;

/**
 * Produces a strictly safe, deterministic ASCII download filename with no path separators or control chars.
 */
export function buildSafePayslipFilename(
  periodCode: string,
  employeeCode: string,
): string {
  const sanitizeSegment = (raw: string, fallback: string): string => {
    const cleaned = raw
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return cleaned || fallback;
  };

  const safePeriod = sanitizeSegment(periodCode, 'PERIOD');
  const safeEmployee = sanitizeSegment(employeeCode, 'EMPLOYEE');
  return `payslip-${safePeriod}-${safeEmployee}.pdf`;
}

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

const SCALE_NAMES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'] as const;

const CURRENCY_WORD_UNITS: Record<string, { major: string; minor: string }> = {
  INR: { major: 'Rupees', minor: 'Paise' },
  USD: { major: 'Dollars', minor: 'Cents' },
  EUR: { major: 'Euros', minor: 'Cents' },
  GBP: { major: 'Pounds', minor: 'Pence' },
  AED: { major: 'Dirhams', minor: 'Fils' },
  SAR: { major: 'Riyals', minor: 'Halalas' },
  SGD: { major: 'Dollars', minor: 'Cents' },
  AUD: { major: 'Dollars', minor: 'Cents' },
  CAD: { major: 'Dollars', minor: 'Cents' },
};

function convertHundredsChunk(num: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(num / 100);
  const remainder = num % 100;

  if (hundreds > 0) {
    parts.push(`${ONES[hundreds]} Hundred`);
  }
  if (remainder > 0) {
    if (remainder < 20) {
      parts.push(ONES[remainder]);
    } else {
      const tenWord = TENS[Math.floor(remainder / 10)];
      const unitDigit = remainder % 10;
      parts.push(unitDigit > 0 ? `${tenWord} ${ONES[unitDigit]}` : tenWord);
    }
  }
  return parts.join(' ');
}

function integerStringToWords(intStr: string): string {
  const trimmed = intStr.replace(/^0+/, '') || '0';
  if (trimmed === '0') {
    return 'Zero';
  }
  if (trimmed.length > 15) {
    // Exceeds safe trillion scale; omit verbal expansion fallback cleanly
    return trimmed;
  }

  const chunks: number[] = [];
  for (let i = trimmed.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    chunks.push(parseInt(trimmed.slice(start, i), 10));
  }

  const words: string[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk === 0) continue;
    const scale = SCALE_NAMES[i] ?? '';
    const chunkWord = convertHundredsChunk(chunk);
    words.push(scale ? `${chunkWord} ${scale}` : chunkWord);
  }
  return words.join(' ');
}

/**
 * Converts a decimal currency string to exact verbal words without JS floating-point math.
 */
export function formatMoneyAmountInWords(
  amountStr: string,
  currency: string,
  precision = 2,
): string {
  const dec = new Decimal(amountStr);
  if (dec.isNegative()) {
    return `Minus ${formatMoneyAmountInWords(dec.abs().toFixed(precision), currency, precision)}`;
  }

  const fixed = dec.toFixed(precision);
  const [wholePart, fracPart = ''] = fixed.split('.');
  const code = currency.trim().toUpperCase();
  const unitInfo = CURRENCY_WORD_UNITS[code];
  const majorLabel = unitInfo ? `${code} ${unitInfo.major}` : code;
  const minorLabel = unitInfo ? unitInfo.minor : 'Subunits';

  const wholeWords = integerStringToWords(wholePart);
  const minorNum = fracPart ? parseInt(fracPart, 10) : 0;

  if (!fracPart || minorNum === 0) {
    return `${majorLabel} ${wholeWords} Only`;
  }

  const minorWords = integerStringToWords(String(minorNum));
  return `${majorLabel} ${wholeWords} and ${minorWords} ${minorLabel} Only`;
}
