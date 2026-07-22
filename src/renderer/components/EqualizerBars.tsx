import Box from '@mui/material/Box';
import { keyframes, styled } from '@mui/material/styles';

// CSS keyframes on scaleY: compositor-only, unlike JS-driven transforms. See Marquee.tsx.
const bounce = keyframes({
  '0%, 100%': { transform: 'scaleY(0.3)' },
  '50%': { transform: 'scaleY(1)' },
});

const BAR_TIMINGS = [
  { duration: 0.9, delay: 0 },
  { duration: 0.7, delay: 0.18 },
  { duration: 1.1, delay: 0.32 },
  { duration: 0.8, delay: 0.1 },
  { duration: 1.0, delay: 0.24 },
];

const Bars = styled(Box, {
  shouldForwardProp: prop => prop !== 'playing',
})<{ playing: boolean }>(({ playing }) => ({
  display: 'inline-flex',
  alignItems: 'flex-end',
  lineHeight: 0,
  '& > span': {
    display: 'block',
    borderRadius: 999,
    transformOrigin: 'bottom',
    animationName: `${bounce}`,
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    animationPlayState: playing ? 'running' : 'paused',
    willChange: playing ? 'transform' : 'auto',
    // Paused: rest at a low bar instead of freezing mid-animation.
    ...(playing ? null : { transform: 'scaleY(0.3)' }),
  },
}));

export interface EqualizerBarsProps {
  /** When false the bars freeze at a low resting height (e.g. a paused track). */
  playing?: boolean;
  /** Bar colour. Defaults to the inherited text colour. */
  color?: string;
  /** Tallest extent of a bar, in px. */
  height?: number;
  barWidth?: number;
  gap?: number;
  /** 1–5 bars. */
  barCount?: number;
}

// CSS-only equalizer, usable as a "now playing" row marker or a decorative accent.
const EqualizerBars = ({
  playing = true,
  color = 'currentColor',
  height = 16,
  barWidth = 3,
  gap = 2,
  barCount = 4,
}: EqualizerBarsProps) => {
  const count = Math.max(1, Math.min(barCount, BAR_TIMINGS.length));
  return (
    <Bars playing={playing} sx={{ height, gap: `${gap}px` }} aria-hidden="true">
      {BAR_TIMINGS.slice(0, count).map((t, i) => (
        <span
          key={i}
          style={{
            width: barWidth,
            height,
            background: color,
            animationDuration: `${t.duration}s`,
            animationDelay: `${t.delay}s`,
          }}
        />
      ))}
    </Bars>
  );
};

export default EqualizerBars;
