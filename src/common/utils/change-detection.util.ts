import { Types } from 'mongoose';

/**
 * Compares fields in `updateData` against the current persisted document.
 * Returns a new object containing only the fields whose values have
 * genuinely changed. Handles ObjectId comparison by value and
 * Date comparison by timestamp.
 *
 * Fields not present in `updateData` (i.e. not sent in the PATCH request)
 * are never included — preserving proper PATCH semantics.
 */
export function getChangedFields(
  updateData: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};

  for (const key of Object.keys(updateData)) {
    if (!isFieldEqual(updateData[key], current[key])) {
      changed[key] = updateData[key];
    }
  }

  return changed;
}

function isFieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (a == null || b == null) {
    return false;
  }

  if (isObjectId(a) || isObjectId(b)) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(a) === String(b);
  }

  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }

  return false;
}

function isObjectId(value: unknown): value is Types.ObjectId {
  return value instanceof Types.ObjectId;
}
