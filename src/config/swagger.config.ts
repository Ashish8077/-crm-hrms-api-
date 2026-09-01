import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('CRM + HRMS API')
    .setDescription('Production API documentation for the CRM + HRMS platform.')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT access token',
      },
      'access-token',
    )
    .addTag('Authentication', 'Authentication and session management')
    .addTag('Users', 'User management')
    .addTag('Roles & Permissions', 'RBAC management')
    .addTag('Organization', 'Departments, teams and organization')
    .addTag('HR - Employees', 'Employee management')
    .addTag('HR - Attendance', 'Attendance management')
    .addTag('HR - Leave', 'Leave management')
    .addTag('HR - Performance', 'Performance management')
    .addTag('HR - Expenses', 'Expense management')
    .addTag('HR - Payroll', 'Payroll management')
    .addTag('HR - Recruitment', 'Recruitment / ATS')
    .addTag('HR - Assets', 'Asset management')
    .addTag('HR - Helpdesk', 'HR helpdesk')
    .addTag('HR - Training', 'Learning and training')
    .addTag('CRM - Leads', 'Lead management')
    .addTag('CRM - Deals', 'Deal and pipeline management')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, documentFactory, {
    customSiteTitle: 'CRM + HRMS API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    jsonDocumentUrl: 'docs/json',
  });
}
