import React, { useCallback, useContext, useEffect } from 'react';
import { Box, Button, IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { Icon } from '@iconify/react';
import streamIcon from '@iconify/icons-fluent/live-24-regular';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import bookmarkIcon from '@iconify/icons-fluent/bookmark-24-regular';
import bookmarkFilledIcon from '@iconify/icons-fluent/bookmark-24-filled';
import PageToolbar from '../components/PageToolbar';
import StreamActionsMenu from '../components/StreamActionsMenu';
import { useIpc } from '../state/ipc';
import { store } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { getStreamHistoryDays } from '../utils/LocStoreUtil';
import { artPlaceholderSx, detailBannerBg, listRowSx } from '../styles/listSx';

const { ipcRenderer } = window.require('electron');

interface StreamRow {
  Id: number;
  Name: string;
  Uri: string;
  CoverUri: string | null;
}

interface StreamTrackRow {
  Id: number;
  Raw: string;
  Title: string | null;
  Artist: string | null;
  FirstHeardAt: number | null;
  LastHeardAt: number | null;
  Saved: number;
}

const ROW_HEIGHT = 52;

function coverSrc(uri: string): string {
  return uri.startsWith('file://') ? uri : `file:///${uri.replace(/\\/g, '/')}`;
}

function heardAgo(at: number | null): string {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const StreamDetail: React.FC = () => {
  const { streamId } = useParams();
  const id = Number(streamId);
  const { invokeEventToMainProcess } = useIpc();
  const { state, dispatch } = useContext(store);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scrollHide = useScrollHidePlayerBar();

  const { data: stream, isLoading } = useQuery({
    queryKey: [QUERY_KEYS.STREAMS, id],
    queryFn: () =>
      invokeEventToMainProcess('get-stream', { streamId: id }) as Promise<StreamRow | undefined>,
  });

  const { data: tracks = [] as StreamTrackRow[] } = useQuery({
    queryKey: [QUERY_KEYS.STREAM_TRACKS, id],
    queryFn: () =>
      invokeEventToMainProcess('get-stream-tracks', { streamId: id }) as Promise<StreamTrackRow[]>,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  // A live log, so it refreshes on every announcement instead of on navigation.
  useEffect(() => {
    const onMeta = () =>
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.STREAM_TRACKS, id] });
    ipcRenderer.on('stream-metadata', onMeta);
    return () => {
      ipcRenderer.removeListener('stream-metadata', onMeta);
    };
  }, [queryClient, id]);

  const historyDays = getStreamHistoryDays();
  const isPlaying = state.track?.Id === `stream:${id}`;

  const handlePlay = useCallback(() => {
    if (!stream) return;
    const track = isPlaying
      ? { ...state.track }
      : {
          Id: `stream:${stream.Id}`,
          Title: stream.Name,
          Uri: stream.Uri,
          ...(stream.CoverUri ? { AlbumArt: stream.CoverUri } : {}),
        };
    dispatch({
      type: 'SET_QUEUE',
      payload: { queue: [track], index: 0, source: location.pathname },
    });
    dispatch({ type: 'SET_CURR_TRACK', payload: track });
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  }, [stream, isPlaying, state.track, dispatch, location.pathname]);

  const toggleSaved = useCallback(
    async (track: StreamTrackRow) => {
      await invokeEventToMainProcess('set-stream-track-saved', {
        id: track.Id,
        saved: !track.Saved,
      });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.STREAM_TRACKS, id] });
    },
    [invokeEventToMainProcess, queryClient, id]
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const track = tracks[index];
      return (
        <Box style={style} sx={{ ...listRowSx(index, false), gap: 1.5, px: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {track.Title || track.Raw}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {track.Artist || 'Unknown Artist'}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {heardAgo(track.LastHeardAt)}
          </Typography>
          <Tooltip title={track.Saved ? 'Remove bookmark' : 'Bookmark this song'}>
            <IconButton
              size="small"
              aria-label={track.Saved ? `Remove bookmark on ${track.Raw}` : `Bookmark ${track.Raw}`}
              onClick={() => void toggleSaved(track)}
              sx={{ color: track.Saved ? 'primary.main' : 'text.secondary' }}
            >
              <Icon icon={track.Saved ? bookmarkFilledIcon : bookmarkIcon} width={18} />
            </IconButton>
          </Tooltip>
        </Box>
      );
    },
    [tracks, toggleSaved]
  );

  if (isLoading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Stream" />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );

  if (!stream)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Stream" />
        <Typography sx={{ p: 3, opacity: 0.6 }}>That stream no longer exists.</Typography>
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
        title={stream.Name}
        action={
          <StreamActionsMenu
            stream={stream}
            variant="button"
            onChanged={() => {
              queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.STREAMS] });
            }}
            onDeleted={() => navigate('/main_window/streams')}
          />
        }
      />

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 2, pb: 2 }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ p: 2, mb: 2, borderRadius: 1, bgcolor: detailBannerBg }}
        >
          <Box
            sx={{
              ...artPlaceholderSx,
              width: 140,
              height: 140,
              flexShrink: 0,
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            {stream.CoverUri ? (
              <Box
                component="img"
                src={coverSrc(stream.CoverUri)}
                alt={stream.Name}
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Icon icon={streamIcon} width={48} />
            )}
          </Box>
          <Stack spacing={1} sx={{ minWidth: 0, justifyContent: 'center' }}>
            <Typography variant="h5" noWrap>
              {stream.Name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {stream.Uri}
            </Typography>
            <Box>
              <Button
                variant="contained"
                startIcon={<Icon icon={playIcon} />}
                onClick={handlePlay}
                sx={{ mt: 1 }}
              >
                {isPlaying ? 'Playing' : 'Play'}
              </Button>
            </Box>
          </Stack>
        </Stack>

        <Stack direction="row" alignItems="baseline" spacing={1} sx={{ px: 1, mb: 1 }}>
          <Typography variant="h6">Recently Played</Typography>
          <Typography variant="caption" color="text.secondary">
            bookmarked songs will be kept, rest will be dropped after {historyDays} day
            {historyDays === 1 ? '' : 's'}.
          </Typography>
        </Stack>

        {tracks.length === 0 ? (
          <Typography sx={{ p: 3, opacity: 0.6 }}>
            Nothing yet. Songs appear here while the station is playing.
          </Typography>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <AutoSizer>
              {({ height, width }: { height: number; width: number }) => (
                <FixedSizeList
                  height={height}
                  width={width}
                  itemCount={tracks.length}
                  itemSize={ROW_HEIGHT}
                  overscanCount={10}
                  onScroll={scrollHide}
                >
                  {Row}
                </FixedSizeList>
              )}
            </AutoSizer>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default StreamDetail;
