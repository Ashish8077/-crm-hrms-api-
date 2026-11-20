import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { AuditLogRepository } from './repositories/audit-log.repository';
import { AuditLogsService } from './audit-logs.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [AuditLogRepository, AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
