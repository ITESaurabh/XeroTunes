import React, { useContext, useEffect, useCallback, useState } from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  ListItemButton,
  useMediaQuery,
  Theme,
} from '@mui/material';
import { useParams, useLocation } from 'react-router';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import PageToolbar from '../../components/PageToolbar';
import { useIpc } from '../../state/ipc';
import { store, Track } from '../../utils/store';
import { QUERY_KEYS } from '../../constants/queryKeys';
import { useScrollHidePlayerBar } from '../../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../../utils/useScrollRestoration';

interface ArtistDetailData {
  Id: number;
  Name: string;
  ProfileImgUri?: string | null;
  ProfileImg?: string | null;
  profileImgUri?: string | null;
  SongCount: number;
  AlbumCount: number;
  ArtistMeta?: unknown | null;
}

interface ArtistAlbum {
  Id: number;
  Title: string;
  ReleaseYear: number | null;
  CoverUri: string | null;
  coverUri?: string | null;
  SongCount: number;
}

const formatDuration = (seconds: unknown): string => {
  const secs = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (secs == null) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const totalDuration = (songs: Track[]): string => {
  const total = songs.reduce((acc, song) => acc + ((song.Duration as number) || 0), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} hr ${m} mins`;
  return `${m} mins`;
};

function formatTrackNumber(trackNumber?: string | number | null): number | null {
  if (trackNumber === null || trackNumber === undefined || trackNumber === '') return null;
  const num = typeof trackNumber === 'number' ? trackNumber : Number(trackNumber);
  if (Number.isNaN(num)) return null;
  return Math.trunc(num);
}

const isRemoteUri = (uri: string) =>
  uri.startsWith('http://') ||
  uri.startsWith('https://') ||
  uri.startsWith('file://') ||
  uri.startsWith('data:');

const toFileUrl = (uri: string) => {
  const normalized = uri.replace(/\\/g, '/');
  if (normalized.startsWith('file://')) return normalized;
  if (/^[A-Za-z]:/.test(normalized)) return `file:///${normalized}`;
  if (/^\/[A-Za-z]:/.test(normalized)) return `file://${normalized}`;
  if (normalized.startsWith('/')) return `file://${normalized}`;
  return `file:///${normalized}`;
};

const resolveImageSrc = (uri: string | null | undefined) => {
  if (!uri) return undefined;
  return isRemoteUri(uri) ? uri : toFileUrl(uri);
};

const ArtistDetail: React.FC = () => {
  const { artistId } = useParams<{ artistId: string }>();
  const location = useLocation();
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const { scrollRef, saveScrollPosition } = useScrollRestoration(location.pathname);

  const {
    data: artist,
    isLoading: artistLoading,
    error: artistError,
  } = useQuery({
    queryKey: [QUERY_KEYS.ARTIST_DETAIL, artistId],
    queryFn: () =>
      invokeEventToMainProcess('get-artist-detail', {
        artistId: Number(artistId),
      }) as Promise<ArtistDetailData | null>,
    enabled: !!artistId,
  });

  const { isLoading: artistMetaLoading, error: artistMetaError } = useQuery({
    queryKey: [QUERY_KEYS.ARTIST_META, artistId],
    queryFn: () =>
      invokeEventToMainProcess('get-artist-meta', { artistId: Number(artistId) }) as Promise<
        unknown | null
      >,
    enabled: !!artistId,
  });

  const {
    data: songs = [],
    isLoading: songsLoading,
    error: songsError,
  } = useQuery({
    queryKey: [QUERY_KEYS.ARTIST_SONGS, artistId],
    queryFn: () =>
      invokeEventToMainProcess('get-artist-songs', { artistId: Number(artistId) }) as Promise<
        Track[]
      >,
    enabled: !!artistId,
  });

  const {
    data: albums = [],
    isLoading: albumsLoading,
    error: albumsError,
  } = useQuery({
    queryKey: [QUERY_KEYS.ARTIST_ALBUMS, artistId],
    queryFn: () =>
      invokeEventToMainProcess('get-artist-albums', { artistId: Number(artistId) }) as Promise<
        ArtistAlbum[]
      >,
    enabled: !!artistId,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const [isHeaderCondensed, setIsHeaderCondensed] = useState(false);

  const condensedTitleSize = isHeaderCondensed ? (isPhone ? 22 : 34) : isPhone ? 30 : 48;
  const headerHeight = useMotionValue(isHeaderCondensed ? 120 : 210);
  const imageSize = useMotionValue(isHeaderCondensed ? 80 : 180);
  const titleSize = useMotionValue(condensedTitleSize);

  const animatedHeaderHeight = useSpring(headerHeight, {
    damping: 26,
    stiffness: 210,
  });
  const animatedImageSize = useSpring(imageSize, {
    damping: 28,
    stiffness: 220,
  });
  const animatedTitleSize = useSpring(titleSize, {
    damping: 24,
    stiffness: 200,
  });

  useEffect(() => {
    headerHeight.set(isHeaderCondensed ? 120 : 210);
    imageSize.set(isHeaderCondensed ? 80 : 180);
    titleSize.set(condensedTitleSize);
  }, [condensedTitleSize, headerHeight, imageSize, isHeaderCondensed, titleSize]);

  const hasAlbums = albums.length > 0;
  const hasSongs = songs.length > 0;

  const sortedAlbums = React.useMemo(() => {
    return [...albums].sort((a, b) => {
      const aYear = a.ReleaseYear ?? -1;
      const bYear = b.ReleaseYear ?? -1;
      if (aYear !== bYear) return bYear - aYear;
      return a.Title.localeCompare(b.Title, undefined, { sensitivity: 'base' });
    });
  }, [albums]);

  const handlePlayAll = useCallback(
    (startIndex = 0) => {
      if (!songs.length) return;
      dispatch({ type: 'SET_QUEUE', payload: { queue: songs, index: startIndex } });
      dispatch({ type: 'SET_CURR_TRACK', payload: songs[startIndex] });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    },
    [songs, dispatch]
  );

  const handleScroll = useScrollHidePlayerBar<{ scrollTop: number }>({
    field: 'scrollTop',
    threshold: 0,
  });

  const albumTracksMap = React.useMemo(() => {
    const map = new Map<number, Track[]>();
    songs.forEach(song => {
      const albumId = song.AlbumId as number | undefined;
      if (albumId == null) return;
      if (!map.has(albumId)) map.set(albumId, []);
      map.get(albumId)?.push(song);
    });
    return map;
  }, [songs]);

  const albumIdSet = React.useMemo(() => new Set(albums.map(a => a.Id)), [albums]);
  const orphanTracks = React.useMemo(
    () => songs.filter(song => song.AlbumId == null || !albumIdSet.has(song.AlbumId as number)),
    [songs, albumIdSet]
  );

  const loading = artistLoading || artistMetaLoading || songsLoading || albumsLoading;
  const error = artistError || artistMetaError || songsError || albumsError;

  if (loading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Artist" />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );

  if (error || !artist)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Artist" />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading artist details</Typography>
      </Box>
    );

  const imageSource = artist.ProfileImg || artist.ProfileImgUri || artist.profileImgUri || null;
  const imageSrc = resolveImageSrc(imageSource);

  const onContentScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const y = event.currentTarget.scrollTop;
    const condensed = y > 0;
    if (condensed !== isHeaderCondensed) {
      setIsHeaderCondensed(condensed);
    }
    saveScrollPosition(y);
    handleScroll({ scrollTop: y });
  };

  return (
    <Box
      component={motion.div}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      transition={{ duration: 0.3 }}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Box
        component={motion.div}
        initial={false}
        style={{ height: animatedHeaderHeight }}
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          transition: theme =>
            theme.transitions.create(['padding', 'background-color'], {
              duration: theme.transitions.duration.shortest,
            }),
          px: 3,
          py: 1,
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          // backgroundColor: 'rgba(12,12,20,0.95)',
          // backdropFilter: 'blur(8px)',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2,
            height: '100%',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <Box
              component={motion.div}
              style={{ width: animatedImageSize, height: animatedImageSize }}
              sx={{
                aspectRatio: '1 / 1',
                borderRadius: 1,
                overflow: 'hidden',
              }}
            >
              {imageSrc ? (
                <img
                  src={imageSrc}
                  alt={artist.Name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src =
                      'data:image/svg+xml;utf8,' +
                      encodeURIComponent(
                        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360"><rect width="100%" height="100%" rx="24" fill="#1e1e3f"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="Inter,system-ui,sans-serif" font-size="160" fill="#ffffff" opacity="0.75">${artist.Name.charAt(0).toUpperCase()}</text></svg>`
                      );
                  }}
                />
              ) : (
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #1e1e3f 0%, #2d2d5a 100%)',
                  }}
                >
                  <Typography sx={{ color: 'white', fontSize: 48, fontWeight: 700 }}>
                    {artist.Name.charAt(0).toUpperCase()}
                  </Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <motion.span
                style={{
                  fontSize: animatedTitleSize,
                  fontWeight: 800,
                  color: 'white',
                  lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'block',
                }}
              >
                {artist.Name}
              </motion.span>
              <Typography sx={{ color: 'grey.300', mt: 0.5, fontSize: 14 }}>
                {artist.AlbumCount} albums • {artist.SongCount} songs • {totalDuration(songs)}
              </Typography>
              {!isHeaderCondensed && (
                <Typography sx={{ color: 'grey.400', fontSize: 12 }}>Artist • Mashup</Typography>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <Box
        ref={scrollRef}
        sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}
        onScroll={onContentScroll}
      >
        <Box sx={{ pl: 2, py: 2, minWidth: 0 }}>
          <Typography variant="h6" sx={{ mb: 2, color: 'common.white' }}>
            In your library
          </Typography>
          {!hasSongs ? (
            <Typography color="text.secondary">No tracks found for this artist.</Typography>
          ) : (
            <Box
              id="artist-albums"
              sx={{ display: 'grid', gap: 2, width: '100%', maxWidth: '100%', minWidth: 0 }}
            >
              {hasAlbums ? (
                sortedAlbums.map(album => (
                  <Box
                    key={album.Id}
                    sx={{
                      // borderRadius: 0.5,
                      // border: '1px solid rgba(255,255,255,0.08)',
                      display: 'flex',
                      flexDirection: {
                        xs: 'column',
                        sm: 'row',
                      },
                      alignContent: 'flex-start',
                      px: 0.5,
                      width: '100%',
                      minWidth: 0,
                      maxWidth: '100%',
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        flexDirection: 'column',
                        width: 150,
                        maxWidth: 150,
                        alignContent: 'flex-start',
                        justifyContent: 'flex-start',
                        gap: 1,
                        mr: 1,
                      }}
                    >
                      {resolveImageSrc(album.CoverUri) || resolveImageSrc(album.coverUri) ? (
                        <Box
                          component="img"
                          src={resolveImageSrc(album.CoverUri) || resolveImageSrc(album.coverUri)}
                          alt={album.Title}
                          sx={{ width: 150, height: 150, borderRadius: 0.5, objectFit: 'cover' }}
                          onError={e => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src =
                              'data:image/svg+xml;utf8,' +
                              encodeURIComponent(
                                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="100%" height="100%" rx="18" fill="#1e1e3f"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="Inter,system-ui,sans-serif" font-size="52" fill="#ffffff" opacity="0.75">♪</text></svg>`
                              );
                          }}
                        />
                      ) : (
                        <Box
                          sx={{
                            width: 50,
                            height: 50,
                            borderRadius: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'linear-gradient(135deg, #1e1e3f 0%, #2d2d5a 100%)',
                          }}
                        >
                          <Typography sx={{ color: 'white', fontSize: 20, lineHeight: 1 }}>
                            ♪
                          </Typography>
                        </Box>
                      )}
                      <Box sx={{ minWidth: 0, gap: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: 'common.white' }}>
                          {album.Title}
                        </Typography>
                        <Typography sx={{ color: 'grey.300', fontSize: '0.8rem' }}>
                          {album.ReleaseYear ?? 'Unknown'} • {album.SongCount} songs
                        </Typography>
                      </Box>
                    </Box>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        flex: 1,
                        height: 'fit-content',
                        justifyContent: 'flex-start',
                        maxWidth: {
                          xs: '100%',
                          sm: 'calc(100% - 160px)',
                        },
                      }}
                    >
                      {(albumTracksMap.get(album.Id) || []).map((song, trackIndex) => (
                        <ListItemButton
                          key={song.Id ?? trackIndex}
                          selected={song.Id === state.track?.Id}
                          onClick={() => handlePlayAll(songs.findIndex(s => s.Id === song.Id))}
                          sx={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            py: 1,
                            px: 1.5,
                            borderRadius: 1,
                            background:
                              song.Id === state.track?.Id
                                ? 'rgba(98, 0, 238, 0.15)'
                                : trackIndex % 2 === 0
                                  ? 'rgba(255,255,255,0.03)'
                                  : undefined,
                            minWidth: 0,
                          }}
                        >
                          <Box sx={{ minWidth: 40, pr: 2, textAlign: 'right' }}>
                            <Typography sx={{ color: 'grey.300', fontSize: 12 }}>
                              {formatTrackNumber(
                                song.TrackNumber as string | number | null | undefined
                              ) ?? trackIndex + 1}
                            </Typography>
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0, pr: 2 }}>
                            <Typography
                              noWrap
                              sx={{
                                color: 'common.white',
                                fontWeight: 600,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {(song.Title as string) || 'Unknown'}
                            </Typography>
                          </Box>
                          <Box sx={{ minWidth: 60, textAlign: 'right' }}>
                            <Typography sx={{ color: 'grey.300', fontSize: 12 }}>
                              {formatDuration(song.Duration)}
                            </Typography>
                          </Box>
                        </ListItemButton>
                      ))}
                    </Box>
                  </Box>
                ))
              ) : (
                <Box
                  sx={{
                    borderRadius: 2,
                    border: '1px solid rgba(255,255,255,0.08)',
                    bgcolor: 'rgba(18,18,24,0.85)',
                    p: 2,
                  }}
                >
                  <Typography sx={{ mb: 1, color: 'common.white', fontWeight: 700 }}>
                    All tracks
                  </Typography>
                  <Box>
                    {songs.map((song, index) => (
                      <ListItemButton
                        key={song.Id ?? index}
                        selected={song.Id === state.track?.Id}
                        onClick={() => handlePlayAll(index)}
                        sx={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          py: 1,
                          px: 1.5,
                          borderRadius: 1,
                          mb: 0.5,
                          background:
                            song.Id === state.track?.Id
                              ? 'rgba(98, 0, 238, 0.15)'
                              : index % 2 === 0
                                ? 'rgba(255,255,255,0.00)'
                                : 'rgba(255,255,255,0.04)',
                        }}
                      >
                        <Box sx={{ minWidth: 40, pr: 2, textAlign: 'right' }}>
                          <Typography sx={{ color: 'grey.300', fontSize: 12 }}>
                            {formatTrackNumber(
                              song.TrackNumber as string | number | null | undefined
                            ) ?? index + 1}
                          </Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pr: 2 }}>
                          <Typography
                            noWrap
                            sx={{
                              color: 'common.white',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {(song.Title as string) || 'Unknown'}
                          </Typography>
                        </Box>
                        <Box sx={{ minWidth: 60, textAlign: 'right' }}>
                          <Typography sx={{ color: 'grey.300', fontSize: 12 }}>
                            {formatDuration(song.Duration)}
                          </Typography>
                        </Box>
                      </ListItemButton>
                    ))}
                  </Box>
                </Box>
              )}
              {orphanTracks.length > 0 && (
                <Box
                  sx={{
                    borderRadius: 2,
                    border: '1px solid rgba(255,255,255,0.08)',
                    bgcolor: 'rgba(18,18,24,0.85)',
                    p: 2,
                  }}
                >
                  <Typography sx={{ mb: 1, color: 'common.white', fontWeight: 700 }}>
                    Unknown album
                  </Typography>
                  <Box>
                    {orphanTracks.map((song, index) => (
                      <ListItemButton
                        key={song.Id ?? index}
                        selected={song.Id === state.track?.Id}
                        onClick={() => handlePlayAll(songs.findIndex(s => s.Id === song.Id))}
                        sx={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          py: 1,
                          px: 1.5,
                          borderRadius: 1,
                          mb: 0.5,
                          background:
                            song.Id === state.track?.Id
                              ? 'rgba(98, 0, 238, 0.15)'
                              : index % 2 === 0
                                ? 'rgba(255,255,255,0.02)'
                                : 'rgba(255,255,255,0.04)',
                        }}
                      >
                        <Box sx={{ minWidth: 40, pr: 2, textAlign: 'right' }}>
                          <Typography sx={{ color: 'grey.300', fontSize: 12 }}>
                            {formatTrackNumber(
                              song.TrackNumber as string | number | null | undefined
                            ) ?? index + 1}
                          </Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pr: 2 }}>
                          <Typography
                            noWrap
                            sx={{
                              color: 'common.white',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {(song.Title as string) || 'Unknown'}
                          </Typography>
                        </Box>
                        <Box sx={{ minWidth: 60, textAlign: 'right' }}>
                          <Typography sx={{ color: 'grey.300', fontSize: 12 }}>
                            {formatDuration(song.Duration)}
                          </Typography>
                        </Box>
                      </ListItemButton>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default ArtistDetail;
