import React, { useLayoutEffect, useRef } from 'react';
import { Box, Button, IconButton, Stack, Typography, alpha, styled } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { Icon } from '@iconify/react';
import dismiss from '@iconify/icons-fluent/dismiss-12-regular';
import subtract from '@iconify/icons-fluent/subtract-12-regular';
import add from '@iconify/icons-fluent/add-12-regular';
import playFilled from '@iconify/icons-fluent/play-16-filled';
import arrowUp from '@iconify/icons-fluent/arrow-circle-up-24-regular';
import arrowDown from '@iconify/icons-fluent/arrow-circle-down-24-regular';
import { formatLrcTime, type Line } from '../../utils/lrc';

/** How far −/+ move a stamp. Small enough to fix a late tap, big enough to feel. */
export const NUDGE_MS = 100;

/**
 * Width of the controls column. Unstamped lines reserve it too, so the text of
 * every row lines up whether or not it has been timed yet.
 */
const CONTROLS_W = 248;

/**
 * Every row is this tall, active or not, and they are separated by a gap rather
 * than by the active one growing. Sizing rows off the cursor made the list shift
 * under the finger on every step, which is exactly when you are trying to hit
 * the next control.
 */
const ROW_H = 56;

const Scroll = styled(Box)({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  paddingRight: 8,
  // Makes this the offset parent, so a row's offsetTop is measured against the
  // scroller rather than whatever ancestor happens to be positioned.
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

const Row = styled(Box, {
  shouldForwardProp: prop => prop !== 'active',
})<{ active: boolean }>(({ theme, active }) => ({
  display: 'flex',
  alignItems: 'center',
  minHeight: ROW_H,
  flexShrink: 0,
  paddingLeft: 16,
  paddingRight: 12,
  borderRadius: 8,
  cursor: 'pointer',
  backgroundColor: active ? theme.palette.primary.main : 'transparent',
  color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
  '&:hover': {
    backgroundColor: active ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.06),
  },
}));

/**
 * On a plain row the chips are the same raised grey as the tip cards, so the two
 * halves of the studio read as one surface. On the highlighted row they go solid
 * black, which is what keeps them legible against a saturated primary.
 */
const chipBg = (theme: Theme, active: boolean) =>
  active ? theme.palette.common.black : theme.palette.surfaces.elevated;
const chipFg = (theme: Theme, active: boolean) =>
  active ? theme.palette.common.white : theme.palette.text.primary;
const chipHover = (theme: Theme, active: boolean) =>
  alpha(active ? theme.palette.common.white : theme.palette.text.primary, 0.15);

const chip = (prop: string) => prop !== 'active';

const Marker = styled(Box, { shouldForwardProp: chip })<{ active: boolean }>(
  ({ theme, active }) => ({
    display: 'inline-flex',
    alignItems: 'center',
    height: 36,
    paddingLeft: 16,
    paddingRight: 16,
    borderRadius: 18,
    letterSpacing: 2,
    lineHeight: 1,
    backgroundColor: chipBg(theme, active),
    color: chipFg(theme, active),
  })
);

const Pill = styled(Stack, { shouldForwardProp: chip })<{ active: boolean }>(
  ({ theme, active }) => ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingLeft: 10,
    paddingRight: 10,
    cursor: 'default',
    borderRadius: 20,
    backgroundColor: chipBg(theme, active),
    color: chipFg(theme, active),
  })
);

const PillButton = styled(IconButton, { shouldForwardProp: chip })<{ active: boolean }>(
  ({ theme, active }) => ({
    width: 28,
    height: 28,
    padding: 0,
    color: 'inherit',
    '&:hover': { backgroundColor: chipHover(theme, active) },
  })
);

const PlayDot = styled(IconButton, { shouldForwardProp: chip })<{ active: boolean }>(
  ({ theme, active }) => ({
    width: 36,
    height: 36,
    padding: 0,
    transition: 'none',
    backgroundColor: chipBg(theme, active),
    color: chipFg(theme, active),
    '&:hover': { backgroundColor: chipBg(theme, active), filter: 'brightness(1.15)' },
  })
);

/**
 * Hand focus back after a click.
 *
 * The arrow keys are studio shortcuts, not list navigation, and Chromium
 * re-promotes a focused control to `:focus-visible` as soon as the keyboard is
 * used, so whatever was last clicked keeps a focus ring while you tap through
 * the song. Bound to pointer release rather than click, so Enter or Space still
 * leaves focus where a keyboard user needs it.
 */
const dropFocus = (e: React.PointerEvent<HTMLElement>) => e.currentTarget.blur();

/** The clear / time / nudge cluster, shared by the lyric rows and the end mark. */
function TimePill({
  timeMs,
  active,
  onChange,
  onPreview,
}: {
  timeMs: number;
  active: boolean;
  onChange: (_timeMs: number | null) => void;
  onPreview?: () => void;
}) {
  return (
    <>
      <Pill active={active}>
        <PillButton
          active={active}
          onPointerUp={dropFocus}
          onClick={() => onChange(null)}
          title="Clear timestamp"
        >
          <Icon icon={dismiss} height="0.9em" />
        </PillButton>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
          {formatLrcTime(timeMs)}
        </Typography>
        <PillButton
          active={active}
          onPointerUp={dropFocus}
          onClick={() => onChange(timeMs - NUDGE_MS)}
          title={`${NUDGE_MS}ms earlier`}
        >
          <Icon icon={subtract} height="0.9em" />
        </PillButton>
        <PillButton
          active={active}
          onPointerUp={dropFocus}
          onClick={() => onChange(timeMs + NUDGE_MS)}
          title={`${NUDGE_MS}ms later`}
        >
          <Icon icon={add} height="0.9em" />
        </PillButton>
      </Pill>
      {onPreview && (
        <PlayDot active={active} onPointerUp={dropFocus} onClick={onPreview} title="Play from here">
          <Icon icon={playFilled} height="0.9em" />
        </PlayDot>
      )}
    </>
  );
}

export interface SyncStudioProps {
  lines: Line[];
  /** -1 is the opening marker, `lines.length` the closing one. */
  cursor: number;
  /** When the last line stops, or null until it has been marked. */
  endMs: number | null;
  onCursor: (_index: number) => void;
  onStamp: (_index: number, _timeMs: number | null) => void;
  onEndStamp: (_timeMs: number | null) => void;
  onPreviewFrom: (_index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}

export default function SyncStudio({
  lines,
  cursor,
  endMs,
  onCursor,
  onStamp,
  onEndStamp,
  onPreviewFrom,
  onPrevious,
  onNext,
}: SyncStudioProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * Hold the active row at a fixed point on screen and let the lyrics move
   * behind it.
   *
   * Both halves matter. The scroll is instant, not smooth, because an animated
   * recentre drags the highlight down to the new row and then slides it back;
   * that travel is what made stepping through a song dizzy.
   *
   * And it runs as a layout effect: a passive effect lands after paint, leaving
   * one frame where the highlight has already moved to the next row but the
   * scroll has not caught up. Before paint, the cursor and the scroll change
   * together, so the band never visibly shifts at all.
   */
  useLayoutEffect(() => {
    const row = activeRef.current;
    const box = scrollRef.current;
    if (!row || !box) return;
    box.scrollTop = Math.max(0, row.offsetTop - (box.clientHeight - row.offsetHeight) / 2);
  }, [cursor]);

  const atEnd = cursor >= lines.length;

  return (
    <>
      <Scroll ref={scrollRef}>
        {/* The starting position, before the first line. Sitting here means
            nothing is highlighted yet; the first Next Line marks line one. */}
        <Row
          active={cursor < 0}
          ref={cursor < 0 ? activeRef : undefined}
          onClick={() => onCursor(-1)}
        >
          <Box sx={{ width: CONTROLS_W, flexShrink: 0 }} />
          <Marker active={cursor < 0}>…</Marker>
        </Row>

        {lines.map((line, i) => {
          const active = i === cursor;
          return (
            <Row
              key={i}
              active={active}
              ref={active ? activeRef : undefined}
              onClick={() => onCursor(i)}
            >
              <Box
                sx={{ width: CONTROLS_W, flexShrink: 0, display: 'flex', gap: 1.5 }}
                onClick={e => e.stopPropagation()}
              >
                {line.timeMs != null && (
                  <TimePill
                    timeMs={line.timeMs}
                    active={active}
                    onChange={at => onStamp(i, at)}
                    onPreview={() => onPreviewFrom(i)}
                  />
                )}
              </Box>
              {/* Size stays put across states. Growing the active line re-wraps
                  a long lyric, so the row's height changes as the cursor lands
                  on it and the list judders under the scroll. Weight and the row
                  colour carry the emphasis instead. */}
              <Typography
                sx={{
                  fontSize: '1.3rem',
                  fontWeight: active ? 600 : 400,
                  opacity: active ? 1 : line.timeMs != null ? 0.85 : 0.45,
                }}
              >
                {line.text || ' '}
              </Typography>
            </Row>
          );
        })}

        {/* The closing position. Marking it is what tells a player when the last
            line stops, instead of leaving it on screen until the track ends. */}
        <Row
          active={atEnd}
          ref={atEnd ? activeRef : undefined}
          onClick={() => onCursor(lines.length)}
        >
          <Box
            sx={{ width: CONTROLS_W, flexShrink: 0, display: 'flex', gap: 1.5 }}
            onClick={e => e.stopPropagation()}
          >
            {endMs != null && <TimePill timeMs={endMs} active={atEnd} onChange={onEndStamp} />}
          </Box>
          <Marker active={atEnd}>…</Marker>
        </Row>
      </Scroll>

      <Stack direction="row" gap={2.5} justifyContent="flex-end" sx={{ pt: 2, pb: 1, pr: 1 }}>
        <Button
          variant="outlined"
          size="large"
          onPointerUp={dropFocus}
          onClick={onPrevious}
          endIcon={<Icon icon={arrowUp} height="1.4em" />}
          sx={{ borderRadius: 99, px: 4, py: 1.5, fontSize: '1.05rem' }}
        >
          Previous Line
        </Button>
        <Button
          variant="contained"
          size="large"
          onPointerUp={dropFocus}
          onClick={onNext}
          startIcon={<Icon icon={arrowDown} height="1.4em" />}
          sx={{ borderRadius: 99, px: 4, py: 1.5, fontSize: '1.05rem' }}
        >
          Next Line
        </Button>
      </Stack>
    </>
  );
}
