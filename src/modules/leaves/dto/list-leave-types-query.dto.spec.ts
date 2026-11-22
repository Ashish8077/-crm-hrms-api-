import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListLeaveTypesQueryDto } from './list-leave-types-query.dto';

describe('ListLeaveTypesQueryDto Unit Suite', () => {
  it('should pass validation when query is empty (defaults used)', async () => {
    const dto = plainToInstance(ListLeaveTypesQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.isActive).toBeUndefined();
    expect(dto.isPaid).toBeUndefined();
  });

  it('should pass validation with custom pagination and filters', async () => {
    const dto = plainToInstance(ListLeaveTypesQueryDto, {
      page: 3,
      limit: 15,
      isActive: 'true',
      isPaid: 'false',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(15);
    expect(dto.isActive).toBe(true);
    expect(dto.isPaid).toBe(false);
  });

  it('should parse boolean values correctly when passed as boolean literals', async () => {
    const dto = plainToInstance(ListLeaveTypesQueryDto, {
      isActive: false,
      isPaid: true,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(false);
    expect(dto.isPaid).toBe(true);
  });

  it('should fail validation when page is less than 1', async () => {
    const dto = plainToInstance(ListLeaveTypesQueryDto, {
      page: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  it('should fail validation when limit exceeds 100', async () => {
    const dto = plainToInstance(ListLeaveTypesQueryDto, {
      limit: 101,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('should fail validation when limit is less than 1', async () => {
    const dto = plainToInstance(ListLeaveTypesQueryDto, {
      limit: 0,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });
});
