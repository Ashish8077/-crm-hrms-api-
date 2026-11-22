import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdjustLeaveBalanceDto } from './adjust-leave-balance.dto';

describe('AdjustLeaveBalanceDto', () => {
  const validPayload = {
    employeeId: '60d5ecb8b5c9c32b8c8d4e11',
    leaveTypeId: '60d5ecb8b5c9c32b8c8d4e22',
    year: 2026,
    adjustmentType: 'CREDIT',
    days: 1.5,
    reason: 'Testing balance adjustment.',
  };

  it('should validate a valid adjustment payload (1.5 days)', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, validPayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept whole number days (e.g. 2 days)', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      days: 2,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept 2 decimal places (e.g. 1.25 days for quarter-day accrual)', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      days: 1.25,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('Test 6: should reject excessive decimal precision (days: 1.234567)', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      days: 1.234567,
      reason: 'Testing excessive decimal precision.',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const daysError = errors.find((e) => e.property === 'days');
    expect(daysError).toBeDefined();
    expect(daysError?.constraints).toHaveProperty('isNumber');
    expect(daysError?.constraints?.isNumber).toContain(
      'days cannot have more than 2 decimal places',
    );
  });

  it('should reject days less than 0.5 (days: 0)', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      days: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const daysError = errors.find((e) => e.property === 'days');
    expect(daysError).toBeDefined();
    expect(daysError?.constraints).toHaveProperty('min');
  });

  it('should reject negative days (days: -1)', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      days: -1,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const daysError = errors.find((e) => e.property === 'days');
    expect(daysError).toBeDefined();
  });

  it('should reject days exceeding 90', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      days: 91,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const daysError = errors.find((e) => e.property === 'days');
    expect(daysError).toBeDefined();
    expect(daysError?.constraints).toHaveProperty('max');
  });

  it('should reject invalid adjustmentType', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      adjustmentType: 'INVALID_TYPE',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const typeError = errors.find((e) => e.property === 'adjustmentType');
    expect(typeError).toBeDefined();
  });

  it('Test 18a: should reject invalid year 0', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      year: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const yearError = errors.find((e) => e.property === 'year');
    expect(yearError).toBeDefined();
    expect(yearError?.constraints).toHaveProperty('min');
  });

  it('Test 18b: should reject year outside supported range (< 2000 or > 2100)', async () => {
    const dtoLow = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      year: 1999,
    });
    const errorsLow = await validate(dtoLow);
    expect(errorsLow.length).toBeGreaterThan(0);
    expect(errorsLow.find((e) => e.property === 'year')).toBeDefined();

    const dtoHigh = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      year: 2101,
    });
    const errorsHigh = await validate(dtoHigh);
    expect(errorsHigh.length).toBeGreaterThan(0);
    expect(errorsHigh.find((e) => e.property === 'year')).toBeDefined();
  });

  it('Test 19: should reject missing reason when reason field is omitted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { reason, ...payloadWithoutReason } = validPayload;
    const dto = plainToInstance(AdjustLeaveBalanceDto, payloadWithoutReason);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const reasonError = errors.find((e) => e.property === 'reason');
    expect(reasonError).toBeDefined();
    expect(reasonError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('Test 20a: should reject empty reason ("")', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      reason: '',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const reasonError = errors.find((e) => e.property === 'reason');
    expect(reasonError).toBeDefined();
  });

  it('Test 20b: should reject whitespace-only reason ("     ")', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      reason: '     ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const reasonError = errors.find((e) => e.property === 'reason');
    expect(reasonError).toBeDefined();
  });

  it('Test 20c: should reject reason with fewer than 5 characters ("abc")', async () => {
    const dto = plainToInstance(AdjustLeaveBalanceDto, {
      ...validPayload,
      reason: 'abc',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const reasonError = errors.find((e) => e.property === 'reason');
    expect(reasonError).toBeDefined();
    expect(reasonError?.constraints).toHaveProperty('minLength');
  });
});
