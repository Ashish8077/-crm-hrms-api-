import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from './schemas/task.schema';
import {
  CrmActivity,
  CrmActivitySchema,
} from '../../common/schemas/crm-activity.schema';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskRepository } from './repositories/task.repository';
import { CrmActivityRepository } from '../../common/repositories/crm-activity.repository';
import { UsersModule } from '../users/users.module';
import { RolesModule } from '../roles/roles.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmployeesModule } from '../employees/employees.module';
import { LeadsModule } from '../leads/leads.module';
import { ContactsModule } from '../contacts/contacts.module';
import { CompaniesModule } from '../companies/companies.module';
import { DealsModule } from '../deals/deals.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: CrmActivity.name, schema: CrmActivitySchema },
    ]),
    UsersModule,
    RolesModule,
    AuditLogsModule,
    EmployeesModule,
    LeadsModule,
    ContactsModule,
    CompaniesModule,
    DealsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskRepository, CrmActivityRepository],
  exports: [TasksService, TaskRepository],
})
export class TasksModule {}
