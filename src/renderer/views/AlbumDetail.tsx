import React, { useContext, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  ListItemButton,
  useMediaQuery,
  Theme,
  Button,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';

interface AlbumSong extends Track {
  TrackNumber?: string | number;
  ArtistName?: string;
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
  const navigate = useNavigate();
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));

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
      dispatch({ type: 'SET_QUEUE', payload: { queue: songs, index: startIndex } });
      dispatch({ type: 'SET_CURR_TRACK', payload: songs[startIndex] });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    },
    [songs, dispatch]
  );

  // Derive album metadata from first song
  const albumTitle = songs[0]?.AlbumTitle ?? 'Unknown Album';
  const artistName = songs[0]?.ArtistName ?? 'Unknown Artist';
  const coverUri = songs[0]?.AlbumCoverUri ?? null;
  const releaseYear = songs[0]?.['Year'] ?? null;

  const ROW_HEIGHT = 60;
  const handleScroll = useScrollHidePlayerBar();

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const song = songs[index] as AlbumSong;
      const isActive = song.Id === state.track?.Id;

      return (
        <ListItemButton
          style={style}
          selected={isActive}
          onClick={() => handlePlayAll(index)}
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
              <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>
                {song.ArtistName || ''}
              </Typography>
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
        sx={{
          // height: HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          p: {
            xs: 2,
            md: 5,
          },
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '0.5rem 0 0 0',
          // borderTopLeftRadius: 0.5,
          // borderTopRightRadius: 0.5,
          // borderBottomLeftRadius: 0.5,
          // borderBottomRightRadius: 0.5,
          background: 'rgba(255,255,255,0.04)',
        }}
      >
        {/* Blurred background art */}
        {coverUri && (
          <Box
            component="img"
            src={`file://${coverUri}`}
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
            sx={{
              width: isPhone ? 112 : 200,
              height: isPhone ? 112 : 200,
              borderRadius: 0.5,
              overflow: 'hidden',
              flexShrink: 0,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              background: 'linear-gradient(135deg, #1e1e3f 0%, #2d2d5a 100%)',
            }}
          >
            {coverUri ? (
              <Box
                component="img"
                src={`file://${coverUri}`}
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
          <Box>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1 }}
            >
              Album
            </Typography>
            <Typography
              variant={isPhone ? 'h5' : 'h4'}
              sx={{ fontWeight: 800, lineHeight: 1.1, mb: 0.5 }}
            >
              {albumTitle}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {artistName}
              {releaseYear ? ` · ${releaseYear}` : ''}
              {songs.length ? ` · ${songs.length} songs` : ''}
              {songs.length ? ` · ${totalDuration(songs)}` : ''}
            </Typography>

            {/* Play all button */}
            <Button
              onClick={() => handlePlayAll(0)}
              variant="contained"
              sx={{
                mt: 2,
              }}
            >
              ▶ Play All
            </Button>
          </Box>
        </Box>
      </Box>

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
                height={height}
                width={width}
                itemCount={songs.length}
                itemSize={ROW_HEIGHT}
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
