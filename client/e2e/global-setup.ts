/**
 * Playwright global setup — runs once before any test suite.
 * Creates small binary fixtures that tests need (e.g. the test ZIP).
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Minimal valid ZIP fixture ─────────────────────────────────────────────────
// A ZIP containing one file: hello.ts  →  const hello = 'world';\n
// Generated with a hand-crafted local-file-header + central-directory so no
// runtime library dependency is needed here.
function buildMinimalZip(filename: string, content: string): Buffer {
  const nameBytes = Buffer.from(filename, "utf8");
  const dataBytes = Buffer.from(content, "utf8");
  const crc = crc32(dataBytes);
  const now = new Date();
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);

  // Local file header
  const lh = Buffer.alloc(30 + nameBytes.length);
  lh.writeUInt32LE(0x04034b50, 0); // signature
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt16LE(0, 6); // flags
  lh.writeUInt16LE(0, 8); // compression (stored)
  lh.writeUInt16LE(dosTime, 10);
  lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(dataBytes.length, 18); // compressed size
  lh.writeUInt32LE(dataBytes.length, 22); // uncompressed size
  lh.writeUInt16LE(nameBytes.length, 26);
  lh.writeUInt16LE(0, 28); // extra field length
  nameBytes.copy(lh, 30);

  const lfOffset = 0;

  // Central directory entry
  const cd = Buffer.alloc(46 + nameBytes.length);
  cd.writeUInt32LE(0x02014b50, 0); // signature
  cd.writeUInt16LE(20, 4); // version made by
  cd.writeUInt16LE(20, 6); // version needed
  cd.writeUInt16LE(0, 8); // flags
  cd.writeUInt16LE(0, 10); // compression
  cd.writeUInt16LE(dosTime, 12);
  cd.writeUInt16LE(dosDate, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(dataBytes.length, 20);
  cd.writeUInt32LE(dataBytes.length, 24);
  cd.writeUInt16LE(nameBytes.length, 28);
  cd.writeUInt16LE(0, 30); // extra
  cd.writeUInt16LE(0, 32); // comment
  cd.writeUInt16LE(0, 34); // disk start
  cd.writeUInt16LE(0, 36); // internal attrs
  cd.writeUInt32LE(0, 38); // external attrs
  cd.writeUInt32LE(lfOffset, 42); // local header offset
  nameBytes.copy(cd, 46);

  const cdOffset = lh.length + dataBytes.length;
  const cdSize = cd.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([lh, dataBytes, cd, eocd]);
}

// Simple CRC-32 (no dependency)
function crc32(buf: Buffer): number {
  const table = makeCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (table[(crc ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable(): number[] {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
}

// ── Export ────────────────────────────────────────────────────────────────────

export default async function globalSetup() {
  const fixturesDir = path.join(__dirname, "fixtures");
  fs.mkdirSync(fixturesDir, { recursive: true });

  const zipPath = path.join(fixturesDir, "test-project.zip");
  const zip = buildMinimalZip("hello.ts", "const hello = 'world';\n");
  fs.writeFileSync(zipPath, zip);

  // Best-effort: purge throwaway accounts left behind by previous runs. The
  // endpoint only works when the server is started with E2E_TEST=true, and is
  // a no-op (or unreachable) otherwise — so failures here are non-fatal.
  const backendUrl =
    process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";
  try {
    await fetch(`${backendUrl}/e2e/cleanup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailPrefix: "e2e-" }),
    });
  } catch {
    // Backend not running (offline-only test run) — ignore.
  }
}
