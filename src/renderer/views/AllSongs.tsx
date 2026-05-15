import React, { useContext, useEffect } from 'react';
import {
  Container,
  Button,
  useMediaQuery,
  Box,
  Grid,
  LinearProgress,
  Theme,
  Typography,
  ListItemButton,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router';
import filterIcon from '@iconify/icons-fluent/filter-24-filled';
import { Icon } from '@iconify/react';
import PageToolbar from '../components/PageToolbar';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
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
}

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
  { label: 'Year', key: 'Year', width: 100, align: 'center', flex: 1 },
  { label: 'Genre', key: 'GenreName', width: 130, align: 'left', flex: 2 },
  { label: 'Duration', key: 'Duration', width: 80, align: 'right', flex: 1 },
];

const getVisibleColumns = (isPhone: boolean): Column[] => (isPhone ? columns.slice(0, 2) : columns);

// Overlay scrollbar so it floats over content, keeping header and row widths in sync.
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

const formatDuration = (seconds: unknown): string => {
  const secs = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

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

const AllSongs: React.FC = () => {
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
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
  const listRef = React.useRef<FixedSizeList | null>(null);

  const {
    data: songs = [] as Track[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.ALL_SONGS],
    queryFn: () => invokeEventToMainProcess('get-all-songs', undefined) as Promise<Track[]>,
  });

  // Show player bar when component mounts or unmounts
  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

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

  // Focus-scroll: when navigated here from PlayBar with a focusTrackId, scroll to it.
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
                {navPath ? (
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
                    {(song[col.key] as string) || ''}
                  </Typography>
                ) : (
                  <Typography variant="body2" noWrap>
                    {col.key === 'Duration'
                      ? formatDuration(song[col.key])
                      : (song[col.key] as string) || ''}
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
        <LinearProgress
          color="primary"
          sx={{
            borderRadius: 1,
          }}
        />
      </div>
    );
  if (error) return <div>Error fetching songs</div>;

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
      <PageToolbar
        title="All Songs"
        action={
          <Button variant="contained" startIcon={<Icon icon={filterIcon} />}>
            Filter
          </Button>
        }
      />
      <Container
        maxWidth="xl"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <HeaderRow isPhone={isPhone} />
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
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

export default AllSongs;
