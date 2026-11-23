import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Attendance, AttendanceSchema } from './schemas/attendance.schema';
import { Shift, ShiftSchema } from './schemas/shift.schema';
import {
  AttendanceRegularization,
  AttendanceRegularizationSchema,
} from './schemas/attendance-regularization.schema';
import { AttendanceController } from './attendance.controller';
import { ShiftController } from './shift.controller';
import { AttendanceService } from './services/attendance.service';
import { ShiftService } from './services/shift.service';
import { AttendanceFinalizationService } from './services/attendance-finalization.service';
import { AttendanceFinalizationScheduler } from './schedulers/attendance-finalization.scheduler';
import { AttendanceRepository } from './repositories/attendance.repository';
import { ShiftRepository } from './repositories/shift.repository';
import { AttendanceRegularizationRepository } from './repositories/attendance-regularization.repository';
import { EmployeesModule } from '../employees/employees.module';
import { BranchesModule } from '../branches/branches.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { WorkSchedulesModule } from '../work-schedules/work-schedules.module';
import { LeavesModule } from '../leaves/leaves.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attendance.name, schema: AttendanceSchema },
      { name: Shift.name, schema: ShiftSchema },
      {
        name: AttendanceRegularization.name,
        schema: AttendanceRegularizationSchema,
      },
    ]),
    EmployeesModule,
    BranchesModule,
    AuditLogsModule,
    AuthorizationModule,
    WorkSchedulesModule,
    forwardRef(() => LeavesModule),
  ],
  controllers: [AttendanceController, ShiftController],
  providers: [
    AttendanceService,
    ShiftService,
    AttendanceFinalizationService,
    AttendanceFinalizationScheduler,
    AttendanceRepository,
    ShiftRepository,
    AttendanceRegularizationRepository,
  ],
  exports: [
    AttendanceService,
    ShiftService,
    AttendanceFinalizationService,
    AttendanceFinalizationScheduler,
    AttendanceRepository,
    ShiftRepository,
    AttendanceRegularizationRepository,
    WorkSchedulesModule,
  ],
})
export class AttendanceModule {}
