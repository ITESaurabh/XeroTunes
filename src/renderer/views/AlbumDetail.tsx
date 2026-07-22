import React, { useContext, useEffect, useCallback, useState } from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  ListItemButton,
  useMediaQuery,
  Theme,
  Button,
} from '@mui/material';
import { useParams, useLocation, useNavigate } from 'react-router';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';
import ImagePreviewDialog from '../components/ImagePreviewDialog';
import ArtistCell from '../components/ArtistCell';

interface AlbumSong extends Track {
  TrackNumber?: string | number;
  ArtistName?: string;
  AlbumArtistName?: string;
  AlbumTitle?: string;
  AlbumCoverUri?: string;
  GenreName?: string;
  Duration?: number;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function totalDuration(songs: AlbumSong[]): string {
  const total = songs.reduce((acc, s) => acc + (s.Duration || 0), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

function formatTrackNumber(trackNumber?: string | number | null): number | null {
  if (trackNumber === null || trackNumber === undefined || trackNumber === '') return null;
  const num = typeof trackNumber === 'number' ? trackNumber : Number(trackNumber);
  if (Number.isNaN(num)) return null;
  return Math.trunc(num);
}

const AlbumDetail: React.FC = () => {
  const { albumId } = useParams<{ albumId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration(location.pathname);
  const listRef = React.useRef<FixedSizeList | null>(null);

  const {
    data: songs = [] as AlbumSong[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.ALBUM_SONGS, albumId],
    queryFn: () =>
      invokeEventToMainProcess('get-album-songs', { albumId: Number(albumId) }) as Promise<
        AlbumSong[]
      >,
    enabled: !!albumId,
  });

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

  const focusTrackId = (location.state as { focusTrackId?: string | number } | null)?.focusTrackId;
  const focusTs = (location.state as { _ts?: number } | null)?._ts;
  useEffect(() => {
    if (focusTrackId == null || !songs.length || !listRef.current) return;
    const idx = songs.findIndex(s => s.Id === focusTrackId);
    if (idx >= 0) listRef.current.scrollToItem(idx, 'center');
  }, [focusTrackId, focusTs, songs]);

  // Derive album metadata from first song
  const albumTitle = songs[0]?.AlbumTitle ?? 'Unknown Album';
  // Prefer the album artist; only fall back to the track artist when the album
  // has no album artist tagged. The distinction matters for navigation: an
  // album artist links to the album-artist page, a track artist to the
  // regular artist page.
  const albumArtistName = songs[0]?.AlbumArtistName || null;
  const artistName = albumArtistName ?? songs[0]?.ArtistName ?? 'Unknown Artist';
  const isAlbumArtist = albumArtistName != null;
  const coverUri = songs[0]?.AlbumCoverUri ?? null;
  const releaseYear = songs[0]?.['Year'] ?? null;
  const [previewOpen, setPreviewOpen] = useState(false);

  const coverSrc = React.useMemo(() => {
    if (!coverUri) return null;
    if (coverUri.startsWith('file://')) return coverUri;
    return `file:///${coverUri.replace(/\\/g, '/')}`;
  }, [coverUri]);

  const [isHeaderCondensed, setIsHeaderCondensed] = useState(false);

  const expandedImageSize = isPhone ? 112 : 200;
  const condensedImageSize = isPhone ? 60 : 100;
  const expandedTitleSize = isPhone ? 22 : 34;
  const condensedTitleSize = isPhone ? 16 : 22;

  const headerHeightVal = useMotionValue(isPhone ? 180 : 260);
  const imageSizeVal = useMotionValue(expandedImageSize);
  const titleSizeVal = useMotionValue(expandedTitleSize);

  const animatedHeaderHeight = useSpring(headerHeightVal, { damping: 26, stiffness: 210 });
  const animatedImageSize = useSpring(imageSizeVal, { damping: 28, stiffness: 220 });
  const animatedTitleSize = useSpring(titleSizeVal, { damping: 24, stiffness: 200 });

  useEffect(() => {
    headerHeightVal.set(isHeaderCondensed ? 130 : isPhone ? 180 : 260);
    imageSizeVal.set(isHeaderCondensed ? condensedImageSize : expandedImageSize);
    titleSizeVal.set(isHeaderCondensed ? condensedTitleSize : expandedTitleSize);
  }, [
    condensedImageSize,
    condensedTitleSize,
    expandedImageSize,
    expandedTitleSize,
    headerHeightVal,
    imageSizeVal,
    isHeaderCondensed,
    isPhone,
    titleSizeVal,
  ]);

  const ROW_HEIGHT = 60;
  const scrollHide = useScrollHidePlayerBar();
  const handleScroll = React.useCallback(
    (args: { scrollOffset: number }) => {
      const condensed = args.scrollOffset > 0;
      setIsHeaderCondensed(prev => (prev !== condensed ? condensed : prev));
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const song = songs[index] as AlbumSong;
      const isActive = song.Id === state.track?.Id;

      return (
        <ListItemButton
          style={style}
          selected={isActive}
          onClick={e => {
            if ((e.target as HTMLElement).closest('[data-nav-cell]')) return;
            handlePlayAll(index);
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 2,
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: index % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.03)',
            '&:hover': { background: 'rgba(255,255,255,0.08)' },
            '&.Mui-selected': { background: 'rgba(99,102,241,0.18)' },
          }}
        >
          {/* Track number */}
          <Typography
            variant="caption"
            sx={{
              minWidth: 40,
              textAlign: 'right',
              color: isActive ? 'primary.main' : 'text.disabled',
              flexShrink: 0,
            }}
          >
            {isActive
              ? '▶'
              : formatTrackNumber(song.TrackNumber) !== null
                ? formatTrackNumber(song.TrackNumber)
                : index + 1}
          </Typography>

          {/* Title + Artist */}
          <Box sx={{ flex: 1, minWidth: 0, gap: 0, display: 'flex', flexDirection: 'column' }}>
            <Typography
              variant="body2"
              noWrap
              sx={{
                fontWeight: isActive ? 700 : 400,
                color: isActive ? 'primary.main' : 'text.primary',
              }}
            >
              {(song.Title as string) || 'Unknown'}
            </Typography>
            {!isPhone && (
              <Box sx={{ color: 'text.secondary' }}>
                <ArtistCell
                  artistNameRaw={song.ArtistName as string | undefined}
                  variant="caption"
                />
              </Box>
            )}
          </Box>

          {/* Duration */}
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', flexShrink: 0, minWidth: 36, textAlign: 'right' }}
          >
            {formatDuration(song.Duration)}
          </Typography>
        </ListItemButton>
      );
    },
    [songs, state.track?.Id, isPhone, handlePlayAll]
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
      {/* Album header */}
      <Box
        component={motion.div}
        initial={false}
        style={{ height: animatedHeaderHeight }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          px: { xs: 2, md: 4 },
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '0.5rem 0 0 0',
          background: 'rgba(255,255,255,0.04)',
        }}
      >
        {/* Blurred background art */}
        {coverSrc && (
          <Box
            component="img"
            src={coverSrc}
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: 1,
              overflow: 'hidden',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: 'blur(60px) brightness(0.5)',
              transform: 'scale(1.2)',
              pointerEvents: 'none',
            }}
          />
        )}
        <Box
          sx={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 3 }}
        >
          {/* Album art */}
          <Box
            component={motion.div}
            style={{ width: animatedImageSize, height: animatedImageSize }}
            role={coverSrc ? 'button' : undefined}
            tabIndex={coverSrc ? 0 : -1}
            onClick={() => {
              if (coverSrc) setPreviewOpen(true);
            }}
            onKeyDown={event => {
              if (!coverSrc) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setPreviewOpen(true);
              }
            }}
            sx={{
              borderRadius: 0.5,
              overflow: 'hidden',
              flexShrink: 0,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              background: 'linear-gradient(135deg, #1e1e3f 0%, #2d2d5a 100%)',
              cursor: coverSrc ? 'zoom-in' : 'default',
            }}
          >
            {coverSrc ? (
              <Box
                component="img"
                src={coverSrc ?? undefined}
                alt={albumTitle}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <Box
                sx={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography sx={{ fontSize: isPhone ? 40 : 56, opacity: 0.2, lineHeight: 1 }}>
                  ♪
                </Typography>
              </Box>
            )}
          </Box>

          {/* Album info */}
          <Box sx={{ minWidth: 0 }}>
            {!isHeaderCondensed && (
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1 }}
              >
                Album
              </Typography>
            )}
            <motion.span
              style={{
                fontSize: animatedTitleSize,
                fontWeight: 800,
                lineHeight: 1.1,
                display: 'block',
                marginBottom: 4,
                color: 'white',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {albumTitle}
            </motion.span>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                color: 'text.secondary',
              }}
            >
              <ArtistCell artistNameRaw={artistName} variant="body2" albumArtist={isAlbumArtist} />
              {releaseYear != null && releaseYear !== '' && (
                <>
                  <Typography variant="body2" sx={{ mx: 0.5 }}>
                    ·
                  </Typography>
                  <Typography
                    variant="body2"
                    onClick={() =>
                      navigate(`/main_window/years/${encodeURIComponent(String(releaseYear))}`)
                    }
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                    }}
                  >
                    {releaseYear as string | number}
                  </Typography>
                </>
              )}
              {songs.length > 0 && (
                <Typography variant="body2" sx={{ ml: 0.5 }}>
                  · {songs.length} {songs.length === 1 ? 'song' : 'songs'} · {totalDuration(songs)}
                </Typography>
              )}
            </Box>

            {/* Play all button */}
            <Button
              onClick={() => handlePlayAll(0)}
              variant="contained"
              sx={{
                mt: 1,
              }}
            >
              ▶ Play All
            </Button>
          </Box>
        </Box>
      </Box>

      <ImagePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        imageSrc={coverSrc}
        imageAlt={albumTitle}
      />

      {/* Track list */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {isLoading ? (
          <LinearProgress color="primary" sx={{ m: 2, borderRadius: 1 }} />
        ) : error ? (
          <Typography sx={{ p: 3, color: 'error.main' }}>Error loading tracks</Typography>
        ) : (
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <FixedSizeList
                ref={listRef}
                height={height}
                width={width}
                itemCount={songs.length}
                itemSize={ROW_HEIGHT}
                initialScrollOffset={initialScrollOffset}
                overscanCount={20}
                onScroll={handleScroll}
              >
                {Row}
              </FixedSizeList>
            )}
          </AutoSizer>
        )}
      </Box>
    </Box>
  );
};

export default AlbumDetail;
