import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WeeklyOffConfig,
  WeeklyOffConfigSchema,
} from './schemas/weekly-off-config.schema';
import { WeeklyOffController } from './weekly-off.controller';
import { WeeklyOffService } from './services/weekly-off.service';
import { WeeklyOffConfigRepository } from './repositories/weekly-off-config.repository';
import { BranchesModule } from '../branches/branches.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: WeeklyOffConfig.name,
        schema: WeeklyOffConfigSchema,
      },
    ]),
    BranchesModule,
    AuditLogsModule,
    AuthorizationModule,
  ],
  controllers: [WeeklyOffController],
  providers: [WeeklyOffService, WeeklyOffConfigRepository],
  exports: [WeeklyOffService, WeeklyOffConfigRepository, MongooseModule],
})
export class WorkSchedulesModule {}
