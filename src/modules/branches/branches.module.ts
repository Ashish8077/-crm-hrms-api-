import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BranchesService } from './branches.service';
import { BranchesController } from './branches.controller';
import { Branch, BranchSchema } from './schemas/branch.schema';
import { BranchRepository } from './repositories/branch.repository';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Branch.name, schema: BranchSchema }]),
    AuditLogsModule,
  ],
  controllers: [BranchesController],
  providers: [BranchesService, BranchRepository],
  exports: [BranchesService, BranchRepository],
})
export class BranchesModule {}
