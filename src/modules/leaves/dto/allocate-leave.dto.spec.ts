import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AllocateLeaveDto } from './allocate-leave.dto';

describe('AllocateLeaveDto', () => {
  const validPayload = {
    employeeId: '60d5ecb8b5c9c32b8c8d4e11',
    leaveTypeId: '60d5ecb8b5c9c32b8c8d4e33',
    year: 2026,
    days: 12,
    carriedForwardDays: 3,
    remarks: 'Annual FY2026 allocation grant.',
  };

  it('should validate a complete valid allocation payload without departmentId', async () => {
    const dto = plainToInstance(AllocateLeaveDto, validPayload);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect('departmentId' in dto).toBe(false);
  });

  it('Test 10 (DTO): should reject zero allocation days (days: 0)', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      days: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const daysError = errors.find((e) => e.property === 'days');
    expect(daysError).toBeDefined();
    expect(daysError?.constraints).toHaveProperty('min');
  });

  it('should reject negative allocation days (days: -5)', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      days: -5,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const daysError = errors.find((e) => e.property === 'days');
    expect(daysError).toBeDefined();
    expect(daysError?.constraints).toHaveProperty('min');
  });

  it('should reject negative carried forward days (carriedForwardDays: -1)', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      carriedForwardDays: -1,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const cfError = errors.find((e) => e.property === 'carriedForwardDays');
    expect(cfError).toBeDefined();
    expect(cfError?.constraints).toHaveProperty('min');
  });

  it('should accept zero carried forward days (carriedForwardDays: 0)', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      carriedForwardDays: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject invalid MongoDB ObjectId for employeeId', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      employeeId: 'invalid-id',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const idError = errors.find((e) => e.property === 'employeeId');
    expect(idError).toBeDefined();
    expect(idError?.constraints).toHaveProperty('isMongoId');
  });

  it('Test 18 (DTO): should accept valid year 2026', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      year: 2026,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.year).toBe(2026);
  });

  it('Test 19 (DTO): should reject invalid year 0', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      year: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const yearError = errors.find((e) => e.property === 'year');
    expect(yearError).toBeDefined();
    expect(yearError?.constraints).toHaveProperty('min');
  });

  it('Test 20 (DTO): should transform string year "2026" to numeric 2026', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      year: '2026',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(typeof dto.year).toBe('number');
    expect(dto.year).toBe(2026);
  });

  it('Test 22 (DTO): should accept payload with missing remarks', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { remarks, ...payloadWithoutRemarks } = validPayload;
    const dto = plainToInstance(AllocateLeaveDto, payloadWithoutRemarks);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.remarks).toBeUndefined();
  });

  it('should reject excessive decimal precision on allocation days (days: 1.234567)', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      days: 1.234567,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const daysError = errors.find((e) => e.property === 'days');
    expect(daysError).toBeDefined();
    expect(daysError?.constraints?.isNumber).toContain(
      'days cannot have more than 2 decimal places',
    );
  });

  it('should reject excessive decimal precision on carriedForwardDays (carriedForwardDays: 2.345)', async () => {
    const dto = plainToInstance(AllocateLeaveDto, {
      ...validPayload,
      carriedForwardDays: 2.345,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const cfError = errors.find((e) => e.property === 'carriedForwardDays');
    expect(cfError).toBeDefined();
    expect(cfError?.constraints?.isNumber).toContain(
      'carriedForwardDays cannot have more than 2 decimal places',
    );
  });
});
