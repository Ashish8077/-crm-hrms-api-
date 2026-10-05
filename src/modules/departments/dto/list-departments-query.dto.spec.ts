import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListDepartmentsQueryDto } from './list-departments-query.dto';

describe('ListDepartmentsQueryDto', () => {
  it('should validate default valid cases', async () => {
    const dto = plainToInstance(ListDepartmentsQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('should transform "true" correctly for isActive', async () => {
    const dto = plainToInstance(ListDepartmentsQueryDto, {
      isActive: 'true',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.isActive).toBe(true);
  });

  it('should fail on invalid boolean strings', async () => {
    const dto = plainToInstance(ListDepartmentsQueryDto, { isActive: 'abc' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('isActive');
  });

  it('should fail on invalid limit (greater than 100)', async () => {
    const dto = plainToInstance(ListDepartmentsQueryDto, { limit: 101 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should accept search string', async () => {
    const dto = plainToInstance(ListDepartmentsQueryDto, {
      search: 'Engineering',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.search).toBe('Engineering');
  });
});
