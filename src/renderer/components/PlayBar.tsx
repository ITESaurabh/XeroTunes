import React, { useContext, useRef, useState, useEffect } from 'react';
import { styled, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Slider from '@mui/material/Slider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import FastForwardRounded from '@mui/icons-material/FastForwardRounded';
import FastRewindRounded from '@mui/icons-material/FastRewindRounded';
import { Icon } from '@iconify/react';
import { Card, Collapse, useMediaQuery } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2/Grid2';
import DiscordIcon from 'svg-react-loader?name=DiscordIcon!../../img/discord-logo.svg';
import LyricNoteIcon from 'svg-react-loader?name=LyricNoteIcon!../../assets/svgs/lyric-note.svg';
import LyricNoteActiveIcon from 'svg-react-loader?name=LyricNoteActiveIcon!../../assets/svgs/lyric-note-active.svg';
import { RepeatRounded, ShuffleRounded } from '@mui/icons-material';
import ShuffleOnRoundedIcon from '@mui/icons-material/ShuffleOnRounded';
import RepeatOneOnRoundedIcon from '@mui/icons-material/RepeatOneOnRounded';
import RepeatOnRoundedIcon from '@mui/icons-material/RepeatOnRounded';
import { store, RepeatMode } from '../utils/store';
import {
  getVolumeLevel,
  setVolumeLevel,
  getOverlayEnabled,
  getDiscordEnabled,
  setDiscordEnabled,
} from '../utils/LocStoreUtil';
import speaker132Regular from '@iconify/icons-fluent/speaker-1-32-regular';
import speaker232Regular from '@iconify/icons-fluent/speaker-2-32-regular';
import speakerMute32Filled from '@iconify/icons-fluent/speaker-mute-32-filled';
import { Image } from 'mui-image';
import { DEFAULT_AA } from '../../config/constants';
const { ipcRenderer } = window.require('electron');
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { parseFile } from 'music-metadata';
import { Lrc } from 'react-lrc';
import Marquee from 'react-fast-marquee';

const CoverImage = styled(Box)(({ theme }) => ({
  width: 140,
  height: 140,
  margin: 10,
  objectFit: 'cover',
  overflow: 'hidden',
  flexShrink: 0,
  borderRadius: 8,
  backgroundColor: 'rgba(0,0,0,0.08)',
  '& > img': {
    width: '100%',
  },
  [theme.breakpoints.down('md')]: {
    width: 90,
    height: 90,
  },
}));

const TinyText = styled(Typography)({
  fontSize: '0.75rem',
  opacity: 0.38,
  fontWeight: 500,
  letterSpacing: 0.2,
});

export default function PlayBar() {
  const theme = useTheme();
  const navigate = useNavigate();
  const isDark = theme.palette.mode === 'dark';
  const { state, dispatch } = useContext(store);
  const defaultVol = getVolumeLevel();
  const [songPath, setSongPath] = useState(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fadeIntervalRef = useRef(null);
  const volumeRef = useRef(defaultVol / 100);
  const muteVolumeRef = useRef(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [muteVolume, setMuteVolume] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const isPhone = useMediaQuery(({ breakpoints }) => breakpoints.down('md'));
  const [volume, setVolume] = useState(defaultVol);
  const [lastVolume, setLastVolume] = useState(defaultVol > 0 ? defaultVol : 30);
  const [discordEnabled, setDiscordEnabledState] = useState(() => getDiscordEnabled());

  const shouldUseMarquee = (text?: string) => {
    return !!text && text.length > 28;
  };

  const renderMarquee = (text: string, content: React.ReactNode) => {
    if (!shouldUseMarquee(text)) return content;
    return (
      <Box sx={{ width: '100%', overflow: 'hidden' }}>
        <Marquee
          // gradient={true}
          gradientColor="#2b2b2c"
          gradientWidth={20}
          // autoFill={true}
          pauseOnHover
          loop={0}
          speed={35}
          delay={5}
          style={{ width: '100%' }}
        >
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {content}
            <Box component="span" sx={{ width: 64, flexShrink: 0 }} />
          </Box>
        </Marquee>
      </Box>
    );
  };

  // ── Lyrics ───────────────────────────────────────────────────────────────
  const isLyricsExpanded = state.isLyricsExpanded;
  const [lrcContent, setLrcContent] = useState<string | null>(null);
  const [lyricsSource, setLyricsSource] = useState<'LRC file' | 'Embedded' | null>(null);
  const [lyricsType, setLyricsType] = useState<'synced' | 'unsynced' | null>(null);

  function syltToLrc(synchronisedText: Array<{ text: string; timestamp: number }>): string {
    return synchronisedText
      .map(({ text, timestamp }) => {
        const mins = Math.floor(timestamp / 60000);
        const secs = Math.floor((timestamp % 60000) / 1000);
        const centis = Math.floor((timestamp % 1000) / 10);
        return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}]${text}`;
      })
      .join('\n');
  }

  useEffect(() => {
    if (!songPath) {
      setLrcContent(null);
      setLyricsSource(null);
      setLyricsType(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const fs = window.require('fs') as typeof import('fs');
      const nodePath = window.require('path') as typeof import('path');

      // 1. Try sidecar .lrc file — determine synced vs unsynced by content
      const dir = nodePath.dirname(songPath);
      const base = nodePath.basename(songPath, nodePath.extname(songPath));
      const lrcPath = nodePath.join(dir, `${base}.lrc`);
      if (fs.existsSync(lrcPath)) {
        try {
          const content = fs.readFileSync(lrcPath, 'utf8');
          const isSynced = /\[\d{2}:\d{2}[.:]\d{2}/.test(content);
          if (!cancelled) {
            setLrcContent(content);
            setLyricsSource('LRC file');
            setLyricsType(isSynced ? 'synced' : 'unsynced');
          }
          return;
        } catch {
          /* fall through */
        }
      }

      // 2. Try embedded tags via music-metadata
      try {
        const metadata = await parseFile(songPath, { skipCovers: true });
        const nativeFrames = [
          ...(metadata.native['ID3v2.3'] ?? []),
          ...(metadata.native['ID3v2.4'] ?? []),
        ];

        // SYLT — synchronized lyrics
        const sylt = nativeFrames.find(f => f.id === 'SYLT');
        const syltVal = sylt?.value as
          | { synchronisedText?: Array<{ text: string; timestamp: number }> }
          | undefined;
        if (syltVal?.synchronisedText?.length) {
          const lrc = syltToLrc(syltVal.synchronisedText);
          if (!cancelled) {
            setLrcContent(lrc);
            setLyricsSource('Embedded');
            setLyricsType('synced');
          }
          return;
        }

        // USLT — check if already in LRC format (synced) or plain text (unsynced)
        const uslt = nativeFrames.find(f => f.id === 'USLT');
        const usltVal = uslt?.value as { text?: string } | undefined;
        if (usltVal?.text) {
          const text: string = usltVal.text;
          if (/\[\d{2}:\d{2}[.:]\d{2}/.test(text)) {
            if (!cancelled) {
              setLrcContent(text);
              setLyricsSource('Embedded');
              setLyricsType('synced');
            }
          } else {
            if (!cancelled) {
              setLrcContent(text);
              setLyricsSource('Embedded');
              setLyricsType('unsynced');
            }
          }
          return;
        }

        // common.lyrics fallback (plain text)
        const commonLyrics = (metadata.common as unknown as Record<string, unknown>).lyrics;
        const lyricText = Array.isArray(commonLyrics)
          ? (commonLyrics as Array<{ text?: string } | string>)
              .map(l => (typeof l === 'string' ? l : (l?.text ?? '')))
              .filter(Boolean)
              .join('\n')
          : typeof commonLyrics === 'string'
            ? commonLyrics
            : null;
        if (lyricText) {
          if (!cancelled) {
            setLrcContent(lyricText);
            setLyricsSource('Embedded');
            setLyricsType('unsynced');
          }
          return;
        }
      } catch {
        /* ignore */
      }

      if (!cancelled) {
        setLrcContent(null);
        setLyricsSource(null);
        setLyricsType(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [songPath]);

  const handleLyricsToggle = () => {
    dispatch({ type: 'SET_LYRICS_EXPANDED', payload: !isLyricsExpanded });
  };
  // ── End Lyrics ───────────────────────────────────────────────────────────

  const handleDiscordToggle = () => {
    const next = !discordEnabled;
    setDiscordEnabledState(next);
    setDiscordEnabled(next);
    ipcRenderer.send('discord-set-enabled', { enabled: next });
    if (!next) {
      ipcRenderer.send('discord-clear');
    }
  };

  const artistNames = React.useMemo(() => {
    const artistText = (state.track?.ArtistName as string) || '';
    return artistText
      .split(/\s*[,&]\s*/)
      .map(name => name.trim())
      .filter(Boolean);
  }, [state.track?.ArtistName]);

  const handleArtistClick = async (artistName: string) => {
    if (!artistName) return;
    try {
      const result = await ipcRenderer.invoke('find-artist-by-name', { name: artistName });
      if (result?.id) {
        navigate(`/main_window/artists/${result.id}`);
      }
    } catch {
      // ignore lookup failures
    }
  };

  useEffect(() => {
    // Only set songPath and paused if queue is ready and track is valid
    if (Array.isArray(state?.queue) && state.queue.length > 0 && state?.track && state?.track.Uri) {
      setSongPath(state.track.Uri);
      setPaused(false);
    } else {
      setSongPath(null);
      setPaused(true);
    }
  }, [state?.track, state?.queue]);

  useEffect(() => {
    // Only interact with audio if queue is ready and track is valid
    if (audioRef.current && songPath && Array.isArray(state?.queue) && state.queue.length > 0) {
      // Convert file path to file:// URL for proper audio loading
      const fileUrl = `file://${songPath.replace(/\\/g, '/')}`;

      parseFile(songPath, { skipCovers: false }).then(metadata => {
        console.log('TAGS', metadata);
      });
      audioRef.current.src = fileUrl;
      audioRef.current.volume = defaultVol / 100;
      // Play only after loadedmetadata
      const handleLoadedMetadata = () => {
        audioRef.current.play().catch(() => undefined);
      };
      audioRef.current.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      return () => {
        audioRef.current?.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    }
  }, [songPath, state?.queue]);

  useEffect(() => {
    if (!songPath) {
      setPosition(0);
      setDuration(0);
      if (audioRef.current) {
        audioRef.current.src = '';
      }
      setPaused(true);
    }
  }, [songPath]);

  useEffect(() => {
    volumeRef.current = volume / 100;
    muteVolumeRef.current = muteVolume;
    // Only apply volume directly when not in a fade transition
    if (audioRef.current && !fadeIntervalRef.current) {
      audioRef.current.volume = muteVolume ? 0 : volume / 100;
      audioRef.current.muted = muteVolume;
    }
  }, [volume, muteVolume]);

  const handleVolumeChange = (_, value) => {
    const resolved = Array.isArray(value) ? value[0] : value;
    setVolume(resolved);
    setVolumeLevel(resolved);
    if (resolved === 0) {
      setMuteVolume(true);
    } else {
      setMuteVolume(false);
      setLastVolume(resolved);
    }
  };

  const setVolumeValue = (nextValue: number) => {
    const clamped = Math.max(0, Math.min(100, nextValue));
    setVolume(clamped);
    setVolumeLevel(clamped);
    if (clamped === 0) {
      setMuteVolume(true);
    } else {
      setMuteVolume(false);
      setLastVolume(clamped);
    }
  };

  const handleVolumeWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1 : -1; // wheel up -> increase, down -> decrease
    setVolumeValue(volume + delta);
  };

  const handleMuteClick = () => {
    if (muteVolume) {
      setMuteVolume(false);
      setVolume(lastVolume > 0 ? lastVolume : 30);
      setVolumeLevel(lastVolume > 0 ? lastVolume : 30);
    } else {
      setMuteVolume(true);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleTimeUpdate = () => {
      if (!isSeeking) setPosition(audio.currentTime);
    };
    const handleLoadedMetadata = () => setDuration(audio.duration);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [audioRef, isSeeking, state?.track]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => {
        setPosition(0);
        if (state.queue && state.queue.length > 0) {
          if (state.repeatMode === 'one') {
            // Repeat the current track
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(() => undefined);
          } else if (state.queueIndex < state.queue.length - 1) {
            dispatch({ type: 'NEXT_TRACK' });
          } else if (state.repeatMode === 'all') {
            dispatch({ type: 'NEXT_TRACK' });
          } else {
            setPaused(true);
          }
        }
      };
    }
  }, [state.queue, state.queueIndex, state.repeatMode, dispatch]);

  // Sync audio element play/pause with smooth fade in/out
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !songPath) return;

    // Cancel any running fade first
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }

    const FADE_STEPS = 25;
    const FADE_INTERVAL_MS = 20; // 25 steps × 20ms = 500ms total

    if (paused) {
      const startVol = audio.volume;
      let step = 0;
      fadeIntervalRef.current = setInterval(() => {
        step++;
        audio.volume = Math.max(0, startVol * (1 - step / FADE_STEPS));
        if (step >= FADE_STEPS) {
          clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
          audio.pause();
          // Restore to user volume so next play fades from correct target
          audio.volume = muteVolumeRef.current ? 0 : volumeRef.current;
        }
      }, FADE_INTERVAL_MS);
    } else {
      const targetVol = muteVolumeRef.current ? 0 : volumeRef.current;
      audio.volume = 0;
      audio.play().catch(() => undefined);
      let step = 0;
      fadeIntervalRef.current = setInterval(() => {
        step++;
        audio.volume = Math.min(targetVol, targetVol * (step / FADE_STEPS));
        if (step >= FADE_STEPS) {
          audio.volume = targetVol;
          clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
        }
      }, FADE_INTERVAL_MS);
    }
  }, [paused, songPath]);

  // Build album art src from the DB path (avoids reading the raw file into memory)
  const albumArtSrc = state.track?.AlbumArt
    ? `file:///${(state.track.AlbumArt as string).replace(/\\/g, '/')}`
    : DEFAULT_AA;

  // ── Always-on-top overlay notification ─────────────────────────────────
  useEffect(() => {
    if (!state.track?.Id) return;
    if (!getOverlayEnabled()) return;
    ipcRenderer.send('now-playing-notify', {
      title: (state.track.Title as string) || '',
      artist: (state.track.ArtistName as string) || '',
      album: (state.track.AlbumTitle as string) || '',
      albumArt: (state.track.AlbumArt as string) || null,
      queueIndex: state.queueIndex,
      queueTotal: state.queue.length,
      status: 'new-track',
    });
  }, [state.track?.Id]);

  // ── Track play count / last-played tracking (≥70% listened) ────────────
  const playedCountedRef = useRef(false);
  // Reset the flag whenever the track changes
  useEffect(() => {
    playedCountedRef.current = false;
  }, [state.track?.Id]);
  // Fire once when position crosses 70% of duration
  useEffect(() => {
    if (!state.track?.Id) return;
    if (playedCountedRef.current) return;
    if (!duration || duration <= 0) return;
    if (position / duration >= 0.7) {
      playedCountedRef.current = true;
      ipcRenderer.send('track-played', { trackId: state.track.Id });
    }
  }, [position, duration, state.track?.Id]);

  // ── Play / Pause overlay ─────────────────────────────────────────────────
  const prevPausedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!state.track?.Id) return;
    // Skip the very first render to avoid a spurious 'playing' flash on mount
    if (prevPausedRef.current === null) {
      prevPausedRef.current = paused;
      return;
    }
    if (prevPausedRef.current === paused) return;
    prevPausedRef.current = paused;
    if (!getOverlayEnabled()) return;
    ipcRenderer.send('now-playing-notify', {
      title: (state.track.Title as string) || '',
      artist: (state.track.ArtistName as string) || '',
      album: (state.track.AlbumTitle as string) || '',
      albumArt: (state.track.AlbumArt as string) || null,
      queueIndex: state.queueIndex,
      queueTotal: state.queue.length,
      status: paused ? 'paused' : 'playing',
    });
  }, [paused]);

  // --- Media Session API ---
  // Update OS metadata (Now Playing, lock screen, taskbar) when track changes
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const updateMediaSession = async () => {
      let artwork: MediaImage[] = [];
      if (state.track?.AlbumArt) {
        try {
          const fileUrl = `file:///${(state.track.AlbumArt as string).replace(/\\/g, '/')}`;
          const response = await fetch(fileUrl);
          const blob = await response.blob();
          const base64 = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          artwork = [{ src: base64 }];
        } catch {
          // artwork stays empty if loading fails
        }
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: (state.track?.Title as string) || 'Unknown Title',
        artist: (state.track?.ArtistName as string) || 'Unknown Artist',
        album: (state.track?.AlbumTitle as string) || 'Unknown Album',
        artwork,
      });
    };

    updateMediaSession();
  }, [state.track]);

  // Sync OS playback state with local paused state
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
  }, [paused]);

  // Keep OS seek bar in sync with audio position
  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audioRef.current?.playbackRate || 1,
        position: position,
      });
    } catch {
      /* noop */
    }
  }, [position, duration]);

  // Register OS media key / hardware button action handlers
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
      setPaused(false);
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      setPaused(true);
    });
    navigator.mediaSession.setActionHandler('stop', () => {
      setPaused(true);
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      dispatch({ type: 'NEXT_TRACK' });
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      dispatch({ type: 'PREV_TRACK' });
    });
    navigator.mediaSession.setActionHandler('seekto', details => {
      if (audioRef.current && details.seekTime !== undefined) {
        audioRef.current.currentTime = details.seekTime;
        setPosition(details.seekTime);
      }
    });
    navigator.mediaSession.setActionHandler('seekforward', details => {
      const skipTime = details.seekOffset || 10;
      if (audioRef.current) {
        audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + skipTime);
      }
    });
    navigator.mediaSession.setActionHandler('seekbackward', details => {
      const skipTime = details.seekOffset || 10;
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - skipTime);
      }
    });

    return () => {
      (
        [
          'play',
          'pause',
          'stop',
          'nexttrack',
          'previoustrack',
          'seekto',
          'seekforward',
          'seekbackward',
        ] as MediaSessionAction[]
      ).forEach(action => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* noop */
        }
      });
    };
  }, [dispatch, duration]);
  // --- End Media Session API ---

  // ── Discord Rich Presence sync ───────────────────────────────────────
  // Bootstrap enabled state into main process on mount
  useEffect(() => {
    ipcRenderer.send('discord-set-enabled', { enabled: discordEnabled });
  }, []);

  const sendDiscordUpdate = (pos: number) => {
    if (!discordEnabled) return;
    if (!state.track?.Id) {
      ipcRenderer.send('discord-clear');
      return;
    }
    ipcRenderer.send('discord-update', {
      title: (state.track.Title as string) || 'Unknown Track',
      artist: (state.track.ArtistName as string) || '',
      album: (state.track.AlbumTitle as string) || '',
      isPlaying: !paused,
      position: pos,
      duration,
    });
  };

  // Update presence on track change, play/pause toggle, or enable/disable
  useEffect(() => {
    sendDiscordUpdate(position);
  }, [state.track?.Id, paused, discordEnabled]);
  // ── End Discord Rich Presence sync ──────────────────────────────────

  // ── Thumbnail toolbar sync ──────────────────────────────────────────
  // Notify main process whenever play/pause changes so it can flip the icon
  useEffect(() => {
    ipcRenderer.send('thumbar-update', { isPlaying: !paused });
  }, [paused]);

  // Listen for button clicks from the Windows thumbnail toolbar
  useEffect(() => {
    const onToggle = () => setPaused(prev => !prev);
    const onNext = () => dispatch({ type: 'NEXT_TRACK' });
    const onPrev = () => dispatch({ type: 'PREV_TRACK' });

    ipcRenderer.on('thumbar-toggle', onToggle);
    ipcRenderer.on('thumbar-next', onNext);
    ipcRenderer.on('thumbar-prev', onPrev);
    return () => {
      ipcRenderer.removeListener('thumbar-toggle', onToggle);
      ipcRenderer.removeListener('thumbar-next', onNext);
      ipcRenderer.removeListener('thumbar-prev', onPrev);
    };
  }, [dispatch]);
  // ── End Thumbnail toolbar sync ───────────────────────────────────────

  const handleShuffle = () => {
    dispatch({ type: 'SET_SHUFFLE', payload: !state.isShuffle });
  };
  const handleRepeat = () => {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const currentIndex = modes.indexOf(state.repeatMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    dispatch({ type: 'SET_REPEAT_MODE', payload: nextMode });
  };

  function formatDuration(value) {
    const minute = Math.floor(value / 60);
    const secondLeft = Math.floor(value - minute * 60);
    return `${minute}:${secondLeft < 10 ? `0${secondLeft}` : secondLeft}`;
  }
  const mainIconColor = theme.palette.mode === 'dark' ? '#fff' : '#000';
  // Long press logic for skip buttons
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const handlePrevPress = () => {
    dispatch({ type: 'PREV_TRACK' });
  };
  const handleNextPress = () => {
    dispatch({ type: 'NEXT_TRACK' });
  };
  const handlePrevLongPress = () => {
    handlePrevLongPressAction();
    longPressInterval.current = setInterval(handlePrevLongPressAction, 500);
  };
  const handleNextLongPress = () => {
    handleNextLongPressAction();
    longPressInterval.current = setInterval(handleNextLongPressAction, 500);
  };
  const handlePrevLongPressAction = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
      setIsSeeking(false);
    }
  };
  const handleNextLongPressAction = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 15);
      setIsSeeking(false);
    }
  };

  const clearLongPress = (callback?: () => void) => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
    if (longPressInterval.current) {
      clearInterval(longPressInterval.current);
      longPressInterval.current = null;
    }
    if (callback) callback();
  };

  const prevButtonEvents = {
    onMouseDown: () => {
      longPressTimeout.current = setTimeout(handlePrevLongPress, 500);
    },
    onMouseUp: () => {
      clearLongPress(handlePrevPress);
    },
    onMouseLeave: () => {
      clearLongPress();
    },
    onTouchStart: () => {
      longPressTimeout.current = setTimeout(handlePrevLongPress, 500);
    },
    onTouchEnd: () => {
      clearLongPress(handlePrevPress);
    },
  };
  const nextButtonEvents = {
    onMouseDown: () => {
      longPressTimeout.current = setTimeout(handleNextLongPress, 500);
    },
    onMouseUp: () => {
      clearLongPress(handleNextPress);
    },
    onMouseLeave: () => {
      clearLongPress();
    },
    onTouchStart: () => {
      longPressTimeout.current = setTimeout(handleNextLongPress, 500);
    },
    onTouchEnd: () => {
      clearLongPress(handleNextPress);
    },
  };

  if (!state?.track) {
    return null;
  }

  // ── Unsynced lyrics: split into displayable lines
  const unsyncedLines = lyricsType === 'unsynced' && lrcContent ? lrcContent.split('\n') : [];

  const lyricsPanel = (
    <Box
      sx={{
        bottom: '100%',
        width: '100%',
        height: 'calc(100vh - 250px)',
        borderRadius: '0.5rem 0.5rem 0 0',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Source label — top right */}
      {lyricsSource && (
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            right: 14,
            zIndex: 1,
            backgroundColor:
              theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
            borderRadius: '6px',
            px: 1.2,
            py: 0.3,
            pointerEvents: 'none',
          }}
        >
          <Typography sx={{ fontSize: '0.7rem', opacity: 0.55, letterSpacing: 0.3 }}>
            Source: {lyricsSource}
          </Typography>
        </Box>
      )}

      {/* ── SYNCED lyrics ────────────────────────────────────────── */}
      {lyricsType === 'synced' && lrcContent && (
        <Lrc
          lrc={lrcContent}
          currentMillisecond={position * 1000}
          verticalSpace
          style={{ flex: 1, overflow: 'hidden auto', paddingBottom: '60px', width: '100%' }}
          lineRenderer={({ active, line }) => (
            <Box
              key={line.id}
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = line.startMillisecond / 1000;
                  setPosition(line.startMillisecond / 1000);
                }
              }}
              sx={{
                textAlign: 'center',
                py: '5px',
                px: 3,
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
                  color:
                    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)',
                },
              }}
            >
              {line.content || '\u00A0'}
            </Box>
          )}
        />
      )}

      {/* ── UNSYNCED lyrics ──────────────────────────────────────── */}
      {lyricsType === 'unsynced' && (
        <Box sx={{ flex: 1, overflow: 'hidden auto', px: 4, pt: 3, pb: '60px' }}>
          {unsyncedLines.map((line, i) => (
            <Typography
              key={i}
              sx={{
                fontSize: '1rem',
                lineHeight: 1.85,
                color: theme.palette.text.primary,
                opacity: line.trim() === '' ? 0 : 0.82,
                minHeight: line.trim() === '' ? '0.8rem' : undefined,
              }}
            >
              {line || '\u00A0'}
            </Typography>
          ))}
        </Box>
      )}

      {/* ── No lyrics ────────────────────────────────────────────── */}
      {!lrcContent && (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            opacity: 0.35,
          }}
        >
          <Typography variant="body1" fontWeight={500}>
            No lyrics found
          </Typography>
          <Typography variant="caption">Try adding a .lrc file next to the track</Typography>
        </Box>
      )}
    </Box>
  );

  return (
    <Box sx={{ px: isPhone ? 0 : '1.5rem', flex: 1, position: 'relative' }}>
      {/* ── Player controls card ────────────────────────────────────── */}
      <Grid
        container
        sx={{
          backdropFilter: 'blur(40px)',
          width: '100%',
          backgroundColor:
            theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.4)',
        }}
        elevation={3}
        component={Card}
      >
        <Collapse
          in={isLyricsExpanded}
          sx={{
            width: '100%',
          }}
        >
          {lyricsPanel}
        </Collapse>
        <Grid xs={12} md={6}>
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <CoverImage>
              <Image
                src={albumArtSrc}
                className="no-select no-drag"
                showLoading
                style={{ borderRadius: '0.4375rem' }}
                fit="contain"
              />
            </CoverImage>
            <Box
              sx={{
                ml: 0.5,
                minWidth: 0,
                overflow: 'auto',
                maxWidth: {
                  xs: 'calc(100vw - 130px)',
                  md: 'calc(50vw - 200px)',
                },
              }}
            >
              {renderMarquee(
                state?.track?.Title as string,
                <Typography
                  variant="h6"
                  component="h6"
                  title={state?.track?.Title as string}
                  className="no-select no-drag"
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  <b>{state?.track?.Title as string}</b>
                </Typography>
              )}
              {renderMarquee(
                (state.track?.ArtistName as string) || '',
                <Typography
                  variant="body1"
                  color="text.secondary"
                  fontWeight={500}
                  lineHeight={1}
                  title={(state.track?.ArtistName as string) || ''}
                  className="no-select no-drag"
                  sx={{
                    display: 'inline-flex',
                    flexWrap: 'nowrap',
                    gap: 0.5,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {artistNames.length > 0
                    ? artistNames.map((name, index) => (
                        <React.Fragment key={`${name}-${index}`}>
                          <Box
                            component="span"
                            onClick={() => handleArtistClick(name)}
                            sx={{
                              cursor: 'pointer',
                              '&:hover': {
                                opacity: 0.8,
                                textDecoration: 'underline',
                                color: theme.palette.secondary.main,
                              },
                            }}
                          >
                            {name}
                          </Box>
                          {index < artistNames.length - 1 && <Box component="span">•</Box>}
                        </React.Fragment>
                      ))
                    : 'Unknown Artist'}
                </Typography>
              )}
              {renderMarquee(
                (state.track?.AlbumTitle as string) || 'Unknown Album',
                <Typography
                  className="no-select no-drag"
                  sx={{
                    color: theme.palette.primary.main,
                    cursor: 'pointer',
                    '&:hover': { textDecoration: 'underline' },
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => {
                    const navPath =
                      state.track?.AlbumId != null
                        ? `/main_window/albums/${state.track.AlbumId}`
                        : null;
                    if (navPath) navigate(navPath);
                  }}
                  title={(state.track?.AlbumTitle as string) || ''}
                >
                  {(state.track?.AlbumTitle as string) || 'Unknown Album'}
                </Typography>
              )}
            </Box>
          </Box>
        </Grid>
        <Grid justifyContent="center" alignContent="center" xs={12} md={5}>
          <Box marginInline={3} mt={isPhone ? 0 : 2}>
            <Slider
              aria-label="time-indicator"
              size="small"
              value={position}
              min={0}
              step={1}
              max={duration}
              onChange={(_, value) => setPosition(Array.isArray(value) ? value[0] : value)}
              onChangeCommitted={(_, value) => {
                const seekPos = Array.isArray(value) ? value[0] : value;
                if (audioRef.current) audioRef.current.currentTime = seekPos;
                setIsSeeking(false);
                sendDiscordUpdate(seekPos);
              }}
              onMouseDown={() => setIsSeeking(true)}
              onMouseUp={() => setIsSeeking(false)}
              onTouchStart={() => setIsSeeking(true)}
              onTouchEnd={() => setIsSeeking(false)}
              sx={{
                color: theme.palette.primary.main,
                '& .MuiSlider-track': {
                  border: 'none',
                },
                height: 4,
                '& .MuiSlider-thumb': {
                  width: 20,
                  height: 20,
                  backgroundColor: theme.palette.text.primary,
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
                    width: 20,
                    height: 20,
                  },
                },
                '& .MuiSlider-rail': {
                  opacity: 0.28,
                },
              }}
            />
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mt: -2,
              }}
            >
              <TinyText>{formatDuration(position)}</TinyText>
              <TinyText>-{formatDuration(duration - position)}</TinyText>
            </Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.625rem',
              }}
            >
              <IconButton
                component={motion.div}
                whileTap={{ scale: 0.9 }}
                aria-label="previous song"
                sx={{ backgroundColor: isDark ? 'black' : '#d9d9d9' }}
                {...prevButtonEvents}
              >
                <FastRewindRounded fontSize="large" htmlColor={mainIconColor} />
              </IconButton>
              <IconButton
                component={motion.div}
                whileTap={{ scale: 0.9 }}
                aria-label={paused ? 'play' : 'pause'}
                sx={{ backgroundColor: isDark ? 'black' : '#d9d9d9' }}
                onClick={() => setPaused(!paused)}
              >
                {paused ? (
                  <PlayArrowRounded sx={{ fontSize: '3rem' }} htmlColor={mainIconColor} />
                ) : (
                  <PauseRounded sx={{ fontSize: '3rem' }} htmlColor={mainIconColor} />
                )}
              </IconButton>
              <IconButton
                component={motion.div}
                whileTap={{ scale: 0.9 }}
                aria-label="next song"
                sx={{ backgroundColor: isDark ? 'black' : '#d9d9d9' }}
                {...nextButtonEvents}
              >
                <FastForwardRounded fontSize="large" htmlColor={mainIconColor} />
              </IconButton>
            </Box>
            <Stack
              spacing={2}
              direction="row"
              sx={{ mt: 1, mb: isPhone ? 0 : 1, px: 1, width: '60%', marginInline: 'auto' }}
              alignItems="center"
            >
              <IconButton size="small" onClick={handleMuteClick}>
                {volume === 0 || muteVolume ? (
                  <Icon icon={speakerMute32Filled} width={20} />
                ) : volume < 40 ? (
                  <Icon icon={speaker132Regular} width={20} />
                ) : (
                  <Icon icon={speaker232Regular} width={20} />
                )}
              </IconButton>
              <Slider
                onWheel={handleVolumeWheel}
                aria-label="Volume"
                value={muteVolume ? 0 : volume}
                min={0}
                max={100}
                onChange={handleVolumeChange}
                sx={{
                  color: theme.palette.primary.main,
                  '& .MuiSlider-track': {
                    border: 'none',
                  },
                  transition: 'color 0.2s ease-in-out',
                  height: 4,
                  '& .MuiSlider-thumb': {
                    width: 14,
                    height: 14,
                    backgroundColor: theme.palette.text.primary,
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
              <Typography
                fontSize={'0.75rem'}
                ml={2}
                className="no-select no-drag"
              >{`${volume}%`}</Typography>
            </Stack>
          </Box>
        </Grid>
        <Grid xs={12} md={1} direction="row">
          <Box m={1}>
            <IconButton onClick={handleShuffle} aria-label="shuffle">
              {state.isShuffle ? <ShuffleOnRoundedIcon /> : <ShuffleRounded />}
            </IconButton>
            <IconButton onClick={handleRepeat} aria-label="repeat">
              {state.repeatMode === 'off' ? (
                <RepeatRounded />
              ) : state.repeatMode === 'all' ? (
                <RepeatOnRoundedIcon />
              ) : (
                <RepeatOneOnRoundedIcon />
              )}
            </IconButton>
            <IconButton
              onClick={handleDiscordToggle}
              aria-label="discord presence"
              title={discordEnabled ? 'Discord Presence: On' : 'Discord Presence: Off'}
              sx={{ opacity: discordEnabled ? 1 : 0.35 }}
            >
              <DiscordIcon viewBox="0 0 70 60" width={24} height={24} />
            </IconButton>
            <IconButton
              onClick={handleLyricsToggle}
              aria-label="lyrics"
              disabled={!lrcContent}
              title={isLyricsExpanded ? 'Close Lyrics' : 'Show Lyrics'}
              sx={{ opacity: lrcContent ? 1 : 0.5 }}
            >
              {isLyricsExpanded ? (
                <LyricNoteActiveIcon
                  viewBox="0 0 16 17"
                  className="icon-white"
                  width={24}
                  height={24}
                />
              ) : (
                <LyricNoteIcon viewBox="0 0 16 17" className="icon-white" width={24} height={24} />
              )}
            </IconButton>
          </Box>
        </Grid>
      </Grid>
      <audio ref={audioRef} style={{ display: 'none' }} />
    </Box>
  );
}
