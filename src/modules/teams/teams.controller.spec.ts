import { Test, TestingModule } from '@nestjs/testing';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { Types } from 'mongoose';
import { ListTeamsQueryDto } from './dto/list-teams-query.dto';

describe('TeamsController', () => {
  let controller: TeamsController;

  const mockTeamsService = {
    list: jest.fn(),
    getById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamsController],
      providers: [
        {
          provide: TeamsService,
          useValue: mockTeamsService,
        },
      ],
    }).compile();

    controller = module.get<TeamsController>(TeamsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /teams', () => {
    it('should call service list with query', async () => {
      const query: ListTeamsQueryDto = {
        page: 1,
        limit: 10,
        search: 'Dev',
        isActive: true,
      };

      const result = {
        data: [{ name: 'Development' }],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };

      mockTeamsService.list.mockResolvedValue(result);

      const response = await controller.list(query);

      expect(mockTeamsService.list).toHaveBeenCalledWith(query);
      expect(response).toEqual({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    });
  });

  describe('GET /teams/:id', () => {
    it('should call service getById with objectId', async () => {
      const id = new Types.ObjectId();
      const team = { _id: id, name: 'Development' };

      mockTeamsService.getById.mockResolvedValue(team);

      const response = await controller.getById(id);

      expect(mockTeamsService.getById).toHaveBeenCalledWith(id);
      expect(response).toEqual({
        success: true,
        data: team,
      });
    });
  });
});
