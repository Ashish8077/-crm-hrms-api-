import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isPastDate', async: false })
export class IsPastDateConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: unknown) {
    if (!propertyValue) {
      return true;
    }

    if (!(propertyValue instanceof Date)) {
      return false;
    }

    return propertyValue.getTime() < new Date().getTime();
  }

  defaultMessage() {
    return '$property must be a past date';
  }
}

export function IsPastDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPastDateConstraint,
    });
  };
}
