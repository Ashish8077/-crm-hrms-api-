import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthorizationModule } from '../authorization/authorization.module';
import { EmployeesModule } from '../employees/employees.module';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import {
  PayrollRecord,
  PayrollRecordSchema,
} from '../payroll-calculations/schemas/payroll-record.schema';
import {
  PayrollPeriod,
  PayrollPeriodSchema,
} from '../payroll-periods/schemas/payroll-period.schema';
import { Payslip, PayslipSchema } from '../payslips/schemas/payslip.schema';
import { PayrollHistoryController } from './controllers/payroll-history.controller';
import { PayrollReportsController } from './controllers/payroll-reports.controller';
import { PayrollReportingRepository } from './repositories/payroll-reporting.repository';
import { PayrollHistoryService } from './services/payroll-history.service';
import { PayrollReportsService } from './services/payroll-reports.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PayrollPeriod.name, schema: PayrollPeriodSchema },
      { name: PayrollRecord.name, schema: PayrollRecordSchema },
      { name: Payslip.name, schema: PayslipSchema },
      { name: Employee.name, schema: EmployeeSchema },
    ]),
    AuthorizationModule,
    EmployeesModule,
  ],
  controllers: [PayrollHistoryController, PayrollReportsController],
  providers: [
    PayrollReportingRepository,
    PayrollHistoryService,
    PayrollReportsService,
  ],
  exports: [
    PayrollReportingRepository,
    PayrollHistoryService,
    PayrollReportsService,
  ],
})
export class PayrollReportingModule {}
