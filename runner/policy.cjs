'use strict';
function policy(env) {
  const local = env.NODE_ENV === 'development' && env.RUNNER_ALLOW_UNSAFE_LOCAL === 'true';
  const runtime = local ? 'runc' : 'runsc';
  if (!env.RUNNER_TOKEN || env.RUNNER_TOKEN.length < 32) throw new Error('RUNNER_TOKEN must contain at least 32 characters');
  const namespace = env.RUNNER_NAMESPACE || 'meridian';
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(namespace)) throw new Error('Invalid RUNNER_NAMESPACE');
  return { local, runtime, namespace, token: env.RUNNER_TOKEN,
    image: env.RUNNER_IMAGE || 'meridian-sandbox:local',
    host: local ? '127.0.0.1' : (env.RUNNER_BIND || '0.0.0.0'),
    port: Number(env.PORT || 4000), maxSandboxes: 8, maxPerUser: 2 };
}
function createArgs(config, name, image) {
  return ['run', '-d', '--pull=never', '--name', name,
    '--label', `meridian.runner=${config.namespace}`, '--runtime', config.runtime,
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--user=1000:1000', '--pids-limit=128', '--cpus=1', '--memory=1g', '--memory-swap=1g',
    '--ulimit=nofile=1024:1024', '--ulimit=core=0', '--log-driver=none',
    '--tmpfs=/workspace:rw,exec,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700',
    '--tmpfs=/tmp:rw,exec,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=1777',
    image];
}
module.exports = { policy, createArgs };
