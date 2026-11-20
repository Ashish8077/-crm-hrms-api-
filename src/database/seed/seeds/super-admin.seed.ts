import { Logger } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { User } from '../../../modules/users/schemas/user.schema';
import { Role } from '../../../modules/roles/schemas/role.schema';
import { UserStatus } from '../../../modules/users/constants/user-status.constant';
import { SystemRole } from '../../../modules/roles/constants/role.constant';
import { PasswordUtil } from '../../../common/utils/password.util.js';
import { validatePasswordPolicy } from '../../../common/utils/password-policy.util.js';

export class SuperAdminSeed {
  private readonly logger = new Logger(SuperAdminSeed.name);

  constructor(
    private readonly userModel: Model<User>,
    private readonly roleModel: Model<Role>,
    private readonly configService: ConfigService,
  ) {}

  async run(): Promise<void> {
    this.logger.log('Seeding Super Admin user...');

    const email = this.configService.getOrThrow<string>('superAdmin.email');
    const password = this.configService.getOrThrow<string>(
      'superAdmin.password',
    );

    // Normalize email consistently
    const normalizedEmail = email.trim().toLowerCase();

    // 4. Resolve Super Admin role
    const superAdminRole = await this.roleModel
      .findOne({ key: SystemRole.SUPER_ADMIN }, { _id: 1 })
      .lean()
      .exec();

    if (!superAdminRole) {
      this.logger.error(
        'Super Admin role not found. Ensure roles are seeded first.',
      );
      throw new Error(
        'Super Admin role not found. Ensure roles are seeded first.',
      );
    }

    // 5. Check whether Super Admin user already exists
    const existingUser = await this.userModel
      .findOne({ email: normalizedEmail }, { _id: 1, roleIds: 1 })
      .lean()
      .exec();

    if (existingUser) {
      this.logger.log(
        'User with Super Admin email already exists. Verifying role...',
      );

      // 6. Never implicitly escalate an existing account
      const hasSuperAdminRole = existingUser.roleIds.some(
        (roleId: Types.ObjectId) =>
          roleId.toString() === superAdminRole._id.toString(),
      );

      if (!hasSuperAdminRole) {
        this.logger.error(
          'Existing user does not have the Super Admin role. ' +
            'Refusing to implicitly escalate privileges.',
        );
        throw new Error(
          'Existing Super Admin email belongs to a user without the Super Admin role.',
        );
      }
      this.logger.log(
        'Super Admin user already exists and is correctly configured.',
      );

      return;
    }

    // Validate password against policy
    const violations = validatePasswordPolicy(password);
    if (violations.length > 0) {
      violations.forEach((v) => this.logger.error(`  - ${v}`));
      throw new Error(
        'SUPER_ADMIN_PASSWORD does not meet the password policy.',
      );
    }

    // Hash password before storing it
    const passwordHash = await PasswordUtil.hash(password);

    // 8. Create Super Admin user
    await this.userModel.create({
      email: normalizedEmail,
      passwordHash,
      roleIds: [superAdminRole._id],
      status: UserStatus.ACTIVE,
    });

    this.logger.log('Super Admin user seeded successfully.');
  }
}
