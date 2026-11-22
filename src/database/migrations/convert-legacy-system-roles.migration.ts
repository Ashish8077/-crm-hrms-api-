import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../../app.module';
import { Role } from '../../modules/roles/schemas/role.schema';
import { SystemRole } from '../../modules/roles/constants/role.constant';

export class ConvertLegacySystemRolesMigration {
  private readonly logger = new Logger(ConvertLegacySystemRolesMigration.name);

  constructor(private readonly roleModel: Model<Role>) {}

  async run(): Promise<{ modifiedCount: number }> {
    this.logger.log(
      'Starting migration: converting legacy system roles to custom roles...',
    );

    const result = await this.roleModel.updateMany(
      {
        key: { $ne: SystemRole.SUPER_ADMIN },
        isSystemRole: true,
      },
      {
        $set: { isSystemRole: false },
      },
    );

    this.logger.log(
      `Migration completed. Converted ${result.modifiedCount} legacy system roles to custom roles (isSystemRole: false).`,
    );

    return { modifiedCount: result.modifiedCount };
  }
}

async function bootstrap() {
  const logger = new Logger('MigrationRunner');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const roleModel = app.get<Model<Role>>(getModelToken(Role.name));
    const migration = new ConvertLegacySystemRolesMigration(roleModel);
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
