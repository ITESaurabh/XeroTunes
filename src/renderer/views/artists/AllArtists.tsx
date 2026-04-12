import React, { useContext, useEffect, useCallback, useMemo, useState } from 'react';
import { Box, Typography, LinearProgress, Avatar } from '@mui/material';
import { useNavigate, useLocation } from 'react-router';
import { FixedSizeGrid, GridChildComponentProps, GridOnItemsRenderedProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageToolbar from '../../components/PageToolbar';
import { useIpc } from '../../state/ipc';
import { QUERY_KEYS } from '../../constants/queryKeys';
import { store } from '../../utils/store';
import { useScrollHidePlayerBar } from '../../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../../utils/useScrollRestoration';
import { artistImageService } from '../../utils/artistImageService';

export interface Artist {
  Id: number;
  Name: string;
  ProfileImgUri?: string | null;
  ProfileImg?: string | null;
  SongCount: number;
  AlbumCount: number;
}

const CARD_MIN_WIDTH = 148;
const GAP = 14;
const PADDING = 16;
const TEXT_AREA_HEIGHT = 70;
function calcLayout(containerWidth: number): {
  colCount: number;
  colWidth: number;
  rowHeight: number;
} {
  const colCount = Math.max(2, Math.floor((containerWidth + GAP) / (CARD_MIN_WIDTH + GAP)));
  const colWidth = Math.floor((containerWidth - colCount * GAP) / colCount);
  const rowHeight = colWidth + TEXT_AREA_HEIGHT + GAP;
  return { colCount, colWidth, rowHeight };
}

interface ArtistCardProps {
  artist: Artist;
  width: number;
  onClick: (_artist: Artist) => void;
}

const ArtistCard: React.FC<ArtistCardProps> = React.memo(({ artist, width, onClick }) => {
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleMouseLeave = useCallback(() => setMouse(null), []);

  const imageSrc = artist.ProfileImgUri ? artist.ProfileImgUri : null;

  return (
    <Box
      onClick={() => onClick(artist)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      sx={{
        width,
        cursor: 'pointer',
        borderRadius: 0.5,
        overflow: 'hidden',
        position: 'relative',
        outline: mouse ? '1px solid rgba(255,255,255,0.18)' : '1px solid transparent',
        transition: 'outline-color 0.15s ease',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 2,
          background: mouse
            ? `radial-gradient(circle 550px at ${mouse.x}px ${mouse.y}px, rgba(255,255,255,0.15) 0%, transparent 70%)`
            : 'none',
        }}
      />

      <Box
        sx={{
          width: width,
          height: width,
          position: 'relative',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <Avatar
          sx={{ width: '100%', height: '100%' }}
          alt={artist.Name}
          src={imageSrc}
          variant="circular"
        />
      </Box>

      <Box display="flex" py={0.75} px={1} gap={0.7} flexDirection="column">
        <Typography
          variant="body2"
          noWrap
          sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary', lineHeight: 1 }}
        >
          {artist.Name || 'Unknown Artist'}
        </Typography>
        <Typography
          variant="caption"
          noWrap
          sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1 }}
        >
          {artist.AlbumCount} album{artist.AlbumCount === 1 ? '' : 's'} • {artist.SongCount} track
          {artist.SongCount === 1 ? '' : 's'}
        </Typography>
      </Box>
    </Box>
  );
});

ArtistCard.displayName = 'ArtistCard';

interface CellData {
  artists: Artist[];
  colCount: number;
  colWidth: number;
  onClick: (_artist: Artist) => void;
}

const Cell = React.memo(
  ({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CellData>) => {
    const { artists, colCount, colWidth, onClick } = data;
    const idx = rowIndex * colCount + columnIndex;
    if (idx >= artists.length) return null;
    const artist = artists[idx];

    return (
      <div style={{ ...style, paddingRight: GAP, boxSizing: 'border-box' }}>
        <ArtistCard artist={artist} width={colWidth} onClick={onClick} />
      </div>
    );
  }
);
Cell.displayName = 'Cell';

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

interface AllArtistsProps {
  showAlbumsOnly?: boolean;
}

const AllArtists: React.FC<AllArtistsProps> = ({ showAlbumsOnly = false }) => {
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch } = useContext(store);
  const queryClient = useQueryClient();
  const location = useLocation();
  const scrollHide = useScrollHidePlayerBar<{ scrollTop: number }>({ field: 'scrollTop' });
  const { initialScrollTop, saveScrollPosition } = useScrollRestoration(location.pathname);
  const navigate = useNavigate();

  const handleGridScroll = React.useCallback(
    (args: { scrollTop: number }) => {
      saveScrollPosition(args.scrollTop);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const enqueueArtistImageFetch = useCallback(
    (artist: Artist) => {
      if (!artist.Id || artist.ProfileImgUri) return;
      artistImageService.enqueue(artist.Id, queryClient, [QUERY_KEYS.ALL_ARTISTS, showAlbumsOnly]);
    },
    [queryClient, showAlbumsOnly]
  );

  const {
    data: artists = [] as Artist[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.ALL_ARTISTS, showAlbumsOnly],
    queryFn: () => invokeEventToMainProcess('get-all-artists', undefined) as Promise<Artist[]>,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const filtered = useMemo(() => {
    if (!showAlbumsOnly) return artists;
    return artists.filter(a => a.AlbumCount > 0);
  }, [artists, showAlbumsOnly]);

  const handleArtistClick = useCallback(
    (artist: Artist) => {
      navigate(`/main_window/artists/${artist.Id}`);
    },
    [navigate]
  );

  const [gridLayout, setGridLayout] = useState(() => calcLayout(800));

  const handleResize = useCallback(({ width }: { width: number }) => {
    setGridLayout(prev => {
      const next = calcLayout(width);
      if (next.colCount === prev.colCount && next.colWidth === prev.colWidth) return prev;
      return next;
    });
  }, []);

  const itemData = useMemo<CellData>(
    () => ({
      artists: filtered,
      colCount: gridLayout.colCount,
      colWidth: gridLayout.colWidth,
      onClick: handleArtistClick,
    }),
    [filtered, gridLayout, handleArtistClick]
  );

  if (isLoading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title={showAlbumsOnly ? 'Album Artists' : 'Artists'} />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );

  if (error)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title={showAlbumsOnly ? 'Album Artists' : 'Artists'} />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading artists</Typography>
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
      <PageToolbar title={`${showAlbumsOnly ? 'Album Artists' : 'Artists'} (${filtered.length})`} />
      <Box sx={{ flex: 1, minHeight: 0, px: `${PADDING}px` }}>
        <AutoSizer onResize={handleResize}>
          {({ height, width }: { height: number; width: number }) => {
            const { colCount, colWidth, rowHeight } = calcLayout(width);
            const rowCount = Math.ceil(filtered.length / colCount);

            const handleItemsRendered = ({
              visibleRowStartIndex,
              visibleRowStopIndex,
              visibleColumnStartIndex,
              visibleColumnStopIndex,
            }: GridOnItemsRenderedProps) => {
              for (let row = visibleRowStartIndex; row <= visibleRowStopIndex; row += 1) {
                for (let column = visibleColumnStartIndex; column <= visibleColumnStopIndex; column += 1) {
                  const index = row * colCount + column;
                  const artist = filtered[index];
                  if (artist) {
                    enqueueArtistImageFetch(artist);
                  }
                }
              }
            };

            return (
              <FixedSizeGrid
                columnCount={colCount}
                columnWidth={colWidth + GAP}
                rowCount={rowCount}
                rowHeight={rowHeight}
                height={height}
                width={width}
                initialScrollTop={initialScrollTop}
                overscanRowCount={4}
                onItemsRendered={handleItemsRendered}
                onScroll={handleGridScroll}
                itemData={itemData}
                outerElementType={ScrollContainer}
              >
                {Cell}
              </FixedSizeGrid>
            );
          }}
        </AutoSizer>
      </Box>
    </Box>
  );
};

export default AllArtists;
