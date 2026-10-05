import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTeamsQueryDto } from './list-teams-query.dto';
import { Types } from 'mongoose';

describe('ListTeamsQueryDto', () => {
  it('should validate default valid cases', async () => {
    const dto = plainToInstance(ListTeamsQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('should transform "true" correctly for isActive', async () => {
    const dto = plainToInstance(ListTeamsQueryDto, {
      isActive: 'true',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.isActive).toBe(true);
  });

  it('should fail on invalid boolean strings', async () => {
    const dto = plainToInstance(ListTeamsQueryDto, { isActive: 'abc' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('isActive');
  });

  it('should fail on invalid limit', async () => {
    const dto = plainToInstance(ListTeamsQueryDto, { limit: 101 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should accept search string', async () => {
    const dto = plainToInstance(ListTeamsQueryDto, { search: 'Development' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.search).toBe('Development');
  });

  it('should validate departmentId as MongoId', async () => {
    const validId = new Types.ObjectId().toString();
    const dto = plainToInstance(ListTeamsQueryDto, { departmentId: validId });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail on invalid departmentId', async () => {
    const dto = plainToInstance(ListTeamsQueryDto, {
      departmentId: 'invalid-id',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('departmentId');
  });
});
