import request from 'supertest';
import * as fs from 'fs/promises';
import * as path from 'path';
import JSZip from 'jszip';
import type { Socket } from 'socket.io';
import { createTestApp, cleanupByEmailPrefix, uniqueEmail, STRONG_PASSWORD, type TestApp } from './utils/test-app';
import { TerminalSandboxService } from '../src/modules/terminal/terminal-sandbox.service';
import { TerminalFileImportService } from '../src/documents/terminal-file-import.service';
import { DocumentsService } from '../src/documents/documents.service';
import { encodeSeededState, projectCrdtText } from '../src/common/crdt/crdt-lineage';

const PREFIX = 'int-terminal-files-';

describe('Terminal text file persistence', () => {
  let ctx: TestApp;
  let sandbox: TerminalSandboxService;
  let userId: string;
  let jti: string;
  let workspaceId: string;
  let root: string;
  let socketId: string;
  let sequence = 0;
  let emitted: [string, unknown][];

  beforeAll(async () => {
    ctx = await createTestApp();
    sandbox = ctx.app.get(TerminalSandboxService);
    // Drive scans explicitly; no sleeps or background poll timing in these tests.
    sandbox.onModuleDestroy();
    const agent = request.agent(ctx.server);
    const registration = await agent.post('/auth/register').send({
      email: uniqueEmail(PREFIX), password: STRONG_PASSWORD, displayName: 'Terminal files',
    }).expect(201);
    userId = registration.body.user.id;
    jti = (await ctx.prisma.session.findFirstOrThrow({ where: { userId } })).jti;
  });

  beforeEach(async () => {
    const workspace = await ctx.prisma.workspace.create({ data: { name: 'Terminal sync', ownerId: userId,
      members: { create: { userId, role: 'OWNER' } } } });
    workspaceId = workspace.id;
    socketId = `terminal-test-${++sequence}`;
    emitted = [];
  });

  async function start(): Promise<void> {
    root = await sandbox.materialize(socketId, workspaceId, userId);
    sandbox.registerActive(socketId, workspaceId, userId, root, {
      data: { sessionJti: jti }, emit: (event: string, payload: unknown) => emitted.push([event, payload]),
    } as unknown as Socket);
  }

  async function seed(content = 'before') {
    return ctx.prisma.document.create({ data: { workspaceId, path: 'main.py', name: 'main.py', type: 'FILE', content } });
  }

  afterEach(async () => {
    await sandbox.unregister(socketId).catch(() => undefined);
    if (root) await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, PREFIX);
    await ctx.app.close();
  });

  it('saves settled nested text files, creates parents and versions, and exports them', async () => {
    await start();
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src/new.py'), 'print(42)\n');
    await sandbox.syncTerminalFiles();
    expect(await ctx.prisma.document.count({ where: { workspaceId } })).toBe(0);
    await sandbox.syncTerminalFiles();
    const file = await ctx.prisma.document.findUniqueOrThrow({ where: { workspaceId_path: { workspaceId, path: 'src/new.py' } } });
    expect(file.content).toBe('print(42)\n');
    expect(file.parentId).not.toBeNull();
    expect(await ctx.prisma.documentVersion.count({ where: { documentId: file.id } })).toBe(1);
    const exported = await ctx.app.get(DocumentsService).exportWorkspaceZip(workspaceId);
    expect(await (await JSZip.loadAsync(exported.buffer)).file('src/new.py')!.async('string')).toBe('print(42)\n');
    await sandbox.syncTerminalFiles(true);
    expect(await ctx.prisma.documentVersion.count({ where: { documentId: file.id } })).toBe(1);
  });

  it('updates saved content, fences the old CRDT, and preserves the prior version', async () => {
    const doc = await seed();
    await start();
    await fs.writeFile(path.join(root, 'main.py'), 'after');
    await sandbox.syncTerminalFiles(true);
    const updated = await ctx.prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(updated).toMatchObject({ content: 'after', crdtGeneration: 1 });
    expect(await ctx.prisma.$transaction((tx) => projectCrdtText(tx, doc.id, 1))).toBe('after');
    const versions = await ctx.prisma.documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { versionNumber: 'asc' } });
    expect(versions.map((v) => v.content)).toEqual(['before', 'after']);
    await sandbox.unregister(socketId);
    await start();
    expect(await fs.readFile(path.join(root, 'main.py'), 'utf8')).toBe('after');
  });

  it('preserves unsaved durable collaborative edits and saves a separate terminal conflict copy', async () => {
    const doc = await seed();
    await start();
    await ctx.prisma.snapshot.create({ data: { documentId: doc.id, generation: 0, seq: 0,
      state: Buffer.from(encodeSeededState(doc.id, 0, 'editor typing')) } });
    await fs.writeFile(path.join(root, 'main.py'), 'terminal typing');
    await sandbox.syncTerminalFiles(true);
    expect(await ctx.prisma.$transaction((tx) => projectCrdtText(tx, doc.id, 0))).toBe('editor typing');
    const copy = await ctx.prisma.document.findFirstOrThrow({ where: { workspaceId, path: { startsWith: 'terminal-conflicts/' } } });
    expect(copy.content).toBe('terminal typing');
    expect(emitted.some(([event, payload]) => event === 'terminal:output' && JSON.stringify(payload).includes(copy.path))).toBe(true);
    // A retry following a notification failure must not create another copy.
    await ctx.app.get(TerminalFileImportService).importFiles(workspaceId, userId, jti,
      [{ path: 'main.py', baseContent: 'before', content: 'terminal typing' }]);
    expect(await ctx.prisma.document.count({ where: { workspaceId, type: 'FILE' } })).toBe(2);
  });

  it('does not overwrite an unimported shell edit when an editor checkpoint arrives', async () => {
    const doc = await seed();
    await start();
    await fs.writeFile(path.join(root, 'main.py'), 'terminal change');
    await ctx.prisma.document.update({ where: { id: doc.id }, data: { content: 'editor saved' } });
    await sandbox.syncWriteFile(workspaceId, 'main.py', 'editor saved');
    expect(await fs.readFile(path.join(root, 'main.py'), 'utf8')).toBe('terminal change');
    await sandbox.syncTerminalFiles(true);
    expect(await fs.readFile(path.join(root, 'main.py'), 'utf8')).toBe('editor saved');
    expect(await ctx.prisma.document.findFirst({ where: { workspaceId, content: 'terminal change' } })).not.toBeNull();
  });

  it('flushes the final write before natural session cleanup', async () => {
    await start();
    await fs.writeFile(path.join(root, 'last.txt'), 'saved at exit');
    await sandbox.unregister(socketId);
    expect((await ctx.prisma.document.findUniqueOrThrow({ where: { workspaceId_path: { workspaceId, path: 'last.txt' } } })).content).toBe('saved at exit');
    await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains failed imports and retries without advancing the saved baseline', async () => {
    await start();
    await fs.writeFile(path.join(root, 'retry.txt'), 'keep me');
    const importer = ctx.app.get(TerminalFileImportService);
    const failure = jest.spyOn(importer, 'importFiles').mockRejectedValueOnce(new Error('database unavailable'));
    await sandbox.syncTerminalFiles(true);
    expect(await fs.readFile(path.join(root, 'retry.txt'), 'utf8')).toBe('keep me');
    expect(await ctx.prisma.document.count({ where: { workspaceId } })).toBe(0);
    failure.mockRestore();
    await sandbox.syncTerminalFiles(true);
    expect(await ctx.prisma.document.count({ where: { workspaceId, content: 'keep me' } })).toBe(1);
  });

  it('imports a recreated file after an editor deletion cleared its projection baseline', async () => {
    const doc = await seed();
    await start();
    await ctx.prisma.document.delete({ where: { id: doc.id } });
    await sandbox.syncDelete(workspaceId, 'main.py');
    await fs.writeFile(path.join(root, 'main.py'), 'before');
    await sandbox.syncTerminalFiles(true);
    const recreated = await ctx.prisma.document.findUniqueOrThrow({ where: { workspaceId_path: { workspaceId, path: 'main.py' } } });
    expect(recreated.id).not.toBe(doc.id);
    expect(recreated.content).toBe('before');
  });

  it('rejects a revoked session even while its workspace membership remains writable', async () => {
    await start();
    await fs.writeFile(path.join(root, 'revoked.txt'), 'not authorized');
    await ctx.prisma.session.update({ where: { jti }, data: { revokedAt: new Date() } });
    try {
      await sandbox.syncTerminalFiles(true);
      expect(await ctx.prisma.document.count({ where: { workspaceId } })).toBe(0);
    } finally {
      await ctx.prisma.session.update({ where: { jti }, data: { revokedAt: null } });
    }
  });

  it('rechecks membership before importing and retains files if access is revoked', async () => {
    await start();
    await fs.writeFile(path.join(root, 'blocked.txt'), 'do not import');
    await ctx.prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId } }, data: { role: 'VIEWER' } });
    await sandbox.syncTerminalFiles(true);
    expect(await ctx.prisma.document.count({ where: { workspaceId } })).toBe(0);
    await expect(sandbox.unregister(socketId)).rejects.toThrow('Terminal write access has expired');
    expect(await fs.readFile(path.join(root, 'blocked.txt'), 'utf8')).toBe('do not import');
  });
});
