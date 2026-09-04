import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { alpha, styled, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Slider from '@mui/material/Slider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';

import {
  Card,
  Collapse,
  useMediaQuery,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2/Grid2';
import { store, RepeatMode } from '../utils/store';
import { toMediaSrc } from '../utils/misc';
import {
  getVolumeLevel,
  setVolumeLevel,
  getOverlayEnabled,
  getDiscordEnabled,
  setDiscordEnabled,
  getPauseOnAudioOutputChange,
  getAudioOutputDeviceId,
  getCastVolumeLevel,
  setCastVolumeLevel,
  AUDIO_OUTPUT_DEVICE_EVENT,
  CAST_STOP_EVENT,
  PLAYBACK_ERROR_EVENT,
} from '../utils/LocStoreUtil';
import DiscordIcon from 'svg-react-loader?name=DiscordIcon!../../assets/svgs/discord-logo.svg';
import LyricNoteIcon from 'svg-react-loader?name=LyricNoteIcon!../../assets/svgs/lyric-note.svg';
import LyricNoteActiveIcon from 'svg-react-loader?name=LyricNoteActiveIcon!../../assets/svgs/lyric-note-active.svg';
import { Icon } from '@iconify/react';
import pause32Filled from '@iconify/icons-fluent/pause-32-filled';
import play32Filled from '@iconify/icons-fluent/play-32-filled';
import fastForward32Filled from '@iconify/icons-fluent/fast-forward-28-filled';
import repeatOne24Filled from '@iconify/icons-fluent/arrow-repeat-1-24-filled';
import repeatAll24Filled from '@iconify/icons-fluent/arrow-repeat-all-24-filled';
import repeatOff24Filled from '@iconify/icons-fluent/arrow-repeat-all-off-24-filled';
import speaker132Regular from '@iconify/icons-fluent/speaker-1-32-regular';
import speaker232Regular from '@iconify/icons-fluent/speaker-2-32-regular';
import speakerMute32Filled from '@iconify/icons-fluent/speaker-mute-32-filled';
import info24Regular from '@iconify/icons-fluent/info-24-regular';
import edit24Regular from '@iconify/icons-fluent/edit-24-regular';
import moreHorizontal24Regular from '@iconify/icons-fluent/more-horizontal-24-regular';
import moreHorizontal24Filled from '@iconify/icons-fluent/more-horizontal-24-filled';
import options24Regular from '@iconify/icons-fluent/options-24-regular';
import topSpeed24Regular from '@iconify/icons-fluent/top-speed-24-regular';
import cast24Regular from '@iconify/icons-fluent/cast-24-regular';
import speaker224Regular from '@iconify/icons-fluent/speaker-2-24-regular';
import chevronRight20Regular from '@iconify/icons-fluent/chevron-right-20-regular';
import shuffle24Filled from '@iconify/icons-fluent/arrow-shuffle-24-filled';
import shuffleInactive24Filled from '@iconify/icons-fluent/arrow-shuffle-off-24-filled';
import arrowCircleDown24Filled from '@iconify/icons-fluent/arrow-between-down-24-regular';
import heart24Regular from '@iconify/icons-fluent/heart-24-regular';
import heart24Filled from '@iconify/icons-fluent/heart-24-filled';
import bookmark24Regular from '@iconify/icons-fluent/bookmark-24-regular';
import bookmark24Filled from '@iconify/icons-fluent/bookmark-24-filled';
import { Image } from 'mui-image';
import { DEFAULT_AA } from '../../config/constants';
const { ipcRenderer } = window.require('electron');
import { motion } from 'motion/react';
import { useNavigate, useLocation } from 'react-router';
import { parseFile } from 'music-metadata';
import ImagePreviewDialog from './ImagePreviewDialog';
import SongInfoDialog from './SongInfoDialog';
import TagEditorDialog, { EditableTrack } from './TagEditorDialog';
import { isTaggable } from '../../config/constants';
import AudioOutputMenu from './AudioOutputMenu';
import CastDeviceMenu from './CastDeviceMenu';
import type { CastDevice, CastLoadPayload, CastStatus } from '../../main/modules/Cast';
import Marquee from './Marquee';
import PlaybackProgress from './PlaybackProgress';
import LyricsPanel from './LyricsPanel';

// ── Styled primitives ──────────────────────────────────────────────────────

const CoverImage = styled(Box)(({ theme }) => ({
  width: 140,
  height: 140,
  margin: 10,
  objectFit: 'cover',
  overflow: 'hidden',
  flexShrink: 0,
  borderRadius: 8,
  backgroundColor: alpha(theme.palette.surfaces.well, 0.08),
  '& > img': { width: '100%' },
  [theme.breakpoints.down('md')]: { width: 90, height: 90 },
}));

const CoverImageInteractive = styled(CoverImage, {
  shouldForwardProp: prop => prop !== 'hasArt',
})<{ hasArt: boolean }>(({ hasArt }) => ({
  cursor: hasArt ? 'zoom-in' : 'default',
  position: 'relative',
}));

const FavouriteButton = styled(IconButton, {
  shouldForwardProp: prop => prop !== 'isFavourite',
})<{ isFavourite: boolean }>(({ theme, isFavourite }) => ({
  position: 'absolute',
  top: 4,
  right: 4,
  padding: 4,
  zIndex: 1,
  color: isFavourite ? theme.palette.error.main : theme.palette.common.white,
  backgroundColor: alpha(theme.palette.common.black, 0.45),
  '&:hover': { backgroundColor: alpha(theme.palette.common.black, 0.65) },
}));

const TinyText = styled(Typography)({
  fontSize: '0.75rem',
  opacity: 0.38,
  fontWeight: 500,
  letterSpacing: 0.2,
});

const QueueCounter = styled(TinyText)({
  display: 'block',
  marginBottom: 2,
});

const PlayBarRoot = styled(Box, {
  shouldForwardProp: prop => prop !== 'isPhone',
})<{ isPhone: boolean }>(({ isPhone }) => ({
  paddingLeft: isPhone ? 0 : '1.5rem',
  paddingRight: isPhone ? 0 : '1.5rem',
  flex: 1,
  position: 'relative',
}));

const PlayerCard = styled(Grid, {
  shouldForwardProp: prop => prop !== 'isPhone',
})<{ isPhone: boolean }>(({ isPhone, theme }) => ({
  backdropFilter: 'blur(80px)',
  width: '100%',
  border: `${theme.palette.surfaces.glassBorder} 1px solid`,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  '-electron-corner-smoothing': '100%',
  backgroundColor: theme.palette.surfaces.glass,
  // The border alone is too faint in light mode to separate the bar from the page.
  boxShadow: theme.shadows[8],
  // On phones the root drops its side padding, so the card sits flush against the
  // window edge; rounded bottom corners would show the page through them.
  ...(isPhone && {
    borderRadius: `${theme.shape.borderRadius}px ${theme.shape.borderRadius}px 0 0`,
    borderBottom: 'none',
  }),
}));

const LyricsCollapse = styled(Collapse)({
  width: '100%',
});

const TrackInfoRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  height: '100%',
});

const TrackTextWrap = styled(Box)(({ theme }) => ({
  marginLeft: theme.spacing(0.5),
  minWidth: 0,
  overflow: 'auto',
  maxWidth: 'calc(50vw - 200px)',
  [theme.breakpoints.down('md')]: { maxWidth: 'calc(100vw - 130px)' },
}));

const TitleText = styled(Typography, {
  shouldForwardProp: prop => prop !== 'navigable',
})<{ navigable: boolean }>(({ theme, navigable }) => ({
  whiteSpace: 'nowrap',
  fontSize: '1.25rem',
  lineHeight: 1.5,
  '&:hover': navigable
    ? { textDecoration: 'underline', color: theme.palette.secondary.main }
    : undefined,
}));

const ArtistsText = styled(Typography)({
  display: 'inline-flex',
  flexWrap: 'nowrap',
  gap: 4,
  whiteSpace: 'nowrap',
});

const ArtistName = styled(Box)(({ theme }) => ({
  '&:hover': {
    opacity: 0.8,
    textDecoration: 'underline',
    color: theme.palette.secondary.main,
  },
}));

const AlbumText = styled(Typography)(({ theme }) => ({
  color: theme.palette.primary.main,
  '&:hover': { textDecoration: 'underline' },
  whiteSpace: 'nowrap',
}));

const ProgressColumn = styled(Box, {
  shouldForwardProp: prop => prop !== 'isPhone',
})<{ isPhone: boolean }>(({ isPhone, theme }) => ({
  marginInline: theme.spacing(2),
  marginTop: isPhone ? 0 : theme.spacing(1),
}));

const TransportRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.625rem',
});

const ControlButton = styled(IconButton)(({ theme }) => ({
  backgroundColor: theme.palette.surfaces.control,
}));

const TransportIconStyle: React.CSSProperties = { margin: '0.2rem' };
const PlayPauseIconStyle: React.CSSProperties = { margin: '0.3rem' };
const AlbumArtImageStyle: React.CSSProperties = { borderRadius: '0.4375rem' };
const AudioElementStyle: React.CSSProperties = { display: 'none' };

const VolumeStack = styled(Stack, {
  shouldForwardProp: prop => prop !== 'isPhone',
})<{ isPhone: boolean }>(({ isPhone, theme }) => ({
  marginTop: theme.spacing(1),
  marginBottom: isPhone ? 0 : theme.spacing(1),
  paddingLeft: theme.spacing(1),
  paddingRight: theme.spacing(1),
  width: '60%',
  marginInline: 'auto',
}));

const VolumeSlider = styled(Slider)(({ theme }) => ({
  color: theme.palette.primary.main,
  height: 4,
  transition: 'color 0.2s ease-in-out',
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

const VolumeLabel = styled(Typography)(({ theme }) => ({
  fontSize: '0.75rem',
  marginLeft: theme.spacing(2),
}));

const SideButtonsColumn = styled(Grid)(({ theme }) => ({
  display: 'flex',
  [theme.breakpoints.up('md')]: { display: 'grid' },
}));

const SideButtonsRow = styled(Grid)(({ theme }) => ({
  flexWrap: 'nowrap',
  justifyContent: 'flex-end',
  gap: theme.spacing(0.5),
  [theme.breakpoints.up('md')]: { gap: 0 },
}));

const FadedIconButton = styled(IconButton, {
  shouldForwardProp: prop => prop !== 'active',
})<{ active: boolean }>(({ active }) => ({
  opacity: active ? 1 : 0.5,
}));

const DiscordIconButton = styled(IconButton, {
  shouldForwardProp: prop => prop !== 'enabled',
})<{ enabled: boolean }>(({ enabled }) => ({
  opacity: enabled ? 1 : 0.35,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────────

/** An LRC line carrying a timestamp, i.e. lyrics that can follow playback. */
const SYNCED_LRC = /\[\d{2}:\d{2}[.:]\d{2}/;

/** `stream:12` → 12; anything else (a library id, a file path) → undefined. */
function streamIdOf(id: string | number | undefined): number | undefined {
  const match = typeof id === 'string' && /^stream:(\d+)$/.exec(id);
  return match ? Number(match[1]) : undefined;
}

export default function PlayBar() {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, dispatch } = useContext(store);
  const defaultVol = getVolumeLevel();
  const [songPath, setSongPath] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Hidden silent loop — keeps MediaSession active across track changes
  // so SMTC doesn't drop the OS-level entry. See silentSrc below.
  const silentAudioRef = useRef<HTMLAudioElement>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeRef = useRef(defaultVol / 100);
  const muteVolumeRef = useRef(false);
  // true when no restored track on mount → first user-initiated play should autoplay.
  // false when a track is already in state (restored from localStorage) → don't blast music on restart.
  const didAutoStartRef = useRef(!state?.track);
  const pausedRef = useRef(true);
  // Mirrors isCasting for effects and handlers that must not re-subscribe.
  const castingRef = useRef(false);
  // Discards stale artwork loads when the user skips past the track.
  const metadataReqRef = useRef(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [muteVolume, setMuteVolume] = useState(false);
  const isPhone = useMediaQuery(({ breakpoints }) => breakpoints.down('md'));
  const [volume, setVolume] = useState(defaultVol);
  const [lastVolume, setLastVolume] = useState(defaultVol > 0 ? defaultVol : 30);
  const [discordEnabled, setDiscordEnabledState] = useState(() => getDiscordEnabled());
  const [songInfoOpen, setSongInfoOpen] = useState(false);
  const [editTrack, setEditTrack] = useState<EditableTrack[] | null>(null);

  // ── Google Cast ────────────────────────────────────────────────────────────
  const [isCasting, setIsCasting] = useState(false);
  const [castDeviceId, setCastDeviceId] = useState<string | null>(null);
  const [castDeviceName, setCastDeviceName] = useState<string | null>(null);
  const [castMenuAnchorEl, setCastMenuAnchorEl] = useState<HTMLElement | null>(null);
  const castDeviceIdRef = useRef<string | null>(null);
  useEffect(() => {
    castingRef.current = isCasting;
  }, [isCasting]);
  useEffect(() => {
    castDeviceIdRef.current = castDeviceId;
  }, [castDeviceId]);
  const persistVolumeRef = useRef((val: number) => {
    if (castingRef.current && castDeviceIdRef.current) {
      setCastVolumeLevel(castDeviceIdRef.current, val);
    } else {
      setVolumeLevel(val);
    }
  });

  // ── Lyrics ───────────────────────────────────────────────────────────────
  const isLyricsExpanded = state.isLyricsExpanded;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [lrcContent, setLrcContent] = useState<string | null>(null);
  const [lyricsSource, setLyricsSource] = useState<'LRC file' | 'Embedded' | 'Server' | null>(null);
  const [lyricsType, setLyricsType] = useState<'synced' | 'unsynced' | null>(null);

  // Streamed track: there is no local file to find a sidecar .lrc beside, and
  // no local bytes to read embedded lyrics out of.
  const isRemoteSongPath = !!songPath && /^https?:\/\//i.test(songPath);

  useEffect(() => {
    if (!songPath) {
      setLrcContent(null);
      setLyricsSource(null);
      setLyricsType(null);
      return;
    }
    let cancelled = false;

    // A streamed track has no local file to read, but the server keeps the
    // lyrics and hands them back as LRC, so the same parser below applies.
    if (isRemoteSongPath) {
      const trackId = state.track?.Id;
      if (trackId == null) return;
      ipcRenderer
        .invoke('get-remote-lyrics', { trackId })
        .then((lrc: unknown) => {
          if (cancelled) return;
          if (typeof lrc === 'string' && lrc.trim()) {
            setLrcContent(lrc);
            setLyricsSource('Server');
            setLyricsType(SYNCED_LRC.test(lrc) ? 'synced' : 'unsynced');
          } else {
            setLrcContent(null);
            setLyricsSource(null);
            setLyricsType(null);
          }
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

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
          const isSynced = SYNCED_LRC.test(content);
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

        const sylt = nativeFrames.find(f => f.id === 'SYLT');
        const syltVal = sylt?.value as
          { synchronisedText?: Array<{ text: string; timestamp: number }> } | undefined;
        if (syltVal?.synchronisedText?.length) {
          const lrc = syltToLrc(syltVal.synchronisedText);
          if (!cancelled) {
            setLrcContent(lrc);
            setLyricsSource('Embedded');
            setLyricsType('synced');
          }
          return;
        }

        const uslt = nativeFrames.find(f => f.id === 'USLT');
        const usltVal = uslt?.value as { text?: string } | undefined;
        if (usltVal?.text) {
          const text: string = usltVal.text;
          const isSynced = SYNCED_LRC.test(text);
          if (!cancelled) {
            setLrcContent(text);
            setLyricsSource('Embedded');
            setLyricsType(isSynced ? 'synced' : 'unsynced');
          }
          return;
        }

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
  }, [songPath, isRemoteSongPath, state.track?.Id]);

  const handleLyricsToggle = useCallback(() => {
    dispatch({ type: 'SET_LYRICS_EXPANDED', payload: !isLyricsExpanded });
  }, [dispatch, isLyricsExpanded]);

  useEffect(() => {
    if (isLyricsExpanded) {
      dispatch({ type: 'SET_LYRICS_EXPANDED', payload: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  // ── End Lyrics ───────────────────────────────────────────────────────────

  const handleDiscordToggle = useCallback(() => {
    setDiscordEnabledState(prev => {
      const next = !prev;
      setDiscordEnabled(next);
      ipcRenderer.send('discord-set-enabled', { enabled: next });
      if (!next) ipcRenderer.send('discord-clear');
      return next;
    });
  }, []);

  // ── Scrobbling (Last.fm / ListenBrainz) ──────────────────────────────
  // Refs, not state: the 1Hz tick below reads them without restarting itself.
  const scrobbledRef = useRef(false);
  const trackStartedAtRef = useRef(0);
  const startScrobbleWindow = useCallback(() => {
    scrobbledRef.current = false;
    trackStartedAtRef.current = Math.floor(Date.now() / 1000);
  }, []);

  const artistNames = React.useMemo(() => {
    // Split only on the comma that GROUP_CONCAT uses to join multiple distinct
    // artists. Do NOT split on '&' — a single artist name can legitimately
    // contain it (e.g. the "Eminem & Linkin Park" multi-artist exception), and
    // such names are stored as one Artist row.
    const artistText = (state.track?.ArtistName as string) || '';
    return artistText
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);
  }, [state.track?.ArtistName]);

  const handleArtistClick = useCallback(
    async (artistName: string) => {
      if (!artistName) return;
      try {
        const result = await ipcRenderer.invoke('find-artist-by-name', { name: artistName });
        if (result?.id) navigate(`/main_window/artists/${result.id}`);
      } catch {
        /* ignore lookup failures */
      }
    },
    [navigate]
  );

  const trackUri = state?.track?.Uri as string | undefined;
  // Internet radio: no duration, no seeking, and the bar shows Live instead of times.
  // Keyed on the queue id, not the URL scheme: the Streams view is the only thing
  // that enqueues a `stream:<id>`, whereas a synced remote track also has an http
  // Uri but is finite and seekable like any other song.
  const isLive = streamIdOf(state?.track?.Id) !== undefined;
  // Not backed by a local file: internet radio, or a remote track we haven't
  // downloaded. Gates the features that need real bytes on disk.
  const isRemote = !!trackUri && /^https?:\/\//i.test(trackUri);

  // A source set to read tags lazily hands the library a track named after its
  // file, and playing it is what fills in the rest. Main answers immediately
  // for anything already tagged.
  const currentTrackId = state?.track?.Id;
  useEffect(() => {
    if (!isRemote || isLive || currentTrackId == null) return;
    void ipcRenderer
      .invoke('ensure-remote-tags', { trackId: currentTrackId })
      .catch(() => undefined);
  }, [isRemote, isLive, currentTrackId]);

  useEffect(() => {
    if (trackUri) {
      setSongPath(trackUri);
      if (didAutoStartRef.current) setPaused(false);
      didAutoStartRef.current = true;
    } else {
      setSongPath(null);
      setPaused(true);
    }
  }, [trackUri]);

  // The ICY title is written onto the current track, so the player bar, OS controls,
  // overlay and Discord follow along without knowing a stream is involved. The queue
  // entry is read from here because it still holds the station's own name.
  const streamBaseRef = useRef(state.track);
  streamBaseRef.current = state.queue[state.queueIndex] ?? state.track;
  // The history row for the song currently on air, so it can be bookmarked.
  const [streamHistory, setStreamHistory] = useState<{ id: number; saved: boolean } | null>(null);
  useEffect(() => {
    // Cleared for every track, or a library song inherits the last station's
    // row and shows a bookmark instead of a heart.
    setStreamHistory(null);
    if (!isLive) return;
    const handleMeta = (
      _event: Electron.IpcRendererEvent,
      meta: {
        title?: string;
        artist?: string | null;
        historyId?: number;
        saved?: boolean;
      }
    ) => {
      const base = streamBaseRef.current;
      if (!base || !meta?.title) return;
      setStreamHistory(meta.historyId != null ? { id: meta.historyId, saved: !!meta.saved } : null);
      dispatch({
        type: 'SET_CURR_TRACK',
        payload: { ...base, Title: meta.title, ArtistName: meta.artist ?? base.ArtistName },
      });
    };
    ipcRenderer.on('stream-metadata', handleMeta);
    ipcRenderer.send('stream-meta-start', {
      url: trackUri,
      streamId: streamIdOf(streamBaseRef.current?.Id),
    });
    return () => {
      ipcRenderer.removeListener('stream-metadata', handleMeta);
      ipcRenderer.send('stream-meta-stop');
    };
  }, [trackUri, isLive, dispatch]);

  // setSinkId persists across src changes, but the audio element mounts lazily
  // with the first track, so re-apply on each load and on the change event below.
  const applySinkId = useCallback(async (): Promise<void> => {
    const deviceId = getAudioOutputDeviceId();
    for (const el of [audioRef.current, silentAudioRef.current]) {
      const sinkable = el as
        (HTMLAudioElement & { setSinkId?: (_id: string) => Promise<void>; sinkId?: string }) | null;
      if (!sinkable?.setSinkId || sinkable.sinkId === deviceId) continue;
      try {
        await sinkable.setSinkId(deviceId);
      } catch {
        // Device vanished; fall back to the system default so audio keeps playing.
        if (deviceId !== 'default') await sinkable.setSinkId('default').catch(() => undefined);
      }
    }
  }, []);

  useEffect(() => {
    if (audioRef.current && songPath) {
      const audio = audioRef.current;
      audio.src = toMediaSrc(songPath);
      audio.volume = muteVolumeRef.current || castingRef.current ? 0 : volumeRef.current;
      audio.muted = castingRef.current || audio.muted;
      void applySinkId();
      // Kick playback off immediately rather than waiting for loadedmetadata
      // so the new track starts at canplay instead of an extra round-trip later.
      // While casting, the local element is a muted clock; never let it play.
      if (!pausedRef.current && !castingRef.current) audio.play().catch(() => undefined);
    }
  }, [songPath, applySinkId]);

  useEffect(() => {
    if (!songPath) {
      setDuration(0);
      if (audioRef.current) audioRef.current.src = '';
      setPaused(true);
    }
  }, [songPath]);

  useEffect(() => {
    volumeRef.current = volume / 100;
    muteVolumeRef.current = muteVolume;
    if (audioRef.current && !fadeIntervalRef.current) {
      const silent = muteVolume || castingRef.current;
      audioRef.current.volume = silent ? 0 : volume / 100;
      audioRef.current.muted = silent;
    }
  }, [volume, muteVolume]);

  const handleVolumeChange = useCallback((_: Event, value: number | number[]) => {
    const resolved = Array.isArray(value) ? value[0] : value;
    setVolume(resolved);
    persistVolumeRef.current(resolved);
    if (resolved === 0) {
      setMuteVolume(true);
    } else {
      setMuteVolume(false);
      setLastVolume(resolved);
    }
  }, []);

  const handleVolumeWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1 : -1;
    setVolume(prev => {
      const next = Math.max(0, Math.min(100, prev + delta));
      persistVolumeRef.current(next);
      if (next === 0) {
        setMuteVolume(true);
      } else {
        setMuteVolume(false);
        setLastVolume(next);
      }
      return next;
    });
  }, []);

  const handleMuteClick = useCallback(() => {
    setMuteVolume(prev => {
      if (prev) {
        const restore = lastVolume > 0 ? lastVolume : 30;
        setVolume(restore);
        persistVolumeRef.current(restore);
        return false;
      }
      return true;
    });
  }, [lastVolume]);

  // Subscribe to loadedmetadata for duration only — position lives in PlaybackProgress / LyricsPanel.
  // Depends on songPath so it re-runs when the audio element first receives a src (on first run
  // PlayBar renders null until the first track is set, so audioRef.current is null at mount).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // A live stream reports Infinity; 0 is what every consumer already treats as an
    // unknown duration, so no seek, progress fill, play-count or scrobble happens.
    const handleLoadedMetadata = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [songPath]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.onended = () => {
      // While casting, the device signals track end via cast-status, then cast-ended.
      if (castingRef.current) return;
      if (state.queue && state.queue.length > 0) {
        if (state.repeatMode === 'one') {
          audio.currentTime = 0;
          audio.play().catch(() => undefined);
          // Track id doesn't change on repeat, so arm the next scrobble here.
          startScrobbleWindow();
        } else if (state.queueIndex < state.queue.length - 1) {
          dispatch({ type: 'NEXT_TRACK' });
        } else if (state.repeatMode === 'all') {
          dispatch({ type: 'NEXT_TRACK' });
        } else {
          setPaused(true);
        }
      }
    };
    // A file Chromium's demuxer rejects (malformed FLAC picture block, truncated
    // container) fires error and nothing else, so the bar would sit at 0:00 forever.
    // Never repeat on error, even with repeatMode 'one', or it spins on a dead file.
    audio.onerror = () => {
      if (!audio.getAttribute('src')) return; // clearing src on queue end
      const { code, message } = audio.error ?? {};
      console.error('[audio] cannot play', audio.currentSrc, code, message);
      if (castingRef.current) return;
      const canAdvance =
        (state.queue?.length ?? 0) > 0 &&
        (state.queueIndex < state.queue.length - 1 || state.repeatMode === 'all');
      const title = (state.track?.Title as string) || 'This track';
      // An unreachable server fails every one of its tracks identically, so
      // advancing would race through the queue firing a toast per song, and
      // "damaged file" would be the wrong diagnosis every time. Stop once instead.
      if (/^https?:\/\//i.test(String(state.track?.Uri ?? ''))) {
        window.dispatchEvent(
          new CustomEvent(PLAYBACK_ERROR_EVENT, {
            detail: `Can't reach the server for ${title}. Check that it's online.`,
          })
        );
        dispatch({ type: 'RESET_PLAYBACK' });
        return;
      }
      window.dispatchEvent(
        new CustomEvent(PLAYBACK_ERROR_EVENT, {
          detail: `${title} can't be played — the file is unsupported or damaged.${
            canAdvance ? ' Skipping.' : ''
          }`,
        })
      );
      if (canAdvance) dispatch({ type: 'NEXT_TRACK' });
      else dispatch({ type: 'RESET_PLAYBACK' });
    };
  }, [state.queue, state.queueIndex, state.repeatMode, state.track, dispatch, startScrobbleWindow]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // ── SMTC keepalive (silent loop) ─────────────────────────────────────
  // 1s silent WAV looped in a hidden audio element. While it's playing,
  // MediaSession always has at least one active player, so the session
  // doesn't go inactive while the main audio's WebMediaPlayer is destroyed
  // and re-created on a track change — SMTC keeps the OS tile pinned.
  const silentSrc = useMemo(() => {
    const sampleRate = 8000;
    const numSamples = sampleRate; // 1 second
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true); // byte rate
    view.setUint16(32, 1, true); // block align
    view.setUint16(34, 8, true); // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, numSamples, true);
    // 8-bit unsigned PCM midpoint = 128 = silence
    for (let i = 0; i < numSamples; i++) view.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }, []);

  useEffect(() => {
    return () => {
      // Release the blob URL when PlayBar unmounts.
      try {
        URL.revokeObjectURL(silentSrc);
      } catch {
        /* noop */
      }
    };
  }, [silentSrc]);

  // Mirror the main audio's play/pause state. Letting the silent track run
  // while the user has paused makes Chromium override our explicit
  // playbackState='paused' (since it sees an active player), which breaks
  // SMTC's pause toggle. Track changes while paused may briefly drop
  // SMTC — accepted trade-off, the user isn't listening anyway.
  useEffect(() => {
    const silent = silentAudioRef.current;
    if (!silent) return;
    if (paused) {
      silent.pause();
    } else if (silent.paused) {
      silent.play().catch(() => undefined);
    }
  }, [paused]);

  // Auto-pause when the active audio output device disappears (e.g. headphones
  // unplugged, Bluetooth disconnected). Without this the <audio> element would
  // silently re-route to the system default output and keep blasting music.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    let cancelled = false;
    const knownOutputIds = new Set<string>();

    const snapshotOutputs = async (): Promise<Set<string>> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return new Set(
          devices.filter(d => d.kind === 'audiooutput' && d.deviceId).map(d => d.deviceId)
        );
      } catch {
        return new Set();
      }
    };

    // Prime the set so the first devicechange has something to compare against.
    void snapshotOutputs().then(ids => {
      if (cancelled) return;
      ids.forEach(id => knownOutputIds.add(id));
    });

    const handleDeviceChange = async (): Promise<void> => {
      if (!getPauseOnAudioOutputChange()) {
        // Setting may have toggled off — refresh the snapshot anyway so toggling
        // back on later doesn't trigger on stale removals.
        const current = await snapshotOutputs();
        knownOutputIds.clear();
        current.forEach(id => knownOutputIds.add(id));
        return;
      }

      const current = await snapshotOutputs();
      const removed = [...knownOutputIds].some(id => !current.has(id));

      knownOutputIds.clear();
      current.forEach(id => knownOutputIds.add(id));

      if (removed && !pausedRef.current) {
        setPaused(true);
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, []);

  const syncVolumeFromSettings = useCallback(() => {
    const next = getVolumeLevel();
    setVolume(next);
    if (next === 0) {
      setMuteVolume(true);
    } else {
      setMuteVolume(false);
      setLastVolume(next);
    }
  }, []);

  // Re-route live when the output device is changed in Settings.
  useEffect(() => {
    const handler = (): void => {
      // While casting the slider shows the cast volume; an output-device change
      // must not overwrite it with the local level.
      if (!castingRef.current) syncVolumeFromSettings();
      void applySinkId();
    };
    window.addEventListener(AUDIO_OUTPUT_DEVICE_EVENT, handler);
    return () => window.removeEventListener(AUDIO_OUTPUT_DEVICE_EVENT, handler);
  }, [applySinkId, syncVolumeFromSettings]);

  // Sync audio play/pause with smooth fade
  useEffect(() => {
    // While casting, transport lives on the device; forward the intent and leave the local element paused.
    if (castingRef.current) {
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
      ipcRenderer.send('cast-control', { action: paused ? 'pause' : 'play' });
      return;
    }

    const audio = audioRef.current;
    if (!audio || !songPath) return;

    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }

    const FADE_STEPS = 25;
    const FADE_INTERVAL_MS = 20;

    if (paused) {
      const startVol = audio.volume;
      let step = 0;
      fadeIntervalRef.current = setInterval(() => {
        step++;
        audio.volume = Math.max(0, startVol * (1 - step / FADE_STEPS));
        if (step >= FADE_STEPS) {
          if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
          audio.pause();
          audio.volume = muteVolumeRef.current ? 0 : volumeRef.current;
        }
      }, FADE_INTERVAL_MS);
    } else {
      const targetVol = muteVolumeRef.current ? 0 : volumeRef.current;
      audio.volume = 0;
      // Resuming a live stream off its stale buffer plays however long you were
      // paused behind the broadcast; reloading snaps back to the live edge.
      if (!Number.isFinite(audio.duration)) audio.load();
      audio.play().catch(() => undefined);
      let step = 0;
      fadeIntervalRef.current = setInterval(() => {
        step++;
        audio.volume = Math.min(targetVol, targetVol * (step / FADE_STEPS));
        if (step >= FADE_STEPS) {
          audio.volume = targetVol;
          if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
        }
      }, FADE_INTERVAL_MS);
    }
  }, [paused, songPath]);

  const albumArtSrc = state.track?.AlbumArt
    ? `file:///${(state.track.AlbumArt as string).replace(/\\/g, '/')}`
    : DEFAULT_AA;

  // ── Always-on-top overlay notification ─────────────────────────────────
  useEffect(() => {
    if (!state.track?.Id) return;
    if (!getOverlayEnabled()) return;
    ipcRenderer.send('now-playing-notify', {
      title: (state.track.Title as string) || '',
      artist: artistNames.join(', '),
      album: (state.track.AlbumTitle as string) || '',
      albumArt: (state.track.AlbumArt as string) || null,
      queueIndex: state.queueIndex,
      queueTotal: state.queue.length,
      status: 'new-track',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.track?.Id]);

  const scrobbleMeta = useMemo(() => {
    const track = state.track;
    if (!track?.Id) return null;
    const artist = artistNames.join(', ');
    const title = (track.Title as string) || '';
    if (!artist || !title) return null;
    // `artist` is the joined display string, a fallback only; the main process
    // resolves the real per-artist rows from `trackId`.
    return {
      trackId: track.Id as number,
      artist,
      track: title,
      album: (track.AlbumTitle as string) || undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.track?.Id, artistNames]);
  const scrobbleMetaRef = useRef(scrobbleMeta);
  scrobbleMetaRef.current = scrobbleMeta;

  useEffect(() => {
    if (paused || !scrobbleMeta) return;
    ipcRenderer.send('scrobbler-now-playing', { ...scrobbleMeta, duration });
  }, [scrobbleMeta, paused, duration]);

  // ── Track play count / last-played + OS seek bar — coalesced 1Hz tick ──
  const playedCountedRef = useRef(false);
  useEffect(() => {
    playedCountedRef.current = false;
    startScrobbleWindow();
  }, [state.track?.Id, startScrobbleWindow]);

  useEffect(() => {
    const trackId = state.track?.Id;
    if (paused || !trackId || !duration || duration <= 0) return;

    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const pos = audio.currentTime;

      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setPositionState({
            duration,
            playbackRate: audio.playbackRate || 1,
            position: pos,
          });
        } catch {
          /* noop */
        }
      }

      if (!playedCountedRef.current && pos / duration >= 0.7) {
        playedCountedRef.current = true;
        ipcRenderer.send('track-played', { trackId });
      }

      // Last.fm's rule: tracks over 30s count at half their length or 4
      // minutes in, whichever comes first. ListenBrainz uses the same one.
      if (!scrobbledRef.current && duration > 30 && pos >= Math.min(duration / 2, 240)) {
        scrobbledRef.current = true;
        const meta = scrobbleMetaRef.current;
        if (meta) {
          ipcRenderer.send('scrobbler-scrobble', {
            ...meta,
            duration,
            timestamp: trackStartedAtRef.current,
          });
        }
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [paused, duration, state.track?.Id]);

  // ── Play/Pause overlay notify ──────────────────────────────────────────
  const prevPausedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!state.track?.Id) return;
    if (prevPausedRef.current === null) {
      prevPausedRef.current = paused;
      return;
    }
    if (prevPausedRef.current === paused) return;
    prevPausedRef.current = paused;
    if (!getOverlayEnabled()) return;
    ipcRenderer.send('now-playing-notify', {
      title: (state.track.Title as string) || '',
      artist: artistNames.join(', '),
      album: (state.track.AlbumTitle as string) || '',
      albumArt: (state.track.AlbumArt as string) || null,
      queueIndex: state.queueIndex,
      queueTotal: state.queue.length,
      status: paused ? 'paused' : 'playing',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // --- Media Session API ---
  // Title/artist/album are set synchronously so SMTC shows them the moment
  // the track changes; album art is fetched off the critical path and
  // patched in once it's ready (guarded so a slow load for a previous
  // track can't overwrite the current one).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const track = state.track;
    if (!track) {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        /* noop */
      }
      return;
    }

    const baseMeta = {
      title: (track.Title as string) || 'Unknown Title',
      artist: artistNames.length ? artistNames.join(', ') : 'Unknown Artist',
      album: (track.AlbumTitle as string) || 'Unknown Album',
    };
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ ...baseMeta, artwork: [] });
    } catch {
      /* noop */
    }

    if (!track.AlbumArt) return;

    const reqId = ++metadataReqRef.current;
    let cancelled = false;
    (async () => {
      try {
        const fileUrl = `file:///${(track.AlbumArt as string).replace(/\\/g, '/')}`;
        const response = await fetch(fileUrl);
        const blob = await response.blob();
        const base64 = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        if (cancelled || metadataReqRef.current !== reqId) return;
        navigator.mediaSession.metadata = new MediaMetadata({
          ...baseMeta,
          artwork: [{ src: base64 }],
        });
      } catch {
        /* artwork stays empty */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.track]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
  }, [paused]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => setPaused(false));
    navigator.mediaSession.setActionHandler('pause', () => setPaused(true));
    navigator.mediaSession.setActionHandler('stop', () => setPaused(true));
    navigator.mediaSession.setActionHandler('nexttrack', () => dispatch({ type: 'NEXT_TRACK' }));
    navigator.mediaSession.setActionHandler('previoustrack', () =>
      dispatch({ type: 'PREV_TRACK' })
    );
    const applySeek = (target: number) => {
      if (audioRef.current) audioRef.current.currentTime = target;
      if (castingRef.current) ipcRenderer.send('cast-control', { action: 'seek', value: target });
    };
    navigator.mediaSession.setActionHandler('seekto', details => {
      if (details.seekTime !== undefined) applySeek(details.seekTime);
    });
    navigator.mediaSession.setActionHandler('seekforward', details => {
      const skipTime = details.seekOffset || 10;
      if (audioRef.current) applySeek(Math.min(duration, audioRef.current.currentTime + skipTime));
    });
    navigator.mediaSession.setActionHandler('seekbackward', details => {
      const skipTime = details.seekOffset || 10;
      if (audioRef.current) applySeek(Math.max(0, audioRef.current.currentTime - skipTime));
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
  useEffect(() => {
    ipcRenderer.send('discord-set-enabled', { enabled: discordEnabled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendDiscordUpdate = useCallback(
    (pos: number) => {
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
    },
    [discordEnabled, state.track, paused, duration]
  );

  // Ref-stable callback for memoized children that need to call sendDiscordUpdate
  const sendDiscordUpdateRef = useRef(sendDiscordUpdate);
  sendDiscordUpdateRef.current = sendDiscordUpdate;
  const handleSeekCommit = useCallback((pos: number) => {
    if (castingRef.current) ipcRenderer.send('cast-control', { action: 'seek', value: pos });
    sendDiscordUpdateRef.current(pos);
  }, []);

  useEffect(() => {
    sendDiscordUpdate(audioRef.current?.currentTime ?? 0);
    // Title is a dep because a stream keeps one track id across songs.
  }, [state.track?.Id, state.track?.Title, paused, discordEnabled]);
  // ── End Discord Rich Presence sync ──────────────────────────────────

  // ── Thumbnail toolbar sync ──────────────────────────────────────────
  useEffect(() => {
    ipcRenderer.send('thumbar-update', { isPlaying: !paused });
  }, [paused]);

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

  const handleShuffle = useCallback(() => {
    dispatch({ type: 'SET_SHUFFLE', payload: !state.isShuffle });
  }, [dispatch, state.isShuffle]);

  const handleRepeat = useCallback(() => {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const currentIndex = modes.indexOf(state.repeatMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    dispatch({ type: 'SET_REPEAT_MODE', payload: nextMode });
  }, [dispatch, state.repeatMode]);

  const mainIconColor = theme.palette.text.primary;

  // ── Long-press skip buttons ───────────────────────────────────────────
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const longPressFiredRef = useRef(false);

  const handlePrevLongPressAction = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = Math.max(0, audio.currentTime - 15);
    audio.currentTime = target;
    if (castingRef.current) ipcRenderer.send('cast-control', { action: 'seek', value: target });
  }, []);

  const handleNextLongPressAction = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = Math.min(duration, audio.currentTime + 15);
    audio.currentTime = target;
    if (castingRef.current) ipcRenderer.send('cast-control', { action: 'seek', value: target });
  }, [duration]);

  const clearLongPress = useCallback((callback?: () => void) => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
    if (longPressInterval.current) {
      clearInterval(longPressInterval.current);
      longPressInterval.current = null;
    }
    if (callback) callback();
  }, []);

  const consumeClick = useCallback(
    (clickAction: () => void) => () => {
      const fired = longPressFiredRef.current;
      longPressFiredRef.current = false;
      clearLongPress(fired ? undefined : clickAction);
    },
    [clearLongPress]
  );

  const handlePrevPress = useCallback(() => {
    dispatch({ type: 'PREV_TRACK' });
  }, [dispatch]);

  const handleNextPress = useCallback(() => {
    dispatch({ type: 'NEXT_TRACK' });
  }, [dispatch]);

  const startPrevLongPress = useCallback(() => {
    longPressFiredRef.current = true;
    handlePrevLongPressAction();
    longPressInterval.current = setInterval(handlePrevLongPressAction, 500);
  }, [handlePrevLongPressAction]);

  const startNextLongPress = useCallback(() => {
    longPressFiredRef.current = true;
    handleNextLongPressAction();
    longPressInterval.current = setInterval(handleNextLongPressAction, 500);
  }, [handleNextLongPressAction]);

  const prevButtonEvents = React.useMemo(
    () => ({
      onMouseDown: () => {
        longPressFiredRef.current = false;
        longPressTimeout.current = setTimeout(startPrevLongPress, 500);
      },
      onMouseUp: consumeClick(handlePrevPress),
      onMouseLeave: () => {
        longPressFiredRef.current = false;
        clearLongPress();
      },
      onTouchStart: () => {
        longPressFiredRef.current = false;
        longPressTimeout.current = setTimeout(startPrevLongPress, 500);
      },
      onTouchEnd: consumeClick(handlePrevPress),
    }),
    [startPrevLongPress, consumeClick, handlePrevPress, clearLongPress]
  );

  const nextButtonEvents = React.useMemo(
    () => ({
      onMouseDown: () => {
        longPressFiredRef.current = false;
        longPressTimeout.current = setTimeout(startNextLongPress, 500);
      },
      onMouseUp: consumeClick(handleNextPress),
      onMouseLeave: () => {
        longPressFiredRef.current = false;
        clearLongPress();
      },
      onTouchStart: () => {
        longPressFiredRef.current = false;
        longPressTimeout.current = setTimeout(startNextLongPress, 500);
      },
      onTouchEnd: consumeClick(handleNextPress),
    }),
    [startNextLongPress, consumeClick, handleNextPress, clearLongPress]
  );

  // ── Stable handlers for memoized subtrees ─────────────────────────────
  const handleCoverClick = useCallback(() => {
    if (state.track?.AlbumArt) setPreviewOpen(true);
  }, [state.track?.AlbumArt]);

  const handleClosePreview = useCallback(() => setPreviewOpen(false), []);

  // ── Favourite toggle ──────────────────────────────────────────────────────
  // Files played via "Open with" are keyed by path, not by a library row, so
  // there is nothing to favourite.
  const trackId = state.track?.Id;
  // A radio song has no library row; bookmarking it flags its history entry
  // instead, which is also what keeps the entry past its expiry.
  const canFavourite = typeof trackId === 'number' || streamHistory != null;
  const [isFavourite, setIsFavourite] = useState(false);

  useEffect(() => {
    if (streamHistory) {
      setIsFavourite(streamHistory.saved);
      return;
    }
    if (!canFavourite) {
      setIsFavourite(false);
      return;
    }
    // Re-checked on library-updated so removing it from the Favourites screen
    // (or any other window) is reflected here.
    const check = () =>
      ipcRenderer
        .invoke('is-favourite', { trackId })
        .then((v: unknown) => setIsFavourite(!!v))
        .catch(() => undefined);
    check();
    ipcRenderer.on('library-updated', check);
    return () => {
      ipcRenderer.removeListener('library-updated', check);
    };
  }, [trackId, canFavourite, streamHistory]);

  const handleToggleFavourite = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canFavourite) return;
      if (streamHistory) {
        const next = !streamHistory.saved;
        await ipcRenderer.invoke('set-stream-track-saved', { id: streamHistory.id, saved: next });
        setStreamHistory({ ...streamHistory, saved: next });
        setIsFavourite(next);
        return;
      }
      const res = (await ipcRenderer.invoke('toggle-favourite', { trackId })) as {
        favourite?: boolean;
      };
      setIsFavourite(!!res?.favourite);
    },
    [trackId, canFavourite, streamHistory]
  );

  const handleTitleClick = useCallback(() => {
    if (!state.queueSource) return;
    navigate(state.queueSource, {
      state: { focusTrackId: state.track?.Id, _ts: Date.now() },
    });
  }, [navigate, state.queueSource, state.track?.Id]);

  const handleAlbumClick = useCallback(() => {
    const navPath =
      state.track?.AlbumId != null ? `/main_window/albums/${state.track.AlbumId}` : null;
    if (navPath) navigate(navPath);
  }, [navigate, state.track?.AlbumId]);

  const handleOpenSongInfo = useCallback(() => setSongInfoOpen(true), []);
  const handleOpenTagEditor = useCallback(() => {
    if (!state.track?.Id || !songPath) return;
    setEditTrack([{ Id: state.track.Id, Uri: songPath, Title: state.track.Title }]);
  }, [state.track?.Id, state.track?.Title, songPath]);
  const handleCloseSongInfo = useCallback(() => setSongInfoOpen(false), []);

  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuOpen = Boolean(menuAnchorEl) || Boolean(menuPosition);
  const [deviceMenuAnchorEl, setDeviceMenuAnchorEl] = useState<HTMLElement | null>(null);

  const handleOpenMenuButton = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setMenuPosition(null);
    setMenuAnchorEl(e.currentTarget);
  }, []);
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // to prevent event bubbling
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    setMenuAnchorEl(null);
    setMenuPosition({ top: e.clientY, left: e.clientX });
  }, []);
  const handleCloseMenu = useCallback(() => {
    setMenuAnchorEl(null);
    setMenuPosition(null);
    setDeviceMenuAnchorEl(null);
    setCastMenuAnchorEl(null);
  }, []);
  const runMenuAction = useCallback(
    (action: () => void) => () => {
      handleCloseMenu();
      action();
    },
    [handleCloseMenu]
  );
  const handleOpenDeviceMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => setDeviceMenuAnchorEl(e.currentTarget),
    []
  );

  const handleHidePlayBar = useCallback(
    () => dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: false }),
    [dispatch]
  );
  const togglePlay = useCallback(() => setPaused(prev => !prev), []);

  // ── Cast orchestration ─────────────────────────────────────────────────────
  // The device reports position ~1×/sec; these anchor a wall-clock interpolation
  // so the scrubber stays smooth between reports.
  const castPosRef = useRef(0);
  const castWallRef = useRef(0);
  const castPlayingRef = useRef(false);
  const anchorCastClock = useCallback((pos: number, playing: boolean) => {
    castPosRef.current = pos;
    castWallRef.current = Date.now();
    castPlayingRef.current = playing;
  }, []);

  // Latest-state closures so the once-subscribed IPC listeners never go stale.
  const sendCastLoadRef = useRef<(_autoplay: boolean, _startTime: number) => void>(() => undefined);
  sendCastLoadRef.current = (autoplay: boolean, startTime: number) => {
    const track = state.track;
    if (!track?.Uri) return;
    const next = state.queue[state.queueIndex + 1];
    const ext = String(track.Uri).split('.').pop()?.toUpperCase() ?? '';
    const payload: CastLoadPayload = {
      filePath: track.Uri as string,
      title: (track.Title as string) || 'Unknown Title',
      artist: artistNames.join(', ') || 'Unknown Artist',
      album: (track.AlbumTitle as string) || '',
      artPath: (track.AlbumArt as string) || null,
      currentTime: startTime,
      autoplay,
      customData: {
        nextTitle: next?.Title ?? null,
        queueIndex: state.queueIndex + 1,
        queueTotal: state.queue.length,
        formatText: ext,
      },
    };
    ipcRenderer.send('cast-load', payload);
    // Anchor now, or the bar sits at the previous track's position until the
    // first status arrives.
    anchorCastClock(startTime, autoplay);
  };

  // Mirrors the local onended queue logic, but drives the device.
  const castAdvanceRef = useRef<() => void>(() => undefined);
  castAdvanceRef.current = () => {
    if (!state.queue || state.queue.length === 0) return;
    if (state.repeatMode === 'one') {
      ipcRenderer.send('cast-control', { action: 'seek', value: 0 });
      ipcRenderer.send('cast-control', { action: 'play' });
    } else if (state.queueIndex < state.queue.length - 1 || state.repeatMode === 'all') {
      dispatch({ type: 'NEXT_TRACK' });
    } else {
      setPaused(true);
    }
  };

  const resumeLocalPlayback = useCallback(() => {
    setIsCasting(false);
    setCastDeviceId(null);
    setCastDeviceName(null);
    const localVol = getVolumeLevel();
    setVolume(localVol);
    if (localVol === 0) {
      setMuteVolume(true);
    } else {
      setMuteVolume(false);
      setLastVolume(localVol);
    }
    const audio = audioRef.current;
    if (audio) {
      const muted = localVol === 0;
      audio.muted = muted;
      audio.volume = muted ? 0 : localVol / 100;
      // Resume locally from wherever the device left the shared clock.
      if (!pausedRef.current) audio.play().catch(() => undefined);
    }
  }, []);

  const handleSelectCastDevice = useCallback((device: CastDevice) => {
    setCastDeviceId(device.id);
    setCastDeviceName(device.name);
    ipcRenderer.send('cast-connect', { deviceId: device.id });
  }, []);

  const handleStopCasting = useCallback(() => {
    ipcRenderer.send('cast-disconnect');
    resumeLocalPlayback();
  }, [resumeLocalPlayback]);

  useEffect(() => {
    dispatch({ type: 'SET_CASTING', payload: { isCasting, deviceName: castDeviceName } });
  }, [isCasting, castDeviceName, dispatch]);

  useEffect(() => {
    const handler = () => handleStopCasting();
    window.addEventListener(CAST_STOP_EVENT, handler);
    return () => window.removeEventListener(CAST_STOP_EVENT, handler);
  }, [handleStopCasting]);

  const handleOpenCastMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => setCastMenuAnchorEl(e.currentTarget),
    []
  );

  // Subscribe once; the handlers read fresh state through the refs above.
  useEffect(() => {
    const onConnected = () => {
      const audio = audioRef.current;
      // Hand off at the local position, then keep the element muted as the UI clock.
      const startAt = audio?.currentTime ?? 0;
      if (audio) {
        audio.pause();
        audio.muted = true;
        audio.volume = 0;
      }
      setIsCasting(true);
      // The volume-to-device effect pushes this once isCasting flips on.
      const castVol = castDeviceIdRef.current ? getCastVolumeLevel(castDeviceIdRef.current) : 10;
      setVolume(castVol);
      if (castVol === 0) {
        setMuteVolume(true);
      } else {
        setMuteVolume(false);
        setLastVolume(castVol);
      }
      sendCastLoadRef.current(!pausedRef.current, startAt);
    };
    const onStatus = (_e: unknown, s: CastStatus) => {
      if (s.duration && Number.isFinite(s.duration)) setDuration(s.duration);
      if (Number.isFinite(s.currentTime)) {
        anchorCastClock(s.currentTime, s.playerState === 'PLAYING');
      } else {
        castPlayingRef.current = s.playerState === 'PLAYING';
        castWallRef.current = Date.now();
      }
    };
    const onEnded = () => castAdvanceRef.current();
    const onError = (_e: unknown, payload: { message: string }) => {
      // cast-error also carries the non-fatal "falling back to the default
      // receiver" notice, so don't clear the pending device here; the indicator
      // would lose its name.
      console.warn('[cast]', payload?.message);
    };
    ipcRenderer.on('cast-connected', onConnected);
    ipcRenderer.on('cast-status', onStatus);
    ipcRenderer.on('cast-ended', onEnded);
    ipcRenderer.on('cast-error', onError);
    return () => {
      ipcRenderer.removeListener('cast-connected', onConnected);
      ipcRenderer.removeListener('cast-status', onStatus);
      ipcRenderer.removeListener('cast-ended', onEnded);
      ipcRenderer.removeListener('cast-error', onError);
    };
  }, []);

  // Track changes start at 0; connect-time resume is handled in onConnected.
  useEffect(() => {
    if (castingRef.current) sendCastLoadRef.current(!pausedRef.current, 0);
  }, [state.track?.Id]);

  // Writing to the muted element is what makes PlaybackProgress repaint; it
  // listens on timeupdate.
  useEffect(() => {
    if (!isCasting) return;
    const id = setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      let pos = castPosRef.current;
      if (castPlayingRef.current) pos += (Date.now() - castWallRef.current) / 1000;
      if (duration > 0) pos = Math.min(pos, duration);
      audio.currentTime = pos;
    }, 250);
    return () => clearInterval(id);
  }, [isCasting, duration]);

  useEffect(() => {
    if (isCasting) {
      ipcRenderer.send('cast-control', {
        action: 'setVolume',
        value: muteVolume ? 0 : volume / 100,
      });
    }
  }, [volume, muteVolume, isCasting]);

  if (!state?.track) return null;

  const trackTitle = (state.track.Title as string) || '';
  const trackArtist = (state.track.ArtistName as string) || '';
  const trackAlbum = (state.track.AlbumTitle as string) || 'Unknown Album';
  const navigable = !!state.queueSource;

  return (
    <PlayBarRoot isPhone={isPhone}>
      <PlayerCard
        container
        isPhone={isPhone}
        elevation={3}
        component={Card}
        onContextMenu={handleContextMenu}
      >
        <LyricsCollapse in={isLyricsExpanded} mountOnEnter unmountOnExit>
          <LyricsPanel
            audioRef={audioRef}
            lrcContent={lrcContent}
            lyricsType={lyricsType}
            lyricsSource={lyricsSource}
          />
        </LyricsCollapse>

        <Grid xs={12} md={5} lg={6}>
          <TrackInfoRow>
            <CoverImageInteractive hasArt={!!state.track.AlbumArt} onClick={handleCoverClick}>
              <Image
                src={albumArtSrc}
                className="no-select no-drag"
                showLoading
                style={AlbumArtImageStyle}
                fit="contain"
              />
              {canFavourite && (
                <FavouriteButton
                  size="medium"
                  isFavourite={isFavourite}
                  onClick={handleToggleFavourite}
                  // The red heart stays reserved for library favourites.
                  sx={streamHistory && isFavourite ? { color: 'primary.main' } : undefined}
                  aria-label={
                    streamHistory
                      ? isFavourite
                        ? 'remove bookmark'
                        : 'bookmark this song'
                      : isFavourite
                        ? 'remove from favourites'
                        : 'add to favourites'
                  }
                  title={
                    streamHistory
                      ? isFavourite
                        ? 'Remove bookmark'
                        : 'Bookmark this song'
                      : isFavourite
                        ? 'Remove from Favourites'
                        : 'Add to Favourites'
                  }
                >
                  <Icon
                    icon={
                      streamHistory
                        ? isFavourite
                          ? bookmark24Filled
                          : bookmark24Regular
                        : isFavourite
                          ? heart24Filled
                          : heart24Regular
                    }
                    width={25}
                  />
                </FavouriteButton>
              )}
            </CoverImageInteractive>
            <ImagePreviewDialog
              open={previewOpen}
              onClose={handleClosePreview}
              imageSrc={state.track.AlbumArt ? albumArtSrc : null}
              imageAlt={trackTitle}
            />
            <TrackTextWrap>
              {state.queue.length > 0 && (
                <QueueCounter>
                  {state.queueIndex + 1} / {state.queue.length}
                </QueueCounter>
              )}
              <Marquee text={trackTitle}>
                <TitleText
                  variant="h6"
                  component="h6"
                  navigable={navigable}
                  title={navigable ? `${trackTitle} — click to reveal in source` : trackTitle}
                  className="no-select no-drag"
                  onClick={handleTitleClick}
                >
                  <b>{trackTitle}</b>
                </TitleText>
              </Marquee>
              <Marquee text={trackArtist}>
                <ArtistsText
                  variant="body1"
                  color="text.secondary"
                  fontWeight={500}
                  lineHeight={1}
                  title={trackArtist}
                  className="no-select no-drag"
                >
                  {artistNames.length > 0
                    ? artistNames.map((name, index) => (
                        <React.Fragment key={`${name}-${index}`}>
                          <ArtistName component="span" onClick={() => handleArtistClick(name)}>
                            {name}
                          </ArtistName>
                          {index < artistNames.length - 1 && <Box component="span">•</Box>}
                        </React.Fragment>
                      ))
                    : 'Unknown Artist'}
                </ArtistsText>
              </Marquee>
              <Marquee text={trackAlbum}>
                <AlbumText
                  className="no-select no-drag"
                  fontWeight={400}
                  onClick={handleAlbumClick}
                  title={trackAlbum}
                >
                  {trackAlbum}
                </AlbumText>
              </Marquee>
            </TrackTextWrap>
          </TrackInfoRow>
        </Grid>

        <Grid justifyContent="center" alignContent="center" xs={12} md={5}>
          <ProgressColumn isPhone={isPhone}>
            <PlaybackProgress
              audioRef={audioRef}
              duration={duration}
              trackId={state.track.Id as string | number | null}
              isLive={isLive}
              isRemote={isRemote}
              paused={paused}
              onSeekCommit={handleSeekCommit}
            />
            <TransportRow>
              <ControlButton
                component={motion.div}
                whileTap={{ scale: 0.9 }}
                aria-label="previous song"
                {...prevButtonEvents}
              >
                <Icon
                  icon={fastForward32Filled}
                  width={25}
                  style={TransportIconStyle}
                  flip="horizontal"
                  color={mainIconColor}
                />
              </ControlButton>
              <ControlButton
                component={motion.div}
                whileTap={{ scale: 0.9 }}
                aria-label={paused ? 'play' : 'pause'}
                onClick={togglePlay}
              >
                {paused ? (
                  <Icon
                    icon={play32Filled}
                    width={35}
                    style={PlayPauseIconStyle}
                    color={mainIconColor}
                  />
                ) : (
                  <Icon
                    icon={pause32Filled}
                    style={PlayPauseIconStyle}
                    width={35}
                    color={mainIconColor}
                  />
                )}
              </ControlButton>
              <ControlButton
                component={motion.div}
                whileTap={{ scale: 0.9 }}
                aria-label="next song"
                {...nextButtonEvents}
              >
                <Icon
                  icon={fastForward32Filled}
                  style={TransportIconStyle}
                  width={25}
                  color={mainIconColor}
                />
              </ControlButton>
            </TransportRow>
            <VolumeStack spacing={2} direction="row" alignItems="center" isPhone={isPhone}>
              <IconButton size="small" onClick={handleMuteClick}>
                {volume === 0 || muteVolume ? (
                  <Icon icon={speakerMute32Filled} width={20} />
                ) : volume < 40 ? (
                  <Icon icon={speaker132Regular} width={20} />
                ) : (
                  <Icon icon={speaker232Regular} width={20} />
                )}
              </IconButton>
              <VolumeSlider
                onWheel={handleVolumeWheel}
                aria-label="Volume"
                value={muteVolume ? 0 : volume}
                min={0}
                max={100}
                onChange={handleVolumeChange}
              />
              <VolumeLabel className="no-select no-drag">{`${volume}%`}</VolumeLabel>
            </VolumeStack>
          </ProgressColumn>
        </Grid>

        <SideButtonsColumn
          xs={12}
          md={2}
          lg={1}
          alignContent="center"
          justifyContent="center"
          pr={0.5}
        >
          <SideButtonsRow container>
            <Grid xs={6}>
              <FadedIconButton
                onClick={handleShuffle}
                disabled={isLive}
                active={state.isShuffle && !isLive}
                title={
                  isLive
                    ? 'Shuffle unavailable on a stream'
                    : state.isShuffle
                      ? 'Shuffle: On'
                      : 'Shuffle: Off'
                }
                aria-label="shuffle"
              >
                {state.isShuffle ? (
                  <Icon icon={shuffle24Filled} width={22} />
                ) : (
                  <Icon icon={shuffleInactive24Filled} width={22} />
                )}
              </FadedIconButton>
            </Grid>
            <Grid xs={6}>
              <FadedIconButton
                onClick={handleRepeat}
                disabled={isLive}
                active={state.repeatMode !== 'off' && !isLive}
                title={
                  isLive
                    ? 'Repeat unavailable on a stream'
                    : state.repeatMode === 'off'
                      ? 'Repeat: Off'
                      : state.repeatMode === 'all'
                        ? 'Repeat: All'
                        : 'Repeat: One'
                }
                aria-label="repeat"
              >
                {state.repeatMode === 'off' ? (
                  <Icon icon={repeatOff24Filled} width={22} />
                ) : state.repeatMode === 'all' ? (
                  <Icon icon={repeatAll24Filled} width={22} />
                ) : (
                  <Icon icon={repeatOne24Filled} width={22} />
                )}
              </FadedIconButton>
            </Grid>
          </SideButtonsRow>
          <SideButtonsRow container>
            <Grid xs={6}>
              <DiscordIconButton
                onClick={handleDiscordToggle}
                aria-label="discord presence"
                title={discordEnabled ? 'Discord Presence: On' : 'Discord Presence: Off'}
                enabled={discordEnabled}
              >
                <DiscordIcon viewBox="0 0 24 24" className="icon-themed" width={22} height={22} />
              </DiscordIconButton>
            </Grid>
            <Grid xs={6}>
              <FadedIconButton
                onClick={handleLyricsToggle}
                aria-label="lyrics"
                disabled={!lrcContent}
                active={!!lrcContent}
                title={isLyricsExpanded ? 'Close Lyrics' : 'Show Lyrics'}
              >
                {isLyricsExpanded ? (
                  <LyricNoteActiveIcon
                    viewBox="0 0 16 17"
                    className="icon-themed"
                    width={22}
                    height={22}
                  />
                ) : (
                  <LyricNoteIcon
                    viewBox="0 0 16 17"
                    className="icon-themed"
                    width={22}
                    height={22}
                  />
                )}
              </FadedIconButton>
            </Grid>
          </SideButtonsRow>
          <SideButtonsRow container>
            <Grid xs={6}>
              <IconButton
                onClick={handleOpenMenuButton}
                aria-label="track menu"
                title="More"
                disabled={!state.track}
              >
                <Icon
                  icon={menuOpen ? moreHorizontal24Filled : moreHorizontal24Regular}
                  width={22}
                />
              </IconButton>
            </Grid>
            <Grid xs={6}>
              <IconButton
                onClick={handleHidePlayBar}
                aria-label="hide player bar"
                title="Hide player bar"
              >
                <Icon icon={arrowCircleDown24Filled} width={22} />
              </IconButton>
            </Grid>
          </SideButtonsRow>
        </SideButtonsColumn>
      </PlayerCard>
      <SongInfoDialog
        open={songInfoOpen}
        onClose={handleCloseSongInfo}
        track={state.track}
        songPath={songPath}
      />
      {editTrack && (
        <TagEditorDialog open onClose={() => setEditTrack(null)} mode="track" tracks={editTrack} />
      )}
      <Menu
        open={menuOpen}
        onClose={handleCloseMenu}
        anchorReference={menuPosition ? 'anchorPosition' : 'anchorEl'}
        anchorEl={menuAnchorEl}
        anchorPosition={menuPosition ?? undefined}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <MenuItem onClick={runMenuAction(handleOpenSongInfo)} disabled={isLive}>
          <ListItemIcon>
            <Icon icon={info24Regular} width={20} />
          </ListItemIcon>
          <ListItemText>Properties</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={runMenuAction(handleOpenTagEditor)}
          disabled={isRemote || !songPath || !isTaggable(songPath)}
        >
          <ListItemIcon>
            <Icon icon={edit24Regular} width={20} />
          </ListItemIcon>
          <ListItemText>Edit tags</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleCloseMenu} disabled>
          <ListItemIcon>
            <Icon icon={options24Regular} width={20} />
          </ListItemIcon>
          <ListItemText>Equalizer</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleCloseMenu} disabled>
          <ListItemIcon>
            <Icon icon={topSpeed24Regular} width={20} />
          </ListItemIcon>
          <ListItemText>Tempo</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleOpenDeviceMenu}>
          <ListItemIcon>
            <Icon icon={speaker224Regular} width={20} />
          </ListItemIcon>
          <ListItemText>Audio output</ListItemText>
          <Icon icon={chevronRight20Regular} width={18} style={{ marginLeft: 8, opacity: 0.6 }} />
        </MenuItem>
        <MenuItem onClick={handleOpenCastMenu}>
          <ListItemIcon>
            <Icon icon={cast24Regular} width={20} />
          </ListItemIcon>
          <ListItemText>
            {isCasting && castDeviceName ? `Casting to ${castDeviceName}` : 'Cast to device'}
          </ListItemText>
          <Icon icon={chevronRight20Regular} width={18} style={{ marginLeft: 8, opacity: 0.6 }} />
        </MenuItem>
      </Menu>
      <AudioOutputMenu
        anchorEl={deviceMenuAnchorEl}
        open={Boolean(deviceMenuAnchorEl)}
        onClose={handleCloseMenu}
      />
      <CastDeviceMenu
        anchorEl={castMenuAnchorEl}
        open={Boolean(castMenuAnchorEl)}
        onClose={handleCloseMenu}
        onSelect={handleSelectCastDevice}
        onStopCasting={handleStopCasting}
        connectedDeviceId={isCasting ? castDeviceId : null}
      />
      <audio ref={audioRef} style={AudioElementStyle} />
      {/* SMTC keepalive — see silentSrc useMemo. */}
      <audio
        ref={silentAudioRef}
        src={silentSrc}
        loop
        preload="auto"
        style={AudioElementStyle}
        aria-hidden
      />
    </PlayBarRoot>
  );
}
