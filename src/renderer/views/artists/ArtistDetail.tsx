import React, { useContext, useEffect, useCallback, useState, useRef } from 'react';
import {
  alpha,
  Box,
  Typography,
  LinearProgress,
  ListItemButton,
  useMediaQuery,
  useTheme,
  Theme,
  ButtonGroup,
  Button,
  Menu,
  MenuItem,
  Collapse,
} from '@mui/material';
import { useParams, useLocation, useNavigate } from 'react-router';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageToolbar from '../../components/PageToolbar';
import { useIpc } from '../../state/ipc';
import { store, Track } from '../../utils/store';
import { QUERY_KEYS } from '../../constants/queryKeys';
import { useScrollHidePlayerBar } from '../../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../../utils/useScrollRestoration';
import { Icon } from '@iconify/react';
import { artPlaceholderSx } from '../../styles/listSx';
import ChevronDownIcon from '@iconify/icons-fluent/chevron-down-24-filled';
import AppDialog from '../../components/AppDialog';
import ImagePreviewDialog from '../../components/ImagePreviewDialog';
import { DEFAULT_AA } from '../../../config/constants';

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

/** @deprecated need to replace with a more modern placeholder */
const placeholderArt = (theme: Theme, size: number, glyph: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" rx="${size / 15}" fill="${theme.palette.surfaces.artFrom}"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="Inter,system-ui,sans-serif" font-size="${size * 0.44}" fill="${theme.palette.primary.main}" opacity="0.85">${glyph}</text></svg>`
  );

interface ArtistDetailProps {
  showAlbumArtist?: boolean;
}

const ArtistDetail: React.FC<ArtistDetailProps> = ({ showAlbumArtist = false }) => {
  const { artistId } = useParams<{ artistId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const theme = useTheme();
  const { scrollRef, saveScrollPosition } = useScrollRestoration(location.pathname);
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const menuOpen = Boolean(menuAnchorEl);
  const [biographyOpen, setBiographyOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      // Force re-fetch from remote (clears local cache + DB record first)
      await invokeEventToMainProcess('force-fetch-artist-profile-image', {
        artistId: Number(artistId),
      });
      // Then refresh all queries so the UI picks up new data
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.ARTIST_DETAIL, artistId, showAlbumArtist],
      });
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.ARTIST_META, artistId],
      });
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.ARTIST_SONGS, artistId, showAlbumArtist],
      });
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.ARTIST_ALBUMS, artistId, showAlbumArtist],
      });
    } finally {
      setIsSyncing(false);
    }
  }, [artistId, invokeEventToMainProcess, queryClient, showAlbumArtist]);

  const {
    data: artist,
    isLoading: artistLoading,
    error: artistError,
  } = useQuery({
    queryKey: [QUERY_KEYS.ARTIST_DETAIL, artistId, showAlbumArtist],
    queryFn: () =>
      invokeEventToMainProcess(showAlbumArtist ? 'get-album-artist-detail' : 'get-artist-detail', {
        artistId: Number(artistId),
      }) as Promise<ArtistDetailData | null>,
    enabled: !!artistId,
  });

  const {
    data: artistMeta,
    isLoading: artistMetaLoading,
    error: artistMetaError,
  } = useQuery({
    queryKey: [QUERY_KEYS.ARTIST_META, artistId],
    queryFn: () =>
      invokeEventToMainProcess('get-artist-meta', { artistId: Number(artistId) }) as Promise<Record<
        string,
        unknown
      > | null>,
    enabled: !!artistId,
  });

  const {
    data: songs = [],
    isLoading: songsLoading,
    error: songsError,
  } = useQuery({
    queryKey: [QUERY_KEYS.ARTIST_SONGS, artistId, showAlbumArtist],
    queryFn: () =>
      invokeEventToMainProcess(showAlbumArtist ? 'get-album-artist-songs' : 'get-artist-songs', {
        artistId: Number(artistId),
      }) as Promise<Track[]>,
    enabled: !!artistId,
  });

  const {
    data: albums = [],
    isLoading: albumsLoading,
    error: albumsError,
  } = useQuery({
    queryKey: [QUERY_KEYS.ARTIST_ALBUMS, artistId, showAlbumArtist],
    queryFn: () =>
      invokeEventToMainProcess(showAlbumArtist ? 'get-album-artist-albums' : 'get-artist-albums', {
        artistId: Number(artistId),
      }) as Promise<ArtistAlbum[]>,
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

  const focusTrackId = (location.state as { focusTrackId?: string | number } | null)?.focusTrackId;
  const focusTs = (location.state as { _ts?: number } | null)?._ts;
  useEffect(() => {
    if (focusTrackId == null || !songs.length || !scrollRef.current) return;
    // Wait a tick for the rows to render after data load.
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(
        `[data-track-id="${focusTrackId}"]`
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [focusTrackId, focusTs, songs, scrollRef]);

  const artistStats = React.useMemo(() => {
    const parts: string[] = [];
    if (artist?.AlbumCount) parts.push(`${artist.AlbumCount} albums`);
    if (artist?.SongCount) parts.push(`${artist.SongCount} songs`);
    if (songs.length) parts.push(totalDuration(songs));
    return parts.join(' • ');
  }, [artist, songs]);

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

  /** Queue order must match what the page renders: albums by year, then the orphan bucket. */
  const orderedSongs = React.useMemo(
    () =>
      albums.length
        ? [...sortedAlbums.flatMap(album => albumTracksMap.get(album.Id) || []), ...orphanTracks]
        : songs,
    [albums.length, sortedAlbums, albumTracksMap, orphanTracks, songs]
  );

  const handlePlayAll = useCallback(
    (startIndex = 0) => {
      if (!orderedSongs.length || startIndex < 0) return;
      dispatch({
        type: 'SET_QUEUE',
        payload: {
          queue: orderedSongs,
          index: startIndex,
          source: location.pathname + location.search,
        },
      });
      dispatch({ type: 'SET_CURR_TRACK', payload: orderedSongs[startIndex] });
      dispatch({ type: 'SET_IS_PLAYING', payload: true });
    },
    [orderedSongs, dispatch, location.pathname, location.search]
  );

  const loading = artistLoading || artistMetaLoading || songsLoading || albumsLoading;
  const error = artistError || artistMetaError || songsError || albumsError;

  if (loading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title={showAlbumArtist ? 'Album Artist' : 'Artist'} />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );

  if (error || !artist)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title={showAlbumArtist ? 'Album Artist' : 'Artist'} />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading artist details</Typography>
      </Box>
    );

  const imageSource = artist.ProfileImg || artist.ProfileImgUri || artist.profileImgUri || null;
  const imageSrc = resolveImageSrc(imageSource);

  const onContentScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const y = event.currentTarget.scrollTop;
    // Use a small hysteresis band to avoid rapid toggle jitter near the top.
    const condensed = isHeaderCondensed ? y > 8 : y > 24;
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
          borderBottom: '1px solid',
          borderColor: 'divider',
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
              role={imageSrc ? 'button' : undefined}
              tabIndex={imageSrc ? 0 : -1}
              onClick={() => {
                if (imageSrc) setPreviewOpen(true);
              }}
              onKeyDown={event => {
                if (!imageSrc) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setPreviewOpen(true);
                }
              }}
              sx={{
                aspectRatio: '1 / 1',
                borderRadius: 1,
                overflow: 'hidden',
                cursor: imageSrc ? 'zoom-in' : 'default',
              }}
            >
              {imageSrc ? (
                <img
                  src={imageSrc}
                  alt={artist.Name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = placeholderArt(
                      theme,
                      360,
                      artist.Name.charAt(0).toUpperCase()
                    );
                  }}
                />
              ) : (
                <Box sx={{ ...artPlaceholderSx, width: '100%', height: '100%' }}>
                  <Typography sx={{ fontSize: 48, fontWeight: 700 }}>
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
                  color: theme.palette.text.primary,
                  lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'block',
                }}
              >
                {artist.Name}
              </motion.span>
              <Typography sx={{ color: 'text.secondary', mt: 0.5, fontSize: 14 }}>
                {artistStats || '--'}
              </Typography>
              <Collapse in={!isHeaderCondensed} timeout={220} collapsedSize={0}>
                <Box sx={{ pt: 0.25 }}>
                  <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                    {showAlbumArtist ? 'Album Artist' : 'Artist'}
                  </Typography>
                  <ButtonGroup
                    variant="contained"
                    aria-label="Button group with a nested menu"
                    sx={{ mt: 0.75 }}
                  >
                    <Button onClick={() => handlePlayAll(0)}>▶&nbsp;&nbsp;Play All</Button>
                    <Button
                      size="small"
                      ref={dropdownButtonRef}
                      aria-controls={menuOpen ? 'artist-action-menu' : undefined}
                      aria-expanded={menuOpen ? 'true' : undefined}
                      aria-label="more options"
                      aria-haspopup="menu"
                      onClick={e => setMenuAnchorEl(e.currentTarget)}
                    >
                      <Icon icon={ChevronDownIcon} width={'1rem'} />
                    </Button>
                  </ButtonGroup>
                </Box>
              </Collapse>
              <Menu
                id="artist-action-menu"
                anchorEl={menuAnchorEl}
                open={menuOpen}
                onClose={() => setMenuAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem
                  onClick={() => {
                    setMenuAnchorEl(null);
                    setBiographyOpen(true);
                  }}
                  disabled={!artistMeta?.strBiography}
                >
                  Biography
                </MenuItem>
                <MenuItem
                  disabled={isSyncing}
                  onClick={() => {
                    setMenuAnchorEl(null);
                    handleSync();
                  }}
                >
                  Refresh Artist Info
                </MenuItem>
              </Menu>
              <AppDialog
                open={biographyOpen}
                onClose={() => setBiographyOpen(false)}
                title={`${artist?.Name} - Biography`}
                headerAction={
                  <Button size="small" onClick={() => setBiographyOpen(false)}>
                    Close
                  </Button>
                }
              >
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-line', color: 'text.secondary', lineHeight: 1.8 }}
                >
                  {(artistMeta?.strBiography as string) || 'No biography available.'}
                </Typography>
              </AppDialog>
            </Box>
          </Box>
        </Box>
      </Box>

      <ImagePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        imageSrc={imageSrc}
        imageAlt={artist.Name}
      />

      <Box
        ref={scrollRef}
        sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}
        onScroll={onContentScroll}
      >
        <Box sx={{ pl: 2, py: 2, minWidth: 0 }}>
          <Typography variant="h6" sx={{ mb: 2, color: 'text.primary' }}>
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
                      <Box
                        component="img"
                        src={
                          resolveImageSrc(album.CoverUri) ||
                          resolveImageSrc(album.coverUri) ||
                          DEFAULT_AA
                        }
                        alt={album.Title}
                        onClick={() => navigate(`/main_window/albums/${album.Id}`)}
                        sx={{
                          width: 150,
                          height: 150,
                          borderRadius: 0.5,
                          objectFit: 'cover',
                          transition: 'filter 0.15s, transform 0.15s, box-shadow 0.15s',
                          '&:hover': {
                            filter: 'brightness(1.12)',
                            boxShadow: theme => `0 0 0 2px ${theme.palette.primary.main}`,
                          },
                          '&:active': { transform: 'scale(0.97)' },
                        }}
                        onError={e => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = DEFAULT_AA;
                        }}
                      />
                      <Box sx={{ minWidth: '100%', gap: 0.5, mb: 1 }}>
                        <Typography
                          variant="body2"
                          onClick={() => navigate(`/main_window/albums/${album.Id}`)}
                          sx={{
                            fontWeight: 700,
                            color: 'text.primary',
                            '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                          }}
                        >
                          {album.Title}
                        </Typography>
                        <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                          {album.ReleaseYear != null ? (
                            <Box
                              component="span"
                              onClick={() =>
                                navigate(
                                  `/main_window/years/${encodeURIComponent(String(album.ReleaseYear))}`
                                )
                              }
                              sx={{
                                '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                              }}
                            >
                              {album.ReleaseYear}
                            </Box>
                          ) : (
                            'Unknown'
                          )}
                          {' • '}
                          {album.SongCount} songs
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
                          data-track-id={song.Id ?? ''}
                          selected={song.Id === state.track?.Id}
                          onClick={() =>
                            handlePlayAll(orderedSongs.findIndex(s => s.Id === song.Id))
                          }
                          sx={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            py: 1,
                            px: 1.5,
                            borderRadius: 1,
                            bgcolor: theme =>
                              song.Id === state.track?.Id
                                ? theme.palette.surfaces.selection
                                : trackIndex % 2 === 0
                                  ? alpha(theme.palette.text.primary, 0.03)
                                  : 'transparent',
                            minWidth: 0,
                          }}
                        >
                          <Box sx={{ minWidth: 40, pr: 2, textAlign: 'right' }}>
                            <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                              {formatTrackNumber(
                                song.TrackNumber as string | number | null | undefined
                              ) ?? trackIndex + 1}
                            </Typography>
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0, pr: 2 }}>
                            <Typography
                              noWrap
                              sx={{
                                color: 'text.primary',
                                fontWeight: 600,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {(song.Title as string) || 'Unknown'}
                            </Typography>
                          </Box>
                          <Box sx={{ minWidth: 60, textAlign: 'right' }}>
                            <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
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
                    border: '1px solid',
                    borderColor: theme => alpha(theme.palette.text.primary, 0.08),
                    bgcolor: 'background.paper',
                    p: 2,
                  }}
                >
                  <Typography sx={{ mb: 1, color: 'text.primary', fontWeight: 700 }}>
                    All tracks
                  </Typography>
                  <Box>
                    {songs.map((song, index) => (
                      <ListItemButton
                        key={song.Id ?? index}
                        data-track-id={song.Id ?? ''}
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
                          bgcolor: theme =>
                            song.Id === state.track?.Id
                              ? theme.palette.surfaces.selection
                              : index % 2 === 0
                                ? 'transparent'
                                : alpha(theme.palette.text.primary, 0.04),
                        }}
                      >
                        <Box sx={{ minWidth: 40, pr: 2, textAlign: 'right' }}>
                          <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                            {formatTrackNumber(
                              song.TrackNumber as string | number | null | undefined
                            ) ?? index + 1}
                          </Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pr: 2 }}>
                          <Typography
                            noWrap
                            sx={{
                              color: 'text.primary',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {(song.Title as string) || 'Unknown'}
                          </Typography>
                        </Box>
                        <Box sx={{ minWidth: 60, textAlign: 'right' }}>
                          <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
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
                    border: '1px solid',
                    borderColor: theme => alpha(theme.palette.text.primary, 0.08),
                    bgcolor: 'background.paper',
                    p: 2,
                  }}
                >
                  <Typography sx={{ mb: 1, color: 'text.primary', fontWeight: 700 }}>
                    Unknown album
                  </Typography>
                  <Box>
                    {orphanTracks.map((song, index) => (
                      <ListItemButton
                        key={song.Id ?? index}
                        data-track-id={song.Id ?? ''}
                        selected={song.Id === state.track?.Id}
                        onClick={() => handlePlayAll(orderedSongs.findIndex(s => s.Id === song.Id))}
                        sx={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          py: 1,
                          px: 1.5,
                          borderRadius: 1,
                          mb: 0.5,
                          bgcolor: theme =>
                            song.Id === state.track?.Id
                              ? theme.palette.surfaces.selection
                              : index % 2 === 0
                                ? alpha(theme.palette.text.primary, 0.02)
                                : alpha(theme.palette.text.primary, 0.04),
                        }}
                      >
                        <Box sx={{ minWidth: 40, pr: 2, textAlign: 'right' }}>
                          <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                            {formatTrackNumber(
                              song.TrackNumber as string | number | null | undefined
                            ) ?? index + 1}
                          </Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pr: 2 }}>
                          <Typography
                            noWrap
                            sx={{
                              color: 'text.primary',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {(song.Title as string) || 'Unknown'}
                          </Typography>
                        </Box>
                        <Box sx={{ minWidth: 60, textAlign: 'right' }}>
                          <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
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
