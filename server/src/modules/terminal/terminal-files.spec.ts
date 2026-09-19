import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { readTerminalFiles, TERMINAL_FILE_MAX_BYTES } from './terminal-files';

describe('terminal text scanning', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'meridian-scan-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('includes nested UTF-8 and empty files but excludes generated, binary, oversized and linked files', async () => {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src/main.py'), 'print("café")\n');
    await fs.writeFile(path.join(root, 'empty.txt'), '');
    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(root, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
    await fs.writeFile(path.join(root, 'large.txt'), 'x'.repeat(TERMINAL_FILE_MAX_BYTES + 1));
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules/dependency.js'), 'dependency');
    await fs.mkdir(path.join(root, 'src/__pycache__'));
    await fs.writeFile(path.join(root, 'src/__pycache__/main.pyc'), 'cache');
    await fs.symlink('/etc/hosts', path.join(root, 'outside-link'));
    await fs.symlink(path.join(root, 'src'), path.join(root, 'linked-dir'));
    await fs.writeFile(path.join(root, 'hardlink.txt'), 'linked');
    await fs.link(path.join(root, 'hardlink.txt'), path.join(root, 'second-link.txt'));
    expect([...await readTerminalFiles(root)].sort()).toEqual([
      ['empty.txt', ''], ['src/main.py', 'print("café")\n'],
    ]);
  });

  it('rejects a replaced root symlink', async () => {
    await fs.rm(root, { recursive: true });
    await fs.symlink(os.tmpdir(), root);
    await expect(readTerminalFiles(root)).rejects.toThrow('Invalid terminal root');
  });
});
