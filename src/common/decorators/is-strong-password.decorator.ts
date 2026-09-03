import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { validatePasswordPolicy } from '../../common/utils/password-policy.util.js';

/**
 * Custom class-validator decorator that enforces the centralized password policy.
 * Use on any DTO password field (login, create user, reset password, change password).
 */
export function IsStrongPassword(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol) {
    registerDecorator({
      name: 'isStrongPassword',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          return validatePasswordPolicy(value).length === 0;
        },
        defaultMessage(args: ValidationArguments): string {
          const value = args.value as string;
          if (typeof value !== 'string') return 'Password must be a string';
          const violations = validatePasswordPolicy(value);
          return violations.join('; ');
        },
      },
    });
  };
}
