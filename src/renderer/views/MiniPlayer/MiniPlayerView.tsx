import React, { useContext, useEffect, useRef, useState } from 'react';
import { useIpc } from '../../state/ipc';
import { Box, Container, IconButton, Slider, Typography, useTheme } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { store } from '../../utils/store';
import { Icon } from '@iconify/react';
import dismiss12Filled from '@iconify/icons-fluent/dismiss-12-filled';
import subtract12Filled from '@iconify/icons-fluent/subtract-12-filled';
import rewind16Filled from '@iconify/icons-fluent/rewind-16-filled';
import play16Filled from '@iconify/icons-fluent/play-16-filled';
import pause16Filled from '@iconify/icons-fluent/pause-16-filled';
import fastForward16Filled from '@iconify/icons-fluent/fast-forward-16-filled';
import speaker132Regular from '@iconify/icons-fluent/speaker-1-32-regular';
import speaker232Regular from '@iconify/icons-fluent/speaker-2-32-regular';
import speakerMute32Filled from '@iconify/icons-fluent/speaker-mute-32-filled';
import { APP_NAME, APP_EDITION, DEFAULT_AA } from '../../../config/constants';
import MuiImage from 'mui-image';
import { parseFile } from 'music-metadata';
import Marquee from 'react-fast-marquee';
import { formatTime } from '../../utils/misc';
import { getVolumeLevel, setVolumeLevel } from '../../utils/LocStoreUtil';

interface SongMeta {
  title: string;
  artist: string;
  album: string;
  albumArt: string;
}

const parseMusic = async (musicPath: string): Promise<SongMeta> => {
  const metadata = await parseFile(musicPath);
  const picture = metadata.common.picture?.[0] ?? null;
  let albumArt = DEFAULT_AA;
  if (picture) {
    const b64 = Buffer.from(picture.data).toString('base64');
    albumArt = `data:${picture.format};base64,${b64}`;
  }
  return {
    title: metadata.common.title || '',
    artist: (metadata.common.artist || '')
      .split(',')
      .map(n => n.trim())
      .filter(Boolean)
      .join(', '),
    album: metadata.common.album || '',
    albumArt,
  };
};

const maxCharacters = 20;
const initialMeta: SongMeta = {
  title: 'Unknown Title',
  artist: 'Unknown Artist',
  album: 'Unknown Album',
  albumArt: DEFAULT_AA,
};

export default function MiniPlayerView(): React.ReactElement {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const defaultVol = getVolumeLevel();
  const [volume, setVolume] = useState<number>(defaultVol);
  const { state, dispatch } = useContext(store);
  const { path, isPlaying } = state;
  const { sendEventToMainProcess } = useIpc();
  const [songMeta, setSongMeta] = useState<SongMeta>(initialMeta);
  const [position, setPosition] = useState<number>(0);
  const [muteVolume, setMuteVolume] = useState<boolean>(false);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<unknown>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeRef = useRef<number>(defaultVol / 100);
  const muteVolumeRef = useRef<boolean>(false);

  useEffect(() => {
    volumeRef.current = volume / 100;
    muteVolumeRef.current = muteVolume;
    if (audioRef.current && !fadeIntervalRef.current) {
      audioRef.current.volume = muteVolume ? 0 : volume / 100;
      audioRef.current.muted = muteVolume;
    }
  }, [volume, audioRef, muteVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Cancel any running fade first
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }

    const FADE_STEPS = 20;
    const FADE_INTERVAL_MS = 10;

    if (isPlaying) {
      const targetVol = muteVolumeRef.current ? 0 : volumeRef.current;
      audio.volume = 0;
      audio.play().catch(() => undefined);
      let step = 0;
      fadeIntervalRef.current = setInterval(() => {
        step++;
        audio.volume = Math.min(targetVol, targetVol * (step / FADE_STEPS));
        if (step >= FADE_STEPS) {
          audio.volume = targetVol;
          if (fadeIntervalRef.current !== null) clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
        }
      }, FADE_INTERVAL_MS);
    } else {
      const startVol = audio.volume;
      let step = 0;
      fadeIntervalRef.current = setInterval(() => {
        step++;
        audio.volume = Math.max(0, startVol * (1 - step / FADE_STEPS));
        if (step >= FADE_STEPS) {
          if (fadeIntervalRef.current !== null) clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
          audio.pause();
          audio.volume = muteVolumeRef.current ? 0 : volumeRef.current;
        }
      }, FADE_INTERVAL_MS);
    }
  }, [isPlaying, audioRef]);

  useEffect(() => {
    const audioElement = audioRef.current;

    const handleTimeUpdate = (): void => {
      if (!isSeeking) {
        setPosition(audioElement.currentTime);
      }
      if (audioElement.currentTime === audioElement.duration) {
        setPosition(0);
        dispatch({ type: 'SET_IS_PLAYING', payload: false });
      }
    };

    audioElement.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      audioElement.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [isSeeking, audioRef]);

  const handleSliderChange = (_event: Event, newValue: number | number[]): void => {
    setPosition(newValue as number);
  };

  const handleVolumeChange = (_event: Event, newValue: number | number[]): void => {
    setVolume(newValue as number);
  };

  const handleSliderChangeCommitted = (
    _event: React.SyntheticEvent | Event,
    newValue: number | number[]
  ): void => {
    const audioElement = audioRef.current;
    audioElement.currentTime = newValue as number;
    setIsSeeking(false);
  };

  useEffect(() => {
    if (path) {
      const audioElement = audioRef.current;
      // Convert file path to file:/// URL — Windows absolute paths need 3 slashes
      // (2 for the empty authority + 1 for the path root), otherwise "C:" is
      // treated as the hostname and the audio element won't load the file.
      const fileUrl = `file:///${path.replace(/\\/g, '/')}`;
      audioElement.src = fileUrl;

      parseMusic(path)
        .then(meta => {
          setSongMeta({
            title: meta.title || initialMeta.title,
            artist: meta.artist || initialMeta.artist,
            album: meta.album || initialMeta.album,
            albumArt: meta.albumArt || initialMeta.albumArt,
          });
        })
        .catch(() => setSongMeta(initialMeta));
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    }
  }, [path]);

  return (
    <Container
      disableGutters
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
      className="play-area"
    >
      <Grid className="canva">
        <Box
          sx={{
            display: 'flex',
            padding: theme.spacing(1, 2),
            justifyContent: 'space-between',
            alignItems: 'center',
            '-webkit-app-region': 'drag',
          }}
        >
          <Typography fontSize={'0.875rem'} color={theme.palette.primary.main} fontWeight={500}>
            {APP_NAME}
            {APP_EDITION ? ` ${APP_EDITION}` : ''} Mini
          </Typography>
          <Box
            display={'flex'}
            sx={{
              '-webkit-app-region': 'none',
            }}
            gap={'0.6rem'}
          >
            <IconButton
              aria-label="minimize"
              onClick={() => sendEventToMainProcess('minimize', null)}
              sx={{
                backgroundColor: isDark ? 'black' : '#d9d9d9',
              }}
            >
              <Icon icon={subtract12Filled} fontSize={12} />
            </IconButton>
            <IconButton
              onClick={() => sendEventToMainProcess('closeWindow', null)}
              sx={{
                transition: 'background-color 0.2s ease-in-out',
                ':hover': {
                  backgroundColor: theme.palette.error.main,
                  color: theme.palette.common.white,
                },
                backgroundColor: isDark ? 'black' : '#d9d9d9',
              }}
              aria-label="close"
            >
              <Icon icon={dismiss12Filled} fontSize={12} />
            </IconButton>
          </Box>
        </Box>
        <Box display={'flex'} alignItems={'center'} paddingX={2} marginBottom={1}>
          <Box sx={{ width: 'inherit' }}>
            <MuiImage
              src={songMeta.albumArt}
              className="no-select no-drag"
              height={150}
              width={150}
              showLoading
              style={{ borderRadius: '0.4375rem' }}
              fit="contain"
            />
          </Box>
          <Box
            sx={{
              ml: 1.5,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', maxWidth: '12.8rem' }}>
              {(songMeta.title?.length ?? 0) <= maxCharacters ? (
                <Typography variant="h5" noWrap>
                  {songMeta.title}
                </Typography>
              ) : (
                <Marquee pauseOnHover speed={15} direction="left" delay={5}>
                  <Typography variant="h5" pr={4} noWrap>
                    {songMeta.title}
                  </Typography>
                </Marquee>
              )}
              {(songMeta.artist?.length ?? 0) <= 25 ? (
                <Typography variant="body2" color="text.secondary" fontWeight={400} noWrap>
                  {songMeta.artist}
                </Typography>
              ) : (
                <Marquee pauseOnHover speed={15} direction="left" delay={5}>
                  <Typography variant="body2" color="text.secondary" pr={4} fontWeight={400} noWrap>
                    {songMeta.artist}
                  </Typography>
                </Marquee>
              )}
              {(songMeta.album?.length ?? 0) <= maxCharacters ? (
                <Typography variant="h6" lineHeight={'inherit'} fontWeight={400} noWrap>
                  {songMeta.album}
                </Typography>
              ) : (
                <Marquee pauseOnHover speed={15} direction="left" delay={5}>
                  <Typography variant="h6" lineHeight={'inherit'} pr={4} fontWeight={400} noWrap>
                    {songMeta.album}
                  </Typography>
                </Marquee>
              )}
            </Box>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.625rem',
                mt: 1,
              }}
            >
              <IconButton
                sx={{ backgroundColor: isDark ? 'black' : '#d9d9d9' }}
                onClick={() => {
                  const audioElement = audioRef.current;
                  audioElement.currentTime = audioElement.currentTime - 15;
                  setIsSeeking(false);
                }}
              >
                <Icon icon={rewind16Filled} fontSize={18} />
              </IconButton>
              <IconButton
                onClick={() => dispatch({ type: 'SET_IS_PLAYING', payload: !isPlaying })}
                sx={{ backgroundColor: isDark ? 'black' : '#d9d9d9' }}
              >
                <Icon icon={isPlaying ? pause16Filled : play16Filled} fontSize={30} />
              </IconButton>
              <IconButton
                onClick={() => {
                  const audioElement = audioRef.current;
                  audioElement.currentTime = audioElement.currentTime + 15;
                  setIsSeeking(false);
                }}
                aria-label="next song"
                sx={{ backgroundColor: isDark ? 'black' : '#d9d9d9' }}
              >
                <Icon icon={fastForward16Filled} fontSize={18} />
              </IconButton>
            </Box>
            <Box display={'flex'} alignItems={'center'}>
              <Box mr={1} display={'flex'} alignItems={'center'}>
                <IconButton size="small" onClick={() => setMuteVolume(prev => !prev)}>
                  {volume === 0 || muteVolume ? (
                    <Icon icon={speakerMute32Filled} width={20} />
                  ) : volume < 40 ? (
                    <Icon icon={speaker132Regular} width={20} />
                  ) : (
                    <Icon icon={speaker232Regular} width={20} />
                  )}
                </IconButton>
              </Box>
              <Slider
                size="small"
                value={volume}
                min={0}
                max={100}
                onChange={handleVolumeChange}
                onChangeCommitted={(event, newValue) => {
                  setVolumeLevel(newValue as number);
                }}
                sx={{
                  color:
                    theme.palette.mode === 'dark'
                      ? volume >= 60
                        ? theme.palette.error.main
                        : '#fff'
                      : volume >= 60
                        ? theme.palette.error.main
                        : '#6b6b6b',
                  '& .MuiSlider-track': {
                    border: 'none',
                  },
                  transition: 'color 0.2s ease-in-out',
                  height: 4,
                  '& .MuiSlider-thumb': {
                    width: 14,
                    height: 14,
                    transition: '0.3s cubic-bezier(.47,1.64,.41,.8)',
                    '&:before': {
                      boxShadow: '0 2px 12px 0 rgba(0,0,0,0.4)',
                    },
                    '&:hover, &.Mui-focusVisible': {
                      boxShadow: `0px 0px 0px 8px ${
                        theme.palette.mode === 'dark'
                          ? 'rgb(255 255 255 / 16%)'
                          : 'rgb(0 0 0 / 16%)'
                      }`,
                    },
                    '&.Mui-active': {
                      width: 16,
                      height: 16,
                    },
                  },
                  '& .MuiSlider-rail': {
                    opacity: 0.28,
                  },
                }}
              />
              <Typography className="no-select no-drag" fontSize={'0.75rem'} ml={2}>
                {`${volume}%`}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Grid>

      <Grid sx={{ width: '92%', height: '3rem', alignItems: 'center', display: 'flex', mx: 2 }}>
        <Typography className="no-select no-drag" fontSize={'0.75rem'} mr={2}>
          {formatTime(position)}
        </Typography>
        <Slider
          size="small"
          ref={progressBarRef as React.Ref<HTMLSpanElement>}
          value={position}
          min={0}
          max={audioRef.current?.duration || 0}
          onChange={handleSliderChange}
          onChangeCommitted={handleSliderChangeCommitted}
          onMouseDown={() => setIsSeeking(true)}
          onMouseUp={() => setIsSeeking(false)}
          onTouchStart={() => setIsSeeking(true)}
          onTouchEnd={() => setIsSeeking(false)}
          sx={{
            color: theme.palette.mode === 'dark' ? '#fff' : '#6b6b6b',
            '& .MuiSlider-track': {
              border: 'none',
            },
            height: 4,
            '& .MuiSlider-thumb': {
              width: 16,
              height: 16,
              transition: '0.3s cubic-bezier(.47,1.64,.41,.8)',
              '&:before': {
                boxShadow: '0 2px 12px 0 rgba(0,0,0,0.4)',
              },
              '&:hover, &.Mui-focusVisible': {
                boxShadow: `0px 0px 0px 8px ${
                  theme.palette.mode === 'dark' ? 'rgb(255 255 255 / 16%)' : 'rgb(0 0 0 / 16%)'
                }`,
              },
              '&.Mui-active': {
                width: 16,
                height: 16,
              },
            },
            '& .MuiSlider-rail': {
              opacity: 0.28,
            },
          }}
        />
        <Typography className="no-select no-drag" fontSize={'0.75rem'} ml={2}>
          {formatTime(audioRef.current?.duration)}
        </Typography>
      </Grid>
      <audio id="audio" ref={audioRef} style={{ marginBlock: 15 }}></audio>
    </Container>
  );
}
