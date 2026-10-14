import React from 'react';
import { Box, Button, IconButton, Slider, Stack, Typography, alpha, styled } from '@mui/material';
import { motion } from 'motion/react';
import { Image } from 'mui-image';
import { Icon } from '@iconify/react';
import chevronLeft from '@iconify/icons-fluent/chevron-left-20-filled';
import pause32Filled from '@iconify/icons-fluent/pause-32-filled';
import play32Filled from '@iconify/icons-fluent/play-32-filled';
import fastForward32Filled from '@iconify/icons-fluent/fast-forward-28-filled';
import speaker132Regular from '@iconify/icons-fluent/speaker-1-32-regular';
import speaker232Regular from '@iconify/icons-fluent/speaker-2-32-regular';
import speakerMute32Filled from '@iconify/icons-fluent/speaker-mute-32-filled';
import { toMediaSrc } from '../../utils/misc';
import { DEFAULT_AA } from '../../../config/constants';
import Marquee from '../../components/Marquee';
import { type KeyboardShortcut } from '../../utils/useKeyboardShortcuts';
import KeyCaps from '../../components/KeyCaps';

const TIPS = [
  {
    title: 'Split long lines',
    body: 'Keep the each line maximum up to 70 characters long. better to split into more sentences. Will be helpful in sync studio.',
  },
  {
    title: 'Remove end-line punctuation',
    body: 'Remove punctuation at the end of the line.',
  },
  {
    title: 'Avoid Indicator texts',
    body: 'Adding Text like [Hook] (chorus) is just laziness.. Just add the chorus or hook again instead of doing “chorus repeats here”',
  },
  {
    title: 'Capitalize first letter',
    body: 'Capitalize the first letter of every line.',
  },
];

const Rail = styled(Stack)({
  width: '100%',
  height: '100%',
  padding: 12,
  gap: 12,
  whiteSpace: 'normal',
});

const TipCard = styled(Box)(({ theme }) => ({
  padding: '0.5rem 0.8rem',
  borderRadius: 12,
  border: `1px solid ${theme.palette.surfaces.glassBorder}`,
}));

const ControlButton = styled(IconButton)(({ theme }) => ({
  backgroundColor: theme.palette.surfaces.control,
}));

const VolumeSlider = styled(Slider)(({ theme }) => ({
  color: theme.palette.primary.main,
  height: 4,
  '& .MuiSlider-track': { border: 'none' },
  '& .MuiSlider-rail': { opacity: 0.28 },
  '& .MuiSlider-thumb': {
    width: 14,
    height: 14,
    backgroundColor: theme.palette.text.primary,
    transition: '0.3s cubic-bezier(.47,1.64,.41,.8)',
    '&:before': { boxShadow: '0 2px 12px 0 rgba(0,0,0,0.4)' },
    '&:hover, &.Mui-focusVisible': {
      boxShadow: `0px 0px 0px 8px ${alpha(theme.palette.text.primary, 0.16)}`,
    },
    '&.Mui-active': { width: 16, height: 16 },
  },
}));

const COVER_PX = 72;

const CoverImage = styled(Box)(({ theme }) => ({
  width: COVER_PX,
  height: COVER_PX,
  flexShrink: 0,
  overflow: 'hidden',
  borderRadius: 8,
  backgroundColor: alpha(theme.palette.surfaces.well, 0.08),
  '& img': { width: '100%', height: '100%', objectFit: 'cover' },
}));

const Tap = ({ children }: { children: React.ReactNode }) => (
  <motion.div whileTap={{ scale: 0.9 }} style={{ display: 'flex' }}>
    {children}
  </motion.div>
);

const TransportIconStyle: React.CSSProperties = { margin: '0.2rem' };
const PlayPauseIconStyle: React.CSSProperties = { margin: '0.3rem' };
const AlbumArtImageStyle: React.CSSProperties = { borderRadius: '0.4375rem' };

export interface TipsRailProps {
  title: string;
  artist: string;
  album: string;
  artPath: string | null;
  playing: boolean;
  volume: number;
  shortcuts: KeyboardShortcut[];
  onExit: () => void;
  onTogglePlay: () => void;
  onSeekBy: (_seconds: number) => void;
  onVolume: (_value: number) => void;
}

const SEEK_STEP = 5;

export default function TipsRail({
  title,
  artist,
  album,
  artPath,
  playing,
  volume,
  shortcuts,
  onExit,
  onTogglePlay,
  onSeekBy,
  onVolume,
}: TipsRailProps) {
  return (
    <Rail>
      <Button
        onClick={onExit}
        fullWidth
        variant="contained"
        size="large"
        startIcon={
          <Icon
            icon={chevronLeft}
            height="28px"
            style={{
              marginLeft: -8,
            }}
          />
        }
        sx={{
          justifyContent: 'flex-start',
          alignItems: 'center',
          borderRadius: 7,
          flexShrink: 0,
          color: 'text.primary',
          backgroundColor: 'surfaces.elevated',
          textTransform: 'none',
          fontSize: '1rem',
          '&:hover': { backgroundColor: theme => alpha(theme.palette.text.primary, 0.12) },
        }}
      >
        Exit Lyric Studio
      </Button>

      <Typography variant="subtitle2" sx={{ opacity: 0.7, mt: 0.5 }}>
        Keyboard
      </Typography>
      <TipCard>
        <Stack gap={1}>
          {shortcuts.map(s => (
            <Stack key={s.description} direction="row" gap={1} alignItems="center">
              <KeyCaps shortcut={s} />
              <Typography variant="body2" sx={{ opacity: 0.6 }}>
                {s.description}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </TipCard>
      <Typography variant="subtitle2" sx={{ opacity: 0.7 }}>
        General Tips
      </Typography>

      <Stack gap={1.5} sx={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {TIPS.map(tip => (
          <TipCard key={tip.title}>
            <Typography variant="subtitle1" fontWeight={600}>
              {tip.title}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.6, mt: 0.5 }}>
              {tip.body}
            </Typography>
          </TipCard>
        ))}
      </Stack>

      <Stack direction="row" gap={2} alignItems="center" sx={{ flexShrink: 0 }}>
        <CoverImage>
          <Image
            src={artPath ? toMediaSrc(artPath) : DEFAULT_AA}
            width={COVER_PX}
            height={COVER_PX}
            fit="cover"
            duration={0}
            errorIcon={null}
            showLoading={false}
            style={AlbumArtImageStyle}
          />
        </CoverImage>
        {/* Same treatment as the play bar: a title too long for the rail scrolls
            on hover rather than being cut off. */}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Marquee text={title}>
            <Typography variant="h6" title={title}>
              {title}
            </Typography>
          </Marquee>
          <Marquee text={artist}>
            <Typography variant="body2" sx={{ opacity: 0.65 }} title={artist}>
              {artist}
            </Typography>
          </Marquee>
          <Marquee text={album}>
            <Typography variant="body2" sx={{ opacity: 0.65 }} title={album}>
              {album}
            </Typography>
          </Marquee>
        </Box>
      </Stack>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ px: 1, flexShrink: 0 }}>
        <Icon icon={volume === 0 ? speakerMute32Filled : speaker132Regular} width={20} />
        <VolumeSlider
          value={volume}
          min={0}
          max={100}
          onChange={(_e, v) => onVolume(v as number)}
          aria-label="Volume"
        />
        <Icon icon={speaker232Regular} width={20} />
      </Stack>

      <Stack
        direction="row"
        gap={1.25}
        justifyContent="center"
        alignItems="center"
        sx={{ pb: 1, flexShrink: 0 }}
      >
        {/* motion wraps the button rather than replacing it via `component`: the
            latter is what makes the play bar's transport fail typecheck. */}
        <Tap>
          <ControlButton
            onClick={() => onSeekBy(-SEEK_STEP)}
            aria-label={`back ${SEEK_STEP} seconds`}
          >
            <Icon
              icon={fastForward32Filled}
              width={25}
              style={TransportIconStyle}
              flip="horizontal"
            />
          </ControlButton>
        </Tap>
        <Tap>
          <ControlButton onClick={onTogglePlay} aria-label={playing ? 'pause' : 'play'}>
            <Icon
              icon={playing ? pause32Filled : play32Filled}
              width={35}
              style={PlayPauseIconStyle}
            />
          </ControlButton>
        </Tap>
        <Tap>
          <ControlButton
            onClick={() => onSeekBy(SEEK_STEP)}
            aria-label={`forward ${SEEK_STEP} seconds`}
          >
            <Icon icon={fastForward32Filled} width={25} style={TransportIconStyle} />
          </ControlButton>
        </Tap>
      </Stack>
    </Rail>
  );
}
