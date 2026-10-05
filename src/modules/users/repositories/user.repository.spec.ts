import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UserRepository } from './user.repository';
import { User } from '../schemas/user.schema';
import { Types } from 'mongoose';
import { UserStatus } from '../constants/user-status.constant';

describe('UserRepository - findList', () => {
  let repository: UserRepository;
  let mockUserModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockUserModel = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ email: 'test@example.com' }]),
      countDocuments: jest.fn().mockReturnThis(),
    };

    // For countDocuments().exec() we need special handling
    mockUserModel.countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
      ],
    }).compile();

    repository = module.get<UserRepository>(UserRepository);
  });

  it('should query without optional filters', async () => {
    await repository.findList({});

    expect(mockUserModel.find).toHaveBeenCalledWith({
      deletedAt: null,
    });
    expect(mockUserModel.countDocuments).toHaveBeenCalledWith({
      deletedAt: null,
    });

    // Check pagination defaults
    expect(mockUserModel.skip).toHaveBeenCalledWith(0);
    expect(mockUserModel.limit).toHaveBeenCalledWith(20);
  });

  it('should query with search (email)', async () => {
    await repository.findList({ search: 'test@' });

    expect(mockUserModel.find).toHaveBeenCalledWith({
      deletedAt: null,
      email: { $regex: 'test@', $options: 'i' },
    });
  });

  it('should query with status', async () => {
    await repository.findList({ status: UserStatus.INACTIVE });

    expect(mockUserModel.find).toHaveBeenCalledWith({
      deletedAt: null,
      status: UserStatus.INACTIVE,
    });
  });

  it('should query with roleId', async () => {
    const roleId = new Types.ObjectId().toString();
    await repository.findList({ roleId });

    expect(mockUserModel.find).toHaveBeenCalledWith({
      deletedAt: null,
      roleIds: new Types.ObjectId(roleId),
    });
  });

  it('should query with combined filters and custom pagination', async () => {
    const roleId = new Types.ObjectId().toString();
    await repository.findList({
      page: 2,
      limit: 10,
      search: 'bob',
      status: UserStatus.LOCKED,
      roleId,
    });

    expect(mockUserModel.find).toHaveBeenCalledWith({
      deletedAt: null,
      email: { $regex: 'bob', $options: 'i' },
      status: UserStatus.LOCKED,
      roleIds: new Types.ObjectId(roleId),
    });

    expect(mockUserModel.skip).toHaveBeenCalledWith(10);
    expect(mockUserModel.limit).toHaveBeenCalledWith(10);
  });
});
