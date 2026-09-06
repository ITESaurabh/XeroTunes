import React, { useContext, useEffect, useCallback } from 'react';
import { Box, Container, Grid, LinearProgress, Typography } from '@mui/material';
import { useNavigate } from 'react-router';
import { Icon } from '@iconify/react';
import genresIcon from '@iconify/icons-fluent/guitar-24-filled';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import PageToolbar from '../components/PageToolbar';
import Empty from '../components/Empty';
import LibraryTable, { TableColumn, useLibraryTable } from '../components/LibraryTable';
import { useIpc } from '../state/ipc';
import { QUERY_KEYS } from '../constants/queryKeys';
import { store } from '../utils/store';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';

export interface Genre {
  Id: number;
  Name: string;
  SongCount: number;
  AlbumCount: number;
}

const columns: TableColumn<Genre>[] = [
  {
    label: 'Genre',
    key: 'Name',
    align: 'left',
    flex: 4,
    gridWidth: 180,
    render: row => (
      <>
        <Box
          component="span"
          sx={{ color: 'surfaces.genre', flexShrink: 0, display: 'inline-flex', mr: 1.25, verticalAlign: 'middle' }}
        >
          <Icon icon={genresIcon} height="1.25rem" />
        </Box>
        <Typography variant="body2" noWrap fontWeight={500} component="span">
          {row.Name || 'Unknown Genre'}
        </Typography>
      </>
    ),
  },
  { label: 'Albums', key: 'AlbumCount', align: 'right', flex: 1, gridWidth: 90 },
  { label: 'Songs', key: 'SongCount', align: 'right', flex: 1, gridWidth: 90 },
];

const Genres: React.FC = () => {
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch } = useContext(store);
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration('genres');
  const navigate = useNavigate();

  const handleScroll = useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const {
    data: genres = [] as Genre[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.ALL_GENRES],
    queryFn: () => invokeEventToMainProcess('get-all-genres', undefined) as Promise<Genre[]>,
  });

  const { rows: sortedRows, view } = useLibraryTable(genres, columns);

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const handleGenreClick = useCallback(
    (genre: Genre) => {
      navigate(`/main_window/genres/${genre.Id}`);
    },
    [navigate]
  );

  if (isLoading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Genres" />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );
  if (error)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Genres" />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading genres</Typography>
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
      <PageToolbar title={`Genres (${genres.length})`} />
      <Container
        maxWidth="xl"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {genres.length === 0 ? (
          <Empty page="Genres" hint="Tracks in your library don't have genre tags." />
        ) : (
          <>
            <LibraryTable
              rows={sortedRows}
              columns={columns}
              getRowId={row => row.Id}
              view={view}
              rowHeight={48}
              onRowClick={handleGenreClick}
              initialScrollOffset={initialScrollOffset}
              onScroll={handleScroll}
            />
          </>
        )}
      </Container>
    </Grid>
  );
};

export default Genres;
