import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../app.module';
import { PermissionSeed } from './seeds/permission.seed';
import { RoleSeed } from './seeds/role.seed';
import { SuperAdminSeed } from './seeds/super-admin.seed';
import { User } from '../../modules/users/schemas/user.schema';
import { Role } from '../../modules/roles/schemas/role.schema';
import { Permission } from '../../modules/permissions/schemas/permission.schema';

async function bootstrap() {
  const logger = new Logger('Seed');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const roleModel = app.get<Model<Role>>(getModelToken(Role.name));
    const permissionModel = app.get<Model<Permission>>(
      getModelToken(Permission.name),
    );
    const configService = app.get(ConfigService);

    const permissionSeed = new PermissionSeed(permissionModel);
    const roleSeed = new RoleSeed(roleModel, permissionModel);
    const superAdminSeed = new SuperAdminSeed(
      userModel,
      roleModel,
      configService,
    );

    logger.log('Starting seed process...');

    // 1. Seed Permissions
    await permissionSeed.run();

    // 2. Seed Roles
    await roleSeed.run();

    // 3. Seed Super Admin
    await superAdminSeed.run();

    logger.log('Seed process completed successfully.');
    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error('Seed process failed', error);
    await app.close();
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
