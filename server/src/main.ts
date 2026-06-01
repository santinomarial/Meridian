import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration.type';
import { APP_CONFIG_KEY } from './config/app.config';

class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly corsOrigin: string,
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
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(ConfigService).getOrThrow<AppConfig>(APP_CONFIG_KEY);

  app.enableCors({
    origin: config.clientOrigin,
    credentials: true,
  });

  app.useWebSocketAdapter(new SocketIoAdapter(app, config.clientOrigin));

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
