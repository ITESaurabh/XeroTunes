import React, { useContext, useEffect } from 'react';
import {
  Container,
  Box,
  Grid,
  LinearProgress,
  Theme,
  Typography,
  ListItemButton,
  useMediaQuery,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router';
import PageToolbar from '../components/PageToolbar';
import ArtistCell from '../components/ArtistCell';
import { useIpc } from '../state/ipc';
import { store, Track, LibraryStats } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ipcRenderer } from 'electron';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'motion/react';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';

interface Column {
  label: string;
  key: string;
  width: number;
  align: 'left' | 'center' | 'right';
  flex?: number;
  getNavPath?: (_song: Track) => string | null;
  format?: (_val: unknown) => string;
}

const formatDateAdded = (val: unknown): string => {
  if (!val || typeof val !== 'number') return '';
  const date = new Date(val);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatDuration = (seconds: unknown): string => {
  const secs = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const columns: Column[] = [
  { label: 'Title', key: 'Title', width: 248, align: 'left', flex: 3 },
  { label: 'Artist', key: 'ArtistName', width: 200, align: 'left', flex: 2 },
  {
    label: 'Album',
    key: 'AlbumTitle',
    width: 200,
    align: 'left',
    flex: 2,
    getNavPath: song => (song.AlbumId != null ? `/main_window/albums/${song.AlbumId}` : null),
  },
  {
    label: 'Added at',
    key: 'DateAdded',
    width: 130,
    align: 'center',
    flex: 1,
    format: formatDateAdded,
  },
  {
    label: 'Duration',
    key: 'Duration',
    width: 80,
    align: 'right',
    flex: 1,
    format: formatDuration,
  },
];

const getVisibleColumns = (isPhone: boolean): Column[] => (isPhone ? columns.slice(0, 2) : columns);

const ScrollContainer = React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(
  ({ style, ...rest }, ref) => (
    <div
      {...rest}
      ref={ref}
      style={{
        ...style,
        overflowY: 'overlay' as React.CSSProperties['overflowY'],
        overflowX: 'hidden',
      }}
    />
  )
);
ScrollContainer.displayName = 'ScrollContainer';

const getFlex = (col: Column, isPhone: boolean): number => {
  if (isPhone) return 1;
  return col.flex ?? 1;
};

interface HeaderRowProps {
  isPhone: boolean;
}

const HeaderRow: React.FC<HeaderRowProps> = ({ isPhone }) => {
  const visibleColumns = getVisibleColumns(isPhone);
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        background: '#222',
        color: '#fff',
        paddingLeft: 14,
        fontWeight: 500,
      }}
    >
      {visibleColumns.map((col, i) => (
        <div
          key={col.label}
          style={{
            flex: getFlex(col, isPhone),
            padding: '8px 16px',
            paddingRight: i === visibleColumns.length - 1 ? 28 : 16,
            textAlign: col.align,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {col.label}
        </div>
      ))}
    </div>
  );
};

const RecentlyAdded: React.FC = () => {
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const queryClient = useQueryClient();
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration('recently_added');
  const navigate = useNavigate();
  const location = useLocation();
  const listRef = React.useRef<FixedSizeList | null>(null);

  const handleScroll = React.useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const {
    data: songs = [] as Track[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.RECENTLY_ADDED],
    queryFn: () =>
      invokeEventToMainProcess('get-recently-added-songs', undefined) as Promise<Track[]>,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

  // Re-scan for new/removed files once when entering this view. Store
  // dispatches (e.g. from scroll) must NOT re-trigger this — hence empty deps
  // + a ref to the latest `invokeEventToMainProcess`.
  const invokeRef = React.useRef(invokeEventToMainProcess);
  invokeRef.current = invokeEventToMainProcess;
  useEffect(() => {
    console.log('[RecentlyAdded] mounted → invoking scan-media');
    invokeRef
      .current('scan-media', undefined)
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
    (clickedIndex: number): void => {
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

  const focusTrackId = (location.state as { focusTrackId?: string | number } | null)?.focusTrackId;
  const focusTs = (location.state as { _ts?: number } | null)?._ts;
  useEffect(() => {
    if (focusTrackId == null || !songs.length || !listRef.current) return;
    const idx = songs.findIndex(s => s.Id === focusTrackId);
    if (idx >= 0) listRef.current.scrollToItem(idx, 'center');
  }, [focusTrackId, focusTs, songs]);

  const Row = React.useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const song = songs[index];
      const visibleColumns = getVisibleColumns(isPhone);

      return (
        <ListItemButton
          style={style}
          selected={song.Id === state.track?.Id}
          sx={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            borderBottom: '1px solid #333',
            borderRadius: 0.5,
            background: index % 2 === 0 ? 'rgba(255,255,255,0.0)' : 'rgba(255,255,255,0.03)',
            '&:hover': {
              background: 'rgba(255,255,255,0.08)',
            },
          }}
          onClick={e => {
            if ((e.target as HTMLElement).closest('[data-nav-cell]')) return;
            handleSongClick(index);
          }}
        >
          {visibleColumns.map((col, i) => {
            const navPath = col.getNavPath?.(song) ?? null;
            const isLast = i === visibleColumns.length - 1;
            const cellValue = col.format
              ? col.format(song[col.key])
              : (song[col.key] as string) || '';

            return (
              <Box
                key={col.label}
                sx={{
                  flex: getFlex(col, isPhone),
                  pl: 2,
                  pr: isLast ? 3.5 : 2,
                  minWidth: 0,
                  textAlign: col.align,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {col.key === 'ArtistName' ? (
                  <ArtistCell artistNameRaw={song.ArtistName as string | undefined} />
                ) : navPath ? (
                  <Typography
                    variant="body2"
                    noWrap
                    data-nav-cell="true"
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      navigate(navPath);
                    }}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                    }}
                  >
                    {cellValue}
                  </Typography>
                ) : (
                  <Typography variant="body2" noWrap>
                    {cellValue}
                  </Typography>
                )}
              </Box>
            );
          })}
        </ListItemButton>
      );
    },
    [songs, dispatch, isPhone, state.track?.Id, handleSongClick, navigate]
  );

  if (isLoading)
    return (
      <div>
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </div>
    );
  if (error) return <div>Error fetching recently added songs</div>;

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
        <HeaderRow isPhone={isPhone} />
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', overflowX: 'hidden' }}>
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <FixedSizeList
                ref={listRef}
                height={height}
                overscanCount={100}
                itemCount={songs.length}
                itemSize={43}
                width={width}
                initialScrollOffset={initialScrollOffset}
                onScroll={handleScroll}
                outerElementType={ScrollContainer}
              >
                {Row}
              </FixedSizeList>
            )}
          </AutoSizer>
        </Box>
      </Container>
    </Grid>
  );
};

export default RecentlyAdded;
