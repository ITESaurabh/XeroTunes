import React, { useContext, useEffect, useCallback } from 'react';
import { Box, Container, Grid, LinearProgress, Typography } from '@mui/material';
import { useNavigate } from 'react-router';
import { Icon } from '@iconify/react';
import yearsIcon from '@iconify/icons-fluent/timer-24-filled';
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

export interface YearEntry {
  Year: string;
  SongCount: number;
  AlbumCount: number;
}

const columns: TableColumn<YearEntry>[] = [
  {
    label: 'Year',
    key: 'Year',
    align: 'left',
    flex: 4,
    gridWidth: 180,
    render: row => (
      <>
        <Box
          component="span"
          sx={{ color: 'surfaces.year', flexShrink: 0, display: 'inline-flex', mr: 1.25, verticalAlign: 'middle' }}
        >
          <Icon icon={yearsIcon} height="1.25rem" />
        </Box>
        <Typography variant="body2" noWrap fontWeight={500} component="span">
          {row.Year || 'Unknown Year'}
        </Typography>
      </>
    ),
  },
  { label: 'Albums', key: 'AlbumCount', align: 'right', flex: 1, gridWidth: 90 },
  { label: 'Songs', key: 'SongCount', align: 'right', flex: 1, gridWidth: 90 },
];

const Years: React.FC = () => {
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch } = useContext(store);
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration('years');
  const navigate = useNavigate();

  const handleScroll = useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const {
    data: years = [] as YearEntry[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.ALL_YEARS],
    queryFn: () => invokeEventToMainProcess('get-all-years', undefined) as Promise<YearEntry[]>,
  });

  const { rows: sortedRows, view } = useLibraryTable(years, columns);

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const handleYearClick = useCallback(
    (year: YearEntry) => {
      navigate(`/main_window/years/${encodeURIComponent(year.Year)}`);
    },
    [navigate]
  );

  if (isLoading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Years" />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );
  if (error)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Years" />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading years</Typography>
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
      <PageToolbar title={`Years (${years.length})`} />
      <Container
        maxWidth="xl"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {years.length === 0 ? (
          <Empty page="Years" hint="Tracks in your library don't have year tags." />
        ) : (
          <>
            <LibraryTable
              rows={sortedRows}
              columns={columns}
              getRowId={row => row.Year}
              view={view}
              rowHeight={48}
              onRowClick={handleYearClick}
              initialScrollOffset={initialScrollOffset}
              onScroll={handleScroll}
            />
          </>
        )}
      </Container>
    </Grid>
  );
};

export default Years;
