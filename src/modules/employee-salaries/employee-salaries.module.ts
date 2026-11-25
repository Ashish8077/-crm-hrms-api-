import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmployeeSalary,
  EmployeeSalarySchema,
} from './schemas/employee-salary.schema';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import {
  SalaryStructure,
  SalaryStructureSchema,
} from '../salary-structures/schemas/salary-structure.schema';
import {
  SalaryComponent,
  SalaryComponentSchema,
} from '../salary-components/schemas/salary-component.schema';
import { EmployeeSalaryRepository } from './repositories/employee-salary.repository';
import { EmployeeSalariesService } from './services/employee-salaries.service';
import { EmployeeSalariesController } from './employee-salaries.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalaryStructuresModule } from '../salary-structures/salary-structures.module';
import { EmployeesModule } from '../employees/employees.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmployeeSalary.name, schema: EmployeeSalarySchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: SalaryStructure.name, schema: SalaryStructureSchema },
      { name: SalaryComponent.name, schema: SalaryComponentSchema },
    ]),
    AuditLogsModule,
    SalaryStructuresModule,
    EmployeesModule,
  ],
  controllers: [EmployeeSalariesController],
  providers: [EmployeeSalaryRepository, EmployeeSalariesService],
  exports: [EmployeeSalariesService, EmployeeSalaryRepository],
})
export class EmployeeSalariesModule {}
