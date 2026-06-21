import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { Socket } from 'socket.io';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { TerminalSandboxService } from './terminal-sandbox.service';
import { APP_CONFIG_KEY } from '../../config/app.config';

type DocRow = { type: DocumentType; path: string; content: string | null };

function makeSocket() {
  const emitted: Array<[string, unknown]> = [];
  const socket = {
    id: 'sock-1',
    emit: (event: string, data: unknown) => emitted.push([event, data]),
  } as unknown as Socket;
  return { socket, emitted };
}

function makeConfig(enableTerminal = true): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === APP_CONFIG_KEY) return { enableTerminal };
      throw new Error(`unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

describe('TerminalSandboxService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let redis: DeepMockProxy<RedisService>;
  let service: TerminalSandboxService;
  const wsId = `ws${Date.now().toString(36)}`;
  const userId = `user${Math.random().toString(36).slice(2, 8)}`;
  let root: string;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    redis = mockDeep<RedisService>();
    service = new TerminalSandboxService(prisma, redis, makeConfig(true), mockDeep<PinoLogger>());
    root = service.getSandboxDir(wsId, userId);
  });

  afterEach(() => {
    fs.rmSync(path.join(service.sandboxBaseDir(), wsId), { recursive: true, force: true });
  });

  function setDocs(docs: DocRow[]): void {
    prisma.document.findMany.mockResolvedValue(docs as never);
  }

  // ── materialize ──────────────────────────────────────────────────────────

  it('materializes files and preserves nested folder structure with contents', async () => {
    setDocs([
      { type: DocumentType.FILE, path: 'main.py', content: 'print("hi")' },
      { type: DocumentType.FOLDER, path: 'src', content: null },
      { type: DocumentType.FILE, path: 'src/app.ts', content: 'export const x = 1;' },
      { type: DocumentType.FILE, path: 'src/util/helpers.js', content: 'module.exports = {};' },
    ]);

    const returned = await service.materialize(wsId, userId);
    expect(returned).toBe(root);

    expect(fs.readFileSync(path.join(root, 'main.py'), 'utf8')).toBe('print("hi")');
    expect(fs.statSync(path.join(root, 'src')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8')).toBe('export const x = 1;');
    // Parent dirs are created even when only the file (not the folder) is a doc.
    expect(fs.readFileSync(path.join(root, 'src/util/helpers.js'), 'utf8')).toBe('module.exports = {};');
  });

  it('skips documents whose path would escape the sandbox root', async () => {
    setDocs([
      { type: DocumentType.FILE, path: 'safe.txt', content: 'ok' },
      { type: DocumentType.FILE, path: '../escape.txt', content: 'pwned' },
    ]);

    await service.materialize(wsId, userId);

    expect(fs.existsSync(path.join(root, 'safe.txt'))).toBe(true);
    // The traversal target outside the root must not have been written.
    expect(fs.existsSync(path.join(service.sandboxBaseDir(), wsId, 'escape.txt'))).toBe(false);
  });

  it('rejects invalid workspace/user ids for the sandbox path', () => {
    expect(() => service.getSandboxDir('../evil', userId)).toThrow();
    expect(() => service.getSandboxDir(wsId, '../../etc')).toThrow();
  });

  // ── live sync ──────────────────────────────────────────────────────────────

  describe('with an active sandbox', () => {
    let emitted: Array<[string, unknown]>;

    beforeEach(async () => {
      setDocs([]);
      await service.materialize(wsId, userId);
      const s = makeSocket();
      emitted = s.emitted;
      service.registerActive('sock-1', wsId, userId, root, s.socket);
    });

    it('syncWriteFile writes/overwrites content', async () => {
      await service.syncWriteFile(wsId, 'main.py', 'print("v1")');
      expect(fs.readFileSync(path.join(root, 'main.py'), 'utf8')).toBe('print("v1")');

      await service.syncWriteFile(wsId, 'main.py', 'print("v2")');
      expect(fs.readFileSync(path.join(root, 'main.py'), 'utf8')).toBe('print("v2")');
    });

    it('syncMkdir creates folders, syncRename moves, syncDelete removes', async () => {
      await service.syncMkdir(wsId, 'lib');
      expect(fs.statSync(path.join(root, 'lib')).isDirectory()).toBe(true);

      await service.syncWriteFile(wsId, 'a.py', 'a');
      await service.syncRename(wsId, 'a.py', 'b.py');
      expect(fs.existsSync(path.join(root, 'a.py'))).toBe(false);
      expect(fs.readFileSync(path.join(root, 'b.py'), 'utf8')).toBe('a');

      await service.syncDelete(wsId, 'b.py');
      expect(fs.existsSync(path.join(root, 'b.py'))).toBe(false);
    });

    it('never writes outside the sandbox root and warns on a traversal path', async () => {
      await service.syncWriteFile(wsId, '../escape.py', 'pwned');
      expect(fs.existsSync(path.join(service.sandboxBaseDir(), wsId, 'escape.py'))).toBe(false);
      // A sync failure surfaces a terminal warning + a failed sync event.
      expect(emitted.some(([e]) => e === 'terminal:sync')).toBe(true);
      expect(
        emitted.some(
          ([e, d]) => e === 'terminal:output' && String((d as { data: string }).data).includes('Could not sync'),
        ),
      ).toBe(true);
    });

    it('only syncs sandboxes belonging to the same workspace', async () => {
      await service.syncWriteFile('other-workspace', 'x.py', 'nope');
      expect(fs.existsSync(path.join(root, 'x.py'))).toBe(false);
    });

    it('stops syncing after unregister', async () => {
      service.unregister('sock-1');
      await service.syncWriteFile(wsId, 'after.py', 'nope');
      expect(fs.existsSync(path.join(root, 'after.py'))).toBe(false);
    });
  });

  // ── Cross-instance fan-out (Redis) ──────────────────────────────────────────

  describe('cross-instance sync', () => {
    async function getRemoteHandler(): Promise<(channel: string, message: string) => void> {
      await service.onModuleInit();
      const call = redis.subscribe.mock.calls.find(
        ([pattern]) => pattern === 'meridian:sandbox:*:sync',
      );
      expect(call).toBeDefined();
      return call![1] as (channel: string, message: string) => void;
    }

    beforeEach(async () => {
      setDocs([]);
      await service.materialize(wsId, userId);
      service.registerActive('sock-1', wsId, userId, root, makeSocket().socket);
    });

    it('publishes each sync op to Redis for other instances', async () => {
      await service.syncWriteFile(wsId, 'shared.py', 'print(1)');

      const publish = redis.publish.mock.calls.find(
        ([channel]) => channel === `meridian:sandbox:${wsId}:sync`,
      );
      expect(publish).toBeDefined();
      const msg = JSON.parse(publish![1] as string);
      expect(msg).toMatchObject({ op: 'write', workspaceId: wsId, relPath: 'shared.py', content: 'print(1)' });
      expect(typeof msg.originId).toBe('string');
    });

    it('applies a remote write from another instance to the local sandbox', async () => {
      const handler = await getRemoteHandler();
      handler(
        `meridian:sandbox:${wsId}:sync`,
        JSON.stringify({ originId: 'other-instance', op: 'write', workspaceId: wsId, relPath: 'remote.py', content: 'from remote' }),
      );
      // Allow the async apply to settle.
      await new Promise((r) => setTimeout(r, 50));
      expect(fs.readFileSync(path.join(root, 'remote.py'), 'utf8')).toBe('from remote');
    });

    it('ignores a sync message it published itself (origin guard)', async () => {
      const handler = await getRemoteHandler();
      await service.syncWriteFile(wsId, 'self.py', 'mine');
      const own = JSON.parse(
        redis.publish.mock.calls.find(([c]) => c === `meridian:sandbox:${wsId}:sync`)![1] as string,
      );
      // Delete the locally-written file; if the origin guard works, replaying
      // our own message must NOT recreate it.
      fs.rmSync(path.join(root, 'self.py'));
      handler(`meridian:sandbox:${wsId}:sync`, JSON.stringify(own));
      await new Promise((r) => setTimeout(r, 50));
      expect(fs.existsSync(path.join(root, 'self.py'))).toBe(false);
    });
  });
});
