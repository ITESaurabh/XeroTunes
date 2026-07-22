import React, { useEffect, useRef } from 'react';
import { Box, BoxProps, useTheme } from '@mui/material';

// Windows-10 style dot loader — dots stream in from the left, gather into a tight
// evenly-spaced center cluster, hold, then peel off to the right one-by-one.
// Driven by a single rAF loop (not motion springs) so every dot reads off one
// shared, deterministic loop phase — see IMPLEMENTATION_PLAN.md for the model.
//
// Drop-in like MUI's <LinearProgress />: mount it wherever you need an
// indeterminate horizontal loader and it fills its container's width. It
// animates for as long as it is mounted, so gate visibility by mounting/
// unmounting it (e.g. behind AnimatePresence) rather than a boolean prop.
const SIN = 0.035; // entry stagger between dots (loop fraction)
const ENT = 0.3; // one dot's entry duration, decelerating (loop fraction)
const HOLD = 0.05; // beat the assembled cluster is held (loop fraction)
const SOUT = 0.045; // exit stagger between dots (loop fraction)
const EXT = 0.26; // one dot's exit duration, accelerating (loop fraction)
// Px of travel, right before a dot's parked/waiting position at the track edge,
// over which it fades to fully invisible. Must reach exactly 0 by the edge — the
// track's XL/XR *are* the edge now (no off-screen overshoot), so a dot parked
// there with any residual opacity would sit visibly stuck instead of vanishing.
const FADE_RANGE = 48;

export interface LinearDotLoaderProps extends Omit<BoxProps, 'color'> {
  /** Number of dots in the cluster. */
  count?: number;
  /** Duration of one full stream-in/hold/stream-out cycle (seconds). */
  cycleSeconds?: number;
  /** Diameter of each dot (px). */
  size?: number;
  /** Gap between adjacent dots' centers in the gathered cluster (px). */
  gap?: number;
  /** Dot color. Defaults to the theme's primary color. */
  color?: string;
  /** Accessible label for the progressbar role. */
  label?: string;
}

function LinearDotLoader({
  count = 5,
  cycleSeconds = 3.6,
  size = 10,
  gap = 25,
  color,
  label,
  sx,
  ...boxProps
}: LinearDotLoaderProps) {
  const theme = useTheme();
  const dotColor = color ?? theme.palette.primary.main;

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const halfWidthRef = useRef(160);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const updateWidth = () => {
      halfWidthRef.current = track.getBoundingClientRect().width / 2;
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(track);

    const T_ALL = (count - 1) * SIN + ENT;
    const T_REL = T_ALL + HOLD;
    const dotParams = Array.from({ length: count }, (_, i) => {
      const o = ((count - 1) / 2 - i) * gap;
      const tS = i * SIN;
      const tA = tS + ENT;
      const tE = T_REL + i * SOUT;
      const tEnd = tE + EXT;
      return { o, tS, tA, tE, tEnd };
    });

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      dotParams.forEach(({ o }, i) => {
        const el = dotRefs.current[i];
        if (!el) return;
        el.style.transform = `translate(-50%, -50%) translateX(${o}px)`;
        el.style.opacity = '1';
      });
      return () => ro.disconnect();
    }

    const startTime = performance.now();

    const tick = (now: number) => {
      const base = ((now - startTime) / (cycleSeconds * 1000)) % 1;
      const halfWidth = halfWidthRef.current;
      const XL = -halfWidth;
      const XR = halfWidth;
      const fadeStart = halfWidth - FADE_RANGE;

      for (let i = 0; i < count; i++) {
        const el = dotRefs.current[i];
        if (!el) continue;
        const { o, tS, tA, tE, tEnd } = dotParams[i];

        let x: number;
        if (base < tS) {
          x = XL;
        } else if (base < tA) {
          const s = (base - tS) / ENT;
          x = XL + (o - XL) * (1 - (1 - s) ** 2);
        } else if (base < tE) {
          x = o;
        } else if (base < tEnd) {
          const s = (base - tE) / EXT;
          x = o + (XR - o) * (s * s);
        } else {
          x = XR;
        }

        const ax = Math.abs(x);
        const opacity = ax <= fadeStart ? 1 : Math.max(0, 1 - (ax - fadeStart) / FADE_RANGE);

        el.style.transform = `translate(-50%, -50%) translateX(${x}px)`;
        el.style.opacity = String(opacity);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      ro.disconnect();
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [count, cycleSeconds, gap]);

  return (
    <Box
      ref={trackRef}
      role="progressbar"
      aria-label={label ?? 'Loading'}
      sx={{
        position: 'relative',
        width: '100%',
        height: size + 14,
        overflow: 'hidden',
        ...sx,
      }}
      {...boxProps}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          ref={el => {
            dotRefs.current[i] = el;
          }}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: size,
            height: size,
            borderRadius: '50%',
            background: dotColor,
            willChange: 'transform, opacity',
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}
    </Box>
  );
}

export default LinearDotLoader;
