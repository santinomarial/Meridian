/**
 * node-pty ships a `spawn-helper` binary used to fork the shell on Unix. Some
 * npm/prebuild extraction paths drop the executable bit, which makes
 * `pty.spawn` fail at runtime with "posix_spawnp failed". This best-effort
 * postinstall step restores +x on any spawn-helper it can find.
 *
 * Safe to run anywhere: it is a no-op on Windows and silently ignores a missing
 * node-pty (e.g. an install that skipped optional native deps).
 */
const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') process.exit(0);

const root = path.join(__dirname, '..', 'node_modules', 'node-pty');
const candidates = [
  path.join(root, 'build', 'Release', 'spawn-helper'),
  path.join(root, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
  path.join(root, 'prebuilds', 'darwin-x64', 'spawn-helper'),
  path.join(root, 'prebuilds', 'linux-x64', 'spawn-helper'),
  path.join(root, 'prebuilds', 'linux-arm64', 'spawn-helper'),
];

for (const file of candidates) {
  try {
    if (fs.existsSync(file)) {
      fs.chmodSync(file, 0o755);
    }
  } catch {
    // Best-effort only — never fail the install over this.
  }
}
