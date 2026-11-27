import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PayrollPeriod,
  PayrollPeriodSchema,
} from './schemas/payroll-period.schema';
import { PayrollPeriodRepository } from './repositories/payroll-period.repository';
import { PayrollPeriodsService } from './services/payroll-periods.service';
import { PayrollAttendanceSummaryService } from './services/payroll-attendance-summary.service';
import { PayrollLeaveAttendanceResolverService } from './services/payroll-leave-attendance-resolver.service';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollConfigurationModule } from '../payroll-configuration/payroll-configuration.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { EmployeesModule } from '../employees/employees.module';
import { BranchesModule } from '../branches/branches.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeavesModule } from '../leaves/leaves.module';
import { WorkSchedulesModule } from '../work-schedules/work-schedules.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PayrollPeriod.name, schema: PayrollPeriodSchema },
    ]),
    PayrollConfigurationModule,
    AuditLogsModule,
    AuthorizationModule,
    EmployeesModule,
    BranchesModule,
    AttendanceModule,
    LeavesModule,
    WorkSchedulesModule,
  ],
  controllers: [PayrollPeriodsController],
  providers: [
    PayrollPeriodRepository,
    PayrollPeriodsService,
    PayrollAttendanceSummaryService,
    PayrollLeaveAttendanceResolverService,
  ],
  exports: [
    PayrollPeriodRepository,
    PayrollPeriodsService,
    PayrollAttendanceSummaryService,
    PayrollLeaveAttendanceResolverService,
  ],
})
export class PayrollPeriodsModule {}
