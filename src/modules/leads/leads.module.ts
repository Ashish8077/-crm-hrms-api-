import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from './schemas/lead.schema';
import { LeadRepository } from './repositories/lead.repository';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { UsersModule } from '../users/users.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Lead.name, schema: LeadSchema }]),
    UsersModule,
    AuditLogsModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService, LeadRepository],
  exports: [LeadsService, LeadRepository],
})
export class LeadsModule {}
