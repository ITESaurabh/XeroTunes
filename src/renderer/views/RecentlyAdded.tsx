import React, { useContext, useEffect } from 'react';
import { Container, Collapse, Box, Grid, LinearProgress } from '@mui/material';
import { useNavigate, useLocation } from 'react-router';
import PageToolbar from '../components/PageToolbar';
import Empty from '../components/Empty';
import ArtistCell from '../components/ArtistCell';
import LibraryTable, {
  TableColumn,
  useLibraryTable,
  type LibraryTableHandle,
} from '../components/LibraryTable';
import SelectionBar, { toEditableTracks, useTrackSelection } from '../components/SelectionBar';
import TagEditorDialog, { EditableTrack } from '../components/TagEditorDialog';
import { useIpc } from '../state/ipc';
import { store, Track, LibraryStats } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ipcRenderer } from 'electron';
import { motion } from 'motion/react';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';
import { formatDate, formatDuration } from '../utils/formatDuration';

const columns: TableColumn<Track>[] = [
  { label: 'Title', key: 'Title', align: 'left', flex: 3, gridWidth: 180 },
  {
    label: 'Artist',
    key: 'ArtistName',
    align: 'left',
    flex: 2,
    gridWidth: 140,
    render: song => <ArtistCell artistNameRaw={song.ArtistName as string | undefined} />,
  },
  {
    label: 'Album',
    key: 'AlbumTitle',
    align: 'left',
    flex: 2,
    gridWidth: 140,
    getNavPath: song => (song.AlbumId != null ? `/main_window/albums/${song.AlbumId}` : null),
  },
  {
    label: 'Added at',
    key: 'DateAdded',
    align: 'center',
    flex: 1,
    gridWidth: 120,
    format: formatDate,
  },
  {
    label: 'Duration',
    key: 'Duration',
    align: 'right',
    flex: 1,
    gridWidth: 90,
    format: formatDuration,
  },
];

const RecentlyAdded: React.FC = () => {
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const queryClient = useQueryClient();
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration('recently_added');
  const navigate = useNavigate();
  const location = useLocation();
  const listRef = React.useRef<LibraryTableHandle | null>(null);
  const [editTracks, setEditTracks] = React.useState<EditableTrack[] | null>(null);

  const handleScroll = React.useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const {
    data: recent = [] as Track[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.RECENTLY_ADDED],
    queryFn: () =>
      invokeEventToMainProcess('get-recently-added-songs', undefined) as Promise<Track[]>,
  });

  const { rows: songs, view } = useLibraryTable(recent, columns);
  const { selectedIds, selected, toggleAll, clear, replace } = useTrackSelection(songs);

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

  // Re-scan for new/removed files once when entering this view. Store
  // dispatches (e.g. from scroll) must NOT re-trigger this — hence empty deps
  // + a ref to the latest `invokeEventToMainProcess`. Local folders only:
  // syncing a server costs a request per folder, and nobody asked for one.
  const invokeRef = React.useRef(invokeEventToMainProcess);
  invokeRef.current = invokeEventToMainProcess;
  useEffect(() => {
    console.log('[RecentlyAdded] mounted → invoking scan-media');
    invokeRef
      .current('scan-media', { localOnly: true })
      .then(res => console.log('[RecentlyAdded] scan-media resolved:', res))
      .catch(err => console.log('[RecentlyAdded] scan-media error:', err));
  }, []);

  // Refetch when any scan completes — covers the case where the scan ran but
  // detected no changes (so `library-updated` never fired) and the case where
  // an auto-scan was already running when we entered the view. Also pulls
  // fresh library stats so sidebar counts stay in sync with the list.
  useEffect(() => {
    const handleScanEnd = () => {
      console.log('[RecentlyAdded] scan-end received → invalidating + refreshing stats');
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.RECENTLY_ADDED] });
      invokeRef
        .current('get-library-stats', undefined)
        .then(res => {
          console.log('[RecentlyAdded] stats refreshed:', res);
          dispatch({ type: 'SET_LIBRARY_STATS', payload: res as LibraryStats });
        })
        .catch(() => undefined);
    };
    ipcRenderer.on('scan-end', handleScanEnd);
    return () => {
      ipcRenderer.removeListener('scan-end', handleScanEnd);
    };
  }, [queryClient, dispatch]);

  const handleSongClick = React.useCallback(
    (_song: Track, clickedIndex: number): void => {
      dispatch({
        type: 'SET_QUEUE',
        payload: {
          queue: songs,
          index: clickedIndex,
          source: location.pathname + location.search,
        },
      });
      dispatch({ type: 'SET_CURR_TRACK', payload: songs[clickedIndex] });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    },
    [songs, dispatch, location.pathname, location.search]
  );

  const handlePlaySelected = React.useCallback(() => {
    if (!selected.length) return;
    dispatch({
      type: 'SET_QUEUE',
      payload: { queue: selected, index: 0, source: location.pathname + location.search },
    });
    dispatch({ type: 'SET_CURR_TRACK', payload: selected[0] });
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  }, [selected, dispatch, location.pathname, location.search]);

  const focusTrackId = (location.state as { focusTrackId?: string | number } | null)?.focusTrackId;
  const focusTs = (location.state as { _ts?: number } | null)?._ts;
  useEffect(() => {
    if (focusTrackId == null || !songs.length || !listRef.current) return;
    const idx = songs.findIndex(s => s.Id === focusTrackId);
    if (idx >= 0) listRef.current.scrollToItem(idx);
  }, [focusTrackId, focusTs, songs]);

  if (isLoading)
    return (
      <div>
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </div>
    );
  if (error) return <div>Error fetching recently added songs</div>;

  if (!recent.length)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Recently Added" />
        <Empty page="Recently Added" hint="Songs show up here as your library grows." />
      </Box>
    );

  return (
    <Grid
      component={motion.div}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      transition={{ duration: 0.3 }}
      item
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <PageToolbar title="Recently Added" />
      <Container
        maxWidth="xl"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Collapse in={selected.length > 0} sx={{ flexShrink: 0 }}>
          <SelectionBar
            selected={selected}
            total={songs.length}
            onToggleAll={toggleAll}
            onClear={clear}
            onPlay={handlePlaySelected}
            onEditTags={() => setEditTracks(toEditableTracks(selected))}
          />
        </Collapse>
        <LibraryTable
          rows={songs}
          columns={columns}
          getRowId={song => song.Id as string | number}
          view={view}
          isRowActive={song => song.Id === state.track?.Id}
          onRowClick={handleSongClick}
          selection={{ selectedIds, onReplace: replace }}
          listRef={listRef}
          initialScrollOffset={initialScrollOffset}
          onScroll={handleScroll}
          onNavigate={navigate}
        />
      </Container>

      {editTracks && (
        <TagEditorDialog
          open
          onClose={() => setEditTracks(null)}
          mode="track"
          tracks={editTracks}
        />
      )}
    </Grid>
  );
};

export default RecentlyAdded;
