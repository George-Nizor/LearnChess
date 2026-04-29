# LearnChess

Self-hosted chess learning platform — opening repertoire trainer + tactics
trainer + endgame trainer + play-vs-engine, all running in the browser
with no backend. Per-user state lives in IndexedDB; nothing leaves the
device except optional Lichess tablebase queries.

```
┌────────────┬────────────┬────────────┬────────────┬────────────┐
│   Learn    │   Drill    │  Explore   │  Puzzles   │    Test    │
│            │            │            │            │            │
│ Read the   │ Memorise   │ Explore    │ Solve      │ Multiple-  │
│ ideas      │ moves with │ positions  │ tactics    │ choice +   │
│ behind     │ SRS        │ in the     │ pulled     │ click-the- │
│ each line  │ scheduling │ engine     │ from real  │ key-square │
│            │            │            │ Lichess    │ on each    │
│            │            │            │ games of   │ tabiya;    │
│            │            │            │ this       │ SRS-       │
│            │            │            │ opening    │ scheduled  │
└────────────┴────────────┴────────────┴────────────┴────────────┘
```

13 openings authored across 96 named tabiyas, each with structured
strategy prose (White's plan / Black's plan / Key squares / Tactical
theme) that drives both the speech-bubble renderer AND on-board
square-highlight overlays in Learn mode.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite 8 + React 19 + TypeScript strict | Fast HMR, modern React features, no `forwardRef` boilerplate |
| Styling | Tailwind 4 (Oxide engine) + shadcn/ui | Greenfield, no migration debt; shadcn for low-friction primitives |
| Board | chessground 9.2.1 | The Lichess board library; GPL forces our app license |
| Move engine | chess.js 1.4.0 | Authoritative SAN/PGN/legal-move generation |
| Engine | Stockfish 16 NNUE (single-thread WASM) | ~3000 Elo, no COOP/COEP headers needed |
| State | zustand 5 (UI) + idb 8 (persistence) | Tiny, promise-based, schema migrations are manageable |
| Tactics DB | sqlite-wasm + Brotli over HTTP, OPFS-cached | ~5.8M Lichess puzzles pruned to ~50k balanced |

## Quick start (development)

```bash
git clone <this repo>
cd learnchess
npm install
npm run vendor:engine        # downloads Stockfish 16 wasm (~85 MB) into public/
npm run build:puzzles        # downloads + ingests Lichess puzzle CSV (~280 MB → 55 MB DB)
npm run dev                  # http://localhost:5173
```

The engine + puzzle DB are NOT committed to the repo (they're in
`.gitignore` — too large, regenerable). The two `vendor:`/`build:`
commands fetch them once; subsequent `npm run dev` boots are fast.

### Other npm scripts

```
npm run typecheck     # tsc --noEmit (strict; exactOptionalPropertyTypes; verbatimModuleSyntax)
npm run lint          # eslint --max-warnings 0
npm run test          # vitest (138 tests as of 2026-04-29)
npm run test:watch    # vitest in watch mode
npm run test:e2e      # playwright (one chromium project)
npm run build         # production build into dist/ (~150 MB)
npm run preview       # serve the production build locally
```

## Self-hosting on a home server

The repo ships a 3-stage Dockerfile (Node build → Brotli precompress →
Alpine nginx-with-brotli) plus `docker-compose.yml` and
`deploy/nginx.conf`. Point your reverse proxy at port 8080:

```bash
docker compose up -d --build
```

Or use the optional standalone profile (uncomment in `docker-compose.yml`)
which spins up a Caddy sidecar with auto Let's Encrypt:

```bash
CADDY_DOMAIN=chess.example.com docker compose --profile standalone up -d
```

Full notes — cache headers, HTTPS requirements, build-time network
deps, multi-thread Stockfish upgrade path — in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Architecture

```
src/
├── routes/              # one route per pillar (Play, Tactics, Openings, Endgames, Analysis, Dashboard, Settings)
├── chess/
│   ├── board/           # chessground React wrapper
│   ├── engine/          # Stockfish UCI worker bridge
│   ├── rules/           # chess.js wrappers + types
│   ├── tablebase/       # Lichess tablebase client
│   └── openings/        # offline opening book (move graph)
├── openings/
│   ├── lessons.ts       # 96 tabiyas across 13 opening courses
│   ├── proseParser.ts   # parses tabiya prose into typed sections + tokens
│   ├── testQuestions.ts # auto-generates Test-mode questions from tabiyas
│   ├── testSession.ts   # SRS-backed Test-mode scheduler
│   ├── drillSession.ts  # SRS-backed Drill-mode scheduler
│   ├── lineSelector.ts  # Bjork-spaced drill-line selection
│   ├── scheduler.ts     # SM-2-lite SRS algorithm (shared)
│   └── db.ts            # IndexedDB layer (repertoires, moves, lineProgress, testCards)
├── puzzles/             # tactics: db, scheduler, rating, themes
├── components/ui/       # LessonBubble, PuzzleSolver, PawnSkeleton, MiniBoardPreview, Logo, ChessIcons
├── persistence/         # IDB wrapper for tactics + endgames
├── state/               # zustand stores (boardTheme, pieceSet, soundPack, play)
├── styles/globals.css   # Tailwind v4 entry + theme tokens
└── lib/                 # FEN/PGN helpers
```

`docs/` holds the research briefs that locked the stack (`stack.md`,
`puzzle-db.md`, `competitor-deep-dive.md`, `ux-critique.md`, etc.) and
the deploy guide. `CLAUDE.md` is the architectural-decision log — read
it before touching anything in `src/openings/` or `src/chess/engine/`.

## License

GPL-3.0-or-later. Forced by our use of chessground (GPL bundled into
the JS). Stockfish is also GPL but ships as an isolated WASM worker
artifact — see [`LICENSES.md`](LICENSES.md) for the isolation pattern
and the relicensing path if we ever swap chessground for a permissive
alternative.

## Acknowledgements

- [Lichess](https://lichess.org) — puzzle dump (CC0), opening explorer, tablebase
- [chessground](https://github.com/lichess-org/chessground) — Lichess board renderer
- [Stockfish](https://stockfishchess.org) — chess engine
- [chess.js](https://github.com/jhlywa/chess.js) — move generator
- [chessdriller](https://github.com/gtim/chessdriller) — opening drill UX inspiration
- [Chessable](https://www.chessable.com), [chessreps](https://chessreps.com),
  [Listudy](https://listudy.org) — competitor research that shaped the line picker + Learn mode
