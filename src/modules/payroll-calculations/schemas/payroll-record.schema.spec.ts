import { PayrollRecordSchema } from './payroll-record.schema';

describe('PayrollRecordSchema - MongoDB Indexes & Decimal128 Fields', () => {
  it('defines soft-delete compatible unique compound index { payrollPeriodId: 1, employeeId: 1 }', () => {
    const indexes = PayrollRecordSchema.indexes();
    const uniqueIdx = indexes.find(
      (idx) =>
        (idx[0] as Record<string, unknown>).payrollPeriodId === 1 &&
        (idx[0] as Record<string, unknown>).employeeId === 1,
    );

    expect(uniqueIdx).toBeDefined();
    expect(uniqueIdx![0]).toEqual({ payrollPeriodId: 1, employeeId: 1 });
    expect(uniqueIdx![1]).toMatchObject({
      unique: true,
      partialFilterExpression: { deletedAt: null },
      name: 'uq_payroll_records_period_employee',
    });
  });

  it('defines period status index and employee history index', () => {
    const indexes = PayrollRecordSchema.indexes();

    const periodStatusIdx = indexes.find(
      (idx) =>
        (idx[0] as Record<string, unknown>).payrollPeriodId === 1 &&
        (idx[0] as Record<string, unknown>).status === 1 &&
        (idx[0] as Record<string, unknown>).deletedAt === 1,
    );
    expect(periodStatusIdx).toBeDefined();
    expect(periodStatusIdx![1]).toMatchObject({
      name: 'idx_payroll_records_period_status',
    });

    const empHistoryIdx = indexes.find(
      (idx) =>
        (idx[0] as Record<string, unknown>).employeeId === 1 &&
        (idx[0] as Record<string, unknown>).calculatedAt === -1 &&
        (idx[0] as Record<string, unknown>).deletedAt === 1,
    );
    expect(empHistoryIdx).toBeDefined();
    expect(empHistoryIdx![1]).toMatchObject({
      name: 'idx_payroll_records_employee_history',
    });
  });

  it('uses Mongoose Decimal128 schema type for persisted monetary fields', () => {
    expect(PayrollRecordSchema.path('grossEarnings').instance).toBe(
      'Decimal128',
    );
    expect(PayrollRecordSchema.path('totalDeductions').instance).toBe(
      'Decimal128',
    );
    expect(PayrollRecordSchema.path('employerContributions').instance).toBe(
      'Decimal128',
    );
    expect(PayrollRecordSchema.path('netSalary').instance).toBe('Decimal128');
  });
});
