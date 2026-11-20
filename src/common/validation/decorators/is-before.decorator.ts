import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isBefore', async: false })
export class IsBeforeConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: any, args: ValidationArguments) {
    const relatedPropertyName = args.constraints[0] as string;
    const relatedValue = (args.object as Record<string, unknown>)[
      relatedPropertyName
    ];

    // If one of the dates is missing or invalid, we don't handle it here. Let other decorators handle it.
    if (!propertyValue || !relatedValue) {
      return true;
    }

    if (!(propertyValue instanceof Date) || !(relatedValue instanceof Date)) {
      return true;
    }

    return propertyValue.getTime() < relatedValue.getTime();
  }

  defaultMessage(args: ValidationArguments) {
    const relatedPropertyName = args.constraints[0] as string;
    return `$property must be before ${relatedPropertyName}`;
  }
}

export function IsBefore(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsBeforeConstraint,
    });
  };
}
