import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SalaryStructure,
  SalaryStructureSchema,
} from './schemas/salary-structure.schema';
import {
  SalaryComponent,
  SalaryComponentSchema,
} from '../salary-components/schemas/salary-component.schema';
import { SalaryStructureRepository } from './repositories/salary-structure.repository';
import { SalaryStructureCalculationService } from './services/salary-structure-calculation.service';
import { SalaryStructuresService } from './services/salary-structures.service';
import { SalaryStructuresController } from './salary-structures.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SalaryStructure.name, schema: SalaryStructureSchema },
      { name: SalaryComponent.name, schema: SalaryComponentSchema },
    ]),
    AuditLogsModule,
  ],
  controllers: [SalaryStructuresController],
  providers: [
    SalaryStructureRepository,
    SalaryStructureCalculationService,
    SalaryStructuresService,
  ],
  exports: [
    SalaryStructuresService,
    SalaryStructureCalculationService,
    SalaryStructureRepository,
  ],
})
export class SalaryStructuresModule {}
