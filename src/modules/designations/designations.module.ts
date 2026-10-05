import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DesignationsService } from './designations.service';
import { DesignationsController } from './designations.controller';
import { Designation, DesignationSchema } from './schemas/designation.schema';
import { DesignationRepository } from './repositories/designation.repository';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Designation.name, schema: DesignationSchema },
    ]),
    AuditLogsModule,
  ],
  controllers: [DesignationsController],
  providers: [DesignationsService, DesignationRepository],
  exports: [DesignationsService, DesignationRepository],
})
export class DesignationsModule {}
