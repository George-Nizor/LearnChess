/**
 * vendor-fonts.ts
 *
 * Downloads Fraunces and JetBrains Mono from Google Fonts into
 * `public/fonts/` and writes a local `public/fonts/fonts.css` that
 * `index.html` links instead of `fonts.googleapis.com`.
 *
 * Why bother, when the CDN link worked fine. Two reasons, and only the
 * second one is new:
 *
 *  1. LearnChess is offline-first after the first load. A webfont fetched
 *     from a third party is the one asset that isn't, so the first offline
 *     visit silently falls back to a system serif.
 *  2. Inside Instrumenta the app is served by the launcher's static server
 *     under a per-product Content-Security-Policy with `default-src 'none'`.
 *     A stylesheet from `fonts.googleapis.com` and font files from
 *     `fonts.gstatic.com` are both blocked outright. Punching two holes in
 *     the CSP so a font can load is a bad trade when the font can just be
 *     a local file.
 *
 * Both families are SIL Open Font License 1.1, which permits redistribution
 * — see LICENSES.md. The licence text is fetched alongside the fonts so the
 * copy in `public/fonts/` carries its own terms.
 *
 * Run: `npm run vendor:fonts`
 *
 * Idempotent. Re-running overwrites whatever is currently upstream, which is
 * fine: these are variable fonts and the axes we ask for do not move.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'public', 'fonts');

/**
 * Google serves a different stylesheet per user agent. Claiming to be a
 * recent Chrome gets `woff2` with `unicode-range` subsets; claiming nothing
 * gets a `ttf` fallback that is several times the size.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** The same two families and axes `index.html` asked the CDN for. */
const FAMILIES = [
  'Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700;9..144,800',
  'JetBrains+Mono:wght@400;500;600',
] as const;

/** Both families ship their own copy of the licence; both are fetched so neither is asserted. */
const LICENCES = [
  {
    name: 'OFL-Fraunces.txt',
    url: 'https://raw.githubusercontent.com/undercasetype/Fraunces/master/OFL.txt',
  },
  {
    name: 'OFL-JetBrainsMono.txt',
    url: 'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/OFL.txt',
  },
] as const;

/**
 * The interface is English. Google's stylesheet also offers Cyrillic, Greek, and Vietnamese cuts,
 * which `unicode-range` means a browser would never download — but Instrumenta ships this folder
 * inside its installer, where every unused file is just weight. Dropping them halves it.
 */
const SUBSETS = new Set(['latin', 'latin-ext']);

async function get(url: string, accept: 'text' | 'binary'): Promise<string | Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return accept === 'text' ? await res.text() : new Uint8Array(await res.arrayBuffer());
}

interface FontFace {
  url: string;
  family: string;
  weight: string;
  subset: string;
}

/**
 * Splits the stylesheet into its `@font-face` blocks so each file can be named after the family,
 * weight, and subset it actually contains. The gstatic filenames are opaque hashes; a directory
 * of those is impossible to audit against a licence, which for an OFL font is the point.
 */
function faces(css: string): FontFace[] {
  const found: FontFace[] = [];
  const blocks = css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g);
  for (const block of blocks) {
    const subset = block[1] ?? 'latin';
    const body = block[2] ?? '';
    const url = body.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
    if (!url) continue;
    found.push({
      url,
      family: (body.match(/font-family:\s*'([^']+)'/)?.[1] ?? 'font')
        .toLowerCase()
        .replace(/\s+/g, '-'),
      weight: body.match(/font-weight:\s*([0-9]+)/)?.[1] ?? '400',
      subset,
    });
  }
  return found;
}

function fileNameFor(face: FontFace): string {
  return `${face.family}-${face.weight}-${face.subset}.woff2`;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const query = FAMILIES.map((family) => `family=${family}`).join('&');
  const css = (await get(
    `https://fonts.googleapis.com/css2?${query}&display=swap`,
    'text',
  )) as string;

  const found = faces(css).filter((face) => SUBSETS.has(face.subset));
  if (found.length === 0) throw new Error('The stylesheet named no font files.');

  console.log(`[vendor-fonts] ${found.length} font files`);
  let rewritten = css;
  let bytes = 0;
  const written = new Set<string>();
  for (const face of found) {
    const name = fileNameFor(face);
    if (written.has(name)) continue;
    written.add(name);
    const data = (await get(face.url, 'binary')) as Uint8Array;
    writeFileSync(join(OUT_DIR, name), data);
    bytes += data.byteLength;
    // Same-origin and root-relative, so it resolves under the dev server, the
    // Docker deploy, and the launcher's static server alike.
    rewritten = rewritten.split(face.url).join(`/fonts/${name}`);
  }

  // Any block still pointing at gstatic names a subset we chose not to ship, so it is dropped
  // rather than left to fail a request the CSP would block anyway.
  rewritten = rewritten.replace(
    /\/\*\s*[a-z-]+\s*\*\/\s*@font-face\s*\{[^}]*fonts\.gstatic\.com[^}]*\}\s*/g,
    '',
  );

  writeFileSync(
    join(OUT_DIR, 'fonts.css'),
    `/* Generated by scripts/vendor-fonts.ts. Do not edit by hand.\n` +
      `   Fraunces and JetBrains Mono, SIL Open Font License 1.1 — see OFL-*.txt. */\n${rewritten}`,
  );

  for (const licence of LICENCES) {
    try {
      writeFileSync(join(OUT_DIR, licence.name), await get(licence.url, 'text'));
    } catch (error) {
      console.warn(`[vendor-fonts] ${licence.name} not fetched: ${(error as Error).message}`);
    }
  }

  console.log(`[vendor-fonts] wrote ${OUT_DIR} (${Math.round(bytes / 1024)} KB of fonts)`);
}

main().catch((error: unknown) => {
  console.error(`[vendor-fonts] ${(error as Error).message}`);
  process.exit(1);
});
