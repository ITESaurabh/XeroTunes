import React, { useContext, useEffect } from 'react';
import {
  Container,
  Collapse,
  Box,
  Grid,
  LinearProgress,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router';
import edit24Regular from '@iconify/icons-fluent/edit-24-regular';
import { Icon } from '@iconify/react';
import PageToolbar from '../components/PageToolbar';
import Empty from '../components/Empty';
import ArtistCell from '../components/ArtistCell';
import LibraryTable, {
  TableColumn,
  useLibraryTable,
  type LibraryTableHandle,
} from '../components/LibraryTable';
import SelectionBar, { toEditableTracks, useTrackSelection } from '../components/SelectionBar';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';
import TagEditorDialog, { EditableTrack } from '../components/TagEditorDialog';
import DownloadMenuItem from '../components/DownloadMenuItem';
import { isTaggable } from '../../config/constants';
import { formatDuration } from '../utils/formatDuration';

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
    label: 'Year',
    key: 'Year',
    align: 'center',
    flex: 1,
    gridWidth: 90,
    getNavPath: song =>
      song.Year != null && song.Year !== ''
        ? `/main_window/years/${encodeURIComponent(song.Year as string)}`
        : null,
  },
  {
    label: 'Genre',
    key: 'GenreName',
    align: 'left',
    flex: 2,
    gridWidth: 120,
    getNavPath: song =>
      song.GenreId != null ? `/main_window/genres/${song.GenreId as string | number}` : null,
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

const AllSongs: React.FC = () => {
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration('all_songs');
  const handleScroll = React.useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );
  const navigate = useNavigate();
  const location = useLocation();
  const listRef = React.useRef<LibraryTableHandle | null>(null);
  const [editTracks, setEditTracks] = React.useState<EditableTrack[] | null>(null);
  const [rowMenu, setRowMenu] = React.useState<{ top: number; left: number; song: Track } | null>(
    null
  );

  const {
    data: allSongs = [] as Track[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.ALL_SONGS],
    queryFn: () => invokeEventToMainProcess('get-all-songs', undefined) as Promise<Track[]>,
  });

  const { rows: songs, view } = useLibraryTable(allSongs, columns);
  const { selectedIds, selected, toggleAll, clear, replace } = useTrackSelection(songs);

  // Show player bar when component mounts or unmounts
  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

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

  // Focus-scroll: when navigated here from PlayBar with a focusTrackId, scroll to it.
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
        <LinearProgress
          color="primary"
          sx={{
            borderRadius: 1,
          }}
        />
      </div>
    );
  if (error) return <div>Error fetching songs</div>;

  if (!allSongs.length)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="All Songs" />
        <Empty page="All Songs" hint="Add a music folder in Settings, then scan your library." />
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
      <PageToolbar title="All Songs" />
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
          onRowContextMenu={(song, e) => setRowMenu({ top: e.clientY, left: e.clientX, song })}
          selection={{ selectedIds, onReplace: replace }}
          listRef={listRef}
          initialScrollOffset={initialScrollOffset}
          onScroll={handleScroll}
          onNavigate={navigate}
        />
      </Container>

      <Menu
        open={rowMenu !== null}
        onClose={() => setRowMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={rowMenu ? { top: rowMenu.top, left: rowMenu.left } : undefined}
      >
        <MenuItem
          disabled={typeof rowMenu?.song.Uri !== 'string' || !isTaggable(rowMenu.song.Uri)}
          onClick={() => {
            if (rowMenu) {
              setEditTracks([
                {
                  Id: rowMenu.song.Id as number | string,
                  Uri: rowMenu.song.Uri as string,
                  Title: rowMenu.song.Title as string,
                },
              ]);
            }
            setRowMenu(null);
          }}
        >
          <ListItemIcon>
            <Icon icon={edit24Regular} width={20} />
          </ListItemIcon>
          <ListItemText>Edit tags</ListItemText>
        </MenuItem>
        <DownloadMenuItem song={rowMenu?.song} onDone={() => setRowMenu(null)} />
      </Menu>

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

export default AllSongs;
