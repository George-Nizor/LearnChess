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

export function parseInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ')) return null;
  const tokens = line.slice(5).split(/\s+/);
  const info: UciInfo = {};

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;

    switch (tok) {
      case 'depth': {
        const v = tokens[++i];
        if (v !== undefined) info.depth = Number(v);
        break;
      }
      case 'seldepth': {
        const v = tokens[++i];
        if (v !== undefined) info.seldepth = Number(v);
        break;
      }
      case 'multipv': {
        const v = tokens[++i];
        if (v !== undefined) info.multipv = Number(v);
        break;
      }
      case 'nodes': {
        const v = tokens[++i];
        if (v !== undefined) info.nodes = Number(v);
        break;
      }
      case 'nps': {
        const v = tokens[++i];
        if (v !== undefined) info.nps = Number(v);
        break;
      }
      case 'time': {
        const v = tokens[++i];
        if (v !== undefined) info.time = Number(v);
        break;
      }
      case 'score': {
        const kind = tokens[++i];
        const val = tokens[++i];
        if (val === undefined) break;
        if (kind === 'cp') info.scoreCp = Number(val);
        else if (kind === 'mate') info.scoreMate = Number(val);
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
