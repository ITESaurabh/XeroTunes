import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import { alpha, styled } from '@mui/material/styles';
import { Lrc } from 'react-lrc';
import { Icon } from '@iconify/react';
import add24Filled from '@iconify/icons-fluent/add-24-filled';
import subtract24Filled from '@iconify/icons-fluent/subtract-24-filled';

const PanelRoot = styled(Box)({
  position: 'relative',
  width: '100%',
  height: 'calc(100vh - 250px)',
  borderRadius: '0.5rem 0.5rem 0 0',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
});

const SourceBadge = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: 10,
  right: 14,
  zIndex: 1,
  backgroundColor: alpha(theme.palette.text.primary, 0.08),
  borderRadius: '6px',
  paddingLeft: 9.6,
  paddingRight: 9.6,
  paddingTop: 2.4,
  paddingBottom: 2.4,
  pointerEvents: 'none',
}));

const SourceText = styled(Typography)({
  fontSize: '0.7rem',
  opacity: 0.55,
  letterSpacing: 0.3,
});

const SyncedLineBox = styled(Box, {
  shouldForwardProp: prop => prop !== 'active',
})<{ active: boolean }>(({ theme, active }) => ({
  textAlign: 'center',
  paddingTop: 5,
  paddingBottom: 5,
  paddingLeft: theme.spacing(3),
  paddingRight: theme.spacing(3),
  cursor: 'pointer',
  userSelect: 'none',
  fontSize: active ? '1.35rem' : '1rem',
  fontWeight: active ? 700 : 400,
  lineHeight: active ? 1.6 : 1.5,
  color: active ? theme.palette.text.primary : alpha(theme.palette.text.primary, 0.28),
  transform: active ? 'scale(1.03)' : 'scale(1)',
  transition: 'all 0.22s ease',
  '&:hover': { color: alpha(theme.palette.text.primary, 0.6) },
}));

const UnsyncedScroll = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'hidden auto',
  paddingLeft: theme.spacing(4),
  paddingRight: theme.spacing(4),
  paddingTop: theme.spacing(3),
  paddingBottom: 60,
}));

const UnsyncedLine = styled(Typography, {
  shouldForwardProp: prop => prop !== 'isBlank',
})<{ isBlank: boolean }>(({ theme, isBlank }) => ({
  fontSize: '1rem',
  lineHeight: 1.85,
  color: theme.palette.text.primary,
  opacity: isBlank ? 0 : 0.82,
  minHeight: isBlank ? '0.8rem' : undefined,
}));

const OffsetControl = styled(Box)(({ theme }) => ({
  position: 'absolute',
  bottom: 10,
  right: 14,
  zIndex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  backgroundColor: alpha(theme.palette.text.primary, 0.08),
  borderRadius: '999px',
  padding: 4,
  '& .MuiIconButton-root': { width: 32, height: 32 },
}));

const OffsetValue = styled(Typography)({
  fontSize: '0.9rem',
  opacity: 0.8,
  minWidth: 56,
  textAlign: 'center',
  cursor: 'pointer',
  userSelect: 'none',
});

const EmptyRoot = styled(Box)({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  opacity: 0.35,
});

const lrcInlineStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden auto',
  paddingBottom: '60px',
  width: '100%',
};

interface LyricsPanelProps {
  audioRef: React.RefObject<HTMLAudioElement>;
  lrcContent: string | null;
  lyricsType: 'synced' | 'unsynced' | null;
  lyricsSource: 'LRC file' | 'Embedded' | null;
}

const OFFSET_KEY = 'lyricsOffsetSec';
const OFFSET_STEP = 0.25;

interface LrcLine {
  id: string;
  content: string;
  startMillisecond: number;
}

const LyricsPanel = React.memo(function LyricsPanel({
  audioRef,
  lrcContent,
  lyricsType,
  lyricsSource,
}: LyricsPanelProps) {
  const [positionMs, setPositionMs] = useState(0);
  const [offsetSec, setOffsetSec] = useState(() => Number(localStorage.getItem(OFFSET_KEY)) || 0);

  const setOffset = useCallback((next: number) => {
    const clamped = Math.min(30, Math.max(-30, Number(next.toFixed(2))));
    localStorage.setItem(OFFSET_KEY, String(clamped));
    setOffsetSec(clamped);
  }, []);

  // Subscribe to timeupdate only while the panel is mounted (Collapse unmountOnExit)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setPositionMs(audio.currentTime * 1000);
    const onTimeUpdate = () => setPositionMs(audio.currentTime * 1000);
    audio.addEventListener('timeupdate', onTimeUpdate);
    return () => audio.removeEventListener('timeupdate', onTimeUpdate);
  }, [audioRef]);

  const lineRenderer = useCallback(
    ({ active, line }: { active: boolean; line: LrcLine }) => (
      <SyncedLineBox
        key={line.id}
        active={active}
        onClick={() => {
          const audio = audioRef.current;
          if (audio) {
            // Seek so the clicked line lands on the offset-shifted playhead, not before it.
            const seekMs = line.startMillisecond - offsetSec * 1000;
            audio.currentTime = Math.max(0, seekMs / 1000);
            setPositionMs(seekMs);
          }
        }}
      >
        {line.content || ' '}
      </SyncedLineBox>
    ),
    [audioRef, offsetSec]
  );

  const unsyncedLines = useMemo(
    () => (lyricsType === 'unsynced' && lrcContent ? lrcContent.split('\n') : []),
    [lyricsType, lrcContent]
  );

  return (
    <PanelRoot>
      {lyricsSource && (
        <SourceBadge>
          <SourceText>Source: {lyricsSource}</SourceText>
        </SourceBadge>
      )}

      {lyricsType === 'synced' && lrcContent && (
        <Lrc
          lrc={lrcContent}
          currentMillisecond={positionMs + offsetSec * 1000}
          verticalSpace
          style={lrcInlineStyle}
          lineRenderer={lineRenderer}
        />
      )}

      {lyricsType === 'synced' && lrcContent && (
        <OffsetControl>
          <IconButton onClick={() => setOffset(offsetSec - OFFSET_STEP)} title="Delay lyrics">
            <Icon icon={subtract24Filled} width={20} height={20} />
          </IconButton>
          <OffsetValue onClick={() => setOffset(0)} title="Click to reset">
            {offsetSec > 0 ? '+' : ''}
            {offsetSec.toFixed(2)}s
          </OffsetValue>
          <IconButton onClick={() => setOffset(offsetSec + OFFSET_STEP)} title="Advance lyrics">
            <Icon icon={add24Filled} width={20} height={20} />
          </IconButton>
        </OffsetControl>
      )}

      {lyricsType === 'unsynced' && (
        <UnsyncedScroll>
          {unsyncedLines.map((line, i) => (
            <UnsyncedLine key={i} isBlank={line.trim() === ''}>
              {line || ' '}
            </UnsyncedLine>
          ))}
        </UnsyncedScroll>
      )}

      {!lrcContent && (
        <EmptyRoot>
          <Typography variant="body1" fontWeight={500}>
            No lyrics found
          </Typography>
          <Typography variant="caption">Try adding a .lrc file next to the track</Typography>
        </EmptyRoot>
      )}
    </PanelRoot>
  );
});

export default LyricsPanel;
