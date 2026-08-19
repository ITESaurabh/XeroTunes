import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { Icon } from '@iconify/react';
import liveIcon from '@iconify/icons-fluent/live-24-filled';

const formatDuration = (value: number): string => {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  const minute = Math.floor(safe / 60);
  const secondLeft = Math.floor(safe - minute * 60);
  return `${minute}:${secondLeft < 10 ? `0${secondLeft}` : secondLeft}`;
};

const Root = styled(Box)({
  width: '100%',
});

const TrackContainer = styled(Box, {
  shouldForwardProp: prop => prop !== 'isLive',
})<{ isLive?: boolean }>(({ isLive }) => ({
  position: 'relative',
  height: 20,
  cursor: isLive ? 'default' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  touchAction: 'none',
  ...(isLive ? {} : { '&:hover .pp-thumb': { opacity: 1 } }),
}));

const Rail = styled(Box)(({ theme }) => ({
  position: 'absolute',
  left: 0,
  right: 0,
  height: 5,
  borderRadius: 20,
  backgroundColor: theme.palette.surfaces.well,
  opacity: theme.palette.mode === 'dark' ? 0.28 : 1,
  pointerEvents: 'none',
}));

const Fill = styled(Box)(({ theme }) => ({
  position: 'absolute',
  left: 0,
  height: 5,
  width: 0,
  borderRadius: 20,
  backgroundColor: theme.palette.primary.main,
  willChange: 'width',
  pointerEvents: 'none',
}));

const Thumb = styled(Box)(({ theme }) => ({
  position: 'absolute',
  left: 0,
  width: 18,
  height: 18,
  borderRadius: '50%',
  backgroundColor: theme.palette.text.primary,
  boxShadow: '0 2px 12px 0 rgba(0,0,0,0.4)',
  transform: 'translateX(-50%)',
  willChange: 'left',
  pointerEvents: 'none',
  opacity: 0,
  transition: 'opacity 120ms ease',
}));

const BUFFER_GRACE_MS = 400;
const ELASTIC_DURATION_MS = 280;
const ELASTIC_EASING = 'cubic-bezier(0.47, 1.64, 0.41, 0.8)';
const FILL_ELASTIC = `width ${ELASTIC_DURATION_MS}ms ${ELASTIC_EASING}`;
const THUMB_ELASTIC = `left ${ELASTIC_DURATION_MS}ms ${ELASTIC_EASING}, opacity 120ms ease`;

const BufferBar = styled(LinearProgress)(({ theme }) => ({
  position: 'absolute',
  left: 0,
  right: 0,
  height: 5,
  borderRadius: 20,
  backgroundColor: 'transparent',
  [`& .MuiLinearProgress-bar`]: { backgroundColor: theme.palette.primary.main },
}));

const TimeRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: -4,
});

const TimeText = styled(Typography)({
  fontSize: '0.75rem',
  opacity: 0.38,
  fontWeight: 500,
  letterSpacing: 0.2,
});

const LiveRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  color: theme.palette.text.secondary,
  fontSize: '0.75rem',
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
}));

const LiveMark = styled(Box, {
  shouldForwardProp: prop => prop !== 'animate',
})<{ animate?: boolean }>(({ animate }) => ({
  display: 'flex',
  '@keyframes xt-live-pulse': {
    '0%, 100%': { opacity: 0.3 },
    '50%': { opacity: 1 },
  },
  ...(animate ? { animation: 'xt-live-pulse 1.8s ease-in-out infinite' } : { opacity: 0.4 }),
}));

interface PlaybackProgressProps {
  audioRef: React.RefObject<HTMLAudioElement>;
  duration: number;
  trackId?: string | number | null;
  /** Internet radio: no seeking, no end to count down to. */
  isLive?: boolean;
  paused?: boolean;
  onSeekCommit: (_pos: number) => void;
}

// PlaybackProgress drives the slider via direct DOM mutation — `position` is
// never React state, so audio `timeupdate` ticks (4 Hz) cause zero re-renders.
const PlaybackProgress = React.memo(function PlaybackProgress({
  audioRef,
  duration,
  trackId,
  isLive,
  paused,
  onSeekCommit,
}: PlaybackProgressProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const posTextRef = useRef<HTMLSpanElement>(null);
  const remTextRef = useRef<HTMLSpanElement>(null);
  const isSeekingRef = useRef(false);
  const pointerDownRef = useRef(false);
  const seekValueRef = useRef(0);
  const elasticActiveRef = useRef(false);
  const elasticTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const isLiveRef = useRef(isLive);
  isLiveRef.current = isLive;

  const applyElastic = useCallback(() => {
    if (fillRef.current) fillRef.current.style.transition = FILL_ELASTIC;
    if (thumbRef.current) thumbRef.current.style.transition = THUMB_ELASTIC;
    elasticActiveRef.current = true;
  }, []);

  const clearElastic = useCallback(() => {
    if (fillRef.current) fillRef.current.style.transition = '';
    if (thumbRef.current) thumbRef.current.style.transition = 'opacity 120ms ease';
    elasticActiveRef.current = false;
  }, []);

  const paint = useCallback((pos: number) => {
    const dur = durationRef.current;
    const safePos = Number.isFinite(pos) && pos > 0 ? pos : 0;
    const pct = dur > 0 ? Math.max(0, Math.min(1, safePos / dur)) : 0;
    if (fillRef.current) fillRef.current.style.width = `${pct * 100}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${pct * 100}%`;
    if (posTextRef.current) posTextRef.current.textContent = formatDuration(safePos);
    if (remTextRef.current) {
      remTextRef.current.textContent = `-${formatDuration(Math.max(0, dur - safePos))}`;
    }
  }, []);

  // `waiting` means the element ran out of data; on a stream that is the gap
  // between the buffer draining and the next chunk arriving.
  const [buffering, setBuffering] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;
    // Local files fire `waiting` on every track change and are ready again a
    // frame later; swapping the fill for a sweeping bar there reads as the
    // progress jumping backwards.
    if (!audio || !isLive) {
      setBuffering(false);
      return;
    }
    setBuffering(false);
    let pending: ReturnType<typeof setTimeout> | null = null;
    const clearPending = () => {
      if (pending) clearTimeout(pending);
      pending = null;
    };
    // Held back so a gap short enough to be inaudible never shows up.
    const start = () => {
      if (!pending) pending = setTimeout(() => setBuffering(true), BUFFER_GRACE_MS);
    };
    const stop = () => {
      clearPending();
      setBuffering(false);
    };
    audio.addEventListener('waiting', start);
    audio.addEventListener('stalled', start);
    audio.addEventListener('playing', stop);
    audio.addEventListener('canplay', stop);
    audio.addEventListener('pause', stop);
    return () => {
      clearPending();
      audio.removeEventListener('waiting', start);
      audio.removeEventListener('stalled', start);
      audio.removeEventListener('playing', stop);
      audio.removeEventListener('canplay', stop);
      audio.removeEventListener('pause', stop);
    };
  }, [audioRef, trackId, isLive]);

  // Subscribe to timeupdate — DOM only, no React render
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    paint(audio.currentTime);
    const onTimeUpdate = () => {
      if (!isSeekingRef.current) paint(audio.currentTime);
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    return () => audio.removeEventListener('timeupdate', onTimeUpdate);
  }, [audioRef, paint]);

  // Reset paint on new track / duration arrival, and once the fill comes back
  // after buffering swapped it out.
  useEffect(() => {
    paint(audioRef.current?.currentTime ?? 0);
  }, [trackId, duration, buffering, paint, audioRef]);

  const seekFromClientX = useCallback((clientX: number): number | null => {
    const el = trackRef.current;
    const dur = durationRef.current;
    if (!el || dur <= 0 || isLiveRef.current) return null;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * dur;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const seekPos = seekFromClientX(e.clientX);
      if (seekPos === null) return;
      if (elasticTimeoutRef.current) {
        clearTimeout(elasticTimeoutRef.current);
        elasticTimeoutRef.current = null;
      }
      pointerDownRef.current = true;
      isSeekingRef.current = true;
      seekValueRef.current = seekPos;
      applyElastic();
      paint(seekPos);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [seekFromClientX, paint, applyElastic]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerDownRef.current) return;
      const seekPos = seekFromClientX(e.clientX);
      if (seekPos === null) return;
      if (elasticActiveRef.current) clearElastic();
      seekValueRef.current = seekPos;
      paint(seekPos);
    },
    [seekFromClientX, paint, clearElastic]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      const audio = audioRef.current;
      const pos = seekValueRef.current;
      if (audio) audio.currentTime = pos;
      onSeekCommit(pos);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (elasticActiveRef.current) {
        elasticTimeoutRef.current = setTimeout(() => {
          clearElastic();
          isSeekingRef.current = false;
          elasticTimeoutRef.current = null;
        }, ELASTIC_DURATION_MS + 20);
      } else {
        isSeekingRef.current = false;
      }
    },
    [audioRef, onSeekCommit, clearElastic]
  );

  useEffect(
    () => () => {
      if (elasticTimeoutRef.current) clearTimeout(elasticTimeoutRef.current);
    },
    []
  );

  return (
    <Root>
      <TrackContainer
        ref={trackRef}
        isLive={isLive}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role={isLive ? undefined : 'slider'}
        aria-label={isLive ? 'live stream' : 'time-indicator'}
        aria-valuemin={isLive ? undefined : 0}
        aria-valuemax={isLive ? undefined : duration || 0}
      >
        <Rail />
        {buffering ? (
          <BufferBar />
        ) : (
          <>
            <Fill ref={fillRef} />
            {!isLive && <Thumb ref={thumbRef} className="pp-thumb" />}
          </>
        )}
      </TrackContainer>
      <TimeRow>
        <TimeText>
          <span ref={posTextRef}>0:00</span>
        </TimeText>
        {isLive ? (
          <LiveRow>
            <LiveMark animate={!paused}>
              <Icon icon={liveIcon} width={14} />
            </LiveMark>
            {buffering ? 'Buffering' : 'Live'}
          </LiveRow>
        ) : (
          <TimeText>
            <span ref={remTextRef}>-0:00</span>
          </TimeText>
        )}
      </TimeRow>
    </Root>
  );
});

export default PlaybackProgress;
