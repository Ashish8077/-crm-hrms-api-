import { validate } from 'class-validator';
import { ListUsersQueryDto } from './list-users-query.dto';
import { UserStatus } from '../constants/user-status.constant';
import { Types } from 'mongoose';

describe('ListUsersQueryDto', () => {
  it('should validate with valid data', async () => {
    const dto = new ListUsersQueryDto();
    dto.page = 1;
    dto.limit = 10;
    dto.search = 'test';
    dto.status = UserStatus.ACTIVE;
    dto.roleId = new Types.ObjectId().toString();

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should allow empty filters', async () => {
    const dto = new ListUsersQueryDto();
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail with invalid status', async () => {
    const dto = new ListUsersQueryDto();
    dto.status = 'UNKNOWN_STATUS' as UserStatus;
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('status');
  });

  it('should fail with invalid roleId (not a mongo ID)', async () => {
    const dto = new ListUsersQueryDto();
    dto.roleId = 'invalid-role-id';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('roleId');
  });
});
