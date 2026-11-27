import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BranchesModule } from '../branches/branches.module';
import { DepartmentsModule } from '../departments/departments.module';
import { DesignationsModule } from '../designations/designations.module';
import { EmployeesModule } from '../employees/employees.module';
import { PayrollCalculationsModule } from '../payroll-calculations/payroll-calculations.module';
import { PayrollPeriodsModule } from '../payroll-periods/payroll-periods.module';
import { PayslipsController } from './payslips.controller';
import { PayslipRepository } from './repositories/payslip.repository';
import { Payslip, PayslipSchema } from './schemas/payslip.schema';
import { PayslipPdfRendererService } from './services/payslip-pdf-renderer.service';
import { PayslipsService } from './services/payslips.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payslip.name, schema: PayslipSchema }]),
    PayrollPeriodsModule,
    PayrollCalculationsModule,
    EmployeesModule,
    DepartmentsModule,
    DesignationsModule,
    BranchesModule,
    AuditLogsModule,
    AuthorizationModule,
  ],
  controllers: [PayslipsController],
  providers: [PayslipRepository, PayslipPdfRendererService, PayslipsService],
  exports: [PayslipRepository, PayslipsService],
})
export class PayslipsModule {}
