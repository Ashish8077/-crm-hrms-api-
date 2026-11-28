import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PayrollSettings,
  PayrollSettingsSchema,
} from './schemas/payroll-settings.schema';
import {
  PayrollCalculationRule,
  PayrollCalculationRuleSchema,
} from './schemas/payroll-calculation-rule.schema';
import {
  SalaryComponent,
  SalaryComponentSchema,
} from '../salary-components/schemas/salary-component.schema';
import {
  SalaryStructure,
  SalaryStructureSchema,
} from '../salary-structures/schemas/salary-structure.schema';
import {
  EmployeeSalary,
  EmployeeSalarySchema,
} from '../employee-salaries/schemas/employee-salary.schema';
import { PayrollSettingsRepository } from './repositories/payroll-settings.repository';
import { PayrollCalculationRuleRepository } from './repositories/payroll-calculation-rule.repository';
import { PayrollSettingsService } from './services/payroll-settings.service';
import { PayrollCalculationRuleService } from './services/payroll-calculation-rule.service';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { PayrollConfigurationController } from './payroll-configuration.controller';
import { SalaryComponentsModule } from '../salary-components/salary-components.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PayrollSettings.name, schema: PayrollSettingsSchema },
      {
        name: PayrollCalculationRule.name,
        schema: PayrollCalculationRuleSchema,
      },
      { name: SalaryComponent.name, schema: SalaryComponentSchema },
      { name: SalaryStructure.name, schema: SalaryStructureSchema },
      { name: EmployeeSalary.name, schema: EmployeeSalarySchema },
    ]),
    SalaryComponentsModule,
    AuditLogsModule,
  ],
  controllers: [PayrollConfigurationController],
  providers: [
    PayrollSettingsRepository,
    PayrollCalculationRuleRepository,
    PayrollSettingsService,
    PayrollCalculationRuleService,
    PayrollCalculationService,
  ],
  exports: [
    PayrollSettingsRepository,
    PayrollCalculationRuleRepository,
    PayrollSettingsService,
    PayrollCalculationRuleService,
    PayrollCalculationService,
  ],
})
export class PayrollConfigurationModule {}
