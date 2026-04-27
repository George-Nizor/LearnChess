/**
 * vendor-sounds.ts
 *
 * Downloads multiple Lichess sound packs into `public/sounds/<pack>/`. Lichess
 * assets are GPL-3.0 (same umbrella as our app), so re-distribution under our
 * project licence is fine. Source: github.com/lichess-org/lila/public/sound/.
 *
 * Layout:
 *   public/sounds/<pack>/{move,capture,check,genericNotify}.mp3
 *
 * Backwards-compat: also writes a copy of the `standard` pack into
 * `public/sounds/{move,capture,check,genericNotify}.mp3` (no subfolder) so any
 * older code path that still hits the flat URLs keeps working until the
 * caller migrates to the pack-aware sound utility.
 *
 * Falls back gracefully on any 404 — the runtime sound utility synthesises
 * the missing sounds via WebAudio if a file is absent.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = join(REPO_ROOT, 'public', 'sounds');
const BASE = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/sound';

/** Lichess sound packs we ship. Each pack has the same four files. */
const PACKS = ['standard', 'piano', 'nes', 'futuristic'] as const;

interface SoundFile {
  /** Local filename (lowercase, our convention). */
  local: string;
  /** Remote filename inside the lichess pack folder (PascalCase). */
  remote: string;
}

const FILES: ReadonlyArray<SoundFile> = [
  { local: 'move.mp3',          remote: 'Move.mp3' },
  { local: 'capture.mp3',       remote: 'Capture.mp3' },
  { local: 'check.mp3',         remote: 'Check.mp3' },
  { local: 'genericNotify.mp3', remote: 'GenericNotify.mp3' },
];

async function downloadOne(url: string, dst: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[vendor-sounds] ${dst}: HTTP ${res.status}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dst, buf);
    console.log(`[vendor-sounds] ${dst} (${(buf.length / 1024).toFixed(1)} KB)`);
    return true;
  } catch (err) {
    console.warn(`[vendor-sounds] ${dst}: ${(err as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  if (!existsSync(TARGET_DIR)) mkdirSync(TARGET_DIR, { recursive: true });

  let total = 0;
  let ok = 0;

  for (const pack of PACKS) {
    const packDir = join(TARGET_DIR, pack);
    if (!existsSync(packDir)) mkdirSync(packDir, { recursive: true });
    for (const f of FILES) {
      total++;
      const url = `${BASE}/${pack}/${f.remote}`;
      const dst = join(packDir, f.local);
      if (await downloadOne(url, dst)) ok++;
    }
  }

  // Backwards-compat copy: mirror `standard` pack into the flat /public/sounds/
  // location used by the v1 sound utility. Cheaper than a second fetch.
  for (const f of FILES) {
    const src = join(TARGET_DIR, 'standard', f.local);
    const dst = join(TARGET_DIR, f.local);
    if (existsSync(src)) {
      try {
        const { copyFileSync } = await import('node:fs');
        copyFileSync(src, dst);
      } catch (err) {
        console.warn(`[vendor-sounds] flat copy ${f.local}: ${(err as Error).message}`);
      }
    }
  }

  console.log(`[vendor-sounds] done. ${ok}/${total} downloaded across ${PACKS.length} packs`);
  if (ok === 0) {
    console.warn('[vendor-sounds] all downloads failed — runtime will fall back to synthesised WebAudio sounds');
  }
}

void main();
