import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isDateBeforeOrEqual', async: false })
export class IsDateBeforeOrEqualConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: unknown, args: ValidationArguments): boolean {
    const [relatedPropertyName] = args.constraints as [string];
    const relatedValue = (args.object as Record<string, unknown>)[
      relatedPropertyName
    ];

    // If either value is absent, skip cross-field comparison. Let @IsOptional or format decorators handle it.
    if (
      propertyValue === undefined ||
      propertyValue === null ||
      propertyValue === '' ||
      relatedValue === undefined ||
      relatedValue === null ||
      relatedValue === ''
    ) {
      return true;
    }

    if (typeof propertyValue !== 'string' || typeof relatedValue !== 'string') {
      return true;
    }

    // Lexicographical comparison holds for valid ISO YYYY-MM-DD date strings
    return propertyValue <= relatedValue;
  }

  defaultMessage(args: ValidationArguments): string {
    const [relatedPropertyName] = args.constraints as [string];
    return `$property must not be later than ${relatedPropertyName}`;
  }
}

export function IsDateBeforeOrEqual(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsDateBeforeOrEqualConstraint,
    });
  };
}
