import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { EmployeeRepository } from './repositories/employee.repository';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DepartmentsModule } from '../departments/departments.module';
import { DesignationsModule } from '../designations/designations.module';
import { BranchesModule } from '../branches/branches.module';
import { TeamsModule } from '../teams/teams.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
    ]),
    AuditLogsModule,
    DepartmentsModule,
    DesignationsModule,
    BranchesModule,
    TeamsModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeeRepository],
  exports: [EmployeesService, EmployeeRepository],
})
export class EmployeesModule {}
