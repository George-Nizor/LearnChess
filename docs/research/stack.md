# LearnChess — Stack Research Brief (Phase 0)

**Compiled:** 2026-04-26
**Purpose:** Pin versions and lock decisions before any code is written.
All versions verified live against the npm registry / GitHub on the date above.

---

## Risk Register (read first)

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| R1 | **Stockfish is GPL-3.0.** Bundling it inside our app code arguably forces our app to be GPL too. | Legal / licensing | Ship Stockfish strictly as a **separate WASM + JS worker artifact** loaded from `/public/engine/` at runtime — never imported into our React tree, never bundled by Vite. The engine talks to us only via the UCI text protocol over `Worker.postMessage`. Keep it in a separate folder with its own LICENSE file. This is the convention used by Lichess and Chess.com. |
| R2 | **Multi-threaded Stockfish needs `SharedArrayBuffer`**, which requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers (cross-origin isolation). | Deployment friction. COEP `require-corp` blocks third-party iframes/images that don't send CORP headers. | Default to **single-threaded NNUE-lite** (~7 MB, no headers needed) for v1. Capability-detect `crossOriginIsolated`; if true, upgrade to multi-threaded. Plan headers on the prod host (Vercel/Netlify/CF Pages all support custom headers via config). Single-thread "lite" is still ~3000 Elo — overkill for a learning app. |
| R3 | **Lichess Opening Explorer now requires auth** as of April 2026 (changelog: "Using the opening explorer now requires being logged in because we can't defend anon requests against DDoS"). The `/masters` and `/lichess` endpoints on `explorer.lichess.ovh` return 429 to anonymous traffic. | Blocks our planned anonymous opening-explorer feature. | (a) Require user OAuth with Lichess for the explorer feature, OR (b) cache aggressively into our own SQLite/IndexedDB and rate-limit our backend's calls (one in-flight at a time, 60 s back-off on 429), OR (c) use the local PGN dataset only. Decision needed — flagged below. Source: [lichess.org/changelog](https://lichess.org/changelog), [lila issue #19610](https://github.com/lichess-org/lila/issues/19610). |
| R4 | **Lichess rate-limit policy** is dynamic and undocumented per-endpoint; official guidance is "one request at a time, wait 60 s on 429". | Burst traffic from prod = bans. | Server-side proxy with a single-flight queue + 60 s exponential back-off. Send a descriptive `User-Agent`. Cache responses by FEN. Source: [lichess.org/page/api-tips](https://lichess.org/page/api-tips). |
| R5 | **Puzzle dump is 293 MB compressed (.zst), ~1 GB uncompressed**, 5.88M rows. | Cannot ship to client; cannot ingest at runtime. | Build-time ingest only. Stream-decompress with `zstd`, parse with a CSV streamer, write to SQLite. Ship pre-built SQLite → either (a) server-side queries via API, or (b) sqlite-wasm + lazy HTTP range fetch on the client (sql.js-httpvfs pattern). A separate subagent owns the schema (`docs/research/puzzle-db.md`). |
| R6 | **React 19 vs 18.** All our picks (Zustand 5, React Query 5, shadcn/ui, Vite 8) work on either, but React 19 unlocks `ref`-as-prop, native `<title>`/`<meta>` hoisting, `useActionState`, `use()`. | Sticking with 18 = more boilerplate (`forwardRef`, `react-helmet`), no upgrade pressure. Going to 19 = strict-mode behavior changes and a few third-party libs may still warn. | **Recommend React 19.2.5** — it's been GA for ~16 months, ecosystem has caught up, no library on our list pins React 18. |
| R7 | **Tailwind v3 vs v4.** v4 is a ground-up rewrite (Oxide engine, CSS-first `@theme` config, OKLCH colors, `bg-linear-*` rename). shadcn/ui CLI (v4.5.0) supports both. | v4 is faster (3-100x), more modern, but new components scaffolded via `shadcn add` still default to v3 unless you explicitly init for v4. Some tutorials/snippets assume v3 syntax. `tailwindcss-animate` deprecated → use `tw-animate-css`. | **Recommend Tailwind v4.2.4** — initial commit, no migration debt. Use `shadcn init` with v4 flag. Decision flagged below. |
| R8 | **`stockfish-web` (lichess-org) vs `stockfish` npm (nmrugg).** The official Lichess builds (`lichess-org/stockfish-web`) are "not straight-forward to load and use" (per their own README). The community `stockfish` npm package (Nathan Rugg) is the one Chess.com uses, ships clean WASM artifacts, has a stable API. | Choosing the official-but-awkward repo costs us a week of integration time. | **Use `stockfish` 18.0.7 from npm** — same Stockfish 18 NNUE engine, ships single-thread + multi-thread + lite + asm.js variants, tagged releases on GitHub with direct WASM download URLs. |

---

## TL;DR Decision Matrix

| Layer | Pick | Version | License |
|---|---|---|---|
| Build tool | Vite | 8.0.10 | MIT |
| UI framework | React + React-DOM | 19.2.5 | MIT |
| Styling | Tailwind CSS | 4.2.4 | MIT |
| Component kit | shadcn/ui (CLI: `shadcn`) | 4.5.0 | MIT |
| Board renderer | chessground | 9.2.1 | GPL-3.0-or-later |
| Move/rules engine | chess.js | 1.4.0 | BSD-2-Clause |
| Chess engine (analysis) | stockfish (nmrugg WASM, SF 18 NNUE) | 18.0.7 | GPL-3.0 |
| State (client) | zustand | 5.0.12 | MIT |
| Server state / cache | @tanstack/react-query | 5.100.5 | MIT |
| Local storage | idb | 8.0.3 | ISC |
| Unit tests | vitest | 4.1.5 | MIT |
| E2E tests | @playwright/test | 1.59.1 | Apache-2.0 |

GPL-3.0 packages (chessground, stockfish) are **runtime artifacts loaded as workers / separate ES modules**, not statically linked. See R1.

---

## NPM Packages (verified against npm registry, 2026-04-26)

### 1. chessground — Lichess board renderer
- **Version:** 9.2.1 — published 2025-05-15
- **License:** GPL-3.0-or-later
- **Source:** https://www.npmjs.com/package/chessground · https://github.com/lichess-org/chessground
- **Use:** SVG/HTML board with drag-drop, premoves, annotations, arrows. The same board Lichess ships.
- **Notes:** Headless TypeScript, no React wrapper. We write a thin ~80-line React component that mounts to a `<div ref>`. Styles must be imported (`chessground/assets/chessground.base.css` + theme).
- **GPL caveat:** chessground is bundled into our JS, not loaded as a separate worker. The GPL-3.0-or-later license means our app linking it must also be GPL-compatible. **If we want a permissive license for our own code, we either (a) accept GPL for the whole frontend, (b) use react-chessboard instead, or (c) keep chessground but publish our app as GPL.** Decision flagged.
- **Alternatives considered:**
  - **react-chessboard** (MIT) — ergonomic, idiomatic React, but rendering is heavier and animations are less smooth than chessground. No premove/arrow support out of the box. Rejected for v1 because we want Lichess-quality UX, but acceptable fallback if GPL is a dealbreaker.
  - **chessboard.js** (MIT, jQuery era) — abandoned, last release 2019. Rejected.
  - **pixi.js custom** — overkill, weeks of work, no a11y. Rejected.

### 2. chess.js — Move generation, validation, PGN
- **Version:** 1.4.0 — published 2025-06-14
- **License:** BSD-2-Clause
- **Source:** https://www.npmjs.com/package/chess.js · https://github.com/jhlywa/chess.js
- **Use:** Legal move generation, FEN/PGN parsing, check/mate/draw detection, Zobrist hashing.
- **v1.0 rewrite (Jan 2024) — breaking changes from 0.x:**
  - All snake_case methods renamed to camelCase: `game_over` → `isGameOver`, `in_check` → `isCheck`, `in_checkmate` → `isCheckmate`, `in_draw` → `isDraw`, `in_stalemate` → `isStalemate`, `in_threefold_repetition` → `isThreefoldRepetition`, `insufficient_material` → `isInsufficientMaterial`, `load_pgn` → `loadPgn`, `validate_fen` → `validateFen`.
  - `.load()`, `.loadPgn()`, `.move()` now **throw** on invalid input instead of returning `null`/`false`.
  - Boolean second-arg overloads replaced by options objects: `clear({ preserveHeader: true })`.
  - `validateFen()` returns `{ ok: boolean, error?: string }`.
  - Native TypeScript with exported types — no more `@types/chess.js`.
  - 1.3.0 added grammar-based PGN parser + Zobrist hashing.
  - 1.4.0 added `setTurn()` and null-move support.
- **Alternatives considered:**
  - **chessops** (lichess-org, MIT) — used inside Lichess; faster, supports more variants, more rigorous TS. Rejected: API is lower-level (fp-style), steeper learning curve, smaller community.
  - **js-chess-engine** (MIT) — combined rules + minimax engine. Engine is too weak (~1500 Elo) and the rules API is awkward. Rejected.

### 3. stockfish — Chess engine (WASM)
- **Version:** 18.0.7 — published 2026-04-01
- **License:** GPL-3.0
- **Source:** https://www.npmjs.com/package/stockfish · https://github.com/nmrugg/stockfish.js
- **Use:** Position analysis (eval bar, best-move hints), puzzle solution checking when offline, "play vs engine".
- **Five flavors shipped** (per npm package README):
  | Build | Size | Threads | Strength | COOP/COEP needed |
  |---|---|---|---|---|
  | `stockfish-18.js/.wasm` (full) | >100 MB | multi | strongest | yes |
  | `stockfish-18-single.js/.wasm` (full) | >100 MB | single | strong | no |
  | `stockfish-18-lite.js/.wasm` (lite NNUE) | ~7 MB | multi | strong | yes |
  | **`stockfish-18-lite-single.js/.wasm` (lite NNUE)** | **~7 MB** | **single** | **strong (~3000 Elo)** | **no** |
  | `stockfish-18-asm.js` (asm.js) | ~10 MB | single | weakest | no |
- **Recommended for us:** start with `stockfish-18-lite-single` (no headers, fast load, plenty strong for teaching). Capability-detect `crossOriginIsolated && SharedArrayBuffer`, upgrade to `stockfish-18-lite` (multi-thread) when available. Never the full engine (>100 MB is a non-starter for web).
- **NNUE vs HCE:** NNUE = neural-network evaluation (default in SF 18, much stronger). HCE = hand-crafted eval (legacy, used only by the deprecated `lichess-org/stockfish.wasm` repo). All flavors above are NNUE.
- **Integration pattern:** Copy `stockfish-18-lite-single.js` + `.wasm` into `public/engine/`. Spawn `new Worker('/engine/stockfish-18-lite-single.js')`. Talk via UCI text commands (`uci`, `isready`, `position fen ...`, `go depth 18`, `bestmove ...`). Never `import` it.
- **Alternatives considered:**
  - **lichess-org/stockfish-web** (GPL-3.0, v0.3.0 Apr 2026) — official Lichess builds, supports SF 17.1, SF 18 smallnet, fairy-stockfish. Their own README admits "not straight-forward to load and use" and points users back to nmrugg. Rejected for v1 — revisit if we need fairy-stockfish for variants.
  - **lichess-org/stockfish.wasm** — deprecated, HCE only, no NNUE. The repo's own notice: "only kept for compatibility with old browsers." Rejected.
  - **js-chess-engine** (MIT minimax) — weak (~1500), no NNUE. Acceptable as a third-tier fallback for ancient browsers. Not for v1.
  - **Hosted Stockfish API (e.g., chess-api.com)** — external dep, rate-limited, latency, costs. Rejected — defeats the offline-first goal.

### 4. vite — Build tool
- **Version:** 8.0.10 — published 2026-04-23
- **License:** MIT
- **Source:** https://www.npmjs.com/package/vite
- **Use:** Dev server (HMR), production build, asset pipeline.
- **Notes:** v8 dropped Node 18 (requires Node 20.19+ or 22+). Use `@tailwindcss/vite` plugin for Tailwind v4 (much faster than PostCSS pipeline).
- **Alternatives considered:**
  - **Next.js** — overkill, we don't need RSC/SSR for v1 (puzzle UI is client-heavy). Adds runtime complexity. Rejected.
  - **Remix / React Router framework mode** — same reasoning. Rejected for v1, revisit if we need server-rendered SEO pages.
  - **Parcel / Webpack** — slower DX, more config. Rejected.

### 5. react / react-dom
- **Version:** 19.2.5 (both) — published 2026-04-08
- **License:** MIT
- **Source:** https://www.npmjs.com/package/react
- **What v18 → v19 buys you (per [react.dev/blog/2024/12/05/react-19](https://react.dev/blog/2024/12/05/react-19)):**
  - Actions + `useActionState` + `useFormStatus` + `useOptimistic` (form/async patterns without manual pending state)
  - `use()` hook (read promises/context conditionally in render)
  - **`ref` as a prop** (no more `forwardRef` boilerplate — huge for our chessground React wrapper)
  - Native document metadata: `<title>`/`<meta>`/`<link>` hoist to `<head>` automatically
  - Stylesheet `precedence`, async script support
  - Stable Server Components (irrelevant for SPA)
- **What you lose by sticking with v18:** All of the above. Mostly DX paper cuts; nothing on our list is blocked.
- **Recommend:** **v19.** None of our deps require staying on v18.

### 6. zustand — Client state
- **Version:** 5.0.12 — published 2026-03-16
- **License:** MIT
- **Source:** https://www.npmjs.com/package/zustand
- **Use:** Local UI state (engine settings, puzzle progress, board orientation). Lightweight, no boilerplate.
- **v5 breaking changes from v4** ([release notes](https://github.com/pmndrs/zustand/releases/tag/v5.0.0)):
  - Default export removed → must use named imports (`import { create } from 'zustand'`).
  - React 18+ required.
  - TypeScript 4.5+ required.
  - `useSyncExternalStore` is now a peer dep; for custom equality functions, import from `zustand/traditional` (`createWithEqualityFn`).
  - `setState` replace-flag is type-strict.
  - Persist middleware behavior tweaked.
  - UMD/SystemJS/ES5 builds dropped.
- **Alternatives considered:**
  - **Redux Toolkit** (MIT) — more boilerplate, time-travel debugging is overkill for our scope. Rejected.
  - **Jotai** (MIT) — atom-based, nice ergonomics. Roughly equivalent to zustand for our needs; we pick zustand because the team is more familiar and the docs are smaller. Acceptable alternative.
  - **React Context only** — fine for very small state; but engine config + puzzle queue + UI prefs is enough that a store is cleaner. Rejected for v1's scope.

### 7. @tanstack/react-query — Server state
- **Version:** 5.100.5 — published 2026-04-25
- **License:** MIT
- **Source:** https://www.npmjs.com/package/@tanstack/react-query
- **Use:** All HTTP fetches (Lichess opening explorer, tablebase, our own backend). Cache, retry, dedupe, background refetch.
- **Notes:** v5 (current major) requires React 18+. Stable API since late 2023. Pairs with `@tanstack/react-query-devtools` (separate dep).
- **Alternatives considered:**
  - **SWR** (MIT, Vercel) — simpler API, smaller bundle. Lacks React Query's mutation lifecycle, infinite queries, and devtools. Rejected — our explorer/tablebase pagination needs are real.
  - **Apollo Client** — GraphQL-first, irrelevant for REST. Rejected.
  - **Plain `fetch` + zustand** — works, but reinventing cache invalidation/retry is busywork. Rejected.

### 8. tailwindcss — Styling
- **Version:** 4.2.4 — published 2026-04-21
- **License:** MIT
- **Source:** https://www.npmjs.com/package/tailwindcss · https://tailwindcss.com/blog/tailwindcss-v4
- **Use:** Utility-first CSS for everything outside the chess board.
- **v4 vs v3:**
  - Oxide engine: 3.5x full builds, 100x incremental no-change.
  - **CSS-first config** in `@theme {}` block — no more `tailwind.config.js` (it still works as a fallback during transition).
  - **OKLCH color palette** by default (wider gamut, more vivid).
  - `bg-gradient-*` renamed to `bg-linear-*`, plus new `bg-conic-*`, `bg-radial-*`.
  - Single `@import "tailwindcss"` replaces `@tailwind base/components/utilities`.
  - No `content` config — automatic content detection.
  - Container queries built-in.
  - First-party `@tailwindcss/vite` plugin (use this, not PostCSS).
  - Modern browser baseline: Safari 16.4+, Chrome 111+, Firefox 128+. **Will not work on older browsers.**
- **Compatibility tax:** `tailwindcss-animate` is deprecated → use `tw-animate-css` instead (shadcn upstreamed this in March 2025).
- **Alternatives considered:**
  - **vanilla CSS / CSS Modules** — fine, more verbose, no built-in design system. Rejected for velocity.
  - **CSS-in-JS (Emotion, styled-components)** — runtime cost, SSR pain, style-tag explosion. Rejected.
  - **Panda CSS / UnoCSS** — interesting but smaller communities. Rejected.

### 9. shadcn/ui — Component kit (CLI: `shadcn`)
- **CLI version:** 4.5.0 — published 2026-04-25
- **License:** MIT
- **Source:** https://ui.shadcn.com · https://github.com/shadcn-ui/ui
- **Install model:** **Still copy-paste.** You run `pnpm dlx shadcn@latest add button` and it copies `Button.tsx` into `src/components/ui/`. You own the code — no `node_modules/@shadcn/button`. This is the entire point.
- **Tailwind v4 support:** **Yes, full** ([shadcn docs/tailwind-v4](https://ui.shadcn.com/docs/tailwind-v4)). "All components are updated for Tailwind v4 and React 19" and the upgrade is non-breaking. CLI's `init` can scaffold for v3 OR v4 — your `components.json` records the choice. Existing v3 projects keep working; new components added after v4 init use v4 conventions.
- **Gotchas:**
  - `tailwindcss-animate` → `tw-animate-css` (handled by recent CLI).
  - New OKLCH dark-mode color palette (upgraded projects can keep old colors).
  - Tailwind v4 needs modern browsers (see above).
- **Alternatives considered:**
  - **Radix UI primitives raw** — what shadcn is built on. Lower level, more wiring per component. Acceptable, but shadcn just bundles the wiring. No reason to skip shadcn.
  - **Material UI / Mantine / Chakra** (MIT) — opinionated runtime CSS-in-JS, hard to restyle to fit a chess aesthetic, larger bundles. Rejected.
  - **Headless UI** (Tailwind Labs) — fewer components, no command-bar/sheet/etc. Acceptable supplement, not replacement.

### 10. idb — IndexedDB wrapper
- **Version:** 8.0.3 — published 2025-05-07
- **License:** ISC (MIT-equivalent)
- **Source:** https://www.npmjs.com/package/idb · https://github.com/jakearchibald/idb
- **Use:** Persist solved-puzzle history, user prefs, in-memory engine cache flushes, optional offline puzzle slice (a few thousand cached rows).
- **Notes:** Tiny (~1 KB gz), promise-wrapped IndexedDB, no schema migrations beyond what IDB itself offers. Author is Jake Archibald (Chrome DevRel). Rock-solid since 2017.
- **Alternatives considered:**
  - **Dexie.js** (Apache-2.0) — bigger API, query DSL, observable/live queries. Probably overkill for our writes-mostly use case. Acceptable if we later need complex queries.
  - **localforage** (Apache-2.0) — auto-falls-back to localStorage/WebSQL. Outdated; modern browsers all support IDB. Rejected.
  - **sqlite-wasm in OPFS** — possible for the puzzle DB itself (separate research file owns this). Distinct from `idb` use case.

### 11. vitest — Unit / component tests
- **Version:** 4.1.5 — published 2026-04-21
- **License:** MIT
- **Source:** https://www.npmjs.com/package/vitest
- **Use:** Pure-function tests (chess logic, parsers, store reducers), React component tests via `@testing-library/react` + `jsdom` or `happy-dom`.
- **Notes:** Drop-in Jest API surface, runs on Vite's ESM transform — no separate babel-jest config. v4 native browser-mode (Playwright-driven) is GA but not required for v1.
- **Alternatives considered:**
  - **Jest** (MIT) — has to be reconfigured to share Vite's transform pipeline (`@swc/jest` or `babel-jest` + Vite plugins). Pointless when vitest exists for a Vite project. Rejected.
  - **node:test** — too primitive for component tests. Rejected.

### 12. @playwright/test — E2E
- **Version:** 1.59.1 — published 2026-04-01
- **License:** Apache-2.0
- **Source:** https://www.npmjs.com/package/@playwright/test
- **Use:** Full-flow tests (load app → solve a puzzle → verify rating updates). Cross-browser (Chromium / Firefox / WebKit). Built-in trace viewer.
- **Alternatives considered:**
  - **Cypress** (MIT) — single-browser per run, no native iframe / multi-tab support, slower. Playwright surpasses it on every axis we care about. Rejected.
  - **Puppeteer** — Chromium-only, no `test` runner. Rejected.

---

## Lichess APIs (no key required, free — see R3, R4)

### Opening Explorer — `https://explorer.lichess.ovh`
**Source:** [github.com/lichess-org/lila-openingexplorer](https://github.com/lichess-org/lila-openingexplorer)

**Endpoints we care about:**

| Path | Purpose | Notes |
|---|---|---|
| `GET /masters` | Master games (2200+ Elo, both players) | Smaller, curated. Best for opening study. |
| `GET /lichess` | All rated Lichess games | Filter by speed/rating. Huge dataset. |
| `GET /player` | Per-player opening repertoire | Separate use case (user's own games). |

**Common query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `variant` | string | `chess` | `chess`, `antichess`, `atomic`, `crazyhouse`, `horde`, `kingOfTheHill`, `racingKings`, `threeCheck` |
| `fen` | string | start position | URL-encode the FEN |
| `play` | string | empty | UCI moves from `fen`, comma-separated (e.g., `e2e4,e7e5`) |
| `speeds` | string | all | `bullet,blitz,rapid,classical,correspondence` (`/lichess` only) |
| `ratings` | string | all | `0,1000,1200,1400,1600,1800,2000,2200,2500` (`/lichess` only) |
| `moves` | int | `12` | How many top moves to return |
| `topGames` | int | `0` | How many top games to embed (max 4 for `/lichess`, 15 for `/masters`) |
| `recentGames` | int | `0` | (`/lichess` only) |
| `since` | `YYYY-MM` | `0000-01` | Date floor (`/masters`: `1952-01` recommended) |
| `until` | `YYYY-MM` | `3000-12` | Date ceiling |

**Response shape (NDJSON streamed):**
```json
{
  "white": 10,
  "draws": 1,
  "black": 22,
  "moves": [
    { "uci": "e7e5", "san": "e5", "white": 6, "draws": 1, "black": 9, "averageOpponentRating": 1500 }
  ],
  "topGames": [],
  "recentGames": [],
  "opening": { "eco": "B00", "name": "King's Pawn" },
  "queuePosition": 3
}
```
`Content-Type: application/x-ndjson` — be ready to read line-by-line if you stream.

**Rate limits:** Officially: "one request at a time, wait 60 s on 429" ([api-tips](https://lichess.org/page/api-tips)). Per-endpoint thresholds are intentionally undocumented and adaptive.

**CRITICAL — auth requirement (April 2026):** Per [lichess.org/changelog](https://lichess.org/changelog): "Using the opening explorer now requires being logged in because we can't defend anon requests against DDoS." Anonymous requests to `/masters` and `/lichess` may return 429 indefinitely. Plan: require Lichess OAuth, OR ship our own pre-built opening book (subset of the public PGN dump), OR proxy through our backend with an authenticated bot account. **DECISION FLAGGED.**

### Tablebase — `https://tablebase.lichess.ovh`
**Source:** [github.com/lichess-org/lila-tablebase](https://github.com/lichess-org/lila-tablebase)

**Endpoints:**

| Path | Purpose |
|---|---|
| `GET /standard?fen=...` | Probe Syzygy 7-piece tablebase for standard chess |
| `GET /standard/mainline?fen=...` | Best continuation only |
| `GET /atomic`, `GET /antichess` | Variant tablebases |

**Query param:** `fen=<urlencoded>` (underscores allowed in place of spaces, per lila-tablebase docs).

**Response shape:**
```json
{
  "category": "win",
  "dtz": 14,
  "precise_dtz": 14,
  "dtm": 22,
  "dtc": null,
  "checkmate": false,
  "stalemate": false,
  "insufficient_material": false,
  "variant_win": false,
  "variant_loss": false,
  "moves": [
    { "uci": "e6e7", "san": "e7", "category": "win", "dtz": 13, "dtm": 21, "zeroing": false, "checkmate": false }
  ]
}
```

**Coverage:** Up to **7 pieces** standard chess (Syzygy 7-man). Some 8-piece partial coverage. Returns 404 for positions outside coverage; we should treat as "unknown, fall back to engine".

**Use case:** Endgame trainer — show "this is winning in 14 moves, the only winning move is …". Critical for puzzle solutions in K+P endings.

**Rate limits:** Same as above (one in-flight, 60 s on 429). The tablebase service was unaffected by the explorer outage and is currently operational as far as we can verify.

### Puzzle DB Dump — `https://database.lichess.org/`
- **Download URL:** `https://database.lichess.org/lichess_db_puzzle.csv.zst`
- **File size (verified via HEAD 2026-04-26):** **293,504,725 bytes (~280 MB compressed)**
- **Last-Modified:** Wed, 01 Apr 2026 07:50:48 GMT
- **Row count:** 5,882,680 puzzles (per the database.lichess.org page, last updated 2026-04-02)
- **Columns:** `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`
- **License:** CC0 — "research, commercial purpose, publication, anything you like." No attribution required (though courtesy welcome).
- **Note:** Schema design and ingest pipeline are owned by a separate research file (`docs/research/puzzle-db.md`).

---

## Decisions Flagged for User

1. **Tailwind v3 vs v4?** Recommend **v4** (greenfield, no migration debt, official shadcn support). Rejecting v4 only makes sense if you need to support pre-2024 browsers, which a chess learning app does not.
2. **React 18 vs 19?** Recommend **v19** (`ref` as prop alone is worth it for our chessground wrapper). No deps block this.
3. **chessground (GPL) vs react-chessboard (MIT)?** Recommend **chessground** for v1 board UX quality. This forces our app to be GPL-3.0-compatible (or AGPL), which may matter for licensing/business plans down the line. If we want a permissive license for our codebase, switch to react-chessboard now — the API delta is small but real.
4. **Opening Explorer strategy** (R3): pick one — (a) require Lichess OAuth, (b) ship an offline opening book derived from the puzzle/PGN dumps and skip the live explorer, (c) proxy through backend with an auth'd Lichess bot. Recommend (b) for v1, (a) as a v2 power-user feature.
5. **Stockfish multi-threaded build?** Recommend default = **single-threaded lite NNUE** (no header config, ~7 MB, ~3000 Elo). Add capability-detected upgrade to multi-thread later if telemetry shows analysis depth is a complaint. Multi-thread requires COOP+COEP headers on the prod host (Vercel/Netlify/CF Pages — all configurable, but breaks 3rd-party iframes/images without CORP).

---

## Pin File (paste into `package.json`)

```json
{
  "dependencies": {
    "react": "19.2.5",
    "react-dom": "19.2.5",
    "chessground": "9.2.1",
    "chess.js": "1.4.0",
    "zustand": "5.0.12",
    "@tanstack/react-query": "5.100.5",
    "idb": "8.0.3"
  },
  "devDependencies": {
    "vite": "8.0.10",
    "tailwindcss": "4.2.4",
    "@tailwindcss/vite": "4.2.4",
    "shadcn": "4.5.0",
    "vitest": "4.1.5",
    "@playwright/test": "1.59.1"
  }
}
```

Stockfish is **not** an npm dep — copy `stockfish-18-lite-single.js` and `stockfish-18-lite-single.wasm` from the [v18.0.0 GitHub release](https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0) into `public/engine/` at install time (or vendor them into the repo). Use the npm package only as a version anchor / for the README docs.
