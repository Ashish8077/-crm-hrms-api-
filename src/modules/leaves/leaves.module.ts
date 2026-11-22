import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaveType, LeaveTypeSchema } from './schemas/leave-type.schema';
import { Holiday, HolidaySchema } from './schemas/holiday.schema';
import {
  LeaveBalance,
  LeaveBalanceSchema,
} from './schemas/leave-balance.schema';
import {
  LeaveRequest,
  LeaveRequestSchema,
} from './schemas/leave-request.schema';
import {
  LeaveTransaction,
  LeaveTransactionSchema,
} from './schemas/leave-transaction.schema';
import {
  CompOffRecord,
  CompOffRecordSchema,
} from './schemas/comp-off-record.schema';

import { LeaveTypeRepository } from './repositories/leave-type.repository';
import { HolidayRepository } from './repositories/holiday.repository';
import { LeaveBalanceRepository } from './repositories/leave-balance.repository';
import { LeaveRequestRepository } from './repositories/leave-request.repository';
import { LeaveTransactionRepository } from './repositories/leave-transaction.repository';
import { CompOffRepository } from './repositories/comp-off-record.repository';

import { LeavesService } from './services/leaves.service';
import { CompOffService } from './services/comp-off.service';

import { LeavesController } from './leaves.controller';
import { CompOffController } from './comp-off.controller';

import { EmployeesModule } from '../employees/employees.module';
import { BranchesModule } from '../branches/branches.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { WorkSchedulesModule } from '../work-schedules/work-schedules.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeaveType.name, schema: LeaveTypeSchema },
      { name: Holiday.name, schema: HolidaySchema },
      { name: LeaveBalance.name, schema: LeaveBalanceSchema },
      { name: LeaveRequest.name, schema: LeaveRequestSchema },
      { name: LeaveTransaction.name, schema: LeaveTransactionSchema },
      { name: CompOffRecord.name, schema: CompOffRecordSchema },
    ]),
    EmployeesModule,
    BranchesModule,
    AttendanceModule,
    WorkSchedulesModule,
    AuditLogsModule,
    AuthorizationModule,
  ],
  controllers: [LeavesController, CompOffController],
  providers: [
    LeaveTypeRepository,
    HolidayRepository,
    LeaveBalanceRepository,
    LeaveRequestRepository,
    LeaveTransactionRepository,
    CompOffRepository,
    LeavesService,
    CompOffService,
  ],
  exports: [
    LeavesService,
    CompOffService,
    LeaveTypeRepository,
    HolidayRepository,
    LeaveBalanceRepository,
    LeaveRequestRepository,
    LeaveTransactionRepository,
    CompOffRepository,
  ],
})
export class LeavesModule {}
