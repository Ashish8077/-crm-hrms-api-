import { ValidationPipe } from '@nestjs/common';
import { AssignSalaryDto } from './assign-salary.dto';
import { EmployeeSalaryHistoryQueryDto } from './employee-salary-history-query.dto';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { mapValidationErrors } from '../../../common/validation/validation-error.mapper';

describe('Employee Salary DTOs', () => {
  let validationPipe: ValidationPipe;

  beforeAll(() => {
    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = mapValidationErrors(errors);
        return new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Validation failed',
          400,
          details,
        );
      },
    });
  });

  describe('AssignSalaryDto', () => {
    it('passes validation with valid payload', async () => {
      const payload = {
        salaryStructureId: '60d5ec49f1b2c82d8c8e4567',
        effectiveFrom: '2026-07-01',
      };

      const transformed: AssignSalaryDto = (await validationPipe.transform(
        payload,
        {
          type: 'body',
          metatype: AssignSalaryDto,
        },
      )) as AssignSalaryDto;

      expect(transformed).toBeDefined();
      expect(transformed.salaryStructureId).toBe('60d5ec49f1b2c82d8c8e4567');
      expect(transformed.effectiveFrom).toBe('2026-07-01');
    });

    it('rejects missing salaryStructureId', async () => {
      const payload = {
        effectiveFrom: '2026-07-01',
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: AssignSalaryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects missing effectiveFrom', async () => {
      const payload = {
        salaryStructureId: '60d5ec49f1b2c82d8c8e4567',
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: AssignSalaryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects invalid MongoDB ObjectId for salaryStructureId', async () => {
      const payload = {
        salaryStructureId: 'invalid-id-123',
        effectiveFrom: '2026-07-01',
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: AssignSalaryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects non YYYY-MM-DD effectiveFrom format', async () => {
      const payload = {
        salaryStructureId: '60d5ec49f1b2c82d8c8e4567',
        effectiveFrom: '01/07/2026', // Bad format
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: AssignSalaryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('strictly rejects client-supplied salary snapshots and financial totals', async () => {
      const payload = {
        salaryStructureId: '60d5ec49f1b2c82d8c8e4567',
        effectiveFrom: '2026-07-01',
        salarySnapshot: {
          grossSalaryMonthly: 999999,
          totalCtcMonthly: 999999,
          earnings: [{ name: 'Injected Bonus', monthlyAmount: 500000 }],
        },
        grossSalary: 999999,
        netSalary: 999999,
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: AssignSalaryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects unexpected additional properties (forbidNonWhitelisted)', async () => {
      const payload = {
        salaryStructureId: '60d5ec49f1b2c82d8c8e4567',
        effectiveFrom: '2026-07-01',
        extraField: 'not allowed',
      };

      await expect(
        validationPipe.transform(payload, {
          type: 'body',
          metatype: AssignSalaryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('EmployeeSalaryHistoryQueryDto', () => {
    it('passes validation with default values', async () => {
      const query = {};
      const transformed = (await validationPipe.transform(query, {
        type: 'query',
        metatype: EmployeeSalaryHistoryQueryDto,
      })) as EmployeeSalaryHistoryQueryDto;

      expect(transformed).toBeDefined();
      expect(transformed.page).toBe(1);
      expect(transformed.limit).toBe(20);
      expect(transformed.sortBy).toBe('effectiveFrom');
      expect(transformed.sortOrder).toBe('desc');
    });

    it('accepts valid pagination and sorting values', async () => {
      const query = {
        page: '2',
        limit: '50',
        sortBy: 'createdAt',
        sortOrder: 'asc',
      };
      const transformed = (await validationPipe.transform(query, {
        type: 'query',
        metatype: EmployeeSalaryHistoryQueryDto,
      })) as EmployeeSalaryHistoryQueryDto;

      expect(transformed.page).toBe(2);
      expect(transformed.limit).toBe(50);
      expect(transformed.sortBy).toBe('createdAt');
      expect(transformed.sortOrder).toBe('asc');
    });

    it('rejects unwhitelisted sortBy field', async () => {
      const query = {
        sortBy: 'passwordHash',
      };

      await expect(
        validationPipe.transform(query, {
          type: 'query',
          metatype: EmployeeSalaryHistoryQueryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects invalid sortOrder direction', async () => {
      const query = {
        sortOrder: 'sideways',
      };

      await expect(
        validationPipe.transform(query, {
          type: 'query',
          metatype: EmployeeSalaryHistoryQueryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects limit exceeding maximum 100', async () => {
      const query = {
        limit: '150',
      };

      await expect(
        validationPipe.transform(query, {
          type: 'query',
          metatype: EmployeeSalaryHistoryQueryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('rejects page number less than 1', async () => {
      const query = {
        page: '0',
      };

      await expect(
        validationPipe.transform(query, {
          type: 'query',
          metatype: EmployeeSalaryHistoryQueryDto,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });
});
