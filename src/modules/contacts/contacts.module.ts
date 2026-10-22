import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contact, ContactSchema } from './schemas/contact.schema';
import {
  CrmActivity,
  CrmActivitySchema,
} from '../../common/schemas/crm-activity.schema';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactRepository } from './repositories/contact.repository';
import { CrmActivityRepository } from '../../common/repositories/crm-activity.repository';
import { UsersModule } from '../users/users.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { StorageModule } from '../storage/storage.module';
import { RedisModule } from '../../common/redis/redis.module';
import { CompaniesModule } from '../companies/companies.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: CrmActivity.name, schema: CrmActivitySchema },
    ]),
    UsersModule,
    RolesModule,
    AuditLogsModule,
    StorageModule,
    RedisModule,
    forwardRef(() => CompaniesModule),
  ],
  controllers: [ContactsController],
  providers: [ContactsService, ContactRepository, CrmActivityRepository],
  exports: [ContactsService, ContactRepository],
})
export class ContactsModule {}
