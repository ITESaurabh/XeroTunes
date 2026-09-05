import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Grid,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import streamIcon from '@iconify/icons-fluent/live-24-regular';
import addIcon from '@iconify/icons-fluent/add-24-regular';
import arrowImportIcon from '@iconify/icons-fluent/arrow-import-24-regular';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import PageToolbar from '../components/PageToolbar';
import Empty from '../components/Empty';
import AppDialog from '../components/AppDialog';
import StreamActionsMenu from '../components/StreamActionsMenu';
import CardHoverAction from '../components/CardHoverAction';
import { useIpc } from '../state/ipc';
import { store } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { artPlaceholderSx, CARD_HOVER_CLASS, gridCardSx } from '../styles/listSx';

interface StreamRow {
  Id: number;
  Name: string;
  Uri: string;
  CoverUri: string | null;
  DateAdded: number | null;
}

// A string Id keyed on the row, the convention playlist rows use for unscanned
// files. ICY metadata overwrites Title/ArtistName on the playing track, so the
// queue entry is what holds the station's own name.
const toQueueTrack = (stream: StreamRow) => ({
  Id: `stream:${stream.Id}`,
  Title: stream.Name,
  Uri: stream.Uri,
  ...(stream.CoverUri ? { AlbumArt: stream.CoverUri } : {}),
});

function coverSrc(uri: string): string {
  return uri.startsWith('file://') ? uri : `file:///${uri.replace(/\\/g, '/')}`;
}

const Streams: React.FC = () => {
  const { invokeEventToMainProcess } = useIpc();
  const { state, dispatch } = useContext(store);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scrollHide = useScrollHidePlayerBar<{ scrollTop: number }>({ field: 'scrollTop' });

  const {
    data: streams = [] as StreamRow[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.STREAMS],
    queryFn: () => invokeEventToMainProcess('get-streams', undefined) as Promise<StreamRow[]>,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.STREAMS] }),
    [queryClient]
  );

  // A station is a queue of one; it never ends, so there is no next track to line up.
  // Reusing the playing entry keeps the live ICY title, which a fresh station entry
  // would reset with no metadata fetch to restore it until the next song.
  const handlePlay = useCallback(
    (index: number) => {
      const entry = toQueueTrack(streams[index]);
      const track = state.track?.Id === entry.Id ? { ...state.track } : entry;
      dispatch({
        type: 'SET_QUEUE',
        payload: { queue: [track], index: 0, source: location.pathname },
      });
      dispatch({ type: 'SET_CURR_TRACK', payload: track });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    },
    [streams, dispatch, location.pathname, state.track]
  );

  const [report, setReport] = useState<{ success: boolean; message: string } | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUri, setNewUri] = useState('');
  const handleAdd = useCallback(async () => {
    const res = (await invokeEventToMainProcess('add-stream', {
      name: newName,
      uri: newUri,
    })) as { success?: boolean; error?: string };
    if (!res?.success) {
      setReport({ success: false, message: res?.error || 'Could not add that stream' });
      return;
    }
    setAddOpen(false);
    setNewName('');
    setNewUri('');
    await refresh();
  }, [invokeEventToMainProcess, newName, newUri, refresh]);

  const handleImport = useCallback(async () => {
    const res = (await invokeEventToMainProcess('import-streams', undefined)) as {
      success?: boolean;
      canceled?: boolean;
      error?: string;
      imported?: number;
      duplicate?: number;
      local?: number;
    };
    if (res?.canceled) return;
    if (!res?.success) {
      setReport({ success: false, message: res?.error || 'Import failed' });
      return;
    }
    await refresh();
    const parts = [`Added ${res.imported} stream${res.imported === 1 ? '' : 's'}`];
    if (res.duplicate) parts.push(`${res.duplicate} already in the list`);
    if (res.local) parts.push(`${res.local} local file${res.local === 1 ? '' : 's'} skipped`);
    setReport({ success: true, message: `${parts.join(', ')}.` });
  }, [invokeEventToMainProcess, refresh]);

  if (isLoading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Streams" />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );
  if (error)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Streams" />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading streams</Typography>
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
        title={`Streams (${streams.length})`}
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
              onClick={() => setAddOpen(true)}
            >
              Add Stream
            </Button>
          </Stack>
        }
      />

      <Box
        onScroll={e => scrollHide({ scrollTop: e.currentTarget.scrollTop })}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2, pb: 2 }}
      >
        {streams.length === 0 ? (
          <Empty
            page="Streams"
            hint="Add a station URL, or import an M3U/PLS file that points at one."
          />
        ) : (
          <Grid container spacing={2}>
            {streams.map((stream, index) => {
              const isCurrent = state.track?.Id === `stream:${stream.Id}`;
              return (
                <Grid item key={stream.Id} xs={6} sm={4} md={3} lg={2}>
                  <Box
                    className={CARD_HOVER_CLASS}
                    onClick={() => navigate(`/main_window/streams/${stream.Id}`)}
                    sx={{
                      ...gridCardSx,
                      borderRadius: 1,
                      overflow: 'hidden',
                      ...(isCurrent && { borderColor: 'primary.main' }),
                    }}
                  >
                    <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
                      {stream.CoverUri ? (
                        <Box
                          component="img"
                          src={coverSrc(stream.CoverUri)}
                          alt={stream.Name}
                          sx={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                          }}
                        />
                      ) : (
                        <Box sx={{ ...artPlaceholderSx, width: '100%', height: '100%' }}>
                          <Icon icon={streamIcon} width={40} />
                        </Box>
                      )}
                      <CardHoverAction
                        icon={playIcon}
                        corner="top-right"
                        ariaLabel={`Play ${stream.Name}`}
                        onActivate={() => handlePlay(index)}
                      />
                    </Box>
                    <Stack direction="row" alignItems="center" sx={{ px: 1, py: 0.75 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ fontWeight: 600, color: isCurrent ? 'primary.main' : undefined }}
                        >
                          {stream.Name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap component="div">
                          {stream.Uri}
                        </Typography>
                      </Box>
                      <StreamActionsMenu stream={stream} onChanged={refresh} />
                    </Stack>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Box>

      <AppDialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Stream">
        <Stack spacing={2}>
          <TextField
            autoFocus
            fullWidth
            label="Stream URL"
            placeholder="http://serv.example.com:8000/stream"
            value={newUri}
            onChange={e => setNewUri(e.target.value)}
          />
          <TextField
            fullWidth
            label="Name (optional)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleAdd();
            }}
          />
          <Stack direction="row" justifyContent="flex-end" spacing={1}>
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => void handleAdd()}>
              Add
            </Button>
          </Stack>
        </Stack>
      </AppDialog>

      <AppDialog open={report !== null} onClose={() => setReport(null)} title="Streams">
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

export default Streams;
