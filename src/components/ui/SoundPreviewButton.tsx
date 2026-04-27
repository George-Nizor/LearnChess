/*
 * SoundPreviewButton — small play button used in Settings to sample a sound
 * pack WITHOUT committing to it. We piggy-back on `playSound`'s second
 * `packOverride` argument so the user's currently-active pack is unchanged.
 *
 * UX: clicking plays move + capture in quick succession (140 ms apart) so the
 * user hears two characteristic samples. Disabled while the second sample is
 * still pending to discourage rapid-fire spam.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { playSound } from '@/sound';
import type { SoundPackId } from '@/state/soundPack';

interface SoundPreviewButtonProps {
  pack: SoundPackId;
  /** Optional accessible label override; defaults to "Preview <pack> pack". */
  label?: string;
}

export function SoundPreviewButton({ pack, label }: SoundPreviewButtonProps): ReactNode {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleClick = useCallback(() => {
    if (playing) return;
    setPlaying(true);
    playSound('move', pack);
    timerRef.current = window.setTimeout(() => {
      playSound('capture', pack);
      timerRef.current = window.setTimeout(() => {
        setPlaying(false);
        timerRef.current = null;
      }, 220);
    }, 180);
  }, [pack, playing]);

  const a11y = label ?? `Preview ${pack} sound pack`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={playing}
      aria-label={a11y}
      title={a11y}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
    >
      <span aria-hidden="true">{playing ? '■' : '▶'}</span>
      <span>Preview</span>
    </button>
  );
}
