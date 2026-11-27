import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PayrollRecord,
  PayrollRecordSchema,
} from './schemas/payroll-record.schema';
import {
  PayrollProcessingFailure,
  PayrollProcessingFailureSchema,
} from './schemas/payroll-processing-failure.schema';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import {
  SalaryComponent,
  SalaryComponentSchema,
} from '../salary-components/schemas/salary-component.schema';
import { PayrollPeriodsModule } from '../payroll-periods/payroll-periods.module';
import { EmployeeSalariesModule } from '../employee-salaries/employee-salaries.module';
import { SalaryStructuresModule } from '../salary-structures/salary-structures.module';
import { PayrollConfigurationModule } from '../payroll-configuration/payroll-configuration.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PayrollRecordRepository } from './repositories/payroll-record.repository';
import { PayrollProcessingFailureRepository } from './repositories/payroll-processing-failure.repository';
import { PayrollInputResolver } from './services/payroll-input.resolver';
import { SalaryComponentResolver } from './services/salary-component.resolver';
import { ComponentDependencyResolver } from './services/component-dependency.resolver';
import { ComponentCalculationEngine } from './services/component-calculation.engine';
import { ProrationCalculator } from './services/proration.calculator';
import { PayrollTotalsCalculator } from './services/payroll-totals.calculator';
import { PayrollSnapshotBuilder } from './services/payroll-snapshot.builder';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { PayrollProcessingService } from './services/payroll-processing.service';
import { PayrollReviewService } from './services/payroll-review.service';
import { PayrollCalculationsController } from './payroll-calculations.controller';
import { PayrollPeriodProcessingController } from './controllers/payroll-period-processing.controller';
import { PayrollPeriodReviewController } from './controllers/payroll-period-review.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PayrollRecord.name, schema: PayrollRecordSchema },
      {
        name: PayrollProcessingFailure.name,
        schema: PayrollProcessingFailureSchema,
      },
      { name: Employee.name, schema: EmployeeSchema },
      { name: SalaryComponent.name, schema: SalaryComponentSchema },
    ]),
    forwardRef(() => PayrollPeriodsModule),
    EmployeeSalariesModule,
    SalaryStructuresModule,
    PayrollConfigurationModule,
    AuditLogsModule,
    AuthorizationModule,
  ],
  controllers: [
    PayrollCalculationsController,
    PayrollPeriodProcessingController,
    PayrollPeriodReviewController,
  ],
  providers: [
    PayrollRecordRepository,
    PayrollProcessingFailureRepository,
    PayrollInputResolver,
    SalaryComponentResolver,
    ComponentDependencyResolver,
    ComponentCalculationEngine,
    ProrationCalculator,
    PayrollTotalsCalculator,
    PayrollSnapshotBuilder,
    PayrollCalculationService,
    PayrollProcessingService,
    PayrollReviewService,
  ],
  exports: [
    PayrollRecordRepository,
    PayrollProcessingFailureRepository,
    PayrollCalculationService,
    PayrollProcessingService,
    PayrollReviewService,
  ],
})
export class PayrollCalculationsModule {}
