import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionRepository } from './repositories/session.repository.js';
import { Session, SessionSchema } from './schemas/session.schema.js';
import { LoginSecurityService } from './services/login-security.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

import { UsersModule } from '../users/users.module.js';
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
    forwardRef(() => UsersModule),
    AuditLogsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionRepository,
    LoginSecurityService,
    JwtAuthGuard,
  ],
  exports: [AuthService, JwtAuthGuard, SessionRepository],
})
export class AuthModule {}
