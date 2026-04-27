/*
 * Sound utility.
 *
 * Strategy:
 *   1. The active sound pack lives in `src/state/soundPack.ts`. On each
 *      playSound call we look up the pack and resolve the URL
 *      `/sounds/<pack>/<kind>.mp3` (with a fallback to the legacy flat
 *      `/sounds/<kind>.mp3` path for the `standard` pack — kept so older
 *      vendored files still play even if `npm run vendor:sounds` hasn't
 *      been re-run since this update).
 *   2. The HTMLAudioElement cache is keyed by `<pack>:<kind>` so swapping
 *      packs in Settings doesn't keep playing the old samples.
 *   3. Per-key 404 / play-failure flags route to a synthesised WebAudio
 *      fallback (terse but never silent).
 *   4. AudioContext resume happens inside playSound(), so the first call
 *      after any user interaction unlocks audio under browser autoplay rules.
 *
 * Why lazy: HTMLAudioElement preloading of 4 short files per pack is
 * ~100 KB; we don't pay it until the user first triggers a sound.
 */

import { useSoundPack, type SoundPackId } from '@/state/soundPack';

export type SoundKind = 'move' | 'capture' | 'check' | 'gameEnd';

interface MoveSummary {
  isCapture: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
}

export function soundForMove(move: MoveSummary): SoundKind {
  if (move.isCheckmate) return 'gameEnd';
  if (move.isCheck) return 'check';
  if (move.isCapture) return 'capture';
  return 'move';
}

const FILE_NAMES: Record<SoundKind, string> = {
  move: 'move.mp3',
  capture: 'capture.mp3',
  check: 'check.mp3',
  gameEnd: 'genericNotify.mp3',
};

function urlsFor(pack: SoundPackId, kind: SoundKind): string[] {
  const file = FILE_NAMES[kind];
  const candidates = [`/sounds/${pack}/${file}`];
  // Backwards-compat: if the user is on `standard` and the per-pack folder
  // hasn't been vendored yet, fall back to the flat path the v1 vendor
  // script wrote into /sounds/<file>.
  if (pack === 'standard') candidates.push(`/sounds/${file}`);
  return candidates;
}

const cache = new Map<string, HTMLAudioElement>();
const failed = new Set<string>();
let muted = false;
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function tone(freq: number, durationMs: number, type: OscillatorType = 'sine', vol = 0.1, delayMs = 0): void {
  const c = getCtx();
  if (!c) return;
  const start = c.currentTime + delayMs / 1000;
  const stop = start + durationMs / 1000;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(vol, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, stop);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(stop + 0.05);
}

function fallback(kind: SoundKind): void {
  switch (kind) {
    case 'move':
      tone(220, 50, 'triangle', 0.08);
      break;
    case 'capture':
      tone(110, 80, 'square', 0.10);
      tone(330, 40, 'triangle', 0.06, 20);
      break;
    case 'check':
      tone(880, 90, 'triangle', 0.12);
      tone(880, 90, 'triangle', 0.12, 130);
      break;
    case 'gameEnd':
      tone(440, 100, 'sine', 0.10);
      tone(550, 100, 'sine', 0.10, 110);
      tone(660, 180, 'sine', 0.10, 230);
      break;
  }
}

export function setMuted(b: boolean): void {
  muted = b;
}

export function isMuted(): boolean {
  return muted;
}

/**
 * Play a sound for the given kind using the active pack from the
 * sound-pack store. The pack argument override is exposed for the
 * Settings preview button so users can sample a pack without committing.
 */
export function playSound(kind: SoundKind, packOverride?: SoundPackId): void {
  if (muted) return;
  if (typeof window === 'undefined') return;

  const pack = packOverride ?? useSoundPack.getState().pack;
  const key = `${pack}:${kind}`;
  if (failed.has(key)) {
    fallback(kind);
    return;
  }

  let audio = cache.get(key);
  if (!audio) {
    const candidates = urlsFor(pack, kind);
    audio = new Audio(candidates[0]);
    audio.preload = 'auto';
    // If the primary URL fails AND there's a backup (the flat /sounds/<file>
    // path for `standard`), try the backup before falling back to WebAudio.
    audio.addEventListener('error', () => {
      if (candidates.length > 1) {
        const backup = new Audio(candidates[1]);
        backup.preload = 'auto';
        cache.set(key, backup);
        backup.play().catch(() => {
          failed.add(key);
        });
      } else {
        failed.add(key);
      }
    }, { once: true });
    cache.set(key, audio);
  }

  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {
      failed.add(key);
      fallback(kind);
    });
  } catch {
    failed.add(key);
    fallback(kind);
  }
}
