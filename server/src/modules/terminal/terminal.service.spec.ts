import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { PinoLogger } from 'nestjs-pino';
import type { Socket } from 'socket.io';

// jest.mock is hoisted — must be at module level, not inside beforeEach.
const spawnMock = jest.fn<ChildProcess, Parameters<typeof import('child_process').spawn>>();
jest.mock('child_process', () => ({
  ...jest.requireActual<object>('child_process'),
  spawn: (...args: Parameters<typeof import('child_process').spawn>) => spawnMock(...args),
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

function makeFakeProcess(): {
  proc: ChildProcess;
  stdout: EventEmitter;
  stderr: EventEmitter;
  procEmitter: EventEmitter;
  stdinWritten: string[];
  killed: string[];
} {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const procEmitter = new EventEmitter();
  const stdinWritten: string[] = [];
  const killed: string[] = [];

  const stdin = {
    write: (data: string) => stdinWritten.push(data),
    end: () => {},
  };

  const proc = Object.assign(procEmitter, {
    stdout,
    stderr,
    stdin,
    kill: (signal: string) => { killed.push(signal); return true; },
    pid: 12345,
  }) as unknown as ChildProcess;

  return { proc, stdout, stderr, procEmitter, stdinWritten, killed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalService', () => {
  let service: TerminalService;

  beforeEach(() => {
    spawnMock.mockReset();
    service = new TerminalService(makeLogger());
  });

  afterEach(() => {
    const sessions = (service as unknown as { sessions: Map<string, unknown> }).sessions;
    for (const id of sessions.keys()) {
      service.killSession(id);
    }
    jest.useRealTimers();
  });

  // ── getSandboxDir ──────────────────────────────────────────────────────────

  describe('getSandboxDir', () => {
    it('returns a path with the workspaceId and userId segments', () => {
      const dir = service.getSandboxDir('ws-abc123', 'user-XYZ_9');
      expect(dir).toContain('ws-abc123');
      expect(dir).toContain('user-XYZ_9');
      expect(dir).toContain('.terminal-sandboxes');
    });

    it('throws for workspaceId containing path-traversal characters', () => {
      expect(() => service.getSandboxDir('../evil', 'user-1')).toThrow(
        'Invalid workspaceId or userId for sandbox path',
      );
    });

    it('throws for userId containing path-traversal characters', () => {
      expect(() => service.getSandboxDir('ws-1', '../../etc/passwd')).toThrow();
    });

    it('throws for ids containing spaces', () => {
      expect(() => service.getSandboxDir('ws 1', 'user-1')).toThrow();
    });
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
    it('registers a session keyed by socketId', () => {
      jest.useFakeTimers();
      const { proc } = makeFakeProcess();
      spawnMock.mockReturnValue(proc);

      const { socket } = makeSocket('s1');
      service.createSession('s1', 'user-1', 'ws-1', socket);

      expect(service.hasSession('s1')).toBe(true);
      expect(service.getSession('s1')).toMatchObject({ userId: 'user-1', workspaceId: 'ws-1' });
    });

    it('spawns the shell with a safe env (no DATABASE_URL/JWT_SECRET)', () => {
      jest.useFakeTimers();
      const { proc } = makeFakeProcess();
      spawnMock.mockReturnValue(proc);

      process.env['DATABASE_URL'] = 'postgres://secret';
      process.env['JWT_SECRET'] = 'topsecret';

      const { socket } = makeSocket('s2');
      service.createSession('s2', 'user-1', 'ws-1', socket);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const spawnArgs = spawnMock.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
      const spawnEnv = spawnArgs[2];
      expect(spawnEnv['env']['DATABASE_URL']).toBeUndefined();
      expect(spawnEnv['env']['JWT_SECRET']).toBeUndefined();
      expect(spawnEnv['env']['PATH']).toBeDefined();
    });

    it('forwards stdout data to socket as terminal:output', () => {
      jest.useFakeTimers();
      const { proc, stdout } = makeFakeProcess();
      spawnMock.mockReturnValue(proc);

      const { socket, emitted } = makeSocket('s3');
      service.createSession('s3', 'user-1', 'ws-1', socket);
      stdout.emit('data', Buffer.from('hello\r\n'));

      const outputEvent = emitted.find(([e]) => e === 'terminal:output');
      expect(outputEvent).toBeDefined();
      expect((outputEvent![1] as { data: string }).data).toBe('hello\r\n');
    });

    it('forwards stderr data to socket as terminal:output', () => {
      jest.useFakeTimers();
      const { proc, stderr } = makeFakeProcess();
      spawnMock.mockReturnValue(proc);

      const { socket, emitted } = makeSocket('s4');
      service.createSession('s4', 'user-1', 'ws-1', socket);
      stderr.emit('data', Buffer.from('err\r\n'));

      expect(emitted.some(([e]) => e === 'terminal:output')).toBe(true);
    });

    it('removes session and emits terminal:exit when process exits', () => {
      jest.useFakeTimers();
      const { proc, procEmitter } = makeFakeProcess();
      spawnMock.mockReturnValue(proc);

      const { socket, emitted } = makeSocket('s5');
      service.createSession('s5', 'user-1', 'ws-1', socket);
      procEmitter.emit('exit', 0);

      expect(service.hasSession('s5')).toBe(false);
      expect(emitted.some(([e]) => e === 'terminal:exit')).toBe(true);
    });

    it('kills an existing session before starting a new one on the same socket', () => {
      jest.useFakeTimers();
      const { proc: proc1, killed: killed1 } = makeFakeProcess();
      const { proc: proc2 } = makeFakeProcess();
      spawnMock.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

      const { socket } = makeSocket('s6');
      service.createSession('s6', 'user-1', 'ws-1', socket);
      service.createSession('s6', 'user-1', 'ws-2', socket);

      expect(killed1).toContain('SIGTERM');
      expect(service.hasSession('s6')).toBe(true);
    });
  });

  // ── writeToSession ─────────────────────────────────────────────────────────

  describe('writeToSession', () => {
    it('returns false when no session exists', () => {
      expect(service.writeToSession('no-such-socket', 'data')).toBe(false);
    });

    it('writes data to the process stdin and returns true', () => {
      jest.useFakeTimers();
      const { proc, stdinWritten } = makeFakeProcess();
      spawnMock.mockReturnValue(proc);

      const { socket } = makeSocket('s7');
      service.createSession('s7', 'user-1', 'ws-1', socket);

      const result = service.writeToSession('s7', 'ls\n');
      expect(result).toBe(true);
      expect(stdinWritten).toContain('ls\n');
    });
  });

  // ── killSession ────────────────────────────────────────────────────────────

  describe('killSession', () => {
    it('is a no-op when no session exists', () => {
      expect(() => service.killSession('ghost')).not.toThrow();
    });

    it('sends SIGTERM to the process and removes the session', () => {
      jest.useFakeTimers();
      const { proc, killed } = makeFakeProcess();
      spawnMock.mockReturnValue(proc);

      const { socket } = makeSocket('s8');
      service.createSession('s8', 'user-1', 'ws-1', socket);
      service.killSession('s8');

      expect(killed).toContain('SIGTERM');
      expect(service.hasSession('s8')).toBe(false);
    });
  });

  // ── idle timeout ───────────────────────────────────────────────────────────

  describe('idle timeout', () => {
    it('closes the session after 30 minutes of inactivity', () => {
      jest.useFakeTimers();
      const { proc } = makeFakeProcess();
      spawnMock.mockReturnValue(proc);

      const { socket, emitted } = makeSocket('s9');
      service.createSession('s9', 'user-1', 'ws-1', socket);

      jest.advanceTimersByTime(30 * 60 * 1000 + 100);

      expect(service.hasSession('s9')).toBe(false);
      expect(emitted.some(([e]) => e === 'terminal:exit')).toBe(true);
    });
  });

  // ── onModuleDestroy ────────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('kills all active sessions', () => {
      jest.useFakeTimers();
      const { proc: p1, killed: k1 } = makeFakeProcess();
      const { proc: p2, killed: k2 } = makeFakeProcess();
      spawnMock.mockReturnValueOnce(p1).mockReturnValueOnce(p2);

      const { socket: s1 } = makeSocket('sa');
      const { socket: s2 } = makeSocket('sb');
      service.createSession('sa', 'user-1', 'ws-1', s1);
      service.createSession('sb', 'user-2', 'ws-1', s2);

      service.onModuleDestroy();

      expect(k1).toContain('SIGTERM');
      expect(k2).toContain('SIGTERM');
      expect(service.hasSession('sa')).toBe(false);
      expect(service.hasSession('sb')).toBe(false);
    });
  });
});
