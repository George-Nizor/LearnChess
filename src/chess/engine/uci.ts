export interface UciInfo {
  depth?: number;
  seldepth?: number;
  multipv?: number;
  scoreCp?: number;
  scoreMate?: number;
  nodes?: number;
  nps?: number;
  time?: number;
  pv?: string[];
}

export interface UciBestMove {
  bestMove: string;
  ponder?: string;
}

function parseNum(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

export function parseInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ')) return null;
  const tokens = line.slice(5).split(/\s+/);
  const info: UciInfo = {};

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;

    switch (tok) {
      case 'depth': {
        const n = parseNum(tokens[++i]);
        if (n !== undefined) info.depth = n;
        break;
      }
      case 'seldepth': {
        const n = parseNum(tokens[++i]);
        if (n !== undefined) info.seldepth = n;
        break;
      }
      case 'multipv': {
        const n = parseNum(tokens[++i]);
        if (n !== undefined) info.multipv = n;
        break;
      }
      case 'nodes': {
        const n = parseNum(tokens[++i]);
        if (n !== undefined) info.nodes = n;
        break;
      }
      case 'nps': {
        const n = parseNum(tokens[++i]);
        if (n !== undefined) info.nps = n;
        break;
      }
      case 'time': {
        const n = parseNum(tokens[++i]);
        if (n !== undefined) info.time = n;
        break;
      }
      case 'score': {
        const kind = tokens[++i];
        const n = parseNum(tokens[++i]);
        if (n === undefined) break;
        if (kind === 'cp') info.scoreCp = n;
        else if (kind === 'mate') info.scoreMate = n;
        break;
      }
      case 'pv': {
        info.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
      }
      default:
        break;
    }
  }

  return info;
}

export function parseBestMove(line: string): UciBestMove | null {
  if (!line.startsWith('bestmove ')) return null;
  const parts = line.split(/\s+/);
  const bestMove = parts[1];
  if (!bestMove) return null;
  const ponderIdx = parts.indexOf('ponder');
  const result: UciBestMove = { bestMove };
  if (ponderIdx >= 0) {
    const ponder = parts[ponderIdx + 1];
    if (ponder) result.ponder = ponder;
  }
  return result;
}
