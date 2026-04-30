/**
 * capture-screenshots.ts
 * Drives a real Chromium via Playwright against the running dev server
 * (or `npm run preview`) and saves PNGs to docs/screenshots/. Used to
 * populate the README hero / feature shots.
 *
 * Usage:
 *   npm run dev                  # in another terminal
 *   tsx scripts/capture-screenshots.ts [--base http://localhost:5173]
 */

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'docs', 'screenshots');

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1] ?? 'http://localhost:5173'
  : 'http://localhost:5173';

interface Shot {
  name: string;
  path: string;
  // Optional: wait for this selector before snapping (lets the chess
  // board / async data render before we capture).
  waitFor?: string;
  // Optional: extra millisecond pause on top of waitFor — for animation
  // settle (framer-motion fades, chessground board fade-in).
  settle?: number;
  // Optional click sequence to drive the page into the right state
  // before snapping.
  prep?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  { name: 'dashboard', path: '/', waitFor: 'main', settle: 400 },
  { name: 'play', path: '/play', waitFor: '.cg-board-host', settle: 700 },
  { name: 'tactics', path: '/tactics', waitFor: '.cg-board-host', settle: 1500 },
  { name: 'analysis', path: '/analysis', waitFor: '.cg-board-host', settle: 700 },
  { name: 'openings-catalogue', path: '/openings', waitFor: 'main', settle: 400 },
  { name: 'endgames-catalogue', path: '/endgames', waitFor: 'main', settle: 400 },
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  for (const shot of SHOTS) {
    const url = `${BASE}${shot.path}`;
    console.log(`[capture] ${shot.name} ← ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });
    if (shot.waitFor) {
      await page.waitForSelector(shot.waitFor, { timeout: 10_000 }).catch(() => {
        console.warn(`[capture]   waitFor "${shot.waitFor}" timed out — continuing`);
      });
    }
    if (shot.prep) await shot.prep(page);
    if (shot.settle) await page.waitForTimeout(shot.settle);
    const file = join(OUT_DIR, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`[capture]   wrote ${file}`);
  }

  await browser.close();
  console.log(`[capture] done. ${SHOTS.length} screenshots → ${OUT_DIR}`);
}

void main().catch((err: Error) => {
  console.error('[capture] failed:', err.message);
  process.exit(1);
});
