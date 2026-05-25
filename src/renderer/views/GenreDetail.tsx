import React, { useContext, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Container,
  Grid,
  LinearProgress,
  ListItemButton,
  Theme,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useNavigate, useLocation, useParams } from 'react-router';
import { Icon } from '@iconify/react';
import genresIcon from '@iconify/icons-fluent/guitar-24-filled';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import PageToolbar from '../components/PageToolbar';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';

interface Column {
  label: string;
  key: string;
  align: 'left' | 'center' | 'right';
  flex: number;
  getNavPath?: (_song: Track) => string | null;
  format?: (_val: unknown) => string;
}

const formatDuration = (seconds: unknown): string => {
  const secs = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const columns: Column[] = [
  { label: 'Title', key: 'Title', align: 'left', flex: 3 },
  { label: 'Artist', key: 'ArtistName', align: 'left', flex: 2 },
  {
    label: 'Album',
    key: 'AlbumTitle',
    align: 'left',
    flex: 2,
    getNavPath: song => (song.AlbumId != null ? `/main_window/albums/${song.AlbumId}` : null),
  },
  { label: 'Year', key: 'Year', align: 'center', flex: 1 },
  { label: 'Duration', key: 'Duration', align: 'right', flex: 1, format: formatDuration },
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

const HeaderRow: React.FC<{ isPhone: boolean }> = ({ isPhone }) => {
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
            flex: col.flex,
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

const GenreDetail: React.FC = () => {
  const { genreId } = useParams<{ genreId: string }>();
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
    data: songs = [] as Track[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.GENRE_SONGS, genreId],
    queryFn: () =>
      invokeEventToMainProcess('get-genre-songs', { genreId: Number(genreId) }) as Promise<Track[]>,
    enabled: !!genreId,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const genreName = (songs[0]?.GenreName as string) || 'Genre';

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

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const song = songs[index];
      const visibleColumns = getVisibleColumns(isPhone);
      const isActive = song.Id === state.track?.Id;

      return (
        <ListItemButton
          style={style}
          selected={isActive}
          sx={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            borderBottom: '1px solid #333',
            borderRadius: 0.5,
            background: index % 2 === 0 ? 'rgba(255,255,255,0.0)' : 'rgba(255,255,255,0.03)',
            '&:hover': { background: 'rgba(255,255,255,0.08)' },
          }}
          onClick={e => {
            if ((e.target as HTMLElement).closest('[data-nav-cell]')) return;
            handlePlayAll(index);
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
                  flex: col.flex,
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
    [songs, isPhone, state.track?.Id, handlePlayAll, navigate]
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
      {/* Genre header */}
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
          background: 'rgba(255,255,255,0.04)',
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            width: isPhone ? 56 : 80,
            height: isPhone ? 56 : 80,
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #4a1f7a 0%, #c084fc 100%)',
            flexShrink: 0,
          }}
        >
          <Icon
            icon={genresIcon}
            height={isPhone ? '1.75rem' : '2.5rem'}
            style={{ color: '#fff' }}
          />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1 }}
          >
            Genre
          </Typography>
          <Typography variant="h5" noWrap sx={{ fontWeight: 800, lineHeight: 1.1, mt: 0.25 }}>
            {genreName}
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
          <Typography sx={{ p: 3, color: 'error.main' }}>Error loading genre songs</Typography>
        ) : songs.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
            <Typography>No songs in this genre.</Typography>
          </Box>
        ) : (
          <>
            <HeaderRow isPhone={isPhone} />
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                  <FixedSizeList
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
          </>
        )}
      </Container>
    </Grid>
  );
};

export default GenreDetail;
