import { getMetadataStorage, ValidationError } from 'class-validator';

export interface ValidationDetail {
  field: string;
  code: string;
  message: string;
}

/**
 * Constraint priority order — highest priority first.
 * When multiple constraints fail for the same field,
 * we pick the highest-priority one regardless of object key order.
 */
const CONSTRAINT_PRIORITY: string[] = [
  // Presence
  'isNotEmpty',
  'isDefined',

  // Type
  'isString',
  'isNumber',
  'isBoolean',
  'isInt',
  'isEnum',
  'isArray',

  // Format
  'isEmail',
  'matches',
  'isUUID',
  'isMongoId',
  'isUrl',
  'isDateString',
  'isPhoneNumber',

  // Range / Length
  'minLength',
  'maxLength',
  'min',
  'max',
  'arrayMinSize',
  'arrayMaxSize',
  'arrayUnique',

  // Whitelist
  'whitelistValidation',
];

export function mapValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationDetail[] {
  const details: ValidationDetail[] = [];

  for (const error of errors) {
    let currentPath = error.property;
    if (parentPath) {
      if (/^\d+$/.test(error.property)) {
        currentPath = `${parentPath}[${error.property}]`;
      } else {
        currentPath = `${parentPath}.${error.property}`;
      }
    }

    if (error.constraints) {
      // Handle array element validation with { each: true } (e.g. occurrences: [0, 6])
      if (
        Array.isArray(error.value) &&
        (error.constraints.min ||
          error.constraints.max ||
          error.constraints.isInt)
      ) {
        const minThreshold = getConstraintThreshold(
          error.target,
          error.property,
          'min',
        );
        const maxThreshold = getConstraintThreshold(
          error.target,
          error.property,
          'max',
        );

        error.value.forEach((val: unknown, idx: number) => {
          if (
            error.constraints!.min &&
            typeof val === 'number' &&
            minThreshold !== undefined &&
            val < minThreshold
          ) {
            details.push({
              field: `${currentPath}[${idx}]`,
              code: 'OUT_OF_RANGE',
              message: error.constraints!.min,
            });
          } else if (
            error.constraints!.max &&
            typeof val === 'number' &&
            maxThreshold !== undefined &&
            val > maxThreshold
          ) {
            details.push({
              field: `${currentPath}[${idx}]`,
              code: 'OUT_OF_RANGE',
              message: error.constraints!.max,
            });
          } else if (error.constraints!.isInt && !Number.isInteger(val)) {
            details.push({
              field: `${currentPath}[${idx}]`,
              code: 'INVALID_TYPE',
              message: error.constraints!.isInt,
            });
          }
        });

        // Also include whole-array constraints if present (e.g. arrayMinSize, arrayMaxSize, arrayUnique, isArray)
        for (const [key, msg] of Object.entries(error.constraints)) {
          if (
            key === 'arrayMinSize' ||
            key === 'arrayMaxSize' ||
            key === 'arrayUnique' ||
            key === 'isArray'
          ) {
            details.push({
              field: currentPath,
              code: mapConstraintToCode(key),
              message: msg,
            });
          }
        }
      } else {
        const [constraintKey, message] = pickHighestPriorityConstraint(
          error.constraints,
        );

        details.push({
          field: currentPath,
          code: mapConstraintToCode(constraintKey),
          message,
        });
      }
    }

    if (error.children && error.children.length > 0) {
      details.push(...mapValidationErrors(error.children, currentPath));
    }
  }

  return details;
}

function getConstraintThreshold(
  target: unknown,
  property: string,
  constraintName: string,
): number | undefined {
  if (!target || typeof target !== 'object' || !target.constructor) {
    return undefined;
  }
  try {
    const storage = getMetadataStorage();
    const metadatas = storage.getTargetValidationMetadatas(
      target.constructor,
      '',
      false,
      false,
    );
    const meta = metadatas.find(
      (m) => m.propertyName === property && m.name === constraintName,
    );
    return typeof meta?.constraints?.[0] === 'number'
      ? meta.constraints[0]
      : undefined;
  } catch {
    return undefined;
  }
}

function pickHighestPriorityConstraint(
  constraints: Record<string, string>,
): [string, string] {
  for (const key of CONSTRAINT_PRIORITY) {
    if (key in constraints) {
      return [key, constraints[key]];
    }
  }

  // Fallback: constraint not in priority list — pick first available
  const entries = Object.entries(constraints);
  return entries[0];
}

function mapConstraintToCode(constraintKey: string): string {
  switch (constraintKey) {
    case 'isNotEmpty':
    case 'isDefined':
      return 'REQUIRED';

    case 'isEmail':
    case 'matches':
    case 'isUUID':
    case 'isMongoId':
    case 'isUrl':
    case 'isDateString':
    case 'isPhoneNumber':
      return 'INVALID_FORMAT';

    case 'isString':
    case 'isNumber':
    case 'isBoolean':
    case 'isInt':
    case 'isEnum':
    case 'isArray':
      return 'INVALID_TYPE';

    case 'maxLength':
    case 'minLength':
    case 'max':
    case 'min':
    case 'arrayMaxSize':
    case 'arrayMinSize':
      return 'OUT_OF_RANGE';

    case 'arrayUnique':
      return 'DUPLICATE_ENTRY';

    case 'whitelistValidation':
      return 'UNKNOWN_FIELD';

    default:
      return 'INVALID';
  }
}
