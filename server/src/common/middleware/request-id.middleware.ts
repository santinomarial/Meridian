import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestWithId } from '../types/request-with-id.type';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    req.id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  }
}
