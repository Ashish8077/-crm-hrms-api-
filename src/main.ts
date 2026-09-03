import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_PREFIX } from './common/constants/api.constants';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { setupSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  app.use(helmet());

  const configService = app.get(ConfigService);

  const trustProxy = configService.getOrThrow<number>('app.trustProxy');
  if (trustProxy > 0) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: configService.getOrThrow<string>('CORS_ORIGIN'),
  });

  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new LoggingInterceptor(),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  setupSwagger(app);

  const port = configService.getOrThrow<number>('app.port');
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');

  logger.error(
    'Application failed to start',
    error instanceof Error ? error.stack : String(error),
  );

  process.exit(1);
});
