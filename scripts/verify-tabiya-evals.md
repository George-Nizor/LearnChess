# verify-tabiya-evals.md — engine-backed prose evaluation auditing

This isn't a runnable script — Stockfish's WASM build doesn't accept
piped UCI from Node directly, so the cleanest way to audit the
~96 tabiya evaluation claims is via the existing browser-side
`StockfishEngine`. Procedure:

1. Boot the dev server (`npm run dev`).
2. Open DevTools on `/play` (or any page that has loaded the engine).
3. Paste the snippet below into the console. It loads every
   tabiya FEN, evaluates each at depth 14 (with depth 22 re-runs
   for outliers), compares the engine's pawn-eval against any
   `+0.XX` / `-0.XX` claim in the prose, and surfaces deviations
   over 0.4 pawns.

```js
// In the browser console after the dev server is up
const { OPENING_COURSES } = await import('/src/openings/lessons.ts');
const sf = await import('/src/chess/engine/index.ts');
const engine = new sf.StockfishEngine();
await engine.init();

const cases = [];
for (const [oid, course] of Object.entries(OPENING_COURSES)) {
  for (const line of course.lines) {
    const last = line.nodes.at(-1);
    if (!last) continue;
    cases.push({
      opening: oid,
      line: line.id,
      fen: last.fen + ' 0 1',
      side: last.fen.split(' ')[1],
      evalText: last.text.match(/(modern (?:theory|engines?)[^.]+\.|considers? (?:the line|this)[^.]+\.|rates? (?:the (?:line|position)|this)[^.]+\.)/i)?.[0]?.slice(0, 200),
    });
  }
}

const results = [];
for (const c of cases) {
  const r = await engine.search(c.fen, { depth: 14 });
  const cp = r.lastInfo?.scoreCp ?? null;
  const whiteCp = (cp !== null && c.side === 'b') ? -cp : cp;
  results.push({ ...c, enginePawns: whiteCp / 100 });
}

// Surface deviations
const dev = [];
for (const r of results) {
  const m = r.evalText?.match(/([+\-]\d\.\d{1,2})(?:\s*to\s*([+\-]?\d\.\d{1,2}))?/);
  if (!m) continue;
  const [low, high] = [parseFloat(m[1]), m[2] ? parseFloat(m[2]) : parseFloat(m[1])];
  const inRange = r.enginePawns >= Math.min(low, high) - 0.15
                && r.enginePawns <= Math.max(low, high) + 0.15;
  if (!inRange) {
    dev.push({ opening: r.opening, line: r.line,
      claimed: `${low} to ${high}`, engine: r.enginePawns });
  }
}
console.table(dev);
engine.destroy();
```

## Past run: 2026-04 audit

96 tabiyas evaluated at depth 14. Two flagged at depth 14 (Scandinavian
Qd6, Icelandic Gambit) - both resolved at depth 22 (engine just needed
more time on the sharp tactical lines).

Separately, the engine-eval pass surfaced FOUR sign-convention errors
in prose where I'd written "slightly worse for Black (-0.XX)" — the
negative number contradicted the framing because chess-eval convention
has positive=White-better. All four fixed:

- Schliemann tabiya
- Bronstein-Larsen tabiya
- Modern Caro-Kann (4...Nf6 exf6) tabiya
- Icelandic Gambit tabiya

These are the kind of issues only an engine pass can catch — chess.js
verifies legality, my regex audit verifies token validity, but matching
prose-claimed evaluations against actual engine evaluations needs
Stockfish.

## Why not in CI?

Each run takes ~50 seconds on the depth-14 pass and longer if the
engine has to re-evaluate outliers. Running per-PR isn't worth the
CI minutes; running per-content-audit (when prose changes) is the
right cadence. Keeping this as an on-demand procedure rather than
auto-CI matches the "deeper-than-typecheck audit" tier we already
established for the chess.js move-sequence tests.
