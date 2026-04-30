import { useEffect, useMemo, useState } from 'react';
import {
  clearAll,
  getEndgameAttempts,
  getRecentPuzzleAttempts,
  getUserRating,
  type EndgameAttempt,
  type PuzzleAttempt,
} from '@/persistence/db';
import { ratingBand } from '@/puzzles/rating';

interface DashState {
  puzzles: PuzzleAttempt[];
  endgames: EndgameAttempt[];
  tacticsRating: { rating: number; rd: number } | null;
}

function bucketByDay(attempts: PuzzleAttempt[]): { day: string; count: number; solved: number }[] {
  const map = new Map<string, { count: number; solved: number }>();
  for (const a of attempts) {
    const day = new Date(a.attemptedAt).toISOString().slice(0, 10);
    const cur = map.get(day) ?? { count: 0, solved: 0 };
    cur.count++;
    if (a.solved) cur.solved++;
    map.set(day, cur);
  }
  return Array.from(map.entries())
    .map(([day, v]) => ({ day, count: v.count, solved: v.solved }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function ratingByDay(attempts: PuzzleAttempt[]): { day: string; avg: number }[] {
  const map = new Map<string, number[]>();
  for (const a of attempts) {
    const day = new Date(a.attemptedAt).toISOString().slice(0, 10);
    const arr = map.get(day) ?? [];
    arr.push(a.rating);
    map.set(day, arr);
  }
  return Array.from(map.entries())
    .map(([day, ratings]) => ({ day, avg: Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function Dashboard() {
  const [state, setState] = useState<DashState>({ puzzles: [], endgames: [], tacticsRating: null });
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getRecentPuzzleAttempts(500),
      getEndgameAttempts(),
      getUserRating('tactics'),
    ]).then(([p, e, r]) => {
      if (cancelled) return;
      setState({
        puzzles: p,
        endgames: e,
        tacticsRating: r ? { rating: r.rating, rd: r.rd } : null,
      });
    });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const dailyAttempts = useMemo(() => bucketByDay(state.puzzles), [state.puzzles]);
  const dailyRating = useMemo(() => ratingByDay(state.puzzles), [state.puzzles]);

  const totalAttempts = state.puzzles.length;
  const totalSolved = state.puzzles.filter((a) => a.solved).length;
  const accuracy = totalAttempts === 0 ? null : Math.round((totalSolved / totalAttempts) * 100);

  const endgameStats = useMemo(() => {
    const byPos = new Map<string, { wins: number; draws: number; losses: number }>();
    for (const a of state.endgames) {
      const cur = byPos.get(a.positionId) ?? { wins: 0, draws: 0, losses: 0 };
      if (a.result === 'win') cur.wins++;
      if (a.result === 'draw') cur.draws++;
      if (a.result === 'loss') cur.losses++;
      byPos.set(a.positionId, cur);
    }
    return byPos;
  }, [state.endgames]);

  const handleClear = async () => {
    if (!confirm('Wipe all local progress (puzzle history, ratings, endgame attempts, opening drills)?')) return;
    await clearAll();
    setRefreshTick((n) => n + 1);
  };

  return (
    <div className="mx-auto h-full max-w-7xl overflow-y-auto px-6 py-6">
      <header className="mb-6 flex items-baseline justify-end">
        <button
          type="button"
          onClick={() => void handleClear()}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Wipe local progress
        </button>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card title="Tactics rating">
          <div className="text-3xl font-semibold">
            {state.tacticsRating?.rating ?? 1500}
            <span className="ml-1 text-sm text-muted-foreground">±{state.tacticsRating?.rd ?? 350}</span>
          </div>
          <div className="text-xs uppercase text-muted-foreground">{ratingBand(state.tacticsRating?.rating ?? 1500)}</div>
        </Card>
        <Card title="Puzzles attempted">
          <div className="text-3xl font-semibold">{totalAttempts}</div>
        </Card>
        <Card title="Accuracy">
          <div className="text-3xl font-semibold">{accuracy === null ? '—' : `${accuracy}%`}</div>
        </Card>
        <Card title="Endgame attempts">
          <div className="text-3xl font-semibold">{state.endgames.length}</div>
        </Card>
      </section>

      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Puzzles per day (last 30 days)">
          <BarChart data={dailyAttempts.slice(-30).map((d) => ({ label: d.day.slice(5), value: d.count, secondary: d.solved }))} />
        </Card>
        <Card title="Average puzzle rating per day">
          <BarChart data={dailyRating.slice(-30).map((d) => ({ label: d.day.slice(5), value: d.avg, secondary: d.avg }))} maxOverride={2400} />
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Endgame positions touched</h2>
        <div className="overflow-x-auto rounded border border-border bg-background">
          <table className="min-w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Position</th>
                <th className="px-3 py-2 text-right">Wins</th>
                <th className="px-3 py-2 text-right">Draws</th>
                <th className="px-3 py-2 text-right">Losses</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...endgameStats.entries()].length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No endgame attempts yet.</td></tr>
              ) : (
                [...endgameStats.entries()].map(([pos, s]) => (
                  <tr key={pos} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{pos}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{s.wins}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{s.draws}</td>
                    <td className="px-3 py-2 text-right text-red-700">{s.losses}</td>
                    <td className="px-3 py-2 text-right font-medium">{s.wins + s.draws + s.losses}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function BarChart({ data, maxOverride }: { data: { label: string; value: number; secondary?: number }[]; maxOverride?: number }) {
  if (data.length === 0) return <div className="text-sm text-muted-foreground">No data yet.</div>;
  const max = maxOverride ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-40 items-end gap-1">
      {data.map((d) => (
        <div key={d.label} className="group relative flex-1" title={`${d.label}: ${d.value}`}>
          <div
            className="w-full rounded-sm bg-accent/70 transition-colors group-hover:bg-accent"
            style={{ height: `${(d.value / max) * 100}%`, minHeight: '2px' }}
          />
          <div className="mt-0.5 w-full overflow-hidden text-center text-[9px] text-muted-foreground">{d.label}</div>
        </div>
      ))}
    </div>
  );
}
