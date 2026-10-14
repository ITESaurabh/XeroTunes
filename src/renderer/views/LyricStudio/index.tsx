import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Snackbar,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  styled,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '@iconify/react';
import editIcon from '@iconify/icons-fluent/slide-text-edit-24-regular';
import syncIcon from '@iconify/icons-fluent/music-note-2-24-regular';
import saveIcon from '@iconify/icons-fluent/save-24-regular';
import TipsRail from './TipsRail';
import Editor from './Editor';
import SyncStudio from './SyncStudio';
import SaveDialog, { type SaveTarget } from './SaveDialog';
import PlaybackProgress from '../../components/PlaybackProgress';
import AppDrawer, { DRAWER_WIDTH } from '../../components/AppDrawer';
import MuiDrawer from '@mui/material/Drawer';
import {
  clearFrom,
  nextStampAfter,
  parseLrc,
  splitEndMark,
  reconcile,
  stamp,
  stampAtOrBefore,
  toLrc,
  toText,
  type Line,
} from '../../utils/lrc';
import { resolveLyrics, sidecarPathFor, type LyricsSource } from '../../utils/lyricsSource';
import { useIpc } from '../../state/ipc';
import { useKeyboardShortcuts, type KeyboardShortcut } from '../../utils/useKeyboardShortcuts';
import { useConfirm } from '../../utils/useConfirm';
import { setNavGuard } from '../../utils/navGuard';
import { getVolumeLevel, setVolumeLevel } from '../../utils/LocStoreUtil';
import { toMediaSrc } from '../../utils/misc';
import { isTaggable } from '../../../config/constants';
import { store, type Track } from '../../utils/store';

const TITLEBAR_H = 32;

const SEEK_STEP = 5;

/** PlaybackProgress already moves the playhead; this hook is for cast and Discord,
 *  which the studio does not drive. */
const noop = () => undefined;

/**
 * A sidecar and embedded tags can both hold lyrics for one track and the
 * resolver silently prefers the sidecar, so the studio says which it opened.
 */
const SOURCE_LABEL: Record<LyricsSource, string> = {
  'LRC file': 'Source: .lrc',
  Embedded: 'Source: Embedded',
  Server: 'Source: Server',
};

// Padding, not margin: a top margin here collapses through the ancestor chain
// and the studio ends up underneath the fixed title bar.
const Root = styled(motion.div)(({ theme }) => ({
  display: 'flex',
  height: '100vh',
  paddingTop: TITLEBAR_H,
  boxSizing: 'border-box',
  backgroundColor: theme.palette.background.default,
}));

const Main = styled(Stack)(({ theme }) => ({
  flex: 1,
  minWidth: 0,
  paddingRight: 10,
  gap: 8,
  [theme.breakpoints.down('md')]: {
    paddingInline: 10,
  },
}));

const TabPill = styled(ToggleButtonGroup)(({ theme }) => ({
  alignSelf: 'center',
  padding: 4,
  borderRadius: 99,
  backgroundColor: theme.palette.surfaces.elevated,
  '& .MuiToggleButton-root': {
    border: 'none',
    borderRadius: '99px !important',
    padding: '8px 20px',
    gap: 8,
    textTransform: 'none',
    fontSize: '0.95rem',
    color: theme.palette.text.primary,
    '&.Mui-selected': {
      backgroundColor: theme.palette.primary.main,
      color: theme.palette.primary.contrastText,
      '&:hover': { backgroundColor: theme.palette.primary.main },
    },
  },
}));

const Centered = styled(motion.div)({
  display: 'flex',
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
});

/** The rail and the editor together, so they crossfade in as one thing. */
const Body = styled(motion.div)({
  display: 'flex',
  flex: 1,
  minWidth: 0,
});

const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.12 },
};

type Tab = 'edit' | 'sync';

export default function LyricStudio() {
  const { trackId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isPhone = useMediaQuery(({ breakpoints }: Theme) => breakpoints.down('md'));
  const { state, dispatch } = useContext(store);
  const confirm = useConfirm();
  const { invokeEventToMainProcess } = useIpc();

  const [track, setTrack] = useState<Track | null>(null);
  const [loading, setLoading] = useState(true);

  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<Tab>('edit');
  // -1 is the '…' marker above the first line, `lines.length` the one below it.
  // The studio opens on the first, so no lyric is highlighted until the user
  // actually starts.
  const [cursor, setCursor] = useState(-1);
  /** When the last line stops. Null until it has been marked. */
  const [endMs, setEndMs] = useState<number | null>(null);
  /** What was on disk when the studio opened, so exiting knows if work is at risk. */
  const [savedLrc, setSavedLrc] = useState('');
  /** Null when the track had no lyrics anywhere. */
  const [source, setSource] = useState<LyricsSource | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  // 0-100, the scale the play bar's volume control uses. Seeded from, and
  // written back to, the same setting, so the studio is not its own island.
  // Casting is a play-bar concern, so this only ever touches the device level.
  const [volume, setVolume] = useState(getVolumeLevel);

  const handleVolume = useCallback((val: number) => {
    setVolume(val);
    setVolumeLevel(val);
  }, []);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const uri = track?.Uri as string | undefined;

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!trackId) return;
    let cancelled = false;
    (async () => {
      const rows = (await invokeEventToMainProcess('get-queue-tracks', {
        trackIds: [trackId],
      })) as Track[];
      const row = rows?.[0] ?? null;
      if (cancelled) return;
      setTrack(row);

      if (row?.Uri) {
        const found = await resolveLyrics(row.Uri as string, row.Id);
        if (cancelled) return;
        const parsed = splitEndMark(found ? parseLrc(found.content) : []);
        setSource(found?.source ?? null);
        setLines(parsed.lines);
        setEndMs(parsed.endMs);
        setDraft(toText(parsed.lines));
        setSavedLrc(toLrc(parsed.lines, parsed.endMs));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId, invokeEventToMainProcess]);

  // ── Playback ─────────────────────────────────────────────────────────────
  // The studio owns this element. Entering the route unmounted the play bar, so
  // there is no other audio to fight with.
  //
  // `src` is a JSX prop rather than an effect on [uri]: the track arrives one
  // render before `loading` clears, and that render still shows the spinner with
  // no <audio> mounted. An effect would fire there against a null ref and never
  // run again, leaving the element with no source.

  // `loading` is a dep for the same reason: the element does not exist yet on
  // the render where the volume is first known.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume, loading]);

  /**
   * The desktop rail is `permanent` and ignores this flag, so here it only ever
   * means "the phone sheet is showing", and it starts closed.
   *
   * Not `!isPhone`, which is what the library layout uses. That leaves the flag
   * true on desktop, so shrinking the window mounts the phone sheet already
   * open and this effect closes it on the very next tick. MUI's Modal only
   * unmounts once the exit transition has finished, and a flip that fast never
   * finishes it: the modal stays in the DOM without `visibility: hidden` and
   * swallows every click in the window.
   */
  useEffect(() => {
    dispatch({ type: 'SET_MENU_EXPANDED', payload: false });
  }, [isPhone, dispatch]);

  /** A preview owns the transport until something else asks for it. */
  const previewRaf = useRef<number | null>(null);
  const stopPreview = useCallback(() => {
    if (previewRaf.current == null) return;
    cancelAnimationFrame(previewRaf.current);
    previewRaf.current = null;
  }, []);
  useEffect(() => stopPreview, [stopPreview]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    stopPreview();
    if (audio.paused) audio.play().catch(() => undefined);
    else audio.pause();
  }, [stopPreview]);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds);
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      seekTo(Math.min(audio.duration || Infinity, audio.currentTime + delta));
    },
    [seekTo]
  );

  // ── Tabs ─────────────────────────────────────────────────────────────────
  /**
   * The editor holds plain text, which carries no timings, so leaving it has to
   * merge rather than re-parse. reconcile() is what keeps a stamped line's time
   * when lines above it were split or deleted.
   */
  const currentLines = useCallback(
    () => (tab === 'edit' ? reconcile(lines, draft) : lines),
    [tab, lines, draft]
  );

  /**
   * There is nothing to time until some words exist. Read from the draft while
   * the editor owns them, since `lines` only catches up when the tab changes.
   */
  const hasLyrics = (tab === 'edit' ? draft : toText(lines)).trim() !== '';

  const switchTab = useCallback(
    (next: Tab | null) => {
      if (!next || next === tab) return;
      if (next === 'sync' && !hasLyrics) return;
      if (tab === 'edit') {
        const merged = reconcile(lines, draft);
        setLines(merged);
        setCursor(c => (c < 0 ? -1 : Math.min(c, merged.length)));
      } else {
        setDraft(toText(lines));
      }
      setTab(next);
    },
    [tab, lines, draft, hasLyrics]
  );

  // ── Sync ─────────────────────────────────────────────────────────────────
  /**
   * The cursor sits on the line being sung, which is therefore already stamped.
   * A press means "the next line starts now": it advances, and the line moved
   * onto takes the current time.
   *
   * Stamping the outgoing line instead is the tempting reading and it is wrong:
   * it writes the incoming line's start onto the one before it, so every mark
   * ends up a line early and a rewind replays the wrong line.
   *
   * From the '…' marker the line starting is the first one, so the same press
   * stamps it and lands there.
   */
  const stampCursor = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !lines.length) return;
    stopPreview();
    const next = Math.min(cursor + 1, lines.length);
    // Past the last line the press marks where the lyrics stop rather than where
    // one starts.
    if (next === lines.length) setEndMs(Math.max(0, Math.round(audio.currentTime * 1000)));
    else setLines(prev => stamp(prev, next, audio.currentTime * 1000));
    setCursor(next);
  }, [cursor, lines.length, stopPreview]);

  /**
   * Overshot a line: step back and rewind to where that line was marked, so the
   * next stamp replaces it in context rather than guessing.
   */
  const rewindToPrevious = useCallback(() => {
    stopPreview();
    const target = Math.max(-1, cursor - 1);
    setCursor(target);
    // Land on the line stepped back to and play it from its own mark, which
    // stays: it is the line about to be sung again. Everything after it is being
    // redone, so those marks go.
    seekTo(stampAtOrBefore(lines, target) / 1000);
    setLines(prev => clearFrom(prev, target + 1));
    // The end mark sits after every line, so stepping back always invalidates it.
    setEndMs(null);
  }, [cursor, lines, seekTo, stopPreview]);

  /**
   * Play one line and stop where the next begins, so the preview answers "is
   * this line timed right?" rather than running on into the following one.
   *
   * Polled on a frame rather than `timeupdate`, which only fires about four
   * times a second and would let a quarter of the next line through.
   */
  const previewFrom = useCallback(
    (index: number) => {
      const audio = audioRef.current;
      const at = lines[index]?.timeMs;
      if (!audio || at == null) return;
      stopPreview();
      setCursor(index);
      seekTo(at / 1000);
      audio.play().catch(() => undefined);

      const until = nextStampAfter(lines, index, endMs);
      // Nothing marked after this line, or marked before it: just play on.
      if (until == null || until <= at) return;
      const untilSec = until / 1000;
      const tick = () => {
        const el = audioRef.current;
        if (!el || el.paused) {
          previewRaf.current = null;
          return;
        }
        if (el.currentTime >= untilSec) {
          el.pause();
          previewRaf.current = null;
          return;
        }
        previewRaf.current = requestAnimationFrame(tick);
      };
      previewRaf.current = requestAnimationFrame(tick);
    },
    [lines, endMs, seekTo, stopPreview]
  );

  const setStamp = useCallback((index: number, timeMs: number | null) => {
    setLines(prev => stamp(prev, index, timeMs));
  }, []);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const shortcuts = useMemo<KeyboardShortcut[]>(() => {
    if (tab === 'sync') {
      return [
        { key: ' ', action: togglePlay, description: 'Play / pause' },
        { key: 'ArrowDown', action: stampCursor, description: 'Stamp this line, then advance' },
        { key: 'ArrowUp', action: rewindToPrevious, description: 'Back a line and rewind to it' },
      ];
    }
    // The editor tab is one big textarea and this hook preventDefaults whatever
    // it matches, so bare Space and arrows here would make it untypable.
    return [
      { key: ' ', ctrl: true, action: togglePlay, description: 'Play / pause' },
      { key: 'ArrowLeft', ctrl: true, action: () => seekBy(-SEEK_STEP), description: 'Back 5s' },
      {
        key: 'ArrowRight',
        ctrl: true,
        action: () => seekBy(SEEK_STEP),
        description: 'Forward 5s',
      },
    ];
  }, [tab, togglePlay, stampCursor, rewindToPrevious, seekBy]);

  // The dialog owns the keyboard while it is up. Unbinding rather than filtering
  // the list itself keeps the rail's legend showing what the tab's keys do.
  useKeyboardShortcuts(useMemo(() => (saveOpen ? [] : shortcuts), [saveOpen, shortcuts]));

  // ── Save / exit ──────────────────────────────────────────────────────────
  /**
   * Deliberately not `toLrc(currentLines())`: that runs the reconcile diff on
   * every keystroke. These two O(n) comparisons cover the same ground, stamps
   * changed in the sync tab and text typed in the editor but not yet merged.
   */
  const dirty = toLrc(lines, endMs) !== savedLrc || (tab === 'edit' && draft !== toText(lines));

  const handleSave = useCallback(
    async (target: SaveTarget) => {
      if (!uri || !track) return;
      const merged = currentLines();
      const lrc = toLrc(merged, endMs);
      setSaving(true);
      try {
        if (target === 'sidecar') {
          const fs = window.require('fs') as typeof import('fs');
          fs.writeFileSync(sidecarPathFor(uri), lrc, 'utf8');
          setToast({ ok: true, msg: 'Lyrics saved beside the track.' });
        } else {
          const res = (await invokeEventToMainProcess('write-track-tags', {
            trackIds: [track.Id],
            fields: { lyrics: lrc },
          })) as { success?: boolean; failed?: { error: string }[] } | undefined;
          if (res?.success) {
            setToast({ ok: true, msg: 'Lyrics embedded in the file.' });
          } else {
            setToast({ ok: false, msg: res?.failed?.[0]?.error ?? 'Could not write the tags.' });
            return;
          }
        }
        setLines(merged);
        // Trimming means the merged text can differ from what was typed; without
        // this the Save button stays lit on a file that is already saved.
        setDraft(toText(merged));
        setSavedLrc(lrc);
        setSource(target === 'sidecar' ? 'LRC file' : 'Embedded');
        setSaveOpen(false);
      } catch (err) {
        setToast({ ok: false, msg: err instanceof Error ? err.message : String(err) });
      } finally {
        setSaving(false);
      }
    },
    [uri, track, currentLines, endMs, invokeEventToMainProcess]
  );

  /**
   * Every way out runs through here: the Exit button directly, and the title
   * bar's back button through the nav guard. Registered rather than checked at
   * each exit, so a new way out cannot quietly skip it.
   */
  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: 'Leave Lyric Studio',
      message: 'Discard unsaved lyrics?',
      detail: 'The changes you made since the last save will be lost.',
      confirmLabel: 'Discard',
      destructive: true,
    });
  }, [dirty, confirm]);

  useEffect(() => setNavGuard(confirmDiscard), [confirmDiscard]);

  const handleExit = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    // A reload lands here with no history to pop, which would strand the studio.
    if (window.history.length > 1) navigate(-1);
    else navigate('/main_window');
  }, [confirmDiscard, navigate]);

  // ── Render ───────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (loading) {
    body = (
      <Centered key="loading" {...FADE}>
        <CircularProgress />
      </Centered>
    );
  } else if (!track || !uri) {
    body = (
      <Centered key="missing" {...FADE}>
        <Stack alignItems="center" gap={2}>
          <Typography variant="h6">That track is no longer in the library.</Typography>
          <Button variant="contained" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </Stack>
      </Centered>
    );
  } else {
    // Built here, not above: `track` is only non-null down this branch.
    const rail = (
      <TipsRail
        title={(track.Title as string) || 'Unknown title'}
        artist={(track.ArtistName as string) || ''}
        album={(track.AlbumTitle as string) || ''}
        artPath={(track.AlbumArt as string) || null}
        playing={playing}
        volume={volume}
        shortcuts={shortcuts}
        onExit={handleExit}
        onTogglePlay={togglePlay}
        onSeekBy={seekBy}
        onVolume={handleVolume}
      />
    );

    body = (
      <Body key="studio" {...FADE}>
        {/* A phone gets the same plain sheet the title bar's menu uses elsewhere.
            AppDrawer's paper is `position: relative`, which is right for the
            permanent rail and stops the modal variant rendering at all. */}
        {isPhone ? (
          <MuiDrawer
            open={state.isMenuExpanded}
            onClose={() => dispatch({ type: 'SET_MENU_EXPANDED', payload: false })}
            PaperProps={{
              style: {
                paddingTop: TITLEBAR_H,
                width: '100%',
                maxWidth: DRAWER_WIDTH,
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? theme.palette.surfaces.control
                    : theme.palette.background.paper,
                overflow: 'hidden',
                borderRight: 'none',
              },
            }}
          >
            {rail}
          </MuiDrawer>
        ) : (
          <AppDrawer
            variant="permanent"
            open
            sx={{
              height: '100%',
              '&::-webkit-scrollbar': { display: 'none' },
              msOverflowStyle: 'none',
            }}
            PaperProps={{ style: { backgroundColor: 'transparent', borderRight: 'none' } }}
          >
            {rail}
          </AppDrawer>
        )}

        <Main>
          <Stack direction="row" alignItems="center">
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: {
                  xs: 'none',
                  sm: 'inherit',
                },
              }}
            >
              <Typography variant="body2" noWrap sx={{ opacity: 0.6, pl: 1 }}>
                {source ? SOURCE_LABEL[source] : 'No lyrics found for this track yet'}
              </Typography>
            </Box>
            <TabPill exclusive value={tab} onChange={(_e, next: Tab | null) => switchTab(next)}>
              <ToggleButton value="edit">
                <Icon icon={editIcon} height="1.2em" />
                Lyrics Editor
              </ToggleButton>
              <ToggleButton
                value="sync"
                disabled={!hasLyrics}
                title={hasLyrics ? undefined : 'Write some lyrics before syncing them'}
              >
                <Icon icon={syncIcon} height="1.2em" />
                Sync Studio
              </ToggleButton>
            </TabPill>
            <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                disabled={!dirty}
                onClick={() => setSaveOpen(true)}
                startIcon={<Icon icon={saveIcon} height="1.2em" />}
              >
                Save
              </Button>
            </Box>
          </Stack>

          {tab === 'edit' ? (
            <Editor value={draft} onChange={setDraft} />
          ) : (
            <SyncStudio
              lines={lines}
              cursor={cursor}
              endMs={endMs}
              onCursor={setCursor}
              onStamp={setStamp}
              onEndStamp={at => setEndMs(at == null ? null : Math.max(0, Math.round(at)))}
              onPreviewFrom={previewFrom}
              onPrevious={rewindToPrevious}
              onNext={stampCursor}
            />
          )}

          <Box sx={{ px: 1, pb: 1 }}>
            <PlaybackProgress
              audioRef={audioRef}
              duration={duration}
              trackId={track.Id as string | number}
              paused={!playing}
              inline
              onSeekCommit={noop}
            />
          </Box>
        </Main>

        <audio
          ref={audioRef}
          src={toMediaSrc(uri)}
          preload="auto"
          onError={() => setToast({ ok: false, msg: `Could not play this file: ${uri}` })}
          // A container with no duration header reports Infinity, which would make
          // the scrubber unseekable and print "Infinity" as the length.
          onLoadedMetadata={e =>
            setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)
          }
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />

        <SaveDialog
          open={saveOpen}
          sidecarPath={sidecarPathFor(uri)}
          canEmbed={isTaggable(uri)}
          saving={saving}
          onClose={() => setSaveOpen(false)}
          onSave={handleSave}
        />

        <Snackbar
          open={!!toast}
          autoHideDuration={5000}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            severity={toast?.ok ? 'success' : 'error'}
            variant="filled"
            onClose={() => setToast(null)}
          >
            {toast?.msg}
          </Alert>
        </Snackbar>
      </Body>
    );
  }

  return (
    <Root
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <AnimatePresence mode="wait">{body}</AnimatePresence>
    </Root>
  );
}
