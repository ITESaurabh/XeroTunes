import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { Lrc } from 'react-lrc';

const PanelRoot = styled(Box)({
  bottom: '100%',
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
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
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
  color: active
    ? theme.palette.text.primary
    : theme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.28)'
      : 'rgba(0,0,0,0.28)',
  transform: active ? 'scale(1.03)' : 'scale(1)',
  transition: 'all 0.22s ease',
  '&:hover': {
    color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)',
  },
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
            audio.currentTime = line.startMillisecond / 1000;
            setPositionMs(line.startMillisecond);
          }
        }}
      >
        {line.content || ' '}
      </SyncedLineBox>
    ),
    [audioRef]
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
          currentMillisecond={positionMs}
          verticalSpace
          style={lrcInlineStyle}
          lineRenderer={lineRenderer}
        />
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
