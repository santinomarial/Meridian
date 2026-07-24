import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { PinoLogger } from 'nestjs-pino';
import type { Socket } from 'socket.io';
import type { TerminalSandboxService } from './terminal-sandbox.service';

// jest.mock is hoisted — must be at module level, not inside beforeEach.
const spawnMock = jest.fn();
jest.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import after mocking so the service module picks up the mock.
// eslint-disable-next-line import/first
import { TerminalService } from './terminal.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): DeepMockProxy<PinoLogger> {
  return mockDeep<PinoLogger>();
}

const SANDBOX_DIR = '/tmp/meridian-test-sandbox/ws-1/user-1';

function makeSandbox() {
  return {
    materialize: jest.fn(async () => SANDBOX_DIR),
    registerActive: jest.fn(),
    unregister: jest.fn(async () => undefined),
  };
}

function makeSocket(id = 'socket-1'): { socket: Socket; emitted: Array<[string, unknown]> } {
  const emitted: Array<[string, unknown]> = [];
  const socket = {
    id,
    emit: (event: string, data: unknown) => {
      emitted.push([event, data]);
    },
  } as unknown as Socket;
  return { socket, emitted };
}

/** A fake node-pty IPty with manual data/exit dispatch and call recording. */
function makeFakePty() {
  const dataListeners: Array<(d: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  const written: string[] = [];
  const killed: string[] = [];
  const resized: Array<[number, number]> = [];

  const pty = {
    onData: (cb: (d: string) => void) => {
      dataListeners.push(cb);
      return { dispose: () => undefined };
    },
    onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
      exitListeners.push(cb);
      return { dispose: () => undefined };
    },
    write: (d: string) => written.push(d),
    resize: (c: number, r: number) => resized.push([c, r]),
    kill: (signal?: string) => killed.push(signal ?? 'SIGTERM'),
    pid: 4242,
  };

  return {
    pty,
    emitData: (d: string) => dataListeners.forEach((f) => f(d)),
    emitExit: (e: { exitCode: number; signal?: number }) => exitListeners.forEach((f) => f(e)),
    written,
    killed,
    resized,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalService', () => {
  let service: TerminalService;
  let sandbox: ReturnType<typeof makeSandbox>;

  beforeEach(() => {
    spawnMock.mockReset();
    sandbox = makeSandbox();
    service = new TerminalService(
      sandbox as unknown as TerminalSandboxService,
      makeLogger(),
    );
  });

  afterEach(() => {
    const sessions = (service as unknown as { sessions: Map<string, unknown> }).sessions;
    for (const id of sessions.keys()) {
      service.killSession(id);
    }
  });

  // ── hasSession / getSession ────────────────────────────────────────────────

  describe('hasSession / getSession', () => {
    it('returns false / undefined when no session exists', () => {
      expect(service.hasSession('missing')).toBe(false);
      expect(service.getSession('missing')).toBeUndefined();
    });
  });

  // ── createSession ──────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('materializes the workspace, spawns a PTY in the sandbox, and registers it', async () => {
      const { pty } = makeFakePty();
      spawnMock.mockReturnValue(pty);

      const { socket, emitted } = makeSocket('s1');
      await service.createSession('s1', 'user-1', 'ws-1', socket);

      expect(sandbox.materialize).toHaveBeenCalledWith('s1', 'ws-1', 'user-1');
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [, , options] = spawnMock.mock.calls[0] as [string, string[], { cwd: string }];
      expect(options.cwd).toBe(SANDBOX_DIR);
      expect(sandbox.registerActive).toHaveBeenCalledWith(
        's1',
        'ws-1',
        'user-1',
        SANDBOX_DIR,
        socket,
      );
      expect(service.hasSession('s1')).toBe(true);
      expect(
        emitted.find(
          ([e, d]) =>
            e === 'terminal:output' &&
            String((d as { data: string }).data).includes('workspace sandbox'),
        ),
      ).toBeUndefined();
      expect(emitted).toContainEqual(['terminal:sync', { status: 'synced' }]);
    });

    it('spawns with a safe env (no DATABASE_URL/JWT_SECRET) and HOME inside the sandbox', async () => {
      const { pty } = makeFakePty();
      spawnMock.mockReturnValue(pty);
      process.env['DATABASE_URL'] = 'postgres://secret';
      process.env['JWT_SECRET'] = 'topsecret';

      const { socket } = makeSocket('s2');
      await service.createSession('s2', 'user-1', 'ws-1', socket);

      const [, , options] = spawnMock.mock.calls[0] as [
        string,
        string[],
        { name: string; env: Record<string, string> },
      ];
      expect(options.name).toBe('xterm-256color');
      expect(options.env['DATABASE_URL']).toBeUndefined();
      expect(options.env['JWT_SECRET']).toBeUndefined();
      expect(options.env['HOME']).toBe(SANDBOX_DIR);
      expect(options.env['PATH']).toBeDefined();
    });

    it('forwards PTY output to the socket as terminal:output', async () => {
      const fake = makeFakePty();
      spawnMock.mockReturnValue(fake.pty);

      const { socket, emitted } = makeSocket('s3');
      await service.createSession('s3', 'user-1', 'ws-1', socket);
      fake.emitData('meridian@host % ');

      const out = emitted.filter(([e]) => e === 'terminal:output');
      expect(out.some(([, d]) => (d as { data: string }).data === 'meridian@host % ')).toBe(true);
    });

    it('releases the sandbox, removes the session, and emits terminal:exit when the PTY exits', async () => {
      const fake = makeFakePty();
      spawnMock.mockReturnValue(fake.pty);

      const { socket, emitted } = makeSocket('s5');
      await service.createSession('s5', 'user-1', 'ws-1', socket);
      fake.emitExit({ exitCode: 0 });

      expect(service.hasSession('s5')).toBe(false);
      expect(sandbox.unregister).toHaveBeenCalledWith('s5', 0);
      const exit = emitted.find(([e]) => e === 'terminal:exit');
      expect((exit![1] as { code: number }).code).toBe(0);
    });

    it('kills an existing session before starting a new one on the same socket', async () => {
      const fake1 = makeFakePty();
      const fake2 = makeFakePty();
      spawnMock.mockReturnValueOnce(fake1.pty).mockReturnValueOnce(fake2.pty);

      const { socket } = makeSocket('s6');
      await service.createSession('s6', 'user-1', 'ws-1', socket);
      await service.createSession('s6', 'user-1', 'ws-2', socket);

      expect(fake1.killed.length).toBeGreaterThan(0);
      expect(service.getSession('s6')).toMatchObject({ workspaceId: 'ws-2' });
    });
  });

  // ── writeToSession ─────────────────────────────────────────────────────────

  describe('writeToSession', () => {
    it('returns false when no session exists (input before start is rejected)', () => {
      expect(service.writeToSession('no-such-socket', 'data')).toBe(false);
    });

    it('writes data to the PTY and returns true', async () => {
      const fake = makeFakePty();
      spawnMock.mockReturnValue(fake.pty);

      const { socket } = makeSocket('s7');
      await service.createSession('s7', 'user-1', 'ws-1', socket);

      expect(service.writeToSession('s7', 'echo hi\n')).toBe(true);
      expect(fake.written).toContain('echo hi\n');
    });
  });

  // ── resizeSession ──────────────────────────────────────────────────────────

  describe('resizeSession', () => {
    it('returns false when no session exists', () => {
      expect(service.resizeSession('ghost', 80, 24)).toBe(false);
    });

    it('resizes the PTY and returns true', async () => {
      const fake = makeFakePty();
      spawnMock.mockReturnValue(fake.pty);

      const { socket } = makeSocket('s-resize');
      await service.createSession('s-resize', 'user-1', 'ws-1', socket);

      expect(service.resizeSession('s-resize', 120, 40)).toBe(true);
      expect(fake.resized).toContainEqual([120, 40]);
    });
  });

  // ── killSession ────────────────────────────────────────────────────────────

  describe('killSession', () => {
    it('is a no-op when no session exists', () => {
      expect(() => service.killSession('ghost')).not.toThrow();
    });

    it('kills the PTY, unregisters the sandbox, and removes the session', async () => {
      const fake = makeFakePty();
      spawnMock.mockReturnValue(fake.pty);

      const { socket } = makeSocket('s8');
      await service.createSession('s8', 'user-1', 'ws-1', socket);
      service.killSession('s8');

      expect(fake.killed.length).toBeGreaterThan(0);
      expect(sandbox.unregister).toHaveBeenCalledWith('s8', 3100);
      expect(service.hasSession('s8')).toBe(false);
    });
  });

  // ── idle timeout ───────────────────────────────────────────────────────────

  describe('idle timeout', () => {
    it('closes the session after 30 minutes of inactivity', async () => {
      jest.useFakeTimers();
      try {
        const fake = makeFakePty();
        spawnMock.mockReturnValue(fake.pty);

        const { socket, emitted } = makeSocket('s9');
        await service.createSession('s9', 'user-1', 'ws-1', socket);

        jest.advanceTimersByTime(30 * 60 * 1000 + 100);

        expect(service.hasSession('s9')).toBe(false);
        expect(emitted.some(([e]) => e === 'terminal:exit')).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ── onModuleDestroy ────────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('kills all active sessions', async () => {
      const fake1 = makeFakePty();
      const fake2 = makeFakePty();
      spawnMock.mockReturnValueOnce(fake1.pty).mockReturnValueOnce(fake2.pty);

      const { socket: s1 } = makeSocket('sa');
      const { socket: s2 } = makeSocket('sb');
      await service.createSession('sa', 'user-1', 'ws-1', s1);
      await service.createSession('sb', 'user-2', 'ws-1', s2);

      service.onModuleDestroy();

      expect(fake1.killed.length).toBeGreaterThan(0);
      expect(fake2.killed.length).toBeGreaterThan(0);
      expect(service.hasSession('sa')).toBe(false);
      expect(service.hasSession('sb')).toBe(false);
    });
  });
});
