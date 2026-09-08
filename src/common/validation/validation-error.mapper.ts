import { ValidationError } from 'class-validator';

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

  // Whitelist
  'whitelistValidation',
];

export function mapValidationErrors(
  errors: ValidationError[],
): ValidationDetail[] {
  return errors
    .filter((error) => error.constraints)
    .map((error) => {
      const [constraintKey, message] = pickHighestPriorityConstraint(
        error.constraints!,
      );

      return {
        field: error.property,
        code: mapConstraintToCode(constraintKey),
        message,
      };
    });
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

    case 'whitelistValidation':
      return 'UNKNOWN_FIELD';

    default:
      return 'INVALID';
  }
}
