import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { AppConfig } from './config/configuration.type';
import { APP_CONFIG_KEY } from './config/app.config';

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
];

class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly corsOrigin: string | string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options: Partial<ServerOptions> = {}) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  configureApp(app);

  const config = app.get(ConfigService).getOrThrow<AppConfig>(APP_CONFIG_KEY);

  const corsOrigin: string | string[] =
    config.nodeEnv === 'development' ? DEV_ORIGINS : config.clientOrigin;

  app.enableCors({ origin: corsOrigin, credentials: true });

  app.useWebSocketAdapter(new SocketIoAdapter(app, corsOrigin));

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

  await app.listen(config.port);
}

void bootstrap();
