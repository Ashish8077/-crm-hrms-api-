import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Deal, DealSchema } from './schemas/deal.schema';
import {
  CrmActivity,
  CrmActivitySchema,
} from '../../common/schemas/crm-activity.schema';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { DealRepository } from './repositories/deal.repository';
import { CrmActivityRepository } from '../../common/repositories/crm-activity.repository';
import { UsersModule } from '../users/users.module';
import { RolesModule } from '../roles/roles.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompaniesModule } from '../companies/companies.module';
import { ContactsModule } from '../contacts/contacts.module';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: CrmActivity.name, schema: CrmActivitySchema },
    ]),
    UsersModule,
    RolesModule,
    AuditLogsModule,
    CompaniesModule,
    ContactsModule,
    RedisModule,
  ],
  controllers: [DealsController],
  providers: [DealsService, DealRepository, CrmActivityRepository],
  exports: [DealsService, DealRepository],
})
export class DealsModule {}
