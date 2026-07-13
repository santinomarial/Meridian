import * as fs from 'fs';
import * as path from 'path';

/** True if the string contains an ASCII control character (0x00–0x1F). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

/**
 * Validates a workspace-relative path and returns a cleaned POSIX form.
 *
 * Rejects anything that could escape a sandbox root: absolute paths, `..`
 * traversal segments, null bytes, and control characters. This is the first
 * line of defense — callers still resolve against the sandbox root and verify
 * containment (see {@link safeJoin}).
 */
export function assertSafeRelPath(relPath: string): string {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('Invalid path: empty');
  }

  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/'));
  if (path.posix.isAbsolute(normalized)) {
    throw new Error('Invalid path: absolute paths are not allowed');
  }

  const segments = normalized.split('/').filter((s) => s.length > 0 && s !== '.');
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error('Invalid path: path traversal is not allowed');
    }
    if (hasControlChar(segment)) {
      throw new Error('Invalid path: control characters are not allowed');
    }
  }

  const clean = segments.join('/');
  if (clean.length === 0) {
    throw new Error('Invalid path: resolves to the sandbox root');
  }
  return clean;
}

/**
 * Resolves a workspace-relative path against a sandbox root and guarantees the
 * result stays inside the root — including refusing to traverse a symlinked
 * ancestor that points outside the sandbox.
 */
export function safeJoin(root: string, relPath: string): string {
  const clean = assertSafeRelPath(relPath);
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, clean);

  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error('Invalid path: escapes the sandbox root');
  }

  // A final-component symlink is different from a symlinked ancestor: calls
  // such as writeFile follow it and can therefore modify a file outside the
  // sandbox. Reject both valid and dangling links. Mutation callers still use
  // syscall-level protections where available to close the lstat/open race.
  try {
    if (fs.lstatSync(resolved).isSymbolicLink()) {
      throw new Error('Invalid path: final component is a symlink');
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  // Reject if the nearest existing ancestor is a symlink pointing outside the
  // sandbox (prevents writing through a symlink the user created at runtime).
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(rootResolved);
  } catch {
    realRoot = rootResolved; // root not created yet
  }
  let ancestor = path.dirname(resolved);
  while (ancestor.length >= rootResolved.length) {
    if (fs.existsSync(ancestor)) {
      const real = fs.realpathSync(ancestor);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new Error('Invalid path: escapes the sandbox via a symlink');
      }
      break;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }

  return resolved;
}

/** Builds a single-quoted shell argument safe from injection/expansion. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
