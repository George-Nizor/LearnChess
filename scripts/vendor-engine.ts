/**
 * vendor-engine.ts
 * Copies Stockfish WASM engine artifacts from node_modules/stockfish/ into
 * public/engine/. The .js worker has its companion .wasm (and .nnue) filenames
 * BAKED IN — so we MUST preserve original names. We also write engine.json
 * pointing at the JS entry, which StockfishEngine.ts reads at runtime.
 *
 * The engine is a separate Web Worker communicating over UCI. LearnChess is
 * GPL-3.0-or-later; the release includes full notices and corresponding source.
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = join(REPO_ROOT, 'public', 'engine');
const STOCKFISH_PKG_DIR = join(REPO_ROOT, 'node_modules', 'stockfish');

const PREFERRED_VARIANTS = [
  'stockfish-nnue-16-single',
  'stockfish-16-single',
  'stockfish-nnue-16',
  'stockfish-16',
  'stockfish-18-lite-single',
  'stockfish-18-lite',
  'stockfish-nnue-17-single',
  'stockfish-nnue-17',
];

interface VariantFiles {
  jsPath: string;
  wasmPath: string | null;
  binPaths: string[];
}

function findFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const acc: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) stack.push(full);
      else acc.push(full);
    }
  }
  return acc;
}

function pickVariant(allFiles: string[]): VariantFiles | null {
  for (const variant of PREFERRED_VARIANTS) {
    const js = allFiles.find((f) => basename(f) === `${variant}.js`);
    if (!js) continue;
    const wasm = allFiles.find((f) => basename(f) === `${variant}.wasm`) ?? null;
    const bins = allFiles.filter((f) => /\.(nnue|bin)$/.test(f));
    return { jsPath: js, wasmPath: wasm, binPaths: bins };
  }
  return null;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeLicenseFiles(): void {
  const files = findFilesRecursive(STOCKFISH_PKG_DIR);
  const licence = files.find(f => /^(copying|license)(\.txt)?$/i.test(basename(f)));
  if (!licence) throw new Error('Stockfish package is missing its licence');
  writeFileSync(join(TARGET_DIR, 'LICENSE.GPL'), readFileSync(licence, 'utf8').replace(/\r\n/g, '\n'));
  const version = JSON.parse(readFileSync(join(STOCKFISH_PKG_DIR, 'package.json'), 'utf8')).version;
  const appVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
  writeFileSync(join(TARGET_DIR, 'STOCKFISH-SOURCES.txt'),
    `Stockfish.js ${version}, GPL-3.0. Unmodified JS/WASM and NNUE from the locked npm package.
Corresponding C++ sources, build files and network files accompany this release:
https://github.com/George-Nizor/LearnChess/releases/download/v${appVersion}/LearnChess-${appVersion}-sources.zip
Upstream: https://github.com/nmrugg/stockfish.js
Package: https://registry.npmjs.org/stockfish/-/stockfish-${version}.tgz
`);
}

function main(): void {
  if (!existsSync(STOCKFISH_PKG_DIR)) {
    console.error(`[vendor-engine] node_modules/stockfish not found. Run: npm install`);
    process.exit(1);
  }

  ensureDir(TARGET_DIR);

  const allFiles = findFilesRecursive(STOCKFISH_PKG_DIR);
  const variant = pickVariant(allFiles);
  if (!variant) {
    console.error('[vendor-engine] could not locate a stockfish .js variant in node_modules/stockfish/');
    process.exit(1);
  }

  const jsBase = basename(variant.jsPath);
  const wasmBase = variant.wasmPath ? basename(variant.wasmPath) : null;

  copyFileSync(variant.jsPath, join(TARGET_DIR, jsBase));
  console.log(`[vendor-engine] copied ${jsBase}`);

  if (wasmBase && variant.wasmPath) {
    copyFileSync(variant.wasmPath, join(TARGET_DIR, wasmBase));
    console.log(`[vendor-engine] copied ${wasmBase}`);
  }

  for (const bin of variant.binPaths) {
    const binBase = basename(bin);
    copyFileSync(bin, join(TARGET_DIR, binBase));
    console.log(`[vendor-engine] copied ${binBase}`);
  }

  // Manifest read by StockfishEngine.ts at runtime so the engine code doesn't
  // hardcode a Stockfish version-specific filename.
  const manifest = {
    jsFile: jsBase,
    wasmFile: wasmBase,
    bins: variant.binPaths.map((p) => basename(p)),
    vendoredAt: new Date().toISOString(),
  };
  writeFileSync(join(TARGET_DIR, 'engine.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[vendor-engine] wrote engine.json -> jsFile=${jsBase}`);

  writeLicenseFiles();
  console.log(`[vendor-engine] done. ${TARGET_DIR}`);
}

main();
