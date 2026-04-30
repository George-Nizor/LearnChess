import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Chess } from 'chess.js';
import { Chessground } from '@/chess/board';
import { StockfishEngine } from '@/chess/engine';
import type { Square } from '@/chess/rules';
import { lastMoveSquares, legalDests, tryMove, tryMoveUci, turnColor } from '@/chess/rules';
import { playSound, soundForMove } from '@/sound';
import { usePlayStore } from '@/state/play';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';

const SCORE_CLAMP_CP = 1000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function scoreToBarRatio(scoreCp: number | null, scoreMate: number | null): number {
  if (scoreMate !== null) return scoreMate > 0 ? 1 : 0;
  if (scoreCp === null) return 0.5;
  const cp = clamp(scoreCp, -SCORE_CLAMP_CP, SCORE_CLAMP_CP);
  return 0.5 + cp / (2 * SCORE_CLAMP_CP);
}

function formatScore(scoreCp: number | null, scoreMate: number | null): string {
  if (scoreMate !== null) return `M${Math.abs(scoreMate)}`;
  if (scoreCp === null) return '·';
  const pawns = scoreCp / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
}

/*
 * Strength preset buckets — replace the raw 0-20 skill slider + movetime/
 * depth toggles with three named cards. Raw knobs stay available behind a
 * <details> "Customise (advanced)" disclosure for power users.
 *
 * The store still owns `skillLevel` / `engineMode` / `engineMovetime`; the
 * presets are pure setters.
 */
interface StrengthPreset {
  id: 'beginner' | 'intermediate' | 'strong';
  label: string;
  skill: number;
  movetimeMs: number;
  description: string;
}

const STRENGTH_PRESETS: readonly StrengthPreset[] = [
  { id: 'beginner', label: 'Beginner', skill: 4, movetimeMs: 300, description: 'Plays solid moves with frequent slips' },
  { id: 'intermediate', label: 'Intermediate', skill: 10, movetimeMs: 600, description: 'Punishes obvious blunders, opens with theory' },
  { id: 'strong', label: 'Strong', skill: 16, movetimeMs: 1500, description: 'Will take your queen if you hang it' },
] as const;

function matchPreset(skill: number, mode: 'depth' | 'movetime', movetime: number): StrengthPreset['id'] | null {
  if (mode !== 'movetime') return null;
  const hit = STRENGTH_PRESETS.find((p) => p.skill === skill && p.movetimeMs === movetime);
  return hit?.id ?? null;
}

export function Play() {
  const fen = usePlayStore((s) => s.fen);
  const playerColor = usePlayStore((s) => s.playerColor);
  const skillLevel = usePlayStore((s) => s.skillLevel);
  const engineMode = usePlayStore((s) => s.engineMode);
  const engineDepth = usePlayStore((s) => s.engineDepth);
  const engineMovetime = usePlayStore((s) => s.engineMovetime);
  const showEvalBar = usePlayStore((s) => s.showEvalBar);
  const showBestArrow = usePlayStore((s) => s.showBestArrow);
  const evaluation = usePlayStore((s) => s.evaluation);
  const isEngineThinking = usePlayStore((s) => s.isEngineThinking);
  const isGameOver = usePlayStore((s) => s.isGameOver);

  const newGame = usePlayStore((s) => s.newGame);
  const flipSide = usePlayStore((s) => s.flipSide);
  const applyMoveFromSquares = usePlayStore((s) => s.applyMoveFromSquares);
  const applyMoveUci = usePlayStore((s) => s.applyMoveUci);
  const setSkillLevel = usePlayStore((s) => s.setSkillLevel);
  const setEngineMode = usePlayStore((s) => s.setEngineMode);
  const setEngineDepth = usePlayStore((s) => s.setEngineDepth);
  const setEngineMovetime = usePlayStore((s) => s.setEngineMovetime);
  const toggleEvalBar = usePlayStore((s) => s.toggleEvalBar);
  const toggleBestArrow = usePlayStore((s) => s.toggleBestArrow);
  const setEvaluation = usePlayStore((s) => s.setEvaluation);
  const setEngineThinking = usePlayStore((s) => s.setEngineThinking);

  const apiRef = useRef<Api | null>(null);
  const engineRef = useRef<StockfishEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    const engine = new StockfishEngine({ onError: (err) => setEngineError(err.message) });
    engineRef.current = engine;
    engine
      .init()
      .then(() => setEngineReady(true))
      .catch((err: Error) => setEngineError(err.message));
    return () => {
      engine.destroy();
      engineRef.current = null;
      setEngineReady(false);
    };
  }, []);

  useEffect(() => {
    if (engineReady) engineRef.current?.setSkillLevel(skillLevel);
  }, [engineReady, skillLevel]);

  const game = useMemo(() => new Chess(fen), [fen]);
  const sideToMove = turnColor(game);
  const playerSide: 'white' | 'black' = playerColor === 'w' ? 'white' : 'black';
  const isPlayerTurn = sideToMove === playerSide;

  const dests = useMemo(() => (isPlayerTurn && !isGameOver ? legalDests(game) : new Map<Square, Square[]>()), [game, isPlayerTurn, isGameOver]);
  const lastMove = useMemo(() => lastMoveSquares(game), [game]);

  const handleMove = useCallback(
    (from: Square, to: Square) => {
      const probe = new Chess(game.fen());
      const promotion = 'q' as const; // auto-queen; underpromote picker deferred
      const result = tryMove(probe, from, to, promotion);
      const ok = applyMoveFromSquares(from, to, promotion);
      if (ok && result) playSound(soundForMove(result));
    },
    [game, applyMoveFromSquares],
  );

  const drawShapes = useMemo<DrawShape[]>(() => {
    if (!showBestArrow || !evaluation.bestMoveUci) return [];
    const uci = evaluation.bestMoveUci;
    if (uci.length < 4) return [];
    return [{ orig: uci.slice(0, 2) as Square, dest: uci.slice(2, 4) as Square, brush: 'paleBlue' }];
  }, [showBestArrow, evaluation.bestMoveUci]);

  const cgConfig = useMemo<Config>(() => {
    return {
      fen,
      orientation: playerSide,
      turnColor: sideToMove,
      check: game.isCheck(),
      ...(lastMove !== undefined ? { lastMove } : {}),
      movable: {
        free: false,
        ...(isPlayerTurn && !isGameOver ? { color: playerSide } : {}),
        dests,
        events: {
          after: (orig, dest) => handleMove(orig as Square, dest as Square),
        },
      },
      drawable: {
        enabled: true,
        visible: true,
        defaultSnapToValidMove: true,
        autoShapes: drawShapes,
      },
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
    } satisfies Config;
  }, [fen, playerSide, sideToMove, game, lastMove, isPlayerTurn, isGameOver, dests, handleMove, drawShapes]);

  useEffect(() => {
    if (!engineReady || !engineRef.current) return;
    if (isGameOver) return;

    let cancelled = false;
    const opts = engineMode === 'depth' ? { depth: engineDepth } : { movetime: engineMovetime };

    if (!isPlayerTurn) {
      setEngineThinking(true);
      engineRef.current
        .search(fen, opts)
        .then((result) => {
          if (cancelled) return;
          const probe = new Chess(fen);
          const moveResult = tryMoveUci(probe, result.bestMove);
          applyMoveUci(result.bestMove);
          if (moveResult) playSound(soundForMove(moveResult));
          setEngineThinking(false);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setEngineError(err.message);
          setEngineThinking(false);
        });
    } else if (showEvalBar || showBestArrow) {
      engineRef.current
        .search(fen, { depth: 12 }, (info) => {
          if (cancelled) return;
          setEvaluation({
            scoreCp: info.scoreCp ?? null,
            scoreMate: info.scoreMate ?? null,
            bestMoveUci: info.pv?.[0] ?? null,
            depth: info.depth ?? null,
          });
        })
        .then((result) => {
          if (cancelled) return;
          setEvaluation({
            scoreCp: result.lastInfo?.scoreCp ?? null,
            scoreMate: result.lastInfo?.scoreMate ?? null,
            bestMoveUci: result.bestMove,
            depth: result.lastInfo?.depth ?? null,
          });
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setEngineError(err.message);
        });
    }

    return () => {
      cancelled = true;
      engineRef.current?.stop();
    };
  }, [
    engineReady,
    fen,
    isPlayerTurn,
    isGameOver,
    engineMode,
    engineDepth,
    engineMovetime,
    showEvalBar,
    showBestArrow,
    applyMoveUci,
    setEvaluation,
    setEngineThinking,
  ]);

  const evalRatio = scoreToBarRatio(evaluation.scoreCp, evaluation.scoreMate);
  const evalLabel = formatScore(evaluation.scoreCp, evaluation.scoreMate);

  const activePresetId = matchPreset(skillLevel, engineMode, engineMovetime);

  const applyPreset = useCallback(
    (preset: StrengthPreset) => {
      setEngineMode('movetime');
      setSkillLevel(preset.skill);
      setEngineMovetime(preset.movetimeMs);
    },
    [setEngineMode, setSkillLevel, setEngineMovetime],
  );

  // Arrow-key navigation across the radiogroup. Left/right cycles the
  // selection (wrap-around) so keyboard users get the same shortcut as a
  // native <input type=radio> group.
  const handlePresetKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const nextIdx = (idx + dir + STRENGTH_PRESETS.length) % STRENGTH_PRESETS.length;
      const next = STRENGTH_PRESETS[nextIdx];
      if (!next) return;
      applyPreset(next);
      // Move focus to the newly selected card so screen readers announce it.
      const root = e.currentTarget.closest('[role="radiogroup"]');
      const buttons = root?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[nextIdx]?.focus();
    },
    [applyPreset],
  );

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden px-6 py-3">
      {engineError && (
        <div role="alert" className="mb-2 shrink-0 rounded-md border border-border bg-muted p-3 text-sm">
          <strong>Engine:</strong> {engineError}
          <p className="mt-1 text-muted-foreground">
            Run <code className="font-mono">pnpm vendor:engine</code> to populate <code className="font-mono">public/engine/</code>.
          </p>
        </div>
      )}

      <div className="grid h-full min-h-0 grid-cols-1 gap-6 md:grid-cols-[auto_minmax(0,1fr)_360px]">
        {showEvalBar ? (
          <div
            aria-label={`Evaluation ${evalLabel}`}
            className="relative h-full w-6 overflow-hidden rounded border border-border bg-eval-black"
          >
            <div
              className="absolute bottom-0 left-0 right-0 bg-eval-white transition-[height] duration-200"
              style={{ height: `${(evalRatio * 100).toFixed(1)}%` }}
            />
            <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            <span className="absolute inset-x-0 bottom-1 text-center text-[10px] font-mono text-muted-foreground">
              {evalLabel}
            </span>
          </div>
        ) : (
          <div className="w-0" />
        )}

        <div className="cg-board-fit">
          <Chessground config={cgConfig} onApiReady={(api) => { apiRef.current = api; }} />
        </div>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-md border border-border bg-muted/40 p-3">
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <span id="strength-label" className="text-sm font-medium">Strength</span>
              <span className="text-[11px] text-muted-foreground">
                {engineReady ? 'Stockfish ready' : engineError ? 'engine error' : 'engine loading…'}
              </span>
            </div>
            <div
              role="radiogroup"
              aria-labelledby="strength-label"
              className="flex flex-col gap-2"
            >
              {STRENGTH_PRESETS.map((preset, idx) => {
                const isActive = preset.id === activePresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={`${preset.label} — ${preset.description}`}
                    tabIndex={isActive || (activePresetId === null && idx === 0) ? 0 : -1}
                    onClick={() => applyPreset(preset)}
                    onKeyDown={(e) => handlePresetKey(e, idx)}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? 'border-accent ring-2 ring-accent/30 bg-accent/5'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <div className="font-medium">{preset.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{preset.description}</div>
                  </button>
                );
              })}
            </div>
            {activePresetId === null && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Custom settings active — adjust below or pick a preset to reset.
              </p>
            )}
          </section>

          <section>
            <details className="group rounded-md border border-border bg-background p-2 text-sm">
              <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                Customise (advanced)
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="skill" className="block text-xs font-medium">
                    Skill level: <span className="font-mono">{skillLevel}</span>
                  </label>
                  <input
                    id="skill"
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    value={skillLevel}
                    onChange={(e) => setSkillLevel(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">0 = blunder-prone · 20 = full strength</p>
                </div>

                <div>
                  <span className="block text-xs font-medium">Engine mode</span>
                  <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Engine think mode">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={engineMode === 'movetime'}
                      onClick={() => setEngineMode('movetime')}
                      className={`flex-1 rounded-md border border-border px-2 py-1 text-xs ${engineMode === 'movetime' ? 'bg-accent text-accent-foreground' : 'bg-background'}`}
                    >
                      movetime
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={engineMode === 'depth'}
                      onClick={() => setEngineMode('depth')}
                      className={`flex-1 rounded-md border border-border px-2 py-1 text-xs ${engineMode === 'depth' ? 'bg-accent text-accent-foreground' : 'bg-background'}`}
                    >
                      depth
                    </button>
                  </div>
                  {engineMode === 'movetime' ? (
                    <label className="mt-2 block text-xs">
                      ms per move: <span className="font-mono">{engineMovetime}</span>
                      <input
                        type="range"
                        min={100}
                        max={3000}
                        step={50}
                        value={engineMovetime}
                        onChange={(e) => setEngineMovetime(Number(e.target.value))}
                        className="mt-1 w-full"
                      />
                    </label>
                  ) : (
                    <label className="mt-2 block text-xs">
                      depth: <span className="font-mono">{engineDepth}</span>
                      <input
                        type="range"
                        min={1}
                        max={22}
                        step={1}
                        value={engineDepth}
                        onChange={(e) => setEngineDepth(Number(e.target.value))}
                        className="mt-1 w-full"
                      />
                    </label>
                  )}
                </div>
              </div>
            </details>
          </section>

          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showEvalBar} onChange={toggleEvalBar} />
              Show eval bar
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showBestArrow} onChange={toggleBestArrow} />
              Show best-move arrow
            </label>
          </section>

          <section className="space-y-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => newGame()}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              New game
            </button>
            <button
              type="button"
              onClick={flipSide}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
            >
              Switch sides (currently {playerColor === 'w' ? 'white' : 'black'})
            </button>
          </section>

          <section className="border-t border-border pt-3 text-xs text-muted-foreground">
            <p>
              Status:{' '}
              <span className="font-mono">
                {isGameOver ? 'game over' : isEngineThinking ? 'engine thinking…' : isPlayerTurn ? 'your move' : 'engine moving…'}
              </span>
            </p>
            <p>FEN: <span className="font-mono break-all">{fen}</span></p>
          </section>
        </aside>
      </div>
    </div>
  );
}
