import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../../app.module';
import { SalaryComponent } from '../../modules/salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../../modules/salary-components/constants/salary-component.constant';

export interface MigrationResult {
  preMigrationLegacyCount: number;
  migratedCount: number;
  postMigrationLegacyCount: number;
  verified: boolean;
}

export class MigrateSalaryComponentTypesMigration {
  private readonly logger = new Logger(
    MigrateSalaryComponentTypesMigration.name,
  );

  constructor(private readonly salaryComponentModel: Model<SalaryComponent>) {}

  async run(): Promise<MigrationResult> {
    this.logger.log(
      'Starting migration: standardizing SalaryComponent types...',
    );

    // 1. Pre-migration verification: count legacy DEDUCTION records
    const preMigrationLegacyCount =
      await this.salaryComponentModel.countDocuments({
        type: SalaryComponentType.DEDUCTION,
      });

    this.logger.log(
      `Pre-migration check: Found ${preMigrationLegacyCount} legacy 'DEDUCTION' records.`,
    );

    let migratedCount = 0;

    if (preMigrationLegacyCount > 0) {
      // 2. Perform safe update
      const updateResult = await this.salaryComponentModel.updateMany(
        { type: SalaryComponentType.DEDUCTION },
        { $set: { type: SalaryComponentType.EMPLOYEE_DEDUCTION } },
      );
      migratedCount = updateResult.modifiedCount;
    }

    // 3. Post-migration verification: ensure zero legacy DEDUCTION records remain
    const postMigrationLegacyCount =
      await this.salaryComponentModel.countDocuments({
        type: SalaryComponentType.DEDUCTION,
      });

    const verified = postMigrationLegacyCount === 0;

    this.logger.log(
      `Migration completed. Migrated: ${migratedCount}. Remaining legacy: ${postMigrationLegacyCount}. Verified: ${verified}`,
    );

    if (!verified) {
      throw new Error(
        `Migration verification failed: ${postMigrationLegacyCount} legacy 'DEDUCTION' records still remain.`,
      );
    }

    return {
      preMigrationLegacyCount,
      migratedCount,
      postMigrationLegacyCount,
      verified,
    };
  }
}

async function bootstrap() {
  const logger = new Logger('MigrationRunner');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const model = app.get<Model<SalaryComponent>>(
      getModelToken(SalaryComponent.name),
    );
    const migration = new MigrateSalaryComponentTypesMigration(model);
    await migration.run();
    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', error);
    await app.close();
    process.exit(1);
  }
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
