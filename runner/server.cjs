'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const pty = require('node-pty');
const { policy, createArgs } = require('./policy.cjs');
const config = policy(process.env);
const exec = promisify(execFile);
const sandboxes = new Map();
const terminals = new Map();
const MAX_BODY = 30 * 1024 * 1024;
const MAX_OUTPUT = 256 * 1024;
let image;
let closing = false;

async function docker(args) {
  return (await exec('docker', args, { timeout: 20000, maxBuffer: MAX_BODY, encoding: 'utf8' })).stdout.trim();
}
function statusError(status, message) { return Object.assign(new Error(message), { status }); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw statusError(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw statusError(400, 'Invalid JSON'); }
}
function authorized(req) {
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${config.token}`);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function append(term, data) {
  if (term.exitCode !== null) return;
  // Bound memory and stop abusive output rather than queueing it indefinitely.
  if (Buffer.byteLength(term.output) + Buffer.byteLength(data) > MAX_OUTPUT) {
    term.output = '\r\n[Meridian] Terminal stopped: output limit exceeded.\r\n';
    term.exitCode = 137;
    term.child.kill('SIGKILL');
    return;
  }
  term.output += data;
}
function report(error) { console.error('Runner operation failed:', error.message); }
async function destroy(id) {
  const sandbox = sandboxes.get(id);
  if (!sandbox) return;
  if (sandbox.destroying) return sandbox.destroying;
  sandbox.destroying = (async () => {
    for (const [key, term] of terminals) if (term.sandbox === id) {
      try { term.child.kill('SIGKILL'); } catch {}
      terminals.delete(key);
    }
    try { await docker(['rm', '-f', sandbox.name]); }
    catch (error) {
      if (!/No such container:/i.test(error.stderr || '')) throw error;
    }
    sandboxes.delete(id);
  })();
  try { await sandbox.destroying; }
  catch (error) { sandbox.destroying = undefined; throw error; }
}
function fileOperation(sandbox, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', sandbox.name, 'python3', '-I', '/opt/meridian/files.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0; let error = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(statusError(503, 'File operation timed out')); }, 15000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { child.kill('SIGKILL'); reject(statusError(413, 'File snapshot too large')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { if (error.length < 4096) error += chunk; });
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(statusError(409, 'Sandbox file operation failed'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(statusError(502, 'Invalid file response')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
async function route(req) {
  const url = new URL(req.url, 'http://runner');
  if (!authorized(req)) throw statusError(401, 'Unauthorized');
  if (closing) throw statusError(503, 'Runner stopping');
  if (req.method === 'GET' && url.pathname === '/health') {
    const info = JSON.parse(await docker(['info', '--format', '{{json .Runtimes}}']));
    if (!info[config.runtime]) throw statusError(503, 'Isolation runtime unavailable');
    await docker(['image', 'inspect', '--format', '{{.Id}}', image]);
    return { ready: true, isolation: config.local ? 'local-development-only' : 'gvisor', sandboxes: sandboxes.size };
  }
  if (req.method === 'POST' && url.pathname === '/sandboxes') {
    const data = await body(req);
    if (!validId(data.userId) || !validId(data.workspaceId)) throw statusError(400, 'Invalid identity');
    if (sandboxes.size >= config.maxSandboxes || [...sandboxes.values()].filter(s => s.userId === data.userId).length >= config.maxPerUser) {
      throw statusError(429, 'Terminal capacity reached. Close another terminal and retry.');
    }
    const id = crypto.randomUUID();
    const sandbox = { name: `${config.namespace}-${id}`, userId: data.userId, started: Date.now(), touched: Date.now(), chain: Promise.resolve() };
    // Reserve capacity before the first await to prevent concurrent oversubscription.
    sandboxes.set(id, sandbox);
    try {
      await docker(createArgs(config, sandbox.name, image));
      await fileOperation(sandbox, { op: 'seed', files: data.files, folders: data.folders });
      return { id };
    } catch (error) { await destroy(id).catch(report); throw error; }
  }
  const match = /^\/sandboxes\/([a-f0-9-]{36})(?:\/(files|terminals))?$/.exec(url.pathname);
  if (match) {
    const [, id, action] = match;
    const sandbox = sandboxes.get(id);
    if (!sandbox && req.method === 'DELETE' && !action) return { ok: true };
    if (!sandbox || sandbox.destroying) throw statusError(404, 'Sandbox expired');
    sandbox.touched = Date.now();
    if (req.method === 'DELETE' && !action) { await destroy(id); return { ok: true }; }
    if (req.method === 'POST' && action === 'files') {
      const data = await body(req);
      const operation = sandbox.chain.catch(() => {}).then(() => fileOperation(sandbox, data));
      sandbox.chain = operation;
      return operation;
    }
    if (req.method === 'POST' && action === 'terminals') {
      if ([...terminals.values()].filter(t => t.sandbox === id).length >= 4) throw statusError(429, 'Terminal session limit reached');
      const termId = crypto.randomUUID();
      const child = pty.spawn('docker', ['exec', '-it', sandbox.name, 'bash', '--noprofile', '--norc'], {
        name: 'xterm-256color', cols: 80, rows: 24, env: { PATH: process.env.PATH, HOME: '/tmp', TERM: 'xterm-256color' },
      });
      const term = { child, sandbox: id, output: '', exitCode: null, lastInput: Date.now() };
      terminals.set(termId, term);
      child.onData(data => append(term, data));
      child.onExit(({ exitCode }) => { if (term.exitCode === null) term.exitCode = exitCode; });
      return { id: termId };
    }
  }
  const tm = /^\/terminals\/([a-f0-9-]{36})(?:\/(input|resize))?$/.exec(url.pathname);
  if (tm) {
    const [, id, action] = tm;
    const term = terminals.get(id);
    if (!term) throw statusError(404, 'Terminal expired');
    const sandbox = sandboxes.get(term.sandbox);
    if (sandbox) sandbox.touched = Date.now();
    if (req.method === 'GET' && !action) {
      const result = { data: term.output, exitCode: term.exitCode };
      term.output = '';
      if (term.exitCode !== null) terminals.delete(id);
      return result;
    }
    if (req.method === 'DELETE' && !action) {
      term.child.kill('SIGKILL'); terminals.delete(id); return { ok: true };
    }
    if (req.method === 'POST' && action) {
      const data = await body(req);
      if (action === 'input') {
        if (typeof data.data !== 'string' || Buffer.byteLength(data.data) > 65536) throw statusError(400, 'Invalid input');
        term.child.write(data.data); term.lastInput = Date.now();
      } else {
        if (![data.cols, data.rows].every(n => Number.isInteger(n) && n >= 1 && n <= 500)) throw statusError(400, 'Invalid size');
        term.child.resize(data.cols, data.rows);
      }
      return { ok: true };
    }
  }
  throw statusError(404, 'Not found');
}
const server = http.createServer(async (req, res) => {
  try {
    const result = await route(req);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
  } catch (error) {
    if (!error.status) report(error);
    res.writeHead(error.status || 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error.status ? error.message : 'Terminal worker unavailable' }));
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.maxConnections = 64;

async function start() {
  const runtimes = JSON.parse(await docker(['info', '--format', '{{json .Runtimes}}']));
  if (!runtimes[config.runtime]) throw new Error(`Required ${config.runtime} runtime unavailable; no fallback is permitted`);
  const metadata = JSON.parse(await docker(['image', 'inspect', config.image]))[0];
  if (Object.keys(metadata.Config.Volumes || {}).length) throw new Error('Workload images must not declare persistent volumes');
  image = metadata.Id;
  // Keep a reference while the operator rebuilds the source tag. Docker Desktop
  // may discard the previous untagged image even without an explicit prune.
  await docker(['tag', image, `${config.namespace}-sandbox:active`]);
  // Single worker per namespace: reap only this worker's orphan containers.
  const stale = await docker(['ps', '-aq', '--filter', `label=meridian.runner=${config.namespace}`]);
  if (stale) await docker(['rm', '-f', ...stale.split('\n')]);
  server.listen(config.port, config.host, () => console.log(`Runner ready (${config.runtime}) on ${config.host}:${config.port}`));
}
const reaper = setInterval(() => {
  for (const [id, s] of sandboxes) {
    const idle = [...terminals.values()].filter(t => t.sandbox === id).every(t => Date.now() - t.lastInput > 30 * 60 * 1000);
    if (Date.now() - s.touched > 90000 || Date.now() - s.started > 4 * 60 * 60 * 1000 || idle && Date.now() - s.started > 30 * 60 * 1000) void destroy(id).catch(report);
  }
}, 10000).unref();
async function shutdown() {
  closing = true; clearInterval(reaper); server.close();
  await Promise.allSettled([...sandboxes.keys()].map(destroy));
  process.exit(0);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
start().catch(error => { report(error); process.exit(1); });
