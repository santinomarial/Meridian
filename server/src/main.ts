import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { AppConfig } from './config/configuration.type';
import { APP_CONFIG_KEY } from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  configureApp(app);

  const config = app.get(ConfigService).getOrThrow<AppConfig>(APP_CONFIG_KEY);

  // Swagger is a development aid — do not expose the full OpenAPI surface in
  // production (auth is cookie-based; the docs UI still discloses the API).
  if (config.nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Meridian API')
      .setDescription('Backend API for Meridian collaborative browser IDE')
      .setVersion('0.1.0')
      .addTag('health', 'Service liveness')
      .addTag('users', 'User accounts')
      .addTag('workspaces', 'Workspaces and membership')
      .addTag('documents', 'Documents and file tree')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.port);
}

void bootstrap();
