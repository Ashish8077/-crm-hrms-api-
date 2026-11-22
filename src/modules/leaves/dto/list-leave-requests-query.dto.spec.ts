import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListLeaveRequestsQueryDto } from './list-leave-requests-query.dto';
import { LeaveRequestStatus } from '../constants/leaves.constant';

describe('ListLeaveRequestsQueryDto Unit Suite', () => {
  it('should pass validation when query is empty (defaults used)', async () => {
    const dto = plainToInstance(ListLeaveRequestsQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('should pass validation with all valid query filters and pagination', async () => {
    const dto = plainToInstance(ListLeaveRequestsQueryDto, {
      page: 2,
      limit: 50,
      employeeId: '60d5ecb8b5c9c32b8c8d4e11',
      status: LeaveRequestStatus.APPROVED,
      leaveTypeId: '60d5ecb8b5c9c32b8c8d4e22',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      year: 2026,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(dto.employeeId).toBe('60d5ecb8b5c9c32b8c8d4e11');
    expect(dto.status).toBe(LeaveRequestStatus.APPROVED);
    expect(dto.leaveTypeId).toBe('60d5ecb8b5c9c32b8c8d4e22');
    expect(dto.startDate).toBe('2026-10-01');
    expect(dto.endDate).toBe('2026-10-31');
    expect(dto.year).toBe(2026);
  });

  it('should fail validation when employeeId is not a valid Mongo ObjectId', async () => {
    const dto = plainToInstance(ListLeaveRequestsQueryDto, {
      employeeId: 'invalid-emp-id-123',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'employeeId')).toBe(true);
  });

  it('should fail validation when leaveTypeId is not a valid Mongo ObjectId', async () => {
    const dto = plainToInstance(ListLeaveRequestsQueryDto, {
      leaveTypeId: 'invalid-lt-id-456',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'leaveTypeId')).toBe(true);
  });

  it('should fail validation when status is not a valid LeaveRequestStatus enum', async () => {
    const dto = plainToInstance(ListLeaveRequestsQueryDto, {
      status: 'INVALID_STATUS',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('should fail validation when startDate is not in YYYY-MM-DD format', async () => {
    const invalidDates = [
      '2026/10/01',
      '01-10-2026',
      '2026-1-1',
      'invalid-date',
    ];
    for (const date of invalidDates) {
      const dto = plainToInstance(ListLeaveRequestsQueryDto, {
        startDate: date,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'startDate')).toBe(true);
    }
  });

  it('should fail validation when endDate is not in YYYY-MM-DD format', async () => {
    const invalidDates = ['2026.10.31', '31-10-2026', 'invalid'];
    for (const date of invalidDates) {
      const dto = plainToInstance(ListLeaveRequestsQueryDto, {
        endDate: date,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'endDate')).toBe(true);
    }
  });

  it('should fail validation when startDate is later than endDate', async () => {
    const dto = plainToInstance(ListLeaveRequestsQueryDto, {
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
    const dto = plainToInstance(ListLeaveRequestsQueryDto, {
      startDate: '2026-10-15',
      endDate: '2026-10-15',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass validation when only startDate or only endDate is provided', async () => {
    const dtoStartOnly = plainToInstance(ListLeaveRequestsQueryDto, {
      startDate: '2026-10-01',
    });
    const errorsStart = await validate(dtoStartOnly);
    expect(errorsStart).toHaveLength(0);

    const dtoEndOnly = plainToInstance(ListLeaveRequestsQueryDto, {
      endDate: '2026-10-31',
    });
    const errorsEnd = await validate(dtoEndOnly);
    expect(errorsEnd).toHaveLength(0);
  });

  it('should fail validation when year is outside the 2000-2100 boundary', async () => {
    const dtoLow = plainToInstance(ListLeaveRequestsQueryDto, { year: 1999 });
    const errorsLow = await validate(dtoLow);
    expect(errorsLow.length).toBeGreaterThan(0);
    expect(errorsLow.some((e) => e.property === 'year')).toBe(true);

    const dtoHigh = plainToInstance(ListLeaveRequestsQueryDto, { year: 2101 });
    const errorsHigh = await validate(dtoHigh);
    expect(errorsHigh.length).toBeGreaterThan(0);
    expect(errorsHigh.some((e) => e.property === 'year')).toBe(true);
  });

  it('should fail validation when page is less than 1', async () => {
    const dtoZero = plainToInstance(ListLeaveRequestsQueryDto, { page: 0 });
    const errorsZero = await validate(dtoZero);
    expect(errorsZero.length).toBeGreaterThan(0);
    expect(errorsZero.some((e) => e.property === 'page')).toBe(true);

    const dtoNegative = plainToInstance(ListLeaveRequestsQueryDto, {
      page: -5,
    });
    const errorsNegative = await validate(dtoNegative);
    expect(errorsNegative.length).toBeGreaterThan(0);
    expect(errorsNegative.some((e) => e.property === 'page')).toBe(true);
  });

  it('should fail validation when limit is less than 1 or greater than 100', async () => {
    const dtoZero = plainToInstance(ListLeaveRequestsQueryDto, { limit: 0 });
    const errorsZero = await validate(dtoZero);
    expect(errorsZero.length).toBeGreaterThan(0);
    expect(errorsZero.some((e) => e.property === 'limit')).toBe(true);

    const dtoExcess = plainToInstance(ListLeaveRequestsQueryDto, {
      limit: 101,
    });
    const errorsExcess = await validate(dtoExcess);
    expect(errorsExcess.length).toBeGreaterThan(0);
    expect(errorsExcess.some((e) => e.property === 'limit')).toBe(true);
  });
});
