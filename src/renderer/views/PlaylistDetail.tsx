import React, { useContext, useEffect, useState, useCallback } from 'react';
import {
  Box,
  Button,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useParams, useLocation, useNavigate } from 'react-router';
import { Icon } from '@iconify/react';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import dismissIcon from '@iconify/icons-fluent/dismiss-24-regular';
import moreVerticalIcon from '@iconify/icons-fluent/more-vertical-24-regular';
import addIcon from '@iconify/icons-fluent/add-24-regular';
import { motion, Reorder } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageToolbar from '../components/PageToolbar';
import Empty from '../components/Empty';
import AppDialog from '../components/AppDialog';
import AddTracksDialog from '../components/AddTracksDialog';
import ArtistCell from '../components/ArtistCell';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useConfirm } from '../utils/useConfirm';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { listRowSx } from '../styles/listSx';

interface PlaylistTrackRow extends Track {
  PlaylistTrackId: number;
  Position: number;
  Duration?: number;
  ArtistName?: string;
  AlbumTitle?: string;
  /** No matching library Track; played directly from the path stored on this row. */
  IsExternal?: number;
}

const PLAYLIST_FORMATS = [
  { format: 'm3u8', label: 'M3U8 (.m3u8)' },
  { format: 'm3u', label: 'M3U (.m3u)' },
  { format: 'pls', label: 'PLS (.pls)' },
  { format: 'xspf', label: 'XSPF (.xspf)' },
];

function formatDuration(seconds: unknown): string {
  const secs = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (secs == null) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PlaylistDetail: React.FC = () => {
  const { playlistId } = useParams<{ playlistId: string }>();
  const id = Number(playlistId);
  const location = useLocation();
  const navigate = useNavigate();
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const scrollHide = useScrollHidePlayerBar<{ scrollTop: number }>({ field: 'scrollTop' });

  const { data: playlist } = useQuery({
    queryKey: [QUERY_KEYS.PLAYLISTS, id],
    queryFn: () =>
      invokeEventToMainProcess('get-playlist', { playlistId: id }) as Promise<{
        Id: number;
        Name: string;
      }>,
    enabled: Number.isFinite(id),
  });

  const {
    data: tracks = [] as PlaylistTrackRow[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.PLAYLIST_TRACKS, id],
    queryFn: () =>
      invokeEventToMainProcess('get-playlist-tracks', { playlistId: id }) as Promise<
        PlaylistTrackRow[]
      >,
    enabled: Number.isFinite(id),
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  // Drives the drag visuals locally; the server round-trip (handleDragEnd)
  // only fires once per drag, not on every reorder tick.
  const [localTracks, setLocalTracks] = useState<PlaylistTrackRow[]>([]);
  useEffect(() => setLocalTracks(tracks), [tracks]);

  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PLAYLIST_TRACKS, id] }),
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PLAYLISTS] }),
      ]),
    [queryClient, id]
  );

  const handleDragEnd = useCallback(() => {
    void invokeEventToMainProcess('reorder-playlist-tracks', {
      playlistId: id,
      orderedPlaylistTrackIds: localTracks.map(t => t.PlaylistTrackId),
    });
  }, [invokeEventToMainProcess, id, localTracks]);

  const handlePlay = useCallback(
    (startIndex = 0) => {
      if (!localTracks.length) return;
      dispatch({
        type: 'SET_QUEUE',
        payload: { queue: localTracks, index: startIndex, source: location.pathname },
      });
      dispatch({ type: 'SET_CURR_TRACK', payload: localTracks[startIndex] });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    },
    [localTracks, dispatch, location.pathname]
  );

  const handleRemove = useCallback(
    async (track: PlaylistTrackRow) => {
      await invokeEventToMainProcess('remove-playlist-tracks', {
        playlistId: id,
        playlistTrackIds: [track.PlaylistTrackId],
      });
      await refresh();
    },
    [invokeEventToMainProcess, id, refresh]
  );

  const handleAddTracks = useCallback(
    async (trackIds: Array<string | number>) => {
      await invokeEventToMainProcess('add-tracks-to-playlist', {
        playlistId: id,
        trackIds,
      });
      await refresh();
    },
    [invokeEventToMainProcess, id, refresh]
  );

  // ── Rename / Delete / Export ─────────────────────────────────────────────
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const handleRename = useCallback(async () => {
    await invokeEventToMainProcess('rename-playlist', { playlistId: id, name: renameValue });
    setRenameOpen(false);
    await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PLAYLISTS] });
  }, [invokeEventToMainProcess, id, renameValue, queryClient]);

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: 'Delete Playlist',
      message: `Delete "${playlist?.Name || 'this playlist'}"?`,
      detail: 'The songs stay in your library; only the playlist is removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await invokeEventToMainProcess('delete-playlist', { playlistId: id });
    navigate('/main_window/playlists');
  }, [confirm, playlist?.Name, invokeEventToMainProcess, id, navigate]);

  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const handleExport = useCallback(
    async (format: string) => {
      const res = (await invokeEventToMainProcess('export-playlist', {
        playlistId: id,
        format,
      })) as { success?: boolean; canceled?: boolean; error?: string; filePath?: string };
      if (res?.canceled) return;
      setExportMessage(res?.success ? `Exported to ${res.filePath}` : res?.error || 'Export failed');
    },
    [invokeEventToMainProcess, id]
  );

  if (isLoading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Playlist" />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );
  if (error)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Playlist" />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading playlist</Typography>
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
        title={playlist?.Name || 'Playlist'}
        action={
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="contained"
              startIcon={<Icon icon={playIcon} />}
              disabled={localTracks.length === 0}
              onClick={() => handlePlay(0)}
            >
              Play
            </Button>
            <Button startIcon={<Icon icon={addIcon} />} onClick={() => setAddOpen(true)}>
              Add songs
            </Button>
            <IconButton onClick={e => setMenuAnchor(e.currentTarget)}>
              <Icon icon={moreVerticalIcon} width={20} />
            </IconButton>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  setRenameValue(playlist?.Name || '');
                  setRenameOpen(true);
                }}
              >
                Rename
              </MenuItem>
              <MenuItem onClick={e => setExportAnchor(e.currentTarget)}>Export…</MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  void handleDelete();
                }}
                sx={{ color: 'error.main' }}
              >
                Delete
              </MenuItem>
            </Menu>
            <Menu
              anchorEl={exportAnchor}
              open={Boolean(exportAnchor)}
              onClose={() => {
                setExportAnchor(null);
                setMenuAnchor(null);
              }}
            >
              {PLAYLIST_FORMATS.map(({ format, label }) => (
                <MenuItem
                  key={format}
                  onClick={() => {
                    setExportAnchor(null);
                    setMenuAnchor(null);
                    void handleExport(format);
                  }}
                >
                  {label}
                </MenuItem>
              ))}
            </Menu>
          </Stack>
        }
      />

      <Box
        onScroll={e => scrollHide({ scrollTop: e.currentTarget.scrollTop })}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}
      >
        {localTracks.length === 0 ? (
          <Empty page={playlist?.Name || 'Playlist'} hint="Add songs from your library." />
        ) : (
          <Reorder.Group
            axis="y"
            values={localTracks}
            onReorder={setLocalTracks}
            as="div"
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
          >
            {localTracks.map((track, index) => {
              const isActive = track.Id === state.track?.Id;
              return (
                <Reorder.Item
                  key={track.PlaylistTrackId}
                  value={track}
                  as="div"
                  onDragEnd={handleDragEnd}
                  style={{ listStyle: 'none' }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1,
                      minHeight: 48,
                      ...listRowSx(index),
                      ...(isActive ? { bgcolor: 'surfaces.selection' } : {}),
                    }}
                  >
                    <Box sx={{ color: 'text.disabled', cursor: 'grab', display: 'flex' }}>
                      <DragIndicatorIcon fontSize="small" />
                    </Box>
                    <Box
                      sx={{ flex: 1, minWidth: 0, py: 0.5 }}
                      onClick={e => {
                        if ((e.target as HTMLElement).closest('[data-nav-cell]')) return;
                        handlePlay(index);
                      }}
                    >
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          fontWeight: isActive ? 700 : 400,
                          color: isActive ? 'primary.main' : 'text.primary',
                        }}
                      >
                        {(track.Title as string) || 'Unknown'}
                      </Typography>
                      <ArtistCell artistNameRaw={track.ArtistName} variant="caption" />
                    </Box>
                    {!!track.IsExternal && (
                      <Typography
                        variant="caption"
                        title="Played directly from disk — not in your library"
                        sx={{
                          flexShrink: 0,
                          color: 'text.disabled',
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1,
                          px: 0.75,
                          lineHeight: 1.6,
                        }}
                      >
                        external
                      </Typography>
                    )}
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', flexShrink: 0, minWidth: 40, textAlign: 'right' }}
                    >
                      {formatDuration(track.Duration)}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label="remove from playlist"
                      title="Remove from playlist"
                      onClick={() => void handleRemove(track)}
                      sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                    >
                      <Icon icon={dismissIcon} width={16} />
                    </IconButton>
                  </Box>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        )}
      </Box>

      <AddTracksDialog open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAddTracks} />

      <AppDialog open={renameOpen} onClose={() => setRenameOpen(false)} title="Rename Playlist">
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
            <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => void handleRename()}>
              Save
            </Button>
          </Stack>
        </Stack>
      </AppDialog>

      <AppDialog open={exportMessage !== null} onClose={() => setExportMessage(null)} title="Export">
        <Stack spacing={1.5}>
          <Typography variant="body2">{exportMessage}</Typography>
          <Stack direction="row" justifyContent="flex-end">
            <Button onClick={() => setExportMessage(null)}>Close</Button>
          </Stack>
        </Stack>
      </AppDialog>
    </Box>
  );
};

export default PlaylistDetail;
