import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SalaryComponent,
  SalaryComponentSchema,
} from './schemas/salary-component.schema';
import {
  SalaryStructure,
  SalaryStructureSchema,
} from '../salary-structures/schemas/salary-structure.schema';
import {
  EmployeeSalary,
  EmployeeSalarySchema,
} from '../employee-salaries/schemas/employee-salary.schema';
import { SalaryComponentsController } from './salary-components.controller';
import { SalaryComponentsService } from './services/salary-components.service';
import { SalaryComponentRepository } from './repositories/salary-component.repository';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SalaryComponent.name, schema: SalaryComponentSchema },
      { name: SalaryStructure.name, schema: SalaryStructureSchema },
      { name: EmployeeSalary.name, schema: EmployeeSalarySchema },
    ]),
    AuditLogsModule,
  ],
  controllers: [SalaryComponentsController],
  providers: [SalaryComponentsService, SalaryComponentRepository],
  exports: [SalaryComponentsService, SalaryComponentRepository],
})
export class SalaryComponentsModule {}
