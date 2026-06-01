import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RequestWithId } from '../types/request-with-id.type';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    req.id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  }
}
