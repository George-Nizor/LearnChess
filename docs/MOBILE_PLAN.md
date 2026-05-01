# Mobile-version plan

> User feedback (2026-05-01): on mobile the deployed app is unusable —
> the board is not visible across multiple screens because the layout
> assumes desktop-class viewport. This is a known limitation explicitly
> acknowledged in `docs/RESUME.md` ("Mobile/narrow viewport (<700px)
> layout — Play page eval bar shows alone with no board. The whole
> responsive layout pass is beyond a debug session; needs a dedicated
> UX pass with breakpoints defined per route."). This document lays out
> the dedicated pass.

## Why mobile is currently broken

Every route was authored desktop-first with side-by-side layouts that
assume ≥1024 px viewport:

- **Play / Analysis / Endgames / Tactics**: `grid-cols-[auto_360px]` or
  similar — the board column collapses to 0 width on narrow viewports
  because the right rail consumes everything, OR the board overflows
  off-screen entirely.
- **Openings — Learn view**: `grid-cols-[auto_360px]` puts the board
  next to the speech bubble; on narrow viewports the bubble takes
  precedence and the board disappears.
- **The eval bar** sits flush left of the board (`flex flex-row`); on
  mobile it ends up alone in a column with no board next to it.
- **The icon rail** (left nav) is a fixed 56 px wide column. That's
  fine on desktop but eats real estate on phones where horizontal
  pixels are precious.
- **Move tree, PV lines, controls** all assume a vertical sidebar
  layout. On mobile they need to either stack below the board or hide
  behind a slide-up sheet.
- **chessground itself** sizes to its parent. If the parent is 0 px
  wide (because the right rail consumed everything), the board is 0×0.

There are also touch-interaction issues separate from layout:

- chessground supports touch events natively, but our movable-config
  doesn't always set `dropoff: trash` or similar mobile-friendly drag
  defaults — pieces can get stuck mid-drag if the user lifts their
  finger off the board edge.
- Some chrome elements (tooltips, hover-pills on nav) are mouse-only
  and confuse touch users.
- The `dvh` viewport unit isn't used anywhere — `h-screen` doesn't
  account for the iOS Safari URL bar collapsing/expanding, so the
  board height jumps around as the user scrolls.

## Design principles for mobile

1. **Board first.** On any portrait viewport the board is the largest
   visible element. Everything else is either above it (compact
   header), below it (scrollable controls), or behind a sheet
   (settings, move tree, PV lines).
2. **No horizontal scrolling.** Anything that doesn't fit in the
   viewport width either wraps or moves to a sheet/drawer.
3. **Bottom-sheet drawers** for secondary content (move tree, engine
   PVs, settings, FEN/PGN load). Phones learned this pattern from
   maps + chess.com.
4. **Touch targets ≥ 44 × 44 px** (Apple HIG). Current icon rail is
   40 × 40 — borderline; needs ≥ 44 on mobile.
5. **Bottom nav** instead of left rail on mobile. Standard Material
   pattern, thumb-reachable. Five primary destinations
   (Openings / Tactics / Endgames / Play / Analysis) fit a 5-tab
   bottom nav cleanly; Dashboard + Settings move to a hamburger or
   profile menu.
6. **Use `dvh` and `svh`** for viewport-fitting heights so the iOS
   Safari URL bar doesn't reflow the board mid-game.
7. **Reduced-motion detection** is already wired; mobile users on
   slower devices should get instant route swaps (already true after
   the PageTransition fix).

## Per-route mobile spec

### Play (vs Stockfish) — board + 1 sidebar
**Desktop**: board + right rail with skill slider, eval bar toggle,
new game button, move history.

**Mobile portrait**:
- Compact top bar: title + new-game icon + ⚙ overflow → opens sheet
- Board fills the viewport width
- Below board: turn indicator + last move + a single "Resign / new
  game" CTA
- Bottom sheet (swipe up from bottom): skill slider + arrow toggles +
  full move history
- Eval bar: above the board as a thin horizontal bar with a centred
  marker, NOT alongside the board

### Analysis — board + move tree + engine
**Desktop**: board + eval bar (left) + right rail with toolbar +
move tree + engine PVs + FEN/PGN load.

**Mobile portrait**:
- Compact top bar: ⟪ ◀ ▶ ⟫ + ⟳ + ⤺ flip + ⋮ (FEN/PGN load)
- Board fills viewport width
- Eval bar: horizontal, above the board
- Below board: tabs for "Moves" / "Engine" / "Notes"
  - Moves tab: scrolling 2-column move list
  - Engine tab: top 3 PV lines with eval scores
  - Notes tab: text input for personal annotations (deferred)
- Hidden behind ⋮: FEN paste, PGN paste, multi-PV count selector

### Tactics — board + puzzle status
**Desktop**: board + right rail with rating, theme filter, hint button.

**Mobile portrait**:
- Compact top bar: rating + theme filter pill (tap to open sheet)
- Board fills viewport width
- Below board: solve status banner ("Black to move + win the queen")
  + hint button + show solution + next puzzle CTA
- Bottom sheet: theme filter + rating range + recent attempts log

### Openings — list view + course view
**Desktop list view**: grid of opening cards.
**Desktop course view**: 4 tabs (Learn / Drill / Explore / Puzzles /
Test) + board + speech bubble + line picker.

**Mobile list view portrait**:
- Already mostly fine — cards stack in 1 column on narrow viewports
  thanks to the existing responsive grid.
- Just verify card touch targets are ≥ 44px tall.

**Mobile course view portrait**:
- Top bar: ← back to courses + course title + line picker (tap pill
  to open sheet)
- Tab strip: Learn / Drill / Explore / Puzzles / Test (already
  scrollable horizontally — keep)
- Board fills viewport width
- Below board: speech bubble (truncated to 3-4 lines + "more" expand)
- Tutor avatar floats top-right corner (smaller than desktop)
- Below speech bubble: ← prev / N/M / next → navigation
- Bottom sheet (swipe up): full speech bubble text + key squares +
  pawn skeleton diagram (currently shown alongside)

### Endgames — same as Openings
Same pattern as Openings course view; same sheet structure.

### Dashboard — stats + charts
**Desktop**: multi-column stat panels.

**Mobile portrait**:
- Single-column scroll
- Each card is full-width with a clear hierarchy: number first, then
  label, then sparkline
- No pivots; if charts need axis labels, they go below the chart not
  alongside

### Settings
Already scrollable single-column — should work as-is on mobile with
just touch-target audit.

## Implementation phasing

### Phase A — board-fits-viewport everywhere (highest priority)
**Goal**: on a 360 × 800 viewport, every route shows a fully-visible
board.

Changes:
1. `globals.css`: add a mobile-only `cg-board-fit` override that
   uses `min(100dvw, calc(100dvh - var(--mobile-chrome-height)))`
   instead of the desktop `min(80vh, 90vw, 640px)`.
2. `Layout.tsx`: hide left icon rail on `< md` (768 px); render a
   bottom nav instead.
3. Each route's grid layout: switch from `grid-cols-[auto_360px]` to
   `grid-cols-1` on `< lg`, with the right rail moving below the
   board (not beside it).
4. Eval bar: switch to horizontal orientation on `< lg`. Add a
   `<EvalBar orientation="horizontal" />` variant.

This phase alone makes the app USABLE on mobile — not pretty, but
functional.

### Phase B — bottom nav + bottom sheets
1. New `BottomNav.tsx` component — fixed-position, 5 tabs + ⋮.
2. New `BottomSheet.tsx` primitive (swipe-up panel with backdrop).
3. Convert Play / Analysis / Tactics secondary controls to bottom
   sheets.
4. Convert Openings line picker + tutor speech bubble to a bottom
   sheet on mobile.

This phase makes the app feel like a mobile app, not a shrunken
desktop site.

### Phase C — touch-interaction polish
1. Audit every touch target — bump to ≥ 44 × 44 px.
2. Remove or rebuild hover-only UI (nav label pills, tooltips).
3. Use `dvh` instead of `vh` everywhere for layout heights.
4. Test chessground drag on real iOS Safari + Android Chrome —
   verify pieces don't get stuck on edge release; tune
   `movable.events.afterNewPiece` if needed.
5. Ensure scroll containment — no `overflow: hidden` on body that
   prevents pull-to-refresh + back-swipe.

### Phase D — performance + PWA polish (optional)
1. Add a service worker so the app boots offline (currently
   IndexedDB persists progress but engine + puzzles need a network
   round-trip on first visit).
2. Add a web app manifest for "Add to Home Screen" — icon, name,
   theme color, full-screen mode.
3. Preconnect hints for engine WASM + puzzle DB.

## Quality gates

- Add a Playwright test with `viewport: { width: 360, height: 800 }`
  that loads each route and asserts the chessground is visible
  AND has `getBoundingClientRect().width >= 280`.
- Add a `viewport: { width: 768, height: 1024 }` test for tablet.
- Capture mobile screenshots into `docs/screenshots/mobile/` for the
  README.
- Manual smoke test on real iOS Safari + Android Chrome before
  declaring Phase A done.

## Recommended sequence for the next session

Phase A first (board fits viewport) — that's the user's actual
complaint right now. Phase B (bottom nav + sheets) is the next polish
step once the board is at least visible. Phase C is an ongoing
audit; Phase D is optional and can wait until there's actual mobile
usage.

Estimated effort: Phase A ≈ 1 dedicated session (4-6 hours of focus
plus visual verification). Phase B ≈ 1 session. Phase C ≈ 0.5
session. Phase D ≈ deferred.
