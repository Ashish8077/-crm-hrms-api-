import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPendingApprovalsQueryDto } from './list-pending-approvals-query.dto';

describe('ListPendingApprovalsQueryDto Unit Suite', () => {
  it('should pass validation when query is empty (defaults used)', async () => {
    const dto = plainToInstance(ListPendingApprovalsQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('should pass validation with all valid query filters', async () => {
    const dto = plainToInstance(ListPendingApprovalsQueryDto, {
      page: 2,
      limit: 50,
      employeeId: '60d5ecb8b5c9c32b8c8d4e11',
      leaveTypeId: '60d5ecb8b5c9c32b8c8d4e22',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      year: 2026,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.employeeId).toBe('60d5ecb8b5c9c32b8c8d4e11');
    expect(dto.leaveTypeId).toBe('60d5ecb8b5c9c32b8c8d4e22');
    expect(dto.startDate).toBe('2026-10-01');
    expect(dto.endDate).toBe('2026-10-31');
    expect(dto.year).toBe(2026);
  });

  it('should fail validation when employeeId is not a valid Mongo ObjectId', async () => {
    const dto = plainToInstance(ListPendingApprovalsQueryDto, {
      employeeId: 'invalid-id',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'employeeId')).toBe(true);
  });

  it('should fail validation when leaveTypeId is not a valid Mongo ObjectId', async () => {
    const dto = plainToInstance(ListPendingApprovalsQueryDto, {
      leaveTypeId: 'invalid-lt-id',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'leaveTypeId')).toBe(true);
  });

  it('should fail validation when startDate is not in YYYY-MM-DD format', async () => {
    const dto = plainToInstance(ListPendingApprovalsQueryDto, {
      startDate: '2026/10/01',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
  });

  it('should fail validation when endDate is not in YYYY-MM-DD format', async () => {
    const dto = plainToInstance(ListPendingApprovalsQueryDto, {
      endDate: '2026-10-311',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'endDate')).toBe(true);
  });

  it('should fail validation when startDate is later than endDate', async () => {
    const dto = plainToInstance(ListPendingApprovalsQueryDto, {
      startDate: '2026-11-01',
      endDate: '2026-10-01',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const startError = errors.find((e) => e.property === 'startDate');
    expect(startError).toBeDefined();
    expect(startError?.constraints?.isDateBeforeOrEqual).toBe(
      'startDate must not be later than endDate',
    );
  });

  it('should pass validation when startDate equals endDate (single-day filter)', async () => {
    const dto = plainToInstance(ListPendingApprovalsQueryDto, {
      startDate: '2026-10-15',
      endDate: '2026-10-15',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass validation when only startDate or only endDate is provided', async () => {
    const dtoStartOnly = plainToInstance(ListPendingApprovalsQueryDto, {
      startDate: '2026-10-01',
    });
    const errorsStart = await validate(dtoStartOnly);
    expect(errorsStart).toHaveLength(0);

    const dtoEndOnly = plainToInstance(ListPendingApprovalsQueryDto, {
      endDate: '2026-10-31',
    });
    const errorsEnd = await validate(dtoEndOnly);
    expect(errorsEnd).toHaveLength(0);
  });

  it('should fail validation when year is outside the 2000-2100 boundary', async () => {
    const dtoLow = plainToInstance(ListPendingApprovalsQueryDto, {
      year: 1999,
    });
    const errorsLow = await validate(dtoLow);
    expect(errorsLow.length).toBeGreaterThan(0);
    expect(errorsLow.some((e) => e.property === 'year')).toBe(true);

    const dtoHigh = plainToInstance(ListPendingApprovalsQueryDto, {
      year: 2101,
    });
    const errorsHigh = await validate(dtoHigh);
    expect(errorsHigh.length).toBeGreaterThan(0);
    expect(errorsHigh.some((e) => e.property === 'year')).toBe(true);
  });
});
