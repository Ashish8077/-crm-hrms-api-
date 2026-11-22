import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LeavesController } from './leaves.controller';
import { CompOffController } from './comp-off.controller';
import { LeavesService } from './services/leaves.service';
import { CompOffService } from './services/comp-off.service';

describe('Leaves & Comp-Off - Swagger / OpenAPI Registration Spec', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [LeavesController, CompOffController],
      providers: [
        { provide: LeavesService, useValue: {} },
        { provide: CompOffService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should register Leaves and Compensatory Off tags and routes in OpenAPI document', () => {
    const config = new DocumentBuilder()
      .setTitle('CRM + HRMS API')
      .addTag('Leaves')
      .addTag('Compensatory Off')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // 1. Leave Types
    expect(document.paths['/leaves/types']).toBeDefined();
    expect(document.paths['/leaves/types/{id}']).toBeDefined();
    expect(document.paths['/leaves/types/{id}/status']).toBeDefined();

    // Verify path parameter {id} is documented as string in URL path (not object body)
    interface OpenApiParam {
      name: string;
      in: string;
      schema?: { type?: string };
    }
    interface OpenApiOperation {
      parameters?: OpenApiParam[];
    }

    const leaveTypePath = document.paths['/leaves/types/{id}'] as
      Record<string, OpenApiOperation> | undefined;
    const getLeaveType = leaveTypePath?.get;
    expect(getLeaveType).toBeDefined();
    const idParam = getLeaveType?.parameters?.find(
      (p) => p.name === 'id' && p.in === 'path',
    );
    expect(idParam).toBeDefined();
    expect(idParam?.schema?.type).toBe('string');

    // 2. Holidays
    expect(document.paths['/leaves/holidays']).toBeDefined();
    expect(document.paths['/leaves/holidays/{id}']).toBeDefined();

    // 3. Balances & Carry Forward
    expect(document.paths['/leaves/balances/me']).toBeDefined();
    expect(document.paths['/leaves/balances/employees/{id}']).toBeDefined();
    expect(document.paths['/leaves/balances/allocate']).toBeDefined();
    expect(document.paths['/leaves/balances/adjust']).toBeDefined();
    expect(document.paths['/leaves/balances/carry-forward']).toBeDefined();
    expect(document.paths['/leaves/balances/me/transactions']).toBeDefined();

    // 4. Requests & Approvals
    expect(document.paths['/leaves/requests']).toBeDefined();
    expect(document.paths['/leaves/requests/me']).toBeDefined();
    expect(document.paths['/leaves/requests/approvals/pending']).toBeDefined();
    expect(document.paths['/leaves/requests/{id}']).toBeDefined();
    expect(document.paths['/leaves/requests/{id}/approve']).toBeDefined();
    expect(document.paths['/leaves/requests/{id}/reject']).toBeDefined();
    expect(document.paths['/leaves/requests/{id}/cancel']).toBeDefined();
    expect(document.paths['/leaves/requests/{id}/reconcile']).toBeDefined();

    // 5. Calendar Visualizations
    expect(document.paths['/leaves/calendar/me']).toBeDefined();
    expect(document.paths['/leaves/calendar/team']).toBeDefined();
    expect(document.paths['/leaves/calendar/organization']).toBeDefined();

    // 6. Compensatory Off Lifecycle
    expect(document.paths['/leaves/comp-off/claim']).toBeDefined();
    expect(document.paths['/leaves/comp-off/me']).toBeDefined();
    expect(document.paths['/leaves/comp-off']).toBeDefined();
    expect(document.paths['/leaves/comp-off/{id}']).toBeDefined();
    expect(document.paths['/leaves/comp-off/{id}/review']).toBeDefined();
  });
});
