const { test } = require('node:test');
const assert = require('node:assert/strict');
const { policy, createArgs } = require('./policy.cjs');
const token = 'a'.repeat(32);
test('production always requires runsc even with the local override present', () => {
  const p = policy({ NODE_ENV: 'production', RUNNER_TOKEN: token, RUNNER_ALLOW_UNSAFE_LOCAL: 'true' });
  assert.equal(p.runtime, 'runsc');
  assert.equal(p.local, false);
});
test('unsafe local testing is explicitly opt-in and binds loopback', () => {
  assert.equal(policy({ NODE_ENV: 'development', RUNNER_TOKEN: token }).runtime, 'runsc');
  const p = policy({ NODE_ENV: 'development', RUNNER_TOKEN: token, RUNNER_ALLOW_UNSAFE_LOCAL: 'true', RUNNER_BIND: '0.0.0.0' });
  assert.equal(p.runtime, 'runc'); assert.equal(p.host, '127.0.0.1');
});
test('workload has no host mounts, ports, secrets, privileges, or network', () => {
  const args = createArgs(policy({ RUNNER_TOKEN: token }), 'session', 'sha256:image');
  for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--cpus=1', '--memory=1g', '--memory-swap=1g', '--log-driver=none']) assert.ok(args.includes(flag));
  for (const flag of ['-v', '--volume', '--mount', '-p', '--privileged', '--env-file', '-e']) assert.ok(!args.includes(flag));
  assert.ok(!args.join(' ').includes(token));
});
test('weak credentials and unsafe namespaces are rejected', () => {
  assert.throws(() => policy({ RUNNER_TOKEN: 'short' }));
  assert.throws(() => policy({ RUNNER_TOKEN: token, RUNNER_NAMESPACE: '--all' }));
});
