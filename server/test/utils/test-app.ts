// Keep integration-test output quiet. Set before AppModule loads so ConfigModule
// (dotenv) won't override it — dotenv never overwrites an already-set env var.
process.env['LOG_LEVEL'] = process.env['LOG_LEVEL'] ?? 'silent';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  server: Server;
}

/**
 * Boots the real AppModule with the same HTTP pipeline as production
 * (configureApp = cookie parser + global ValidationPipe; the global exception
 * filter, throttler guard, and request-id middleware come from AppModule). Use
 * `request(testApp.server)` (supertest) to drive it without binding a port.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma, server: app.getHttpServer() as Server };
}

/**
 * Removes all users (and the workspaces they own, which cascades to documents,
 * members, versions, invites) created with a given email prefix. The sandbox
 * uses prefixes so a run only ever deletes its own throwaway data — never other
 * rows in a shared database.
 */
export async function cleanupByEmailPrefix(
  prisma: PrismaService,
  prefix: string,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await prisma.workspace.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

let counter = 0;

/** A unique throwaway email for the given prefix. */
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}-${counter}@example.com`;
}

export const STRONG_PASSWORD = 'Test@1234!';
