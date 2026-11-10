import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Company, CompanySchema } from './schemas/company.schema';
import {
  CrmActivity,
  CrmActivitySchema,
} from '../../common/schemas/crm-activity.schema';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyRepository } from './repositories/company.repository';
import { CrmActivityRepository } from '../../common/repositories/crm-activity.repository';
import { UsersModule } from '../users/users.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { StorageModule } from '../storage/storage.module';
import { RedisModule } from '../../common/redis/redis.module';
import { ContactsModule } from '../contacts/contacts.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Company.name, schema: CompanySchema },
      { name: CrmActivity.name, schema: CrmActivitySchema },
    ]),
    UsersModule,
    RolesModule,
    AuditLogsModule,
    StorageModule,
    RedisModule,
    forwardRef(() => ContactsModule),
  ],
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyRepository, CrmActivityRepository],
  exports: [CompaniesService, CompanyRepository, CrmActivityRepository],
})
export class CompaniesModule {}
