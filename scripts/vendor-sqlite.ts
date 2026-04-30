/**
 * vendor-sqlite.ts
 * Copies sqlite3.wasm out of @sqlite.org/sqlite-wasm into public/sqlite/ so the
 * browser can fetch it from a stable URL. Without this, sqlite-wasm tries to
 * derive the .wasm URL from its own JS module location — Vite's transform
 * pipeline breaks that derivation and the request resolves to index.html.
 *
 * Why we don't `import` the .wasm: Vite's `?url` import gives us a hashed URL,
 * but sqlite-wasm's Emscripten loader builds the URL itself via `locateFile`.
 * Easiest contract: vendor the file to a known path and tell sqlite where to
 * look via the locateFile callback in src/puzzles/db.ts.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = join(REPO_ROOT, 'public', 'sqlite');
const SOURCE = join(REPO_ROOT, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'sqlite-wasm', 'jswasm', 'sqlite3.wasm');

if (!existsSync(SOURCE)) {
  console.error(`[vendor-sqlite] not found: ${SOURCE}. Run npm install.`);
  process.exit(1);
}

if (!existsSync(TARGET_DIR)) mkdirSync(TARGET_DIR, { recursive: true });
const dest = join(TARGET_DIR, 'sqlite3.wasm');
copyFileSync(SOURCE, dest);
console.log(`[vendor-sqlite] copied sqlite3.wasm -> ${dest}`);
