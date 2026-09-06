import React, { useContext, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Container,
  Grid,
  Collapse,
  LinearProgress,
  Theme,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useNavigate, useLocation, useParams } from 'react-router';
import { Icon } from '@iconify/react';
import yearsIcon from '@iconify/icons-fluent/timer-24-filled';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import ArtistCell from '../components/ArtistCell';
import Empty from '../components/Empty';
import LibraryTable, {
  TableColumn,
  useLibraryTable,
  type LibraryTableHandle,
} from '../components/LibraryTable';
import SelectionBar, { toEditableTracks, useTrackSelection } from '../components/SelectionBar';
import TagEditorDialog, { EditableTrack } from '../components/TagEditorDialog';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';
import { artPlaceholderSx, detailBannerBg } from '../styles/listSx';
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

const YearDetail: React.FC = () => {
  const { year: yearParam } = useParams<{ year: string }>();
  const year = yearParam ? decodeURIComponent(yearParam) : '';
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const navigate = useNavigate();
  const location = useLocation();
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration(location.pathname);

  const handleScroll = useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const {
    data: allSongs = [] as Track[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.YEAR_SONGS, year],
    queryFn: () => invokeEventToMainProcess('get-year-songs', { year }) as Promise<Track[]>,
    enabled: !!year,
  });

  const listRef = React.useRef<LibraryTableHandle | null>(null);
  const { rows: songs, view } = useLibraryTable(allSongs, columns);
  const { selectedIds, selected, toggleAll, clear, replace } = useTrackSelection(songs);
  const [editTracks, setEditTracks] = React.useState<EditableTrack[] | null>(null);

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const handlePlayAll = useCallback(
    (startIndex = 0) => {
      if (!songs.length) return;
      dispatch({
        type: 'SET_QUEUE',
        payload: {
          queue: songs,
          index: startIndex,
          source: location.pathname + location.search,
        },
      });
      dispatch({ type: 'SET_CURR_TRACK', payload: songs[startIndex] });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    },
    [songs, dispatch, location.pathname, location.search]
  );

  const handlePlaySelected = useCallback(() => {
    if (!selected.length) return;
    dispatch({
      type: 'SET_QUEUE',
      payload: { queue: selected, index: 0, source: location.pathname + location.search },
    });
    dispatch({ type: 'SET_CURR_TRACK', payload: selected[0] });
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  }, [selected, dispatch, location.pathname, location.search]);

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
      {/* Year header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: { xs: 2, md: 4 },
          py: 2,
          mx: { xs: 1, md: 2 },
          mt: 2,
          borderRadius: 1,
          background: detailBannerBg,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            ...artPlaceholderSx,
            width: isPhone ? 56 : 80,
            height: isPhone ? 56 : 80,
            borderRadius: 1,
            flexShrink: 0,
          }}
        >
          <Box component="span" sx={{ display: 'flex' }}>
            <Icon icon={yearsIcon} height={isPhone ? '1.75rem' : '2.5rem'} />
          </Box>
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1 }}
          >
            Year
          </Typography>
          <Typography variant="h5" noWrap sx={{ fontWeight: 800, lineHeight: 1.1, mt: 0.25 }}>
            {year || 'Unknown'}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {songs.length} {songs.length === 1 ? 'song' : 'songs'}
          </Typography>
          {songs.length > 0 && (
            <Button
              onClick={() => handlePlayAll(0)}
              variant="contained"
              size="small"
              startIcon={<Icon icon={playIcon} />}
              sx={{ mt: 1 }}
            >
              Play All
            </Button>
          )}
        </Box>
      </Box>

      <Container
        maxWidth="xl"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, mt: 2 }}
      >
        {isLoading ? (
          <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
        ) : error ? (
          <Typography sx={{ p: 3, color: 'error.main' }}>Error loading year songs</Typography>
        ) : songs.length === 0 ? (
          <Empty page={year || 'Year'} />
        ) : (
          <>
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
              onRowClick={(_song, index) => handlePlayAll(index)}
              selection={{ selectedIds, onReplace: replace }}
              listRef={listRef}
              initialScrollOffset={initialScrollOffset}
              onScroll={handleScroll}
              onNavigate={navigate}
            />
          </>
        )}
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

export default YearDetail;
