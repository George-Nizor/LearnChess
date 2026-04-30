/*
 * TutorAvatar — animated cartoon face that "speaks" the lesson prose.
 *
 * Built as a custom SVG (no external asset dependency, full control over
 * animation). The face has:
 *   - Round head with warm cream/skin tone
 *   - Two eyes (oval pupils on white scleras) that blink autonomously
 *   - Eyebrows that lift slightly when a new bubble appears (raised-
 *     interest expression)
 *   - Mouth that animates between closed-smile and open-talking when
 *     `speaking` is true
 *
 * Idle: gentle vertical bob (3 px peak-to-peak, 4 s loop) + autonomous
 * blink every 4-6 s (random jitter so it doesn't feel mechanical).
 *
 * Reaction: when `pulseKey` changes, eyebrows lift and the head nods
 * once (~450 ms), like a small "got it, here's the next idea" beat.
 *
 * Speaking: when `speaking` is true, the mouth opens/closes in a 200 ms
 * loop until `speaking` flips back to false. Caller pulses this for
 * the duration of bubble streaming.
 *
 * All animations honour prefers-reduced-motion: the bob and mouth-loop
 * stop, but the blink is preserved (it's a 50 ms event, not a sweep —
 * inside the spec's leniency for incidental animation).
 */
import { motion, useReducedMotion, type Easing } from 'framer-motion';
import { useEffect, useState } from 'react';

interface TutorAvatarProps {
  /** Changes whenever a new bubble appears — triggers nod + brow-lift. */
  pulseKey: string;
  /** Pixel size of the avatar frame (default 56). */
  size?: number;
  /** When true, animate the mouth open/close in a loop. */
  speaking?: boolean;
}

export function TutorAvatar({ pulseKey, size = 56, speaking = false }: TutorAvatarProps) {
  const reduce = useReducedMotion();
  const easeInOut: Easing = 'easeInOut';
  const easeOut: Easing = 'easeOut';

  // Blink scheduler — autonomous, random 3.5-6.5 s interval. Each blink
  // is a 90 ms pinch on the eyelid scaleY. Disabled under reduced-motion.
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (reduce) return undefined;
    let cancelled = false;
    const schedule = (): number => {
      const next = 3500 + Math.random() * 3000;
      return window.setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        window.setTimeout(() => {
          if (cancelled) return;
          setBlink(false);
          schedule();
        }, 110);
      }, next);
    };
    const id = schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [reduce]);

  // Outer bob — head breathes up and down.
  const bob = reduce
    ? {}
    : {
        animate: { y: [0, -3, 0] },
        transition: { duration: 4, ease: easeInOut, repeat: Infinity },
      };

  // Reaction nod — fires once per pulseKey change.
  const nod = reduce
    ? {}
    : {
        initial: { rotate: 0 },
        animate: { rotate: [0, -6, 0, 4, 0] },
        transition: { duration: 0.45, ease: easeOut },
      };

  // SVG canvas: 100×100 internal, scaled down to `size` px on the page.
  // All measurements below are in this 100-unit space.
  const eyeY = 42;
  const eyeRX = 4.5;
  const eyeRY = 6;
  const browLift = pulseKey ? -1 : 0; // small numeric so the dep array can change

  return (
    <div
      className="relative flex shrink-0 items-center"
      style={{ width: size, height: size }}
    >
      <motion.div
        aria-hidden
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        {...bob}
      >
        <motion.svg
          key={pulseKey}
          {...nod}
          viewBox="0 0 100 100"
          width={size}
          height={size}
          className="overflow-visible"
        >
          {/* Head — circular face. Warm-paper skin tone reads as friendly
              against the charcoal page; no frame so the face floats on
              the surface. */}
          <circle cx="50" cy="50" r="42" fill="#f5e6c8" />
          {/* Subtle face shadow — rim along bottom-right, gives volume. */}
          <circle cx="52" cy="54" r="40" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="2" />

          {/* Eyebrows — small thick lines that lift on pulseKey change. */}
          <motion.g
            initial={{ y: 0 }}
            animate={{ y: [0, browLift, 0] }}
            transition={{ duration: 0.5, ease: easeOut, times: [0, 0.4, 1] }}
          >
            <line x1="34" y1="32" x2="44" y2="30" stroke="#3b2a1a" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="56" y1="30" x2="66" y2="32" stroke="#3b2a1a" strokeWidth="2.5" strokeLinecap="round" />
          </motion.g>

          {/* Eyes — oval whites with dark pupils. The wrapping `<g>` scales
              vertically when `blink` flips so both eyes blink in lockstep. */}
          <motion.g
            animate={{ scaleY: blink ? 0.05 : 1 }}
            transition={{ duration: 0.09, ease: easeOut }}
            style={{ transformOrigin: `50px ${eyeY}px` }}
          >
            <ellipse cx="38" cy={eyeY} rx={eyeRX} ry={eyeRY} fill="#fff" />
            <ellipse cx="62" cy={eyeY} rx={eyeRX} ry={eyeRY} fill="#fff" />
            <circle cx="38.5" cy={eyeY + 0.5} r="2.4" fill="#1a1410" />
            <circle cx="62.5" cy={eyeY + 0.5} r="2.4" fill="#1a1410" />
            {/* Tiny highlight on each pupil — gives the eyes life. */}
            <circle cx="39.5" cy={eyeY - 1} r="0.8" fill="#fff" />
            <circle cx="63.5" cy={eyeY - 1} r="0.8" fill="#fff" />
          </motion.g>

          {/* Mouth — closed smile by default, opens when speaking.
              We animate the path's `d` attribute via framer-motion's
              <motion.path />: it tweens between the two paths smoothly
              when `speaking` flips. Speaking uses a fast loop of
              open/close so the mouth visibly "talks". */}
          <motion.path
            initial={false}
            animate={
              speaking && !reduce
                ? {
                    d: [
                      'M 38 64 Q 50 68 62 64',     // closed smile
                      'M 38 62 Q 50 72 62 62',     // open
                      'M 38 64 Q 50 68 62 64',     // closed
                      'M 38 62 Q 50 71 62 62',     // open
                      'M 38 64 Q 50 68 62 64',     // closed
                    ],
                  }
                : { d: 'M 38 64 Q 50 68 62 64' }
            }
            transition={
              speaking && !reduce
                ? { duration: 0.7, ease: easeInOut, repeat: Infinity }
                : { duration: 0.2, ease: easeOut }
            }
            stroke="#3b2a1a"
            strokeWidth="2.2"
            strokeLinecap="round"
            fill="none"
          />

          {/* Cheeks — soft circles for a friendly look. */}
          <circle cx="32" cy="58" r="3.5" fill="rgba(220, 100, 80, 0.18)" />
          <circle cx="68" cy="58" r="3.5" fill="rgba(220, 100, 80, 0.18)" />
        </motion.svg>

      </motion.div>

      {/* Speaking indicator — three pulsing dots in a small bubble.
          Positioned to the LEFT of the avatar (absolute right-full)
          so it doesn't overlap with the line-name heading sitting to
          the right of the avatar in the lesson sidebar. Renders only
          when `speaking` is true. */}
      {speaking && !reduce && (
        <motion.span
          aria-label="Tutor is speaking"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.18 }}
          className="absolute right-full top-1/2 mr-2 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-full bg-elevated px-2 py-1 ring-1 ring-border"
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="block h-1 w-1 rounded-full bg-accent"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -1, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18, ease: easeInOut }}
            />
          ))}
        </motion.span>
      )}
    </div>
  );
}
