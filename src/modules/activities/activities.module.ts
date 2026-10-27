import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CrmActivity,
  CrmActivitySchema,
} from '../../common/schemas/crm-activity.schema';
import { CrmActivityRepository } from '../../common/repositories/crm-activity.repository';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompaniesModule } from '../companies/companies.module';
import { ContactsModule } from '../contacts/contacts.module';
import { DealsModule } from '../deals/deals.module';
import { EmployeesModule } from '../employees/employees.module';
import { LeadsModule } from '../leads/leads.module';
import { RolesModule } from '../roles/roles.module';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrmActivity.name, schema: CrmActivitySchema },
    ]),
    TasksModule,
    UsersModule,
    RolesModule,
    EmployeesModule,
    AuditLogsModule,
    LeadsModule,
    ContactsModule,
    CompaniesModule,
    DealsModule,
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesService, CrmActivityRepository],
  exports: [ActivitiesService, CrmActivityRepository],
})
export class ActivitiesModule {}
