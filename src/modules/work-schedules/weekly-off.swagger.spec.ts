import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WeeklyOffController } from './weekly-off.controller';
import { WeeklyOffService } from './services/weekly-off.service';

describe('Weekly Off - Swagger / OpenAPI Registration Spec', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [WeeklyOffController],
      providers: [{ provide: WeeklyOffService, useValue: {} }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should register Weekly Offs tag and all endpoints in OpenAPI document', () => {
    const config = new DocumentBuilder()
      .setTitle('CRM + HRMS API')
      .addTag('Work Schedules & Policies')
      .addTag('Weekly Offs')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // Endpoints under /api/v1/work-schedules/weekly-offs
    expect(document.paths['/api/v1/work-schedules/weekly-offs']).toBeDefined();
    expect(
      document.paths['/api/v1/work-schedules/weekly-offs'].post,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/work-schedules/weekly-offs'].get,
    ).toBeDefined();

    expect(
      document.paths['/api/v1/work-schedules/weekly-offs/effective'],
    ).toBeDefined();
    expect(
      document.paths['/api/v1/work-schedules/weekly-offs/effective'].get,
    ).toBeDefined();

    expect(
      document.paths['/api/v1/work-schedules/weekly-offs/{id}'],
    ).toBeDefined();
    expect(
      document.paths['/api/v1/work-schedules/weekly-offs/{id}'].get,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/work-schedules/weekly-offs/{id}'].patch,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/work-schedules/weekly-offs/{id}'].delete,
    ).toBeDefined();

    expect(
      document.paths['/api/v1/work-schedules/weekly-offs/{id}/status'],
    ).toBeDefined();
    expect(
      document.paths['/api/v1/work-schedules/weekly-offs/{id}/status'].patch,
    ).toBeDefined();

    // Verify tags include 'Work Schedules & Policies' or 'Weekly Offs'
    expect(
      document.paths['/api/v1/work-schedules/weekly-offs']?.post?.tags,
    ).toContain('Weekly Offs');
  });
});
