/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import 'reflect-metadata';
import {
  ArgumentsHost,
  HttpStatus,
  ValidationPipe,
  ValidationError,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSalaryStructureDto } from './create-salary-structure.dto';
import { UpdateSalaryStructureDto } from './update-salary-structure.dto';
import { SalaryStructureComponentInputDto } from './salary-structure-component.dto';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../constants/salary-structure.constant';
import {
  mapValidationErrors,
  ValidationDetail,
} from '../../../common/validation/validation-error.mapper';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';

describe('SalaryStructure DTO Validations', () => {
  // Production ValidationPipe configured identically to src/main.ts
  const createValidationPipe = (): ValidationPipe =>
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = mapValidationErrors(errors);
        return new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          HttpStatus.BAD_REQUEST,
          details,
        );
      },
    });

  describe('SalaryStructureComponentInputDto', () => {
    it('validates a valid FIXED component', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 25000,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('rejects FIXED component if amount is missing (undefined)', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.FIXED,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isValidStructureComponent).toContain(
        'For FIXED calculationType, amount (> 0) is required, and percentage / percentageOf must be null or omitted.',
      );
      expect(
        errors.find((e) => e.property === '_componentValidationGuard'),
      ).toBeUndefined();
    });

    it('rejects FIXED component if amount is null', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.FIXED,
        amount: null,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isValidStructureComponent).toContain(
        'For FIXED calculationType, amount (> 0) is required, and percentage / percentageOf must be null or omitted.',
      );
    });

    it('rejects FIXED component if amount is <= 0', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 0,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const amountError = errors.find((e) => e.property === 'amount');
      expect(amountError).toBeDefined();
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError).toBeDefined();
    });

    it('rejects FIXED component if amount is negative or invalid number', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.FIXED,
        amount: -100,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const amountError = errors.find((e) => e.property === 'amount');
      expect(amountError).toBeDefined();
    });

    it('rejects FIXED component if percentage or percentageOf is provided', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.FIXED,
        amount: 25000,
        percentage: 50,
        percentageOf: StructureComponentPercentageBasis.BASIC,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isValidStructureComponent).toContain(
        'For FIXED calculationType, amount (> 0) is required, and percentage / percentageOf must be null or omitted.',
      );
      expect(
        errors.find((e) => e.property === '_componentValidationGuard'),
      ).toBeUndefined();
    });

    it('validates a valid PERCENTAGE component on BASIC', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        percentage: 50,
        percentageOf: StructureComponentPercentageBasis.BASIC,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('validates a valid PERCENTAGE component on GROSS_SALARY', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        percentage: 50,
        percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('rejects PERCENTAGE component if percentage is missing (undefined)', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        percentageOf: StructureComponentPercentageBasis.BASIC,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isValidStructureComponent).toContain(
        'For PERCENTAGE calculationType, percentage (> 0 and <= 100) and percentageOf (BASIC or GROSS_SALARY) are required, and amount must be null or omitted.',
      );
    });

    it('rejects PERCENTAGE component if percentageOf is missing (undefined)', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        percentage: 50,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isValidStructureComponent).toContain(
        'For PERCENTAGE calculationType, percentage (> 0 and <= 100) and percentageOf (BASIC or GROSS_SALARY) are required, and amount must be null or omitted.',
      );
    });

    it('rejects PERCENTAGE component if percentage is <= 0 or > 100', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        percentage: 120,
        percentageOf: StructureComponentPercentageBasis.BASIC,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const percentageError = errors.find((e) => e.property === 'percentage');
      expect(percentageError).toBeDefined();
    });

    it('rejects PERCENTAGE component if percentage is 0', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        percentage: 0,
        percentageOf: StructureComponentPercentageBasis.BASIC,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const percentageError = errors.find((e) => e.property === 'percentage');
      expect(percentageError).toBeDefined();
    });

    it('rejects PERCENTAGE component if amount is also provided', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.PERCENTAGE,
        percentage: 50,
        percentageOf: StructureComponentPercentageBasis.BASIC,
        amount: 10000,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isValidStructureComponent).toContain(
        'For PERCENTAGE calculationType, percentage (> 0 and <= 100) and percentageOf (BASIC or GROSS_SALARY) are required, and amount must be null or omitted.',
      );
    });

    it('validates a valid BALANCE component with no amount or percentage', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.BALANCE,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('rejects BALANCE component if amount is provided', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.BALANCE,
        amount: 5000,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isValidStructureComponent).toContain(
        'For BALANCE calculationType, amount, percentage, and percentageOf must all be null or omitted.',
      );
    });

    it('rejects BALANCE component if percentage is provided', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: StructureComponentCalculationType.BALANCE,
        percentage: 20,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isValidStructureComponent).toContain(
        'For BALANCE calculationType, amount, percentage, and percentageOf must all be null or omitted.',
      );
    });

    it('rejects invalid calculationType enum value', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: '60d5ec49f1b2c82d8c8e4567',
        calculationType: 'CUSTOM' as StructureComponentCalculationType,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const calcError = errors.find((e) => e.property === 'calculationType');
      expect(calcError?.constraints?.isEnum).toBeDefined();
    });

    it('rejects invalid ObjectId for componentId', async () => {
      const dto = plainToInstance(SalaryStructureComponentInputDto, {
        componentId: 'not-a-valid-mongo-id',
        calculationType: StructureComponentCalculationType.BALANCE,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const idError = errors.find((e) => e.property === 'componentId');
      expect(idError?.constraints?.isMongoId).toBeDefined();
    });

    it('verifies _componentValidationGuard is never exposed or defined on DTO', () => {
      const instance = new SalaryStructureComponentInputDto();
      expect(
        Object.prototype.hasOwnProperty.call(
          instance,
          '_componentValidationGuard',
        ),
      ).toBe(false);
      expect(
        (instance as unknown as Record<string, unknown>)
          ._componentValidationGuard,
      ).toBeUndefined();
    });
  });

  describe('CreateSalaryStructureDto & Nested Validation', () => {
    const validComponent1 = {
      componentId: '60d5ec49f1b2c82d8c8e4567',
      calculationType: StructureComponentCalculationType.FIXED,
      amount: 25000,
    };
    const validComponent2 = {
      componentId: '60d5ec49f1b2c82d8c8e4568',
      calculationType: StructureComponentCalculationType.BALANCE,
    };

    it('validates a complete valid CTC structure', async () => {
      const dto = plainToInstance(CreateSalaryStructureDto, {
        name: 'Engineering CTC L2',
        code: 'eng_l2_ctc',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.ANNUAL,
        salaryAmount: 600000,
        components: [validComponent1, validComponent2],
        isActive: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.code).toBe('ENG_L2_CTC');
    });

    it('rejects when components contain duplicate componentId', async () => {
      const dto = plainToInstance(CreateSalaryStructureDto, {
        name: 'Engineering CTC L2',
        code: 'ENG_L2_CTC',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          validComponent1,
          {
            componentId: '60d5ec49f1b2c82d8c8e4567', // Duplicate!
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 50,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
        ],
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const compError = errors.find((e) => e.property === 'components');
      expect(compError?.constraints?.isUniqueComponentsList).toBeDefined();
    });

    it('rejects when components contain multiple BALANCE components', async () => {
      const dto = plainToInstance(CreateSalaryStructureDto, {
        name: 'Engineering CTC L2',
        code: 'ENG_L2_CTC',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          validComponent2,
          {
            componentId: '60d5ec49f1b2c82d8c8e4569',
            calculationType: StructureComponentCalculationType.BALANCE, // Second balance!
          },
        ],
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const compError = errors.find((e) => e.property === 'components');
      expect(
        compError?.constraints?.hasAtMostOneBalanceComponent,
      ).toBeDefined();
    });

    it('rejects missing required top-level fields', async () => {
      const dto = plainToInstance(CreateSalaryStructureDto, {});
      const errors = await validate(dto);
      const props = errors.map((e) => e.property);
      expect(props).toContain('name');
      expect(props).toContain('code');
      expect(props).toContain('salaryBasis');
      expect(props).toContain('salaryFrequency');
      expect(props).toContain('salaryAmount');
      expect(props).toContain('components');
    });
  });

  describe('Validation Error Reporting & Response Contract (ValidationPipe & GlobalExceptionFilter)', () => {
    let validationPipe: ValidationPipe;
    let filter: GlobalExceptionFilter;
    let mockResponse: {
      status: jest.Mock;
      json: jest.Mock;
    };
    let mockHost: ArgumentsHost;

    beforeEach(() => {
      validationPipe = createValidationPipe();
      filter = new GlobalExceptionFilter();
      mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const mockRequest = {
        headers: { 'x-request-id': 'test-request-id-1234' },
        method: 'POST',
        originalUrl: '/api/v1/salary-structures',
      };
      mockHost = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ArgumentsHost;
    });

    it('reports nested component validation error with exact array index e.g. components[5].calculationType', async () => {
      // 5 valid components followed by 1 invalid FIXED component at index 5 (missing amount)
      const payload = {
        name: 'Large Engineering Structure',
        code: 'ENG_LARGE_01',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 100000,
        components: [
          {
            componentId: '60d5ec49f1b2c82d8c8e4561',
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 40000,
          },
          {
            componentId: '60d5ec49f1b2c82d8c8e4562',
            calculationType: StructureComponentCalculationType.FIXED,
            amount: 20000,
          },
          {
            componentId: '60d5ec49f1b2c82d8c8e4563',
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 10,
            percentageOf: StructureComponentPercentageBasis.BASIC,
          },
          {
            componentId: '60d5ec49f1b2c82d8c8e4564',
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 5,
            percentageOf: StructureComponentPercentageBasis.GROSS_SALARY,
          },
          {
            componentId: '60d5ec49f1b2c82d8c8e4565',
            calculationType: StructureComponentCalculationType.BALANCE,
          },
          {
            componentId: '60d5ec49f1b2c82d8c8e4566',
            calculationType: StructureComponentCalculationType.FIXED,
            // amount missing at index 5!
          },
        ],
      };

      try {
        await validationPipe.transform(payload, {
          type: 'body',
          metatype: CreateSalaryStructureDto,
        });
        fail('Expected ValidationPipe to throw AppError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appError = err as AppError;
        expect(appError.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(appError.code).toBe(ErrorCode.VALIDATION_ERROR);

        const details = appError.details as ValidationDetail[];
        expect(details).toBeDefined();

        // Exact array index error
        const calcError = details.find(
          (d) => d.field === 'components[5].calculationType',
        );
        expect(calcError).toBeDefined();
        expect(calcError?.code).toBe('INVALID');
        expect(calcError?.message).toContain(
          'For FIXED calculationType, amount (> 0) is required, and percentage / percentageOf must be null or omitted.',
        );

        // Verify _componentValidationGuard NEVER appears in any detail
        for (const detail of details) {
          expect(detail.field).not.toContain('_componentValidationGuard');
          expect(detail.message).not.toContain('_componentValidationGuard');
        }

        // Verify end-to-end response format through GlobalExceptionFilter
        filter.catch(appError, mockHost);
        expect(mockResponse.status).toHaveBeenCalledWith(
          HttpStatus.BAD_REQUEST,
        );
        expect(mockResponse.json).toHaveBeenCalledWith({
          success: false,
          error: {
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Request validation failed',
            details: expect.arrayContaining([
              expect.objectContaining({
                field: 'components[5].calculationType',
                code: 'INVALID',
              }),
            ]),
          },
          requestId: 'test-request-id-1234',
        });
      }
    });

    it('reports multiple invalid components in one request with their distinct indices', async () => {
      const payload = {
        name: 'Multi Error Structure',
        code: 'MULTI_ERR_01',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 80000,
        components: [
          {
            // Index 0: FIXED missing amount
            componentId: '60d5ec49f1b2c82d8c8e4561',
            calculationType: StructureComponentCalculationType.FIXED,
          },
          {
            // Index 1: PERCENTAGE missing percentageOf
            componentId: '60d5ec49f1b2c82d8c8e4562',
            calculationType: StructureComponentCalculationType.PERCENTAGE,
            percentage: 20,
          },
          {
            // Index 2: BALANCE with unexpected amount
            componentId: '60d5ec49f1b2c82d8c8e4563',
            calculationType: StructureComponentCalculationType.BALANCE,
            amount: 5000,
          },
        ],
      };

      try {
        await validationPipe.transform(payload, {
          type: 'body',
          metatype: CreateSalaryStructureDto,
        });
        fail('Expected ValidationPipe to throw AppError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appError = err as AppError;
        const details = appError.details as ValidationDetail[];

        const fields = details.map((d) => d.field);
        expect(fields).toContain('components[0].calculationType');
        expect(fields).toContain('components[1].calculationType');
        expect(fields).toContain('components[2].calculationType');

        // Confirm _componentValidationGuard is absent
        expect(JSON.stringify(details)).not.toContain(
          '_componentValidationGuard',
        );
      }
    });

    it('reports invalid ObjectId on nested component with field components[0].componentId', async () => {
      const payload = {
        name: 'Invalid Mongo ID Structure',
        code: 'INV_ID_01',
        salaryBasis: SalaryStructureBasis.GROSS,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        components: [
          {
            componentId: 'not-a-mongo-id',
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      try {
        await validationPipe.transform(payload, {
          type: 'body',
          metatype: CreateSalaryStructureDto,
        });
        fail('Expected ValidationPipe to throw AppError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appError = err as AppError;
        const details = appError.details as ValidationDetail[];
        const idDetail = details.find(
          (d) => d.field === 'components[0].componentId',
        );
        expect(idDetail).toBeDefined();
        expect(idDetail?.code).toBe('INVALID_FORMAT');
      }
    });

    it('rejects unknown request properties with UNKNOWN_FIELD error code', async () => {
      const payloadWithUnknown = {
        name: 'Unknown Props Structure',
        code: 'UNK_PROP_01',
        salaryBasis: SalaryStructureBasis.CTC,
        salaryFrequency: SalaryStructureFrequency.MONTHLY,
        salaryAmount: 50000,
        unknownTopLevelField: 'hacker',
        components: [
          {
            componentId: '60d5ec49f1b2c82d8c8e4561',
            calculationType: StructureComponentCalculationType.BALANCE,
          },
        ],
      };

      try {
        await validationPipe.transform(payloadWithUnknown, {
          type: 'body',
          metatype: CreateSalaryStructureDto,
        });
        fail('Expected ValidationPipe to throw AppError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appError = err as AppError;
        expect(appError.statusCode).toBe(HttpStatus.BAD_REQUEST);
        const details = appError.details as ValidationDetail[];
        const unknownDetail = details.find(
          (d) => d.field === 'unknownTopLevelField',
        );
        expect(unknownDetail).toBeDefined();
        expect(unknownDetail?.code).toBe('UNKNOWN_FIELD');
      }
    });
  });

  describe('UpdateSalaryStructureDto', () => {
    it('validates a valid partial update', async () => {
      const dto = plainToInstance(UpdateSalaryStructureDto, {
        name: 'Revised Name',
        salaryAmount: 700000,
        version: 1,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
