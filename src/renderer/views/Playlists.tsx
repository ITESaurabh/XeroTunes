import React, { useContext, useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  Grid,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import moreVerticalIcon from '@iconify/icons-fluent/more-vertical-24-regular';
import addIcon from '@iconify/icons-fluent/add-24-regular';
import arrowImportIcon from '@iconify/icons-fluent/arrow-import-24-regular';
import playlistIcon from '@iconify/icons-fluent/navigation-play-20-regular';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import PageToolbar from '../components/PageToolbar';
import AppDialog from '../components/AppDialog';
import CardHoverAction from '../components/CardHoverAction';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useConfirm } from '../utils/useConfirm';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { artPlaceholderSx, CARD_HOVER_CLASS, gridCardSx } from '../styles/listSx';
import { DEFAULT_AA } from '../../config/constants';

interface PlaylistRow {
  Id: number;
  Name: string;
  TrackCount: number;
  Duration: number | null;
  CoverUri: string | null;
}

const PLAYLIST_FORMATS = [
  { format: 'm3u8', label: 'M3U8 (.m3u8)' },
  { format: 'm3u', label: 'M3U (.m3u)' },
  { format: 'pls', label: 'PLS (.pls)' },
  { format: 'xspf', label: 'XSPF (.xspf)' },
];

function formatDuration(totalSeconds: number | null): string {
  if (!totalSeconds) return '0 min';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function coverSrc(uri: string | null): string {
  if (!uri) return DEFAULT_AA;
  return uri.startsWith('file://') ? uri : `file:///${uri.replace(/\\/g, '/')}`;
}

interface CardMenuProps {
  playlist: PlaylistRow;
  onRename: (_playlist: PlaylistRow) => void;
  onDelete: (_playlist: PlaylistRow) => void;
  onExport: (_playlist: PlaylistRow, _format: string) => void;
}

// MUI's Menu portals to document.body, but React still bubbles its clicks
// through the component tree, so a click on the menu (or its backdrop on
// close) would otherwise reach the card's onClick={navigate} underneath.
// Same fix ArtistCell.tsx already needed for its own menu.
const stopEventPropagation = (event: unknown): void => {
  (event as { stopPropagation?: () => void } | null)?.stopPropagation?.();
};

const CardMenu: React.FC<CardMenuProps> = ({ playlist, onRename, onDelete, onExport }) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [exportAnchorEl, setExportAnchorEl] = useState<HTMLElement | null>(null);

  return (
    <>
      <IconButton
        size="small"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          setAnchorEl(e.currentTarget);
        }}
        sx={{ color: 'text.secondary' }}
      >
        <Icon icon={moreVerticalIcon} width={18} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={event => {
          stopEventPropagation(event);
          setAnchorEl(null);
        }}
      >
        <MenuItem
          onClick={e => {
            e.stopPropagation();
            setAnchorEl(null);
            onRename(playlist);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={e => {
            e.stopPropagation();
            setExportAnchorEl(e.currentTarget);
          }}
        >
          Export…
        </MenuItem>
        <MenuItem
          onClick={e => {
            e.stopPropagation();
            setAnchorEl(null);
            onDelete(playlist);
          }}
          sx={{ color: 'error.main' }}
        >
          Delete
        </MenuItem>
      </Menu>
      <Menu
        anchorEl={exportAnchorEl}
        open={Boolean(exportAnchorEl)}
        onClose={event => {
          stopEventPropagation(event);
          setExportAnchorEl(null);
          setAnchorEl(null);
        }}
      >
        {PLAYLIST_FORMATS.map(({ format, label }) => (
          <MenuItem
            key={format}
            onClick={e => {
              e.stopPropagation();
              setExportAnchorEl(null);
              setAnchorEl(null);
              onExport(playlist, format);
            }}
          >
            {label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

const Playlists: React.FC = () => {
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch } = useContext(store);
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const scrollHide = useScrollHidePlayerBar<{ scrollTop: number }>({ field: 'scrollTop' });

  const {
    data: playlists = [] as PlaylistRow[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.PLAYLISTS],
    queryFn: () => invokeEventToMainProcess('get-playlists', undefined) as Promise<PlaylistRow[]>,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PLAYLISTS] }),
    [queryClient]
  );

  // The list view only has aggregate metadata, not tracks, so fetch on
  // demand rather than requiring the playlist to be opened first.
  const handlePlayPlaylist = useCallback(
    async (playlist: PlaylistRow) => {
      const tracks = (await invokeEventToMainProcess('get-playlist-tracks', {
        playlistId: playlist.Id,
      })) as Track[];
      if (!tracks.length) return;
      dispatch({
        type: 'SET_QUEUE',
        payload: { queue: tracks, index: 0, source: location.pathname },
      });
      dispatch({ type: 'SET_CURR_TRACK', payload: tracks[0] });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    },
    [invokeEventToMainProcess, dispatch, location.pathname]
  );

  // ── Create ─────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const handleCreate = useCallback(async () => {
    const res = (await invokeEventToMainProcess('create-playlist', { name: newName })) as {
      id: number;
    };
    setCreateOpen(false);
    setNewName('');
    await refresh();
    if (res?.id != null) navigate(`/main_window/playlists/${res.id}`);
  }, [invokeEventToMainProcess, newName, refresh, navigate]);

  // ── Rename ─────────────────────────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<PlaylistRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const handleRename = useCallback(async () => {
    if (!renameTarget) return;
    await invokeEventToMainProcess('rename-playlist', {
      playlistId: renameTarget.Id,
      name: renameValue,
    });
    setRenameTarget(null);
    await refresh();
  }, [invokeEventToMainProcess, renameTarget, renameValue, refresh]);

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (playlist: PlaylistRow) => {
      const ok = await confirm({
        title: 'Delete Playlist',
        message: `Delete "${playlist.Name}"?`,
        detail: 'The songs stay in your library; only the playlist is removed.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      await invokeEventToMainProcess('delete-playlist', { playlistId: playlist.Id });
      await refresh();
    },
    [confirm, invokeEventToMainProcess, refresh]
  );

  // ── Import / Export ────────────────────────────────────────────────────
  const [report, setReport] = useState<{ success: boolean; message: string } | null>(null);

  const handleImport = useCallback(async () => {
    const res = (await invokeEventToMainProcess('import-playlist', undefined)) as {
      success?: boolean;
      canceled?: boolean;
      error?: string;
      name?: string;
      imported?: number;
      external?: number;
      missing?: Array<{ location: string }>;
    };
    if (res?.canceled) return;
    if (!res?.success) {
      setReport({ success: false, message: res?.error || 'Import failed' });
      return;
    }
    await refresh();
    setReport({
      success: true,
      message: `Imported "${res.name}" — ${res.imported} song${res.imported === 1 ? '' : 's'}${
        res.external ? ` (${res.external} played directly from disk, not in your library)` : ''
      }${res.missing?.length ? `, ${res.missing.length} file${res.missing.length === 1 ? '' : 's'} could not be found` : ''}.`,
    });
  }, [invokeEventToMainProcess, refresh]);

  const handleExport = useCallback(
    async (playlist: PlaylistRow, format: string) => {
      const res = (await invokeEventToMainProcess('export-playlist', {
        playlistId: playlist.Id,
        format,
      })) as { success?: boolean; canceled?: boolean; error?: string; filePath?: string };
      if (res?.canceled) return;
      setReport({
        success: !!res?.success,
        message: res?.success ? `Exported to ${res.filePath}` : res?.error || 'Export failed',
      });
    },
    [invokeEventToMainProcess]
  );

  if (isLoading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Playlists" />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );
  if (error)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Playlists" />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading playlists</Typography>
      </Box>
    );

  return (
    <Box
      component={motion.div}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      transition={{ duration: 0.3 }}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <PageToolbar
        title={`Playlists (${playlists.length})`}
        action={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<Icon icon={arrowImportIcon} />}
              onClick={() => void handleImport()}
            >
              Import
            </Button>
            <Button
              variant="contained"
              startIcon={<Icon icon={addIcon} />}
              onClick={() => setCreateOpen(true)}
            >
              New Playlist
            </Button>
          </Stack>
        }
      />

      <Box
        onScroll={e => scrollHide({ scrollTop: e.currentTarget.scrollTop })}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2, pb: 2 }}
      >
        {playlists.length === 0 ? (
          <Typography sx={{ p: 4, opacity: 0.6 }}>
            No playlists yet — create one, or import an M3U/M3U8/PLS/XSPF file.
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {playlists.map(playlist => (
              <Grid item key={playlist.Id} xs={6} sm={4} md={3} lg={2}>
                <Box
                  className={CARD_HOVER_CLASS}
                  onClick={() => navigate(`/main_window/playlists/${playlist.Id}`)}
                  sx={{
                    ...gridCardSx,
                    cursor: 'pointer',
                    borderRadius: 1,
                    overflow: 'hidden',
                  }}
                >
                  <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
                    {playlist.CoverUri ? (
                      <Box
                        component="img"
                        src={coverSrc(playlist.CoverUri)}
                        alt={playlist.Name}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <Box sx={{ ...artPlaceholderSx, width: '100%', height: '100%' }}>
                        <Icon icon={playlistIcon} width={40} />
                      </Box>
                    )}
                    <CardHoverAction
                      icon={playIcon}
                      corner="top-right"
                      ariaLabel={`Play ${playlist.Name}`}
                      disabled={playlist.TrackCount === 0}
                      onActivate={() => void handlePlayPlaylist(playlist)}
                    />
                  </Box>
                  <Stack direction="row" alignItems="center" sx={{ px: 1, py: 0.75 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                        {playlist.Name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {playlist.TrackCount} song{playlist.TrackCount === 1 ? '' : 's'} ·{' '}
                        {formatDuration(playlist.Duration)}
                      </Typography>
                    </Box>
                    <CardMenu
                      playlist={playlist}
                      onRename={p => {
                        setRenameTarget(p);
                        setRenameValue(p.Name);
                      }}
                      onDelete={p => void handleDelete(p)}
                      onExport={(p, format) => void handleExport(p, format)}
                    />
                  </Stack>
                </Box>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      <AppDialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Playlist">
        <Stack spacing={2}>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleCreate();
            }}
          />
          <Stack direction="row" justifyContent="flex-end" spacing={1}>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => void handleCreate()}>
              Create
            </Button>
          </Stack>
        </Stack>
      </AppDialog>

      <AppDialog
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename Playlist"
      >
        <Stack spacing={2}>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleRename();
            }}
          />
          <Stack direction="row" justifyContent="flex-end" spacing={1}>
            <Button onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button variant="contained" onClick={() => void handleRename()}>
              Save
            </Button>
          </Stack>
        </Stack>
      </AppDialog>

      <AppDialog open={report !== null} onClose={() => setReport(null)} title="Playlists">
        <Stack spacing={1.5}>
          <Alert severity={report?.success ? 'success' : 'error'}>{report?.message}</Alert>
          <Stack direction="row" justifyContent="flex-end">
            <Button onClick={() => setReport(null)}>Close</Button>
          </Stack>
        </Stack>
      </AppDialog>
    </Box>
  );
};

export default Playlists;
