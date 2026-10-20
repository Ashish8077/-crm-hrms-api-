import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Attendance, AttendanceSchema } from './schemas/attendance.schema';
import { Shift, ShiftSchema } from './schemas/shift.schema';
import {
  AttendanceRegularization,
  AttendanceRegularizationSchema,
} from './schemas/attendance-regularization.schema';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './services/attendance.service';
import { ShiftService } from './services/shift.service';
import { AttendanceRepository } from './repositories/attendance.repository';
import { ShiftRepository } from './repositories/shift.repository';
import { AttendanceRegularizationRepository } from './repositories/attendance-regularization.repository';
import { EmployeesModule } from '../employees/employees.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthorizationModule } from '../authorization/authorization.module';

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
    AuditLogsModule,
    AuthorizationModule,
  ],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    ShiftService,
    AttendanceRepository,
    ShiftRepository,
    AttendanceRegularizationRepository,
  ],
  exports: [
    AttendanceService,
    ShiftService,
    AttendanceRepository,
    ShiftRepository,
    AttendanceRegularizationRepository,
  ],
})
export class AttendanceModule {}
