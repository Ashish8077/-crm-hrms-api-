import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProcessCarryForwardDto } from './process-carry-forward.dto';

describe('ProcessCarryForwardDto', () => {
  const validPayload = {
    fromYear: 2025,
    toYear: 2026,
    leaveTypeId: '60d5ecb8b5c9c32b8c8d4e11',
    employeeId: '60d5ecb8b5c9c32b8c8d4e22',
  };

  it('should validate a complete valid payload', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, validPayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should validate when optional leaveTypeId and employeeId are omitted', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, {
      fromYear: 2025,
      toYear: 2026,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should transform numeric string years to numbers', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, {
      fromYear: '2025',
      toYear: '2026',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.fromYear).toBe(2025);
    expect(dto.toYear).toBe(2026);
  });

  it('should reject missing fromYear', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, {
      toYear: 2026,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'fromYear')).toBeDefined();
  });

  it('should reject missing toYear', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, {
      fromYear: 2025,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'toYear')).toBeDefined();
  });

  it('should reject fromYear less than 2000 (e.g. 0, -2025, 1999)', async () => {
    for (const badYear of [0, -2025, 1999]) {
      const dto = plainToInstance(ProcessCarryForwardDto, {
        ...validPayload,
        fromYear: badYear,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.find((e) => e.property === 'fromYear')).toBeDefined();
    }
  });

  it('should reject toYear greater than 2100 (e.g. 2101)', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, {
      ...validPayload,
      toYear: 2101,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'toYear')).toBeDefined();
  });

  it('should reject non-integer year (e.g. 2025.5)', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, {
      ...validPayload,
      fromYear: 2025.5,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'fromYear')).toBeDefined();
  });

  it('should reject invalid MongoId for employeeId', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, {
      ...validPayload,
      employeeId: 'invalid-id',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'employeeId')).toBeDefined();
  });

  it('should reject invalid MongoId for leaveTypeId', async () => {
    const dto = plainToInstance(ProcessCarryForwardDto, {
      ...validPayload,
      leaveTypeId: 'invalid-id',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'leaveTypeId')).toBeDefined();
  });
});
