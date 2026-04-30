# LearnChess

Self-contained chess learning web platform: Openings trainer + Tactics trainer + Endgame trainer + Play-vs-engine. Offline-first after first load. No backend required for v1.

> Full reasoning for every pick lives in [`docs/research/stack.md`](docs/research/stack.md) and [`docs/research/puzzle-db.md`](docs/research/puzzle-db.md). Read those first before changing anything in this file.

---

## Architecture decisions (Phase 0, locked 2026-04-26)

All versions verified live against npm on 2026-04-26.

| Layer | Pick | Version | License |
|---|---|---|---|
| Build tool | Vite | 8.0.10 | MIT |
| UI framework | React + React-DOM | 19.2.5 | MIT |
| Styling | Tailwind CSS (Oxide engine) | 4.2.4 | MIT |
| Component kit | shadcn/ui (CLI) | 4.5.0 | MIT |
| Board renderer | chessground | 9.2.1 | **GPL-3.0-or-later** |
| Move/rules engine | chess.js | 1.4.0 | BSD-2-Clause |
| Chess engine | stockfish (nmrugg WASM, SF 18 NNUE lite-single) | 18.0.7 | **GPL-3.0** |
| Client state | zustand | 5.0.12 | MIT |
| Server state / cache | @tanstack/react-query | 5.100.5 | MIT |
| Local persistence | idb (IndexedDB wrapper) | 8.0.3 | ISC |
| Puzzle DB runtime | @sqlite.org/sqlite-wasm | latest | Public Domain (blessing) |
| Unit tests | vitest | 4.1.5 | MIT |
| E2E tests | @playwright/test | 1.59.1 | Apache-2.0 |

**Why these and not alternatives:** see the per-package "Alternatives considered" tables in [`docs/research/stack.md`](docs/research/stack.md).

### Architectural rules

1. **Stockfish is GPL — never `import` it.** Vendor `stockfish-18-lite-single.js` + `.wasm` into `public/engine/`, spawn via `new Worker('/engine/stockfish-18-lite-single.js')`, talk via the UCI text protocol. The engine is a runtime artifact, not a linked library. See [`LICENSES.md`](LICENSES.md).
2. **chessground is GPL.** Bundled into our JS — so our app must ship under a GPL-compatible license (default plan: GPL-3.0-or-later). If we want a permissive license later, swap to `react-chessboard` (MIT, decent but lower-quality UX).
3. **All engine work runs in a Web Worker.** Never block the UI thread with analysis.
4. **All Lichess API calls are cached** (TanStack Query, FEN-keyed) and respect "one in-flight, 60 s back-off on 429" ([api-tips](https://lichess.org/page/api-tips)).
5. **Puzzle DB is built at build time, shipped as a static asset.** No runtime ingest of the 280 MB Lichess dump. See [`docs/research/puzzle-db.md`](docs/research/puzzle-db.md).
6. **Per-user progress lives in IndexedDB.** No accounts, no backend, no telemetry in v1.
7. **TypeScript strict mode, no `any`.** Eslint enforces.
8. **WCAG AA.** Full keyboard navigation of the board, ARIA roles on every interactive element, contrast checks in CI.

### Things deferred from v1
- Multi-threaded Stockfish (needs COOP/COEP cross-origin isolation headers — single-thread lite NNUE is ~3000 Elo and Just Works without deployment friction). Capability-detect + auto-upgrade later.
- Lichess OAuth (only needed if/when we expose the Opening Explorer live; v1 ships with a pre-built offline opening book derived from the PGN dump).
- Service-worker offline cache. Browser HTTP cache + IndexedDB persistence give us most of the win without the SW complexity.

---

## Critical operational notes (don't get burned by these)

### Lichess Opening Explorer requires auth (April 2026 change)
Per [lichess.org/changelog](https://lichess.org/changelog) — anonymous calls to `https://explorer.lichess.ovh/{masters,lichess}` return 429 indefinitely. Our v1 plan sidesteps this by shipping a pre-built opening book; **do not write code that hits the explorer anonymously**.

### Lichess Tablebase is still anonymous
`https://tablebase.lichess.ovh/standard?fen=...` works without auth. Used by the endgame trainer for ground-truth WDL/DTZ. Same rate-limit etiquette.

### Puzzle data sources
- Build-time download: `https://database.lichess.org/lichess_db_puzzle.csv.zst` (CC0, 280 MB compressed, 5.88M rows). Refreshed monthly.
- We ship a pruned ~50k subset (`puzzles.db`, ~12 MB uncompressed / ~4 MB Brotli).
- Schema, indices, and pruning algorithm: [`docs/research/puzzle-db.md`](docs/research/puzzle-db.md).

### Move semantics in the puzzle dump
The CSV's `FEN` is the position **before** the opponent's setup move. The first UCI in `Moves` is that setup move; the rest is the player's solution. Easy to swap; document loudly in the puzzle player.

---

## npm run commands (planned — Phase 1 scaffold)

```
pnpm install              # install deps
pnpm dev                  # vite dev server with HMR
pnpm build                # production build → dist/
pnpm preview              # serve the production build locally
pnpm lint                 # eslint --max-warnings 0
pnpm typecheck            # tsc --noEmit
pnpm test                 # vitest run
pnpm test:watch           # vitest watch
pnpm test:e2e             # playwright test
pnpm build:puzzles        # node scripts/build-puzzles.ts → public/puzzles.db
pnpm vendor:engine        # download stockfish-18-lite-single.{js,wasm} → public/engine/
```

The last two are build-time data pipeline steps; both are idempotent and cache by ETag.

---

## Repo layout (planned)

```
.
├── CLAUDE.md                      # this file
├── LICENSES.md                    # GPL/CC0/attribution notes
├── README.md                      # user-facing
├── package.json
├── tsconfig.json                  # strict mode, no any
├── vite.config.ts                 # @tailwindcss/vite plugin
├── playwright.config.ts
├── vitest.config.ts
├── eslint.config.js
├── docs/
│   └── research/
│       ├── stack.md               # Phase 0 stack research (locked)
│       └── puzzle-db.md           # Phase 0 puzzle DB research (locked)
├── public/
│   ├── engine/                    # vendored Stockfish (gitignored, fetched by `pnpm vendor:engine`)
│   │   ├── stockfish-18-lite-single.js
│   │   └── stockfish-18-lite-single.wasm
│   ├── puzzles.db                 # built artifact (gitignored)
│   └── puzzles.manifest.json      # build provenance
├── scripts/
│   ├── build-puzzles.ts           # CSV → SQLite ingest + prune
│   └── vendor-engine.ts           # downloads Stockfish wasm artifacts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/                    # one route per pillar
│   │   ├── Play.tsx               # play vs engine
│   │   ├── Tactics.tsx
│   │   ├── Openings.tsx
│   │   └── Endgames.tsx
│   ├── chess/
│   │   ├── board/                 # chessground React wrapper
│   │   ├── engine/                # Stockfish UCI worker bridge
│   │   ├── rules/                 # chess.js wrappers + types
│   │   ├── tablebase/             # Lichess tablebase client
│   │   └── openings/              # offline opening book
│   ├── puzzles/
│   │   ├── db/                    # sqlite-wasm bridge
│   │   ├── scheduler/             # SM-2-lite spaced repetition
│   │   └── rating/                # Glicko-lite user rating
│   ├── persistence/               # idb wrapper, schemas, migrations
│   ├── state/                     # zustand stores
│   ├── components/
│   │   └── ui/                    # shadcn-generated primitives
│   ├── styles/
│   │   └── globals.css            # @import "tailwindcss"
│   └── lib/                       # FEN/PGN helpers, etc.
└── tests/
    ├── unit/                      # vitest
    └── e2e/                       # playwright
```

---

## Source URLs (canonical references)

### Lichess
- [Open database index](https://database.lichess.org/) — puzzle dump + games
- [Opening Explorer source](https://github.com/lichess-org/lila-openingexplorer) — endpoint reference
- [Tablebase source](https://github.com/lichess-org/lila-tablebase) — endpoint reference
- [API tips](https://lichess.org/page/api-tips) — rate-limit etiquette
- [Changelog](https://lichess.org/changelog) — explorer auth change announced here
- [Puzzle theme vocabulary (lila)](https://github.com/lichess-org/lila/blob/master/translation/source/puzzleTheme.xml)

### Libraries
- [chessground](https://github.com/lichess-org/chessground)
- [chess.js](https://github.com/jhlywa/chess.js)
- [stockfish.js (nmrugg)](https://github.com/nmrugg/stockfish.js) — the WASM build we use
- [stockfish-web (lichess-org)](https://github.com/lichess-org/stockfish-web) — official, alternative, deferred
- [shadcn/ui Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4)
- [SQLite Wasm docs](https://sqlite.org/wasm)

---

## Phase status

| Phase | Status | Demo deliverable |
|---|---|---|
| 0 — Research & plan | done (this file) | `docs/research/*.md`, `CLAUDE.md`, `LICENSES.md` |
| 1 — Core board + engine | pending approval | `pnpm dev` → play vs Stockfish at adjustable strength |
| 2 — Tactics | pending | spaced-rep puzzle loop with rating |
| 3 — Openings | pending | repertoire builder + drill mode |
| 4 — Endgames | pending | tablebase-graded practical positions |
| 5 — Polish | pending | per-pillar progress + dashboard |

Run lint + typecheck + tests at every phase boundary.
