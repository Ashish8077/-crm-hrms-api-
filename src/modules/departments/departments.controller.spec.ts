import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { Types } from 'mongoose';
import { ListDepartmentsQueryDto } from './dto/list-departments-query.dto';

describe('DepartmentsController', () => {
  let controller: DepartmentsController;

  const mockDepartmentsService = {
    list: jest.fn(),
    getById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepartmentsController],
      providers: [
        {
          provide: DepartmentsService,
          useValue: mockDepartmentsService,
        },
      ],
    }).compile();

    controller = module.get<DepartmentsController>(DepartmentsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /departments', () => {
    it('should call service list with query', async () => {
      const query: ListDepartmentsQueryDto = {
        page: 1,
        limit: 10,
        search: 'Eng',
        isActive: true,
      };

      const result = {
        data: [{ name: 'Engineering' }],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };

      mockDepartmentsService.list.mockResolvedValue(result);

      const response = await controller.list(query);

      expect(mockDepartmentsService.list).toHaveBeenCalledWith(query);
      expect(response).toEqual({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    });
  });

  describe('GET /departments/:id', () => {
    it('should call service getById with objectId', async () => {
      const id = new Types.ObjectId();
      const department = { _id: id, name: 'Engineering' };

      mockDepartmentsService.getById.mockResolvedValue(department);

      const response = await controller.getById(id);

      expect(mockDepartmentsService.getById).toHaveBeenCalledWith(id);
      expect(response).toEqual({
        success: true,
        data: department,
      });
    });
  });
});
