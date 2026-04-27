/*
 * Lichess Syzygy tablebase client.
 *   API: https://tablebase.lichess.ovh/standard?fen=<urlencoded>
 *   Coverage: up to 7 pieces (Syzygy 7-man), standard chess.
 *   Returns 404 for positions outside coverage; treat as "unknown".
 *
 * Etiquette (per https://lichess.org/page/api-tips):
 *   - One in-flight request at a time.
 *   - 60 s back-off on 429.
 *   - Send a descriptive User-Agent (we can't set it from the browser, but
 *     TanStack Query handles cache + dedup so we don't hammer the API).
 *
 * We pair this with TanStack Query in the calling components for caching
 * (FEN-keyed), retries, and request dedup.
 */

export type TbCategory = 'win' | 'cursed-win' | 'maybe-win' | 'draw' | 'blessed-loss' | 'maybe-loss' | 'loss' | 'unknown';

export interface TbMove {
  uci: string;
  san: string;
  category: TbCategory;
  dtz: number | null;
  dtm: number | null;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
  insufficient_material: boolean;
}

export interface TbResponse {
  category: TbCategory;
  dtz: number | null;
  precise_dtz?: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficient_material: boolean;
  moves: TbMove[];
}

const TABLEBASE_URL = 'https://tablebase.lichess.ovh/standard';

export class TablebaseUnavailable extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TablebaseUnavailable';
  }
}

export async function probeTablebase(fen: string, signal?: AbortSignal): Promise<TbResponse | null> {
  const url = `${TABLEBASE_URL}?fen=${encodeURIComponent(fen)}`;
  const init: RequestInit = signal !== undefined ? { signal } : {};
  const res = await fetch(url, init);
  if (res.status === 404) return null;
  if (res.status === 429) throw new TablebaseUnavailable('rate-limited (429); back off 60 s');
  if (!res.ok) throw new TablebaseUnavailable(`HTTP ${res.status}`);
  return (await res.json()) as TbResponse;
}

export function gradeMove(
  beforeFen: string,
  beforeResp: TbResponse,
  uci: string,
): { grade: 'optimal' | 'good' | 'inaccuracy' | 'losing' | 'unknown'; played?: TbMove; optimal?: TbMove } {
  void beforeFen;
  const played = beforeResp.moves.find((m) => m.uci === uci);
  const optimal = beforeResp.moves[0];
  if (!played || !optimal) return { grade: 'unknown' };

  if (played.category === optimal.category) {
    if (
      (played.dtz !== null && optimal.dtz !== null && Math.abs(played.dtz) === Math.abs(optimal.dtz)) ||
      played.uci === optimal.uci
    ) {
      return { grade: 'optimal', played, optimal };
    }
    return { grade: 'good', played, optimal };
  }

  if (
    (beforeResp.category === 'win' && (played.category === 'draw' || played.category === 'cursed-win')) ||
    (beforeResp.category === 'draw' && (played.category === 'loss' || played.category === 'blessed-loss'))
  ) {
    return { grade: 'losing', played, optimal };
  }

  return { grade: 'inaccuracy', played, optimal };
}
