import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import type { AppConfig } from '../../config/configuration.type';

export function allowedOrigins(config: AppConfig): string[] {
  const origins = [config.clientOrigin];
  if (config.nodeEnv === 'development') {
    for (const host of ['localhost', '127.0.0.1']) {
      for (const port of [5173, 5174, 5175]) origins.push(`http://${host}:${port}`);
    }
  }
  return origins;
}

/** CORS alone does not enforce origin checks for WebSocket transports. */
export class SocketIoAdapter extends IoAdapter {
  constructor(app: INestApplication, private readonly config: AppConfig) {
    super(app);
  }

  override createIOServer(port: number, options: Partial<ServerOptions> = {}) {
    const origins = allowedOrigins(this.config);
    return super.createIOServer(port, {
      ...options,
      cors: { origin: origins, credentials: true },
      maxHttpBufferSize: this.config.wsMaxYjsUpdateBytes + 16_384,
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        // Non-browser bearer-token clients have no Origin header. Every socket
        // still authenticates through the gateway before joining any room.
        callback(null, origin === undefined || origins.includes(origin));
      },
    } satisfies Partial<ServerOptions>);
  }
}
