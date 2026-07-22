import React, { useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';

const formatDuration = (value: number): string => {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  const minute = Math.floor(safe / 60);
  const secondLeft = Math.floor(safe - minute * 60);
  return `${minute}:${secondLeft < 10 ? `0${secondLeft}` : secondLeft}`;
};

const Root = styled(Box)({
  width: '100%',
});

const TrackContainer = styled(Box)({
  position: 'relative',
  height: 20,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  touchAction: 'none',
  '&:hover .pp-thumb': { opacity: 1 },
});

const Rail = styled(Box)(({ theme }) => ({
  position: 'absolute',
  left: 0,
  right: 0,
  height: 5,
  borderRadius: 20,
  backgroundColor: theme.palette.mode === 'dark' ? '#000000' : '#c1c1c1',
  opacity: 0.28,
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

const ELASTIC_DURATION_MS = 280;
const ELASTIC_EASING = 'cubic-bezier(0.47, 1.64, 0.41, 0.8)';
const FILL_ELASTIC = `width ${ELASTIC_DURATION_MS}ms ${ELASTIC_EASING}`;
const THUMB_ELASTIC = `left ${ELASTIC_DURATION_MS}ms ${ELASTIC_EASING}, opacity 120ms ease`;

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

interface PlaybackProgressProps {
  audioRef: React.RefObject<HTMLAudioElement>;
  duration: number;
  trackId?: string | number | null;
  onSeekCommit: (_pos: number) => void;
}

// PlaybackProgress drives the slider via direct DOM mutation — `position` is
// never React state, so audio `timeupdate` ticks (4 Hz) cause zero re-renders.
const PlaybackProgress = React.memo(function PlaybackProgress({
  audioRef,
  duration,
  trackId,
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

  // Reset paint on new track / duration arrival
  useEffect(() => {
    paint(audioRef.current?.currentTime ?? 0);
  }, [trackId, duration, paint, audioRef]);

  const seekFromClientX = useCallback((clientX: number): number | null => {
    const el = trackRef.current;
    const dur = durationRef.current;
    if (!el || dur <= 0) return null;
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="slider"
        aria-label="time-indicator"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
      >
        <Rail />
        <Fill ref={fillRef} />
        <Thumb ref={thumbRef} className="pp-thumb" />
      </TrackContainer>
      <TimeRow>
        <TimeText>
          <span ref={posTextRef}>0:00</span>
        </TimeText>
        <TimeText>
          <span ref={remTextRef}>-0:00</span>
        </TimeText>
      </TimeRow>
    </Root>
  );
});

export default PlaybackProgress;
