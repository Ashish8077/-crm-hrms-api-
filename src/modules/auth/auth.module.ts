import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionRepository } from './repositories/session.repository.js';
import { Session, SessionSchema } from './schemas/session.schema.js';
import { LoginSecurityService } from './services/login-security.service.js';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

import { AuthorizationService } from './authorization/authorization.service';
import { UsersModule } from '../users/users.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: {
          algorithm: 'HS256' as const,
        },
      }),
    }),
    UsersModule,
    RolesModule,
    PermissionsModule,
    AuditLogsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionRepository,
    LoginSecurityService,
    AuthorizationService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService, AuthorizationService],
})
export class AuthModule {}
