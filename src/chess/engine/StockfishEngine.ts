import { parseBestMove, parseInfo } from './uci';
import type { UciBestMove, UciInfo } from './uci';

/*
 * Why a Web Worker (vs running Stockfish on the main thread):
 *   Stockfish is CPU-intensive — running it in the same thread as the React
 *   render loop would freeze the UI for hundreds of ms per move. Workers run
 *   on a separate OS thread; we trade synchronous calls for a postMessage
 *   protocol. UCI is just text in/text out, so the bridge stays tiny.
 *
 * Why we vendor the .js + .wasm into public/engine/ rather than `import` it:
 *   Stockfish is GPL-3.0; bundling would propagate GPL across our entire app.
 *   Loading it as a separate runtime artifact keeps the licensing boundary
 *   clean (see LICENSES.md). The companion .wasm + .nnue filenames are baked
 *   into the .js, so vendor-engine.ts preserves them verbatim and writes
 *   /engine/engine.json with the entrypoint name we should spawn.
 */

export type StockfishStatus = 'idle' | 'loading' | 'ready' | 'thinking' | 'error';

export interface AnalyzeOptions {
  depth?: number;
  movetime?: number;
  multipv?: number;
}

export interface SearchResult extends UciBestMove {
  lastInfo: UciInfo | null;
}

interface EngineManifest {
  jsFile: string;
  wasmFile: string | null;
}

const ENGINE_DIR = '/engine';
const MANIFEST_URL = `${ENGINE_DIR}/engine.json`;
const INIT_TIMEOUT_MS = 15_000;

export class StockfishEngine {
  private worker: Worker | null = null;
  private status: StockfishStatus = 'idle';
  private pending: ((line: string) => void) | null = null;
  private currentRun: { resolve: (r: SearchResult) => void; reject: (e: Error) => void; lastInfo: UciInfo | null } | null = null;
  private infoListener: ((info: UciInfo) => void) | null = null;
  private onError: ((err: Error) => void) | null = null;
  private initRejecter: ((err: Error) => void) | null = null;

  constructor(opts: { onError?: (err: Error) => void } = {}) {
    if (opts.onError) this.onError = opts.onError;
  }

  getStatus(): StockfishStatus {
    return this.status;
  }

  async init(): Promise<void> {
    if (this.status === 'ready' || this.status === 'thinking') return;
    this.status = 'loading';

    let manifest: EngineManifest;
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${MANIFEST_URL}`);
      manifest = (await res.json()) as EngineManifest;
      if (!manifest.jsFile) throw new Error('engine.json missing jsFile field');
    } catch (err) {
      this.status = 'error';
      const msg = `Engine manifest unavailable (${(err as Error).message}). Did you run \`npm run vendor:engine\`?`;
      const e = new Error(msg);
      this.onError?.(e);
      throw e;
    }

    const engineUrl = `${ENGINE_DIR}/${manifest.jsFile}`;

    try {
      this.worker = new Worker(engineUrl);
    } catch (err) {
      this.status = 'error';
      const e = new Error(`Failed to spawn Stockfish worker at ${engineUrl}: ${(err as Error).message}`);
      this.onError?.(e);
      throw e;
    }

    this.worker.onmessage = (event: MessageEvent<string>) => this.onMessage(event.data);
    this.worker.onerror = (event: ErrorEvent) => {
      this.status = 'error';
      const err = new Error(`Stockfish worker error: ${event.message || 'unknown'}`);
      this.onError?.(err);
      this.initRejecter?.(err);
      this.initRejecter = null;
      this.currentRun?.reject(err);
      this.currentRun = null;
    };

    try {
      await this.commandWithTimeout('uci', (line) => line === 'uciok', INIT_TIMEOUT_MS);
      await this.commandWithTimeout('isready', (line) => line === 'readyok', INIT_TIMEOUT_MS);
    } catch (err) {
      this.status = 'error';
      this.onError?.(err as Error);
      throw err;
    }

    this.status = 'ready';
  }

  setSkillLevel(level: number): void {
    const clamped = Math.max(0, Math.min(20, Math.round(level)));
    this.send(`setoption name Skill Level value ${clamped}`);
  }

  setMultiPV(n: number): void {
    this.send(`setoption name MultiPV value ${Math.max(1, Math.round(n))}`);
  }

  newGame(): void {
    this.send('ucinewgame');
  }

  stop(): void {
    if (this.status === 'thinking') this.send('stop');
  }

  /**
   * Cancel any in-flight search and resolve when the engine has acknowledged
   * (UCI emits a `bestmove` line in response to `stop`). Safe to call when
   * no search is active — resolves immediately.
   */
  async cancel(): Promise<void> {
    const run = this.currentRun;
    if (!run) return;
    return new Promise<void>((resolve) => {
      const origResolve = run.resolve;
      const origReject = run.reject;
      run.resolve = (r) => {
        origResolve(r);
        resolve();
      };
      run.reject = (e) => {
        origReject(e);
        resolve();
      };
      this.send('stop');
    });
  }

  /**
   * Run a search. If another search is in flight (e.g. eval-bar analysis when
   * the user makes a move), cancel it first and wait for the engine to flush
   * its bestmove before starting the new search. Concurrent calls serialise.
   */
  async search(fen: string, opts: AnalyzeOptions, onInfo?: (info: UciInfo) => void): Promise<SearchResult> {
    if (!this.worker || this.status === 'error') throw new Error('Engine not initialised');

    if (this.currentRun) await this.cancel();

    this.status = 'thinking';
    this.infoListener = onInfo ?? null;

    return new Promise<SearchResult>((resolve, reject) => {
      this.currentRun = { resolve, reject, lastInfo: null };
      this.send(`position fen ${fen}`);
      this.send(this.buildGoCommand(opts));
    });
  }

  destroy(): void {
    this.currentRun?.reject(new Error('Engine destroyed'));
    this.worker?.terminate();
    this.worker = null;
    this.status = 'idle';
    this.currentRun = null;
    this.infoListener = null;
    this.initRejecter = null;
  }

  private buildGoCommand(opts: AnalyzeOptions): string {
    const parts = ['go'];
    if (opts.depth !== undefined) parts.push('depth', String(opts.depth));
    else if (opts.movetime !== undefined) parts.push('movetime', String(opts.movetime));
    else parts.push('depth', '14');
    return parts.join(' ');
  }

  private send(cmd: string): void {
    this.worker?.postMessage(cmd);
  }

  private commandWithTimeout(cmd: string, until: (line: string) => boolean, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.pending = null;
        this.initRejecter = null;
        reject(new Error(`Engine timeout after ${timeoutMs}ms waiting for response to: ${cmd}`));
      }, timeoutMs);

      this.initRejecter = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending = null;
        this.initRejecter = null;
        reject(err);
      };

      this.pending = (line: string) => {
        if (settled) return;
        if (until(line)) {
          settled = true;
          clearTimeout(timer);
          this.pending = null;
          this.initRejecter = null;
          resolve();
        }
      };
      this.send(cmd);
    });
  }

  private onMessage(line: string): void {
    if (typeof line !== 'string') return;

    if (this.pending) this.pending(line);

    const info = parseInfo(line);
    if (info) {
      if (this.currentRun) this.currentRun.lastInfo = info;
      this.infoListener?.(info);
      return;
    }

    const best = parseBestMove(line);
    if (best && this.currentRun) {
      const run = this.currentRun;
      this.currentRun = null;
      this.infoListener = null;
      this.status = 'ready';
      run.resolve({ ...best, lastInfo: run.lastInfo });
    }
  }
}
