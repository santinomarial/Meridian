// npm's published manifest references private development packages, so do not
// run npm install in its own installation directory. Install compatible fixes
// in a clean prefix, then replace their package directories (including scopes).
const fs = require('node:fs');
const path = require('node:path');
const source = '/tmp/npm-patches/node_modules';
const target = '/usr/local/lib/node_modules/npm/node_modules';
function replace(name) {
  const dest = path.join(target, name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(source, name), dest, { recursive: true });
}
for (const name of fs.readdirSync(source)) {
  if (name.startsWith('.')) continue;
  if (name.startsWith('@')) {
    for (const child of fs.readdirSync(path.join(source, name))) replace(`${name}/${child}`);
  } else replace(name);
}
