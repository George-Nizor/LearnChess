import { useEffect, useRef } from 'react';
import { Chessground as buildChessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';

/*
 * chessground is a headless DOM library — no React. We mount it once into a
 * <div ref> and hand the imperative `Api` back via a callback ref so parent
 * components can call `cg.set(...)`, `cg.move(...)`, etc. Re-renders push
 * config diffs through `cg.set()` rather than re-mounting the board.
 *
 * React 19 lets us pass `ref` directly as a prop (no forwardRef), but we use
 * `apiRef` here because the parent needs the chessground Api, not the DOM node.
 */

interface ChessgroundProps {
  config: Config;
  onApiReady?: (api: Api) => void;
  className?: string;
}

export function Chessground({ config, onApiReady, className }: ChessgroundProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const api = buildChessground(hostRef.current, config);
    apiRef.current = api;
    onApiReady?.(api);
    return () => {
      api.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiRef.current?.set(config);
  }, [config]);

  return <div ref={hostRef} className={className ?? 'cg-board-host'} />;
}
