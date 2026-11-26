import { PayrollPeriodSchema } from './payroll-period.schema';

describe('PayrollPeriodSchema - MongoDB Index & Middleware Definitions', () => {
  describe('Index 1: Unique Period Code Index (uq_payroll_periods_code)', () => {
    it('defines a unique index on periodCode with case-insensitive collation and partialFilterExpression for soft deletes', () => {
      const indexes = PayrollPeriodSchema.indexes();
      const codeIndex = indexes.find(
        (idx) => (idx[0] as Record<string, unknown>).periodCode === 1,
      );

      expect(codeIndex).toBeDefined();
      const [fields, options] = codeIndex!;
      expect(fields).toEqual({ periodCode: 1 });
      expect(options).toMatchObject({
        unique: true,
        collation: { locale: 'en', strength: 2 },
        partialFilterExpression: { deletedAt: null },
        name: 'uq_payroll_periods_code',
      });
    });
  });

  describe('Index 2: Compound Unique Cycle Index (uq_payroll_periods_cycle)', () => {
    it('defines a compound unique index on (year, month, payrollFrequency, deletedAt)', () => {
      const indexes = PayrollPeriodSchema.indexes();
      const cycleIndex = indexes.find(
        (idx) =>
          (idx[0] as Record<string, unknown>).year === 1 &&
          (idx[0] as Record<string, unknown>).month === 1 &&
          (idx[0] as Record<string, unknown>).payrollFrequency === 1 &&
          (idx[0] as Record<string, unknown>).deletedAt === 1,
      );

      expect(cycleIndex).toBeDefined();
      const [fields, options] = cycleIndex!;
      expect(fields).toEqual({
        year: 1,
        month: 1,
        payrollFrequency: 1,
        deletedAt: 1,
      });
      expect(options).toMatchObject({
        unique: true,
        name: 'uq_payroll_periods_cycle',
      });
    });
  });

  describe('Index 3 & 4: Performance Query Helper Indexes', () => {
    it('defines an index on (startDate, endDate, deletedAt) for date range queries', () => {
      const indexes = PayrollPeriodSchema.indexes();
      const dateIndex = indexes.find(
        (idx) =>
          (idx[0] as Record<string, unknown>).startDate === 1 &&
          (idx[0] as Record<string, unknown>).endDate === 1 &&
          (idx[0] as Record<string, unknown>).deletedAt === 1,
      );

      expect(dateIndex).toBeDefined();
      expect(dateIndex![1]).toMatchObject({
        name: 'idx_payroll_periods_dates',
      });
    });

    it('defines an index on (status, year, month, deletedAt) for status-filtered queries', () => {
      const indexes = PayrollPeriodSchema.indexes();
      const statusIndex = indexes.find(
        (idx) =>
          (idx[0] as Record<string, unknown>).status === 1 &&
          (idx[0] as Record<string, unknown>).year === -1 &&
          (idx[0] as Record<string, unknown>).month === -1 &&
          (idx[0] as Record<string, unknown>).deletedAt === 1,
      );

      expect(statusIndex).toBeDefined();
      expect(statusIndex![1]).toMatchObject({
        name: 'idx_payroll_periods_status_cycle',
      });
    });
  });

  describe('Schema Middleware: Guaranteed Uppercase Normalization', () => {
    it('trims and uppercases periodCode in pre-validate hook', () => {
      const doc: Record<string, unknown> = {
        periodCode: '  pr-2026-10-custom  ',
      };
      const validateHooks = (
        PayrollPeriodSchema as unknown as {
          s: {
            hooks: {
              _pres: Map<string, Array<{ fn: (this: unknown) => void }>>;
            };
          };
        }
      ).s.hooks._pres.get('validate');

      expect(validateHooks).toBeDefined();
      const ourHook = validateHooks?.find(
        (h) =>
          typeof h.fn === 'function' && h.fn.toString().includes('periodCode'),
      );
      expect(ourHook).toBeDefined();

      ourHook!.fn.call(doc);
      expect(doc.periodCode).toBe('PR-2026-10-CUSTOM');
    });

    it('trims and uppercases periodCode in pre-findOneAndUpdate hook', () => {
      const updateData = {
        $set: { periodCode: '  pr-2026-11-updated  ' },
      };
      const updateQueryContext = {
        getUpdate: () => updateData,
        schema: PayrollPeriodSchema,
      };
      const findOneAndUpdateHooks = (
        PayrollPeriodSchema as unknown as {
          s: {
            hooks: {
              _pres: Map<string, Array<{ fn: (this: unknown) => void }>>;
            };
          };
        }
      ).s.hooks._pres.get('findOneAndUpdate');

      expect(findOneAndUpdateHooks).toBeDefined();
      for (const hook of findOneAndUpdateHooks!) {
        try {
          hook.fn.call(updateQueryContext);
        } catch {
          // ignore internal timestamps hook if not a full Query instance
        }
      }
      expect(updateData.$set.periodCode).toBe('PR-2026-11-UPDATED');
    });
  });
});
