import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSalaryComponentDto } from './create-salary-component.dto';
import { UpdateSalaryComponentDto } from './update-salary-component.dto';
import { UpdateSalaryComponentStatusDto } from './update-salary-component-status.dto';
import { ListSalaryComponentsQueryDto } from './list-salary-components-query.dto';
import {
  SalaryComponentCalculationType,
  SalaryComponentPercentageBasis,
  SalaryComponentType,
} from '../constants/salary-component.constant';

describe('SalaryComponent DTO Validations', () => {
  describe('CreateSalaryComponentDto', () => {
    it('should validate a valid FIXED earning component', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Basic Salary',
        code: 'BASIC',
        type: SalaryComponentType.EARNING,
        calculationType: SalaryComponentCalculationType.FIXED,
        isTaxable: true,
        isStatutory: false,
        description: 'Base salary pay',
        isActive: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.code).toBe('BASIC');
    });

    it('should validate a valid PERCENTAGE deduction component with valid percentageOf', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Provident Fund',
        code: 'PF',
        type: SalaryComponentType.DEDUCTION,
        calculationType: SalaryComponentCalculationType.PERCENTAGE,
        percentageOf: SalaryComponentPercentageBasis.BASIC,
        isTaxable: false,
        isStatutory: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should normalize and uppercase lowercase codes', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'House Rent Allowance',
        code: '  hra_allowance  ',
        type: SalaryComponentType.EARNING,
        calculationType: SalaryComponentCalculationType.PERCENTAGE,
        percentageOf: SalaryComponentPercentageBasis.BASIC,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.code).toBe('HRA_ALLOWANCE');
    });

    it('should fail when code contains invalid characters', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Special Allowance',
        code: 'SPECIAL@123',
        type: SalaryComponentType.EARNING,
        calculationType: SalaryComponentCalculationType.FIXED,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const codeError = errors.find((e) => e.property === 'code');
      expect(codeError).toBeDefined();
    });

    it('should validate a valid component with identity and classification only (calculationType omitted)', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Basic Salary',
        code: 'BASIC',
        type: SalaryComponentType.EARNING,
        isTaxable: true,
        isStatutory: false,
        isActive: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.code).toBe('BASIC');
    });

    it('should validate a valid GRATUITY employer contribution component', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Gratuity Provision',
        code: 'GRATUITY',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        isStatutory: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should normalize case variations for GRATUITY and validate successfully', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Gratuity Provision',
        code: '  gratuity  ',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        isStatutory: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.code).toBe('GRATUITY');
    });

    it('should reject GRATUITY when classified as EARNING', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Gratuity Provision',
        code: 'GRATUITY',
        type: SalaryComponentType.EARNING,
        isStatutory: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const guardError = errors.find(
        (e) => e.property === '_gratuityValidationGuard',
      );
      expect(guardError).toBeDefined();
      expect(guardError?.constraints?.isValidGratuityClassification).toContain(
        'Gratuity Provision must be classified as an EMPLOYER_CONTRIBUTION',
      );
    });

    it('should reject GRATUITY when classified as EMPLOYEE_DEDUCTION', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Gratuity Provision',
        code: 'GRATUITY',
        type: SalaryComponentType.EMPLOYEE_DEDUCTION,
        isStatutory: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject GRATUITY when isStatutory is set to false', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Gratuity Provision',
        code: 'GRATUITY',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        isStatutory: false,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const guardError = errors.find(
        (e) => e.property === '_gratuityValidationGuard',
      );
      expect(guardError?.constraints?.isValidGratuityClassification).toContain(
        'isStatutory: true',
      );
    });

    it('should reject case variation "gratuity" when classified as EARNING', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Gratuity Provision',
        code: 'gratuity',
        type: SalaryComponentType.EARNING,
        isStatutory: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail when required fields (name, code, type) are missing', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {});
      const errors = await validate(dto);
      const missingProps = errors.map((e) => e.property);
      expect(missingProps).toContain('name');
      expect(missingProps).toContain('code');
      expect(missingProps).toContain('type');
      expect(missingProps).not.toContain('calculationType');
    });

    it('should reject FIXED component when percentageOf is provided', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Conveyance Allowance',
        code: 'CONVEYANCE',
        type: SalaryComponentType.EARNING,
        calculationType: SalaryComponentCalculationType.FIXED,
        percentageOf: SalaryComponentPercentageBasis.BASIC,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const pctError = errors.find((e) => e.property === 'percentageOf');
      expect(pctError).toBeDefined();
      expect(pctError?.constraints?.isValidPercentageOf).toContain(
        'percentageOf must not be provided when calculationType is FIXED',
      );
    });

    it('should reject PERCENTAGE component when percentageOf is missing', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'ESI Deduction',
        code: 'ESI',
        type: SalaryComponentType.DEDUCTION,
        calculationType: SalaryComponentCalculationType.PERCENTAGE,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const pctError = errors.find((e) => e.property === 'percentageOf');
      expect(pctError).toBeDefined();
      expect(pctError?.constraints?.isValidPercentageOf).toContain(
        'percentageOf is required when calculationType is PERCENTAGE',
      );
    });

    it('should reject invalid enum values for type and calculationType', async () => {
      const dto = plainToInstance(CreateSalaryComponentDto, {
        name: 'Bonus',
        code: 'BONUS',
        type: 'INVALID_TYPE',
        calculationType: 'INVALID_CALC',
      });

      const errors = await validate(dto);
      const errorProps = errors.map((e) => e.property);
      expect(errorProps).toContain('type');
      expect(errorProps).toContain('calculationType');
    });
  });

  describe('UpdateSalaryComponentDto', () => {
    it('should allow valid partial update', async () => {
      const dto = plainToInstance(UpdateSalaryComponentDto, {
        name: 'Updated Name',
        description: 'New description',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject invalid enum in update', async () => {
      const dto = plainToInstance(UpdateSalaryComponentDto, {
        type: 'NOT_A_TYPE' as unknown as SalaryComponentType,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('type');
    });

    it('should reject updating code to GRATUITY with invalid type or isStatutory: false', async () => {
      const dtoInvalidType = plainToInstance(UpdateSalaryComponentDto, {
        code: 'gratuity',
        type: SalaryComponentType.EARNING,
      });
      const errorsType = await validate(dtoInvalidType);
      expect(errorsType.length).toBeGreaterThan(0);

      const dtoInvalidStatutory = plainToInstance(UpdateSalaryComponentDto, {
        code: 'GRATUITY',
        isStatutory: false,
      });
      const errorsStatutory = await validate(dtoInvalidStatutory);
      expect(errorsStatutory.length).toBeGreaterThan(0);
    });
  });

  describe('UpdateSalaryComponentStatusDto', () => {
    it('should accept valid boolean', async () => {
      const dto = plainToInstance(UpdateSalaryComponentStatusDto, {
        isActive: false,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.isActive).toBe(false);
    });

    it('should reject non-boolean status values', async () => {
      const dto = plainToInstance(UpdateSalaryComponentStatusDto, {
        isActive: 'invalid',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('isActive');
    });
  });

  describe('ListSalaryComponentsQueryDto', () => {
    it('should apply defaults for pagination and sorting', async () => {
      const dto = plainToInstance(ListSalaryComponentsQueryDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.page).toBe(1);
      expect(dto.limit).toBe(20);
      expect(dto.sortBy).toBe('createdAt');
      expect(dto.sortOrder).toBe('desc');
    });

    it('should reject sortBy fields outside the allowlist', async () => {
      const dto = plainToInstance(ListSalaryComponentsQueryDto, {
        sortBy: 'unallowedField',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('sortBy');
    });

    it('should correctly transform isActive string query params', () => {
      const dtoTrue = plainToInstance(ListSalaryComponentsQueryDto, {
        isActive: 'true',
      });
      expect(dtoTrue.isActive).toBe(true);

      const dtoFalse = plainToInstance(ListSalaryComponentsQueryDto, {
        isActive: 'false',
      });
      expect(dtoFalse.isActive).toBe(false);
    });
  });
});
