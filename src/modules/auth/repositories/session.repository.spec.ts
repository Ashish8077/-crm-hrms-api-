/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SessionRepository } from './session.repository.js';
import { Session } from '../schemas/session.schema.js';

describe('SessionRepository', () => {
  let repository: SessionRepository;
  let model: any;

  beforeEach(async () => {
    model = class {
      public data: any;
      public save: any;
      constructor(data: any) {
        this.data = data;
        this.save = jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId(), ...data });
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionRepository,
        {
          provide: getModelToken(Session.name),
          useValue: model,
        },
      ],
    }).compile();

    repository = module.get<SessionRepository>(SessionRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('createSession', () => {
    it('should create and save a new session', async () => {
      const data = {
        userId: new Types.ObjectId(),
        refreshTokenHash: 'hash',
        expiresAt: new Date(),
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      };

      const result = await repository.createSession(data);

      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      expect(result.userId).toEqual(data.userId);
      expect(result.refreshTokenHash).toEqual(data.refreshTokenHash);
      expect(result.expiresAt).toEqual(data.expiresAt);
      expect(result.ipAddress).toEqual(data.ipAddress);
      expect(result.userAgent).toEqual(data.userAgent);
    });
  });
});
