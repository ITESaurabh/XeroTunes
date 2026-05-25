import React, { useContext, useEffect, useCallback } from 'react';
import {
  Box,
  Container,
  Grid,
  LinearProgress,
  ListItemButton,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router';
import { Icon } from '@iconify/react';
import yearsIcon from '@iconify/icons-fluent/timer-24-filled';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import PageToolbar from '../components/PageToolbar';
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

const HeaderRow: React.FC = () => (
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
    <div
      style={{
        flex: 4,
        padding: '8px 16px',
        textAlign: 'left',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      Year
    </div>
    <div
      style={{
        flex: 1,
        padding: '8px 16px',
        textAlign: 'right',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      Albums
    </div>
    <div
      style={{
        flex: 1,
        padding: '8px 16px',
        paddingRight: 28,
        textAlign: 'right',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      Songs
    </div>
  </div>
);

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

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const handleYearClick = useCallback(
    (year: YearEntry) => {
      navigate(`/main_window/years/${encodeURIComponent(year.Year)}`);
    },
    [navigate]
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const year = years[index];
      return (
        <ListItemButton
          style={style}
          onClick={() => handleYearClick(year)}
          sx={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            borderBottom: '1px solid #333',
            borderRadius: 0.5,
            background: index % 2 === 0 ? 'rgba(255,255,255,0.0)' : 'rgba(255,255,255,0.03)',
            '&:hover': { background: 'rgba(255,255,255,0.08)' },
          }}
        >
          <Box
            sx={{
              flex: 4,
              pl: 2,
              pr: 2,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              overflow: 'hidden',
            }}
          >
            <Icon icon={yearsIcon} height="1.25rem" style={{ color: '#7cc4ff', flexShrink: 0 }} />
            <Typography variant="body2" noWrap fontWeight={500}>
              {year.Year || 'Unknown Year'}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, pl: 2, pr: 2, minWidth: 0, textAlign: 'right' }}>
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
              {year.AlbumCount}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, pl: 2, pr: 3.5, minWidth: 0, textAlign: 'right' }}>
            <Typography variant="body2" noWrap>
              {year.SongCount}
            </Typography>
          </Box>
        </ListItemButton>
      );
    },
    [years, handleYearClick]
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
          <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
            <Typography>No years found. Tracks in your library don&apos;t have year tags.</Typography>
          </Box>
        ) : (
          <>
            <HeaderRow />
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                  <FixedSizeList
                    height={height}
                    overscanCount={50}
                    itemCount={years.length}
                    itemSize={48}
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

export default Years;
