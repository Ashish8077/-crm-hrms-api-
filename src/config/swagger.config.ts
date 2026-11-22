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
    .addTag('Employees', 'Employee management and user linkages')
    .addTag('Departments', 'Department configuration')
    .addTag('Designations', 'Designation configuration')
    .addTag('Branches', 'Branch location configuration')
    .addTag(
      'Attendance',
      'Attendance tracking, break sessions, monthly calendar, and regularization',
    )
    .addTag('Shifts', 'Work shifts configuration and employee shift assignment')
    .addTag(
      'Work Schedules & Policies',
      'Organizational work schedule policies and weekly off configurations (company-wide & branch-level rules)',
    )
    .addTag(
      'Weekly Offs',
      'Weekly off configuration (company-wide defaults & branch-level rules)',
    )
    .addTag(
      'Leaves',
      'Leave policy, types, allocations, adjustments, requests, dynamic manager approvals, calendar visualization, and year-end carry forward',
    )
    .addTag(
      'Compensatory Off',
      'Compensatory off claims for weekend/holiday overtime work and manager review workflow',
    )
    .addTag('HR - Performance', 'Performance management')
    .addTag('HR - Expenses', 'Expense management')
    .addTag('HR - Payroll', 'Payroll management')
    .addTag('HR - Recruitment', 'Recruitment / ATS')
    .addTag('HR - Assets', 'Asset management')
    .addTag('HR - Helpdesk', 'HR helpdesk')
    .addTag('HR - Training', 'Learning and training')
    .addTag('CRM - Leads', 'Lead management')
    .addTag('CRM - Companies', 'Company records and corporate accounts')
    .addTag('CRM - Contacts', 'Individual contacts and customer relationships')
    .addTag('CRM - Deals', 'Deal and pipeline management')
    .addTag('CRM - Tasks', 'Task and to-do item management')
    .addTag('CRM - Activities', 'Activity logging, timeline and scheduling')
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
      // withCredentials: true,
    },
    jsonDocumentUrl: 'docs/json',
  });
}
