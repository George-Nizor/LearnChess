/*
 * TutorAvatar — animated knight that "speaks" the lesson prose.
 *
 * Idle state: gentle vertical bob (3 px peak-to-peak, 4 s loop). Reads as
 * breathing rather than fidgeting.
 *
 * Reaction: when the prose changes (new bubble), the avatar tilts
 * forward-and-back once, ~250 ms, like a small nod that says "next idea
 * coming". The caller passes `pulseKey` (any string that changes when
 * a new bubble appears) and the avatar plays the reaction once per key.
 *
 * The avatar sits inside an amber-soft circle so it reads as a "speaker"
 * portrait. The frame's shadow + ring is the only piece of warm chrome
 * the lesson sidebar shows — everything else is achromatic charcoal.
 */
import { motion, useReducedMotion, type Easing } from 'framer-motion';
import { KnightIcon } from './ChessIcons';

interface TutorAvatarProps {
  /** Changes whenever a new bubble appears — triggers the nod animation. */
  pulseKey: string;
  /** Pixel size of the avatar frame (default 56). */
  size?: number;
}

export function TutorAvatar({ pulseKey, size = 56 }: TutorAvatarProps) {
  const reduce = useReducedMotion();

  // Idle bob — slow, low-amplitude, infinite. Disabled under
  // prefers-reduced-motion (vestibular safety).
  const easeInOut: Easing = 'easeInOut';
  const easeOut: Easing = 'easeOut';
  const bob = reduce
    ? {}
    : {
        animate: { y: [0, -3, 0] },
        transition: { duration: 4, ease: easeInOut, repeat: Infinity },
      };

  // Reaction nod — keyed by pulseKey so it re-fires on each new bubble.
  // Layered on top of the bob; framer-motion combines them via composition.
  const nod = reduce
    ? {}
    : {
        initial: { rotate: 0 },
        animate: { rotate: [0, -8, 0, 4, 0] },
        transition: { duration: 0.45, ease: easeOut },
      };

  return (
    <motion.div
      aria-hidden
      className="relative flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-foreground ring-2 ring-accent/40 dark:bg-accent-soft dark:ring-accent/30"
      style={{ width: size, height: size }}
      {...bob}
    >
      <motion.div key={pulseKey} {...nod} className="flex items-center justify-center">
        <KnightIcon size={Math.round(size * 0.62)} />
      </motion.div>
      {/* Subtle inner glow so the avatar reads as lit, not flat. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-white/15 to-transparent dark:from-white/10"
      />
    </motion.div>
  );
}
