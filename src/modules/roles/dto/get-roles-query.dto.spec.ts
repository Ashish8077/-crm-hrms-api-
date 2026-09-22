import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetRolesQueryDto } from './get-roles-query.dto';

describe('GetRolesQueryDto', () => {
  it('should validate default valid cases', async () => {
    const dto = plainToInstance(GetRolesQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('should transform "true" and "false" correctly', async () => {
    const dto = plainToInstance(GetRolesQueryDto, {
      isActive: 'true',
      isSystemRole: 'false',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.isActive).toBe(true);
    expect(dto.isSystemRole).toBe(false);
  });

  it('should fail on invalid boolean strings', async () => {
    const dto = plainToInstance(GetRolesQueryDto, { isActive: 'abc' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('isActive');
  });

  it('should fail on invalid limit', async () => {
    const dto = plainToInstance(GetRolesQueryDto, { limit: 101 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });
});
