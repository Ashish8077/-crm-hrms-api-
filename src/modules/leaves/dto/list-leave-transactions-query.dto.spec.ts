import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListLeaveTransactionsQueryDto } from './list-leave-transactions-query.dto';
import { LeaveTransactionType } from '../constants/leaves.constant';

describe('ListLeaveTransactionsQueryDto', () => {
  it('should pass validation when query is empty (defaults used)', async () => {
    const dto = plainToInstance(ListLeaveTransactionsQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass validation with valid pagination and filters', async () => {
    const dto = plainToInstance(ListLeaveTransactionsQueryDto, {
      page: 2,
      limit: 10,
      leaveTypeId: '6650b2f8a123456789abcdef',
      year: 2026,
      transactionType: LeaveTransactionType.ALLOCATION,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
    expect(dto.year).toBe(2026);
    expect(dto.transactionType).toBe(LeaveTransactionType.ALLOCATION);
  });

  it('should fail validation when leaveTypeId is not a valid Mongo ObjectId', async () => {
    const dto = plainToInstance(ListLeaveTransactionsQueryDto, {
      leaveTypeId: 'invalid-id-123',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('leaveTypeId');
  });

  it('should fail validation when year is before 2000 or after 2100', async () => {
    const dtoLow = plainToInstance(ListLeaveTransactionsQueryDto, {
      year: 1999,
    });
    const errorsLow = await validate(dtoLow);
    expect(errorsLow.length).toBeGreaterThan(0);
    expect(errorsLow[0].property).toBe('year');

    const dtoHigh = plainToInstance(ListLeaveTransactionsQueryDto, {
      year: 2101,
    });
    const errorsHigh = await validate(dtoHigh);
    expect(errorsHigh.length).toBeGreaterThan(0);
    expect(errorsHigh[0].property).toBe('year');
  });

  it('should fail validation when transactionType is not a valid enum value', async () => {
    const dto = plainToInstance(ListLeaveTransactionsQueryDto, {
      transactionType: 'UNKNOWN_TYPE',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('transactionType');
  });

  it('should fail validation when page or limit is less than 1', async () => {
    const dto = plainToInstance(ListLeaveTransactionsQueryDto, {
      page: 0,
      limit: -5,
    });
    const errors = await validate(dto);
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('page');
    expect(properties).toContain('limit');
  });
});
