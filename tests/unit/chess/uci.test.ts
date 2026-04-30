import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfo } from '@/chess/engine/uci';

describe('parseInfo', () => {
  it('returns null for non-info lines', () => {
    expect(parseInfo('readyok')).toBeNull();
    expect(parseInfo('bestmove e2e4')).toBeNull();
    expect(parseInfo('')).toBeNull();
  });

  it('parses a typical info line', () => {
    const line = 'info depth 12 seldepth 18 multipv 1 score cp 32 nodes 87654 nps 1234567 time 71 pv e2e4 e7e5 g1f3';
    const info = parseInfo(line);
    expect(info).not.toBeNull();
    expect(info?.depth).toBe(12);
    expect(info?.seldepth).toBe(18);
    expect(info?.multipv).toBe(1);
    expect(info?.scoreCp).toBe(32);
    expect(info?.nodes).toBe(87654);
    expect(info?.nps).toBe(1234567);
    expect(info?.time).toBe(71);
    expect(info?.pv).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  it('parses mate scores', () => {
    const info = parseInfo('info depth 6 score mate 3 pv h5h7 g8h7 d1h5');
    expect(info?.scoreMate).toBe(3);
    expect(info?.scoreCp).toBeUndefined();
  });

  it('parses negative mate (being mated)', () => {
    const info = parseInfo('info depth 8 score mate -2 pv g7g5 d1h5');
    expect(info?.scoreMate).toBe(-2);
  });
});

describe('parseBestMove', () => {
  it('parses bestmove with ponder', () => {
    const r = parseBestMove('bestmove e2e4 ponder e7e5');
    expect(r?.bestMove).toBe('e2e4');
    expect(r?.ponder).toBe('e7e5');
  });

  it('parses bestmove without ponder', () => {
    const r = parseBestMove('bestmove g1f3');
    expect(r?.bestMove).toBe('g1f3');
    expect(r?.ponder).toBeUndefined();
  });

  it('returns null for non-bestmove lines', () => {
    expect(parseBestMove('info depth 1')).toBeNull();
    expect(parseBestMove('')).toBeNull();
  });

  it('parses promotion bestmove', () => {
    const r = parseBestMove('bestmove a7a8q');
    expect(r?.bestMove).toBe('a7a8q');
  });
});
