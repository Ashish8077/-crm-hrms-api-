/**
 * Canonical registration number normalization.
 * Trims, converts to uppercase, and removes all whitespace, hyphens, and underscores.
 */
export function normalizeRegistrationNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/[\s\-_]/g, '');
  return normalized.length > 0 ? normalized : null;
}

/**
 * Canonical email normalization.
 * Trims and lowercases.
 */
export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
