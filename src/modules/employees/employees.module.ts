import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesService } from './employees.service';
import { EmployeeDocumentsService } from './employee-documents.service';
import { EmployeesController } from './employees.controller';
import { EmployeeRepository } from './repositories/employee.repository';
import { EmployeeStatusHistoryRepository } from './repositories/employee-status-history.repository';
import { EmployeeDocumentRepository } from './repositories/employee-document.repository';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import {
  EmployeeStatusHistory,
  EmployeeStatusHistorySchema,
} from './schemas/employee-status-history.schema';
import {
  EmployeeDocument,
  EmployeeDocumentSchema,
} from './schemas/employee-document.schema';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DepartmentsModule } from '../departments/departments.module';
import { DesignationsModule } from '../designations/designations.module';
import { BranchesModule } from '../branches/branches.module';
import { TeamsModule } from '../teams/teams.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: EmployeeStatusHistory.name, schema: EmployeeStatusHistorySchema },
      { name: EmployeeDocument.name, schema: EmployeeDocumentSchema },
    ]),
    AuditLogsModule,
    DepartmentsModule,
    DesignationsModule,
    BranchesModule,
    TeamsModule,
    UsersModule,
  ],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    EmployeeDocumentsService,
    EmployeeRepository,
    EmployeeStatusHistoryRepository,
    EmployeeDocumentRepository,
  ],
  exports: [
    EmployeesService,
    EmployeeDocumentsService,
    EmployeeRepository,
    EmployeeStatusHistoryRepository,
    EmployeeDocumentRepository,
  ],
})
export class EmployeesModule {}
