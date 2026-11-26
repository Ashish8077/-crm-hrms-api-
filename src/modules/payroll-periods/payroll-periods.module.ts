import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PayrollPeriod,
  PayrollPeriodSchema,
} from './schemas/payroll-period.schema';
import { PayrollPeriodRepository } from './repositories/payroll-period.repository';
import { PayrollPeriodsService } from './services/payroll-periods.service';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollConfigurationModule } from '../payroll-configuration/payroll-configuration.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PayrollPeriod.name, schema: PayrollPeriodSchema },
    ]),
    PayrollConfigurationModule,
    AuditLogsModule,
    AuthorizationModule,
  ],
  controllers: [PayrollPeriodsController],
  providers: [PayrollPeriodRepository, PayrollPeriodsService],
  exports: [PayrollPeriodRepository, PayrollPeriodsService],
})
export class PayrollPeriodsModule {}
