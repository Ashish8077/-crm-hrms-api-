import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from '../../common/redis/redis.module';
import { SalesQuota, SalesQuotaSchema } from './schemas/sales-quota.schema';
import { SalesQuotaRepository } from './repositories/sales-quota.repository';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  CrmActivity,
  CrmActivitySchema,
} from '../../common/schemas/crm-activity.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { Role, RoleSchema } from '../roles/schemas/role.schema';
import {
  Quotation,
  QuotationSchema,
} from '../quotations/schemas/quotation.schema';
import { DataScopeService } from './services/data-scope.service';
import { DashboardCacheService } from './services/dashboard-cache.service';
import { LeadAnalyticsService } from './services/lead-analytics.service';
import { DealAnalyticsService } from './services/deal-analytics.service';
import { ActivityAnalyticsService } from './services/activity-analytics.service';
import { QuotaService } from './services/quota.service';
import { ExportService } from './services/export.service';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SalesQuota.name, schema: SalesQuotaSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Deal.name, schema: DealSchema },
      { name: CrmActivity.name, schema: CrmActivitySchema },
      { name: Task.name, schema: TaskSchema },
      { name: User.name, schema: UserSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Quotation.name, schema: QuotationSchema },
    ]),
    RedisModule,
  ],
  controllers: [DashboardController],
  providers: [
    SalesQuotaRepository,
    DataScopeService,
    DashboardCacheService,
    LeadAnalyticsService,
    DealAnalyticsService,
    ActivityAnalyticsService,
    QuotaService,
    ExportService,
    DashboardService,
  ],
  exports: [DashboardService, DataScopeService],
})
export class DashboardModule {}
