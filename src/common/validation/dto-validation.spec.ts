import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateUserDto } from '../../modules/users/dto/create-user.dto';
import { UpdateUserDto } from '../../modules/users/dto/update-user.dto';
import { UpdateRoleDto } from '../../modules/roles/dto/update-role.dto';
import { CreateDepartmentDto } from '../../modules/departments/dto/create-department.dto';
import { CreateTeamDto } from '../../modules/teams/dto/create-team.dto';

describe('DTO Validation Audit Fixes', () => {
  it('should trim valid email with spaces in CreateUserDto', async () => {
    const dto = plainToInstance(CreateUserDto, {
      email: '  test@example.com  ',
      password: 'StrongPassword1!',
    });
    await validate(dto);
    expect(dto.email).toBe('test@example.com');
  });

  it('should reject whitespace-only email in UpdateUserDto', async () => {
    const dto = plainToInstance(UpdateUserDto, { email: '   ' });
    const errors = await validate(dto);
    const emailError = errors.find((e) => e.property === 'email');
    expect(emailError).toBeDefined();
    expect(dto.email).toBe('');
  });

  it('should reject whitespace-only name in UpdateRoleDto', async () => {
    const dto = plainToInstance(UpdateRoleDto, { name: '   ' });
    const errors = await validate(dto);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    // Since it's trimmed to '', it fails @IsNotEmpty()
    expect(dto.name).toBe('');
  });

  it('should reject whitespace-only name in CreateDepartmentDto', async () => {
    const dto = plainToInstance(CreateDepartmentDto, { name: '   ' });
    const errors = await validate(dto);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
  });

  it('should trim optional description in CreateTeamDto', async () => {
    const dto = plainToInstance(CreateTeamDto, {
      name: 'Team A',
      description: '  optional  ',
      departmentId: '507f1f77bcf86cd799439011',
    });
    await validate(dto);
    expect(dto.description).toBe('optional');
  });

  it('should successfully validate a padded name after trimming in CreateDepartmentDto', async () => {
    const dto = plainToInstance(CreateDepartmentDto, {
      name: '  Engineering  ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.name).toBe('Engineering');
  });
});
