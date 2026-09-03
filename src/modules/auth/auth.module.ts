import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema.js';
import { UserRepository } from '../users/repositories/user.repository.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema.js';
import { Session, SessionSchema } from './schemas/session.schema.js';
import { LoginSecurityService } from './services/login-security.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
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
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserRepository,
    SessionRepository,
    AuditLogRepository,
    LoginSecurityService,
  ],
})
export class AuthModule {}
