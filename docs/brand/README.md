# Brand v2 in LearnChess

Aligned 2026-10-06 against Instrumenta `brand/` at commit `292a1dd` (`brand/ALIGNMENT.md`).
Instrumenta is the source; nothing here is edited by hand. To refresh, regenerate in Instrumenta
(`uv run brand/scripts/build-brand.py`) and copy again.

## Copied

| From `Instrumenta/brand/` | To | Used for |
| --- | --- | --- |
| `fonts/*.woff2`, `fonts.css`, `OFL-*.txt` | `public/fonts/brand/` | Fraunces, Commissioner, Spline Sans Mono (replaces the old Google-vendored Fraunces and JetBrains Mono, and `scripts/vendor-fonts.ts`) |
| `icons/svg/learnchess{,-24,-16}.svg` | `public/brand/` | favicon, fallback logo |
| `icons/png/learnchess-*.png`, `icons/ico/learnchess.ico` | `public/brand/` | favicons, apple-touch-icon |
| `artwork/learnchess-app-art.png` | `public/brand/` | `instrumenta/product.json` `assets.mark` (launcher tile art) |
| `icons/instrumenta-icons.{js,css}` | `public/brand/` | `Logo.tsx` renders the rook with `InstrumentaIcons.render('learnchess')`; it hops on hover/focus of the rail logo; `prefers-reduced-motion` stops it |
| `icons/svg/learnchess-animated.svg` | `docs/brand/` | README only (it carries an inline style, so it is not shipped in `dist`) |
| `tokens.json` "learnchess" block | `src/styles/globals.css` `--brand-*` | accent `#47B968`, secondary `#A7E2B2`, deep `#0B5D2A`, ink `#091A0D`, surface `#0E2513` |

`docs/images/learnchess-banner.png` (1600x500) was rendered from the brand files: surface field,
accent glow at the edges, Fraunces name, the rook from `InstrumentaIcons.render`, and the launcher's
blurb.

## Roles

- Accent: primary buttons, selected nav item, selection borders, progress, focus. Ink on accent is
  about 8:1. As text and focus ring on the light page the raw green is only about 2.6:1, so
  `--color-accent-strong` and `--color-focus` use the brand `deep` shade in light and the accent
  itself in dark. Use `text-accent-strong` and `ring-focus`, not `text-accent`/`ring-accent`.
- Fraunces (`"SOFT" 100, "WONK" 1`, weight 650): `h1`, `h2` and `.font-display` titles only. Card and
  list titles that used `font-display` now use Commissioner.
- Commissioner (`"FLAR" 40`): all interface text (previously Fraunces everywhere).
- Spline Sans Mono: FEN, PGN, counters (`font-mono`), replacing JetBrains Mono.

## Kept, and why

- Board square colours, piece sets, board themes, the tutor avatar, the opening-annotation badges
  and the amber/green/red status colours on lessons and puzzle feedback: content or meaning.
- Neutral charcoal and off-white surface ramps in both themes, so the board stays the only warm
  element. `surface` (`#0E2513`) is used only as the base of `--color-accent-soft` in dark.
- `<meta name="theme-color">` values follow the neutral page background, which is unchanged.
- The old v1 3D mark renderer (`scripts/render-brand-mark.py`, `npm run brand`) is removed.

## Not done / follow-ups

- `npm run build` ends with `scripts/write-notices.mjs`, which fails in this WSL checkout because
  `node_modules/cookie` is missing (Windows-installed `node_modules`); unrelated to this change.
  `vite build` itself succeeds and `auditWebBuild` passes.
- The README screenshots under `docs/screenshots/` still show the previous look.
