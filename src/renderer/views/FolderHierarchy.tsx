import React, { useContext, useEffect, useMemo, useCallback, useState } from 'react';
import {
  Box,
  Breadcrumbs,
  Button,
  IconButton,
  LinearProgress,
  ListItemButton,
  Theme,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useSearchParams, useLocation, useNavigate } from 'react-router';
import { Icon } from '@iconify/react';
import folderIcon from '@iconify/icons-fluent/folder-24-filled';
import musicNoteIcon from '@iconify/icons-fluent/music-note-2-24-regular';
import chevronRightIcon from '@iconify/icons-fluent/chevron-right-16-regular';
import arrowUpIcon from '@iconify/icons-fluent/arrow-up-24-regular';
import homeIcon from '@iconify/icons-fluent/home-24-regular';
import playIcon from '@iconify/icons-fluent/play-24-filled';
import revealIcon from '@iconify/icons-fluent/folder-arrow-right-24-regular';
import PageToolbar from '../components/PageToolbar';
import ArtistCell from '../components/ArtistCell';
import ViewModeToggle, { GRID_MIN_PX, GRID_GAP, GRID_ICON_REM } from '../components/ViewModeToggle';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { GridSize, ViewMode } from '../../config/app_settings';
import { getFolderViewSettings, setFolderViewSettings } from '../utils/LocStoreUtil';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';

interface SubFolder {
  Path: string;
  Name: string;
  SongCount: number;
  IsRoot?: boolean;
}

interface FolderChildren {
  subfolders: SubFolder[];
  songs: Track[];
  isRoot: boolean;
}

const formatDuration = (seconds: unknown): string => {
  const secs = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const detectSep = (p: string): '\\' | '/' => (p.includes('\\') ? '\\' : '/');

interface BreadcrumbSeg {
  label: string;
  path: string | null;
}

function buildBreadcrumb(currentPath: string | null, roots: SubFolder[]): BreadcrumbSeg[] {
  if (!currentPath) return [];
  const root = roots.find(r => {
    if (currentPath === r.Path) return true;
    const sep = detectSep(r.Path);
    const prefix = r.Path.endsWith(sep) ? r.Path : r.Path + sep;
    return currentPath.startsWith(prefix);
  });

  if (!root) {
    const sep = detectSep(currentPath);
    return [{ label: currentPath.split(sep).pop() || currentPath, path: currentPath }];
  }

  const segs: BreadcrumbSeg[] = [{ label: root.Name, path: root.Path }];
  if (currentPath === root.Path) return segs;

  const sep = detectSep(root.Path);
  const prefix = root.Path.endsWith(sep) ? root.Path : root.Path + sep;
  const remainder = currentPath.slice(prefix.length);
  const parts = remainder.split(sep).filter(Boolean);
  let acc = root.Path.endsWith(sep) ? root.Path.slice(0, -1) : root.Path;
  for (const part of parts) {
    acc = acc + sep + part;
    segs.push({ label: part, path: acc });
  }
  return segs;
}

function getParentPath(currentPath: string, roots: SubFolder[]): string | null {
  const root = roots.find(r => {
    if (currentPath === r.Path) return true;
    const sep = detectSep(r.Path);
    const prefix = r.Path.endsWith(sep) ? r.Path : r.Path + sep;
    return currentPath.startsWith(prefix);
  });
  if (!root) return null;
  if (currentPath === root.Path) return null;
  const sep = detectSep(currentPath);
  const idx = currentPath.lastIndexOf(sep);
  if (idx <= 0) return null;
  const parent = currentPath.slice(0, idx);
  if (parent.length < root.Path.length) return root.Path;
  return parent;
}

interface SubFolderCardProps {
  folder: SubFolder;
  iconSize: string;
  onClick: () => void;
  onHover: () => void;
}

const SubFolderCard: React.FC<SubFolderCardProps> = React.memo(
  ({ folder, iconSize, onClick, onHover }) => (
    <Box
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      tabIndex={0}
      role="button"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        p: 2,
        borderRadius: 2,
        cursor: 'pointer',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        transition: 'background 0.15s, border-color 0.15s',
        '&:hover': {
          background: 'rgba(255,255,255,0.08)',
          borderColor: 'rgba(255,255,255,0.15)',
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
        },
        textAlign: 'center',
        minWidth: 0,
        userSelect: 'none',
      }}
    >
      <Icon
        icon={folderIcon}
        height={iconSize}
        style={{ color: folder.IsRoot ? '#7cc4ff' : '#facc6b', flexShrink: 0 }}
      />
      <Typography variant="body2" noWrap fontWeight={500} sx={{ width: '100%' }}>
        {folder.Name}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {folder.SongCount} {folder.SongCount === 1 ? 'song' : 'songs'}
      </Typography>
    </Box>
  )
);
SubFolderCard.displayName = 'SubFolderCard';

const FolderHierarchy: React.FC = () => {
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const { invokeEventToMainProcess, sendEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentPath = searchParams.get('path');
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => getFolderViewSettings('folderHierarchy').viewMode
  );
  const [gridSize, setGridSize] = useState<GridSize>(
    () => getFolderViewSettings('folderHierarchy').gridSize
  );

  const onScrollHidePlayerBar = useScrollHidePlayerBar<{ scrollTop: number }>({
    field: 'scrollTop',
  });
  const handleBodyScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      onScrollHidePlayerBar({ scrollTop: e.currentTarget.scrollTop });
    },
    [onScrollHidePlayerBar]
  );

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setFolderViewSettings('folderHierarchy', { viewMode: mode });
  }, []);

  const handleGridSize = useCallback((size: GridSize) => {
    setGridSize(size);
    setFolderViewSettings('folderHierarchy', { gridSize: size });
  }, []);

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
  }, [dispatch]);

  const { data: rootsData } = useQuery({
    queryKey: [QUERY_KEYS.FOLDER_CHILDREN, null],
    queryFn: () =>
      invokeEventToMainProcess('get-folder-children', {
        folderPath: null,
      }) as Promise<FolderChildren>,
  });
  const roots = useMemo(() => rootsData?.subfolders ?? [], [rootsData]);

  const {
    data: children,
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.FOLDER_CHILDREN, currentPath],
    queryFn: () =>
      invokeEventToMainProcess('get-folder-children', {
        folderPath: currentPath,
      }) as Promise<FolderChildren>,
  });

  const subfolders = children?.subfolders ?? [];
  const songs = (children?.songs ?? []) as Track[];

  const breadcrumb = useMemo(() => buildBreadcrumb(currentPath, roots), [currentPath, roots]);

  const navigateTo = useCallback(
    (path: string | null) => {
      if (path === null) {
        setSearchParams({});
      } else {
        setSearchParams({ path });
      }
    },
    [setSearchParams]
  );

  const prefetchChildren = useCallback(
    (path: string) => {
      queryClient.prefetchQuery({
        queryKey: [QUERY_KEYS.FOLDER_CHILDREN, path],
        queryFn: () => invokeEventToMainProcess('get-folder-children', { folderPath: path }),
        staleTime: 30_000,
      });
    },
    [queryClient, invokeEventToMainProcess]
  );

  const handleSongClick = useCallback(
    (clickedIndex: number) => {
      if (!songs.length) return;
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

  const handlePlayFolder = useCallback(async () => {
    if (!currentPath) return;
    const all = (await invokeEventToMainProcess('get-songs-in-folder', {
      folderPath: currentPath,
    })) as Track[];
    if (!all.length) return;
    dispatch({
      type: 'SET_QUEUE',
      payload: { queue: all, index: 0, source: location.pathname + location.search },
    });
    dispatch({ type: 'SET_CURR_TRACK', payload: all[0] });
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  }, [currentPath, invokeEventToMainProcess, dispatch, location.pathname, location.search]);

  const focusTrackId = (location.state as { focusTrackId?: string | number } | null)?.focusTrackId;
  const focusTs = (location.state as { _ts?: number } | null)?._ts;
  useEffect(() => {
    if (focusTrackId == null || !songs.length || !bodyRef.current) return;
    const id = requestAnimationFrame(() => {
      const el = bodyRef.current?.querySelector(
        `[data-track-id="${focusTrackId}"]`
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [focusTrackId, focusTs, songs]);

  const handleRevealInExplorer = useCallback(() => {
    if (!currentPath) return;
    sendEventToMainProcess('reveal-folder', { folderPath: currentPath });
  }, [currentPath, sendEventToMainProcess]);

  const parentPath = currentPath ? getParentPath(currentPath, roots) : null;
  const isAtRoot = !currentPath;

  const toolbarAction = useMemo(
    () => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ViewModeToggle
          viewMode={viewMode}
          gridSize={gridSize}
          onChangeViewMode={handleViewMode}
          onChangeGridSize={handleGridSize}
        />
        {!isAtRoot && songs.length > 0 && (
          <Button
            variant="contained"
            size="small"
            startIcon={<Icon icon={playIcon} />}
            onClick={handlePlayFolder}
          >
            Play{isPhone ? '' : ' Folder'}
          </Button>
        )}
      </Box>
    ),
    [
      viewMode,
      gridSize,
      handleViewMode,
      handleGridSize,
      isAtRoot,
      songs.length,
      handlePlayFolder,
      isPhone,
    ]
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
      <PageToolbar title="Folder Hierarchy" action={toolbarAction} />

      {/* Breadcrumb bar — wraps on mobile so the path can scroll without
          getting clipped by the action buttons. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: { xs: 1, md: 2 },
          py: 1,
          mt: 1,
          mx: { xs: 1, md: 2 },
          borderRadius: 1,
          background: 'rgba(255,255,255,0.04)',
          minHeight: 44,
          flexShrink: 0,
          flexWrap: { xs: 'wrap', md: 'nowrap' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <IconButton
            size="small"
            disabled={isAtRoot}
            onClick={() => navigateTo(parentPath)}
            title="Go up"
            aria-label="Go up"
          >
            <Icon icon={arrowUpIcon} height="1.25rem" />
          </IconButton>
          <IconButton
            size="small"
            disabled={isAtRoot}
            onClick={() => navigateTo(null)}
            title="Music Folders"
            aria-label="Music Folders"
          >
            <Icon icon={homeIcon} height="1.25rem" />
          </IconButton>
        </Box>
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            // Hide scrollbar for cleaner look but keep scrolling.
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { height: 4 },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 2,
            },
          }}
        >
          <Breadcrumbs
            separator={<Icon icon={chevronRightIcon} />}
            aria-label="folder breadcrumb"
            sx={{
              ml: { xs: 0.5, md: 1 },
              '& ol': { flexWrap: 'nowrap' },
              '& li': { whiteSpace: 'nowrap' },
            }}
            itemsBeforeCollapse={1}
            itemsAfterCollapse={isPhone ? 2 : 4}
            maxItems={isPhone ? 4 : 8}
          >
            <Box
              component="span"
              onClick={() => navigateTo(null)}
              sx={{
                cursor: 'pointer',
                color: 'text.secondary',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                fontSize: { xs: 13, md: 14 },
                '&:hover': { color: 'primary.main', textDecoration: 'underline' },
              }}
            >
              {isPhone ? 'Home' : 'Music Folders'}
            </Box>
            {breadcrumb.map((seg, i) => {
              const isLast = i === breadcrumb.length - 1;
              return (
                <Box
                  key={seg.path ?? i}
                  component="span"
                  onClick={() => {
                    if (!isLast && seg.path) navigateTo(seg.path);
                  }}
                  onMouseEnter={() => {
                    if (!isLast && seg.path) prefetchChildren(seg.path);
                  }}
                  sx={{
                    cursor: isLast ? 'default' : 'pointer',
                    color: isLast ? 'text.primary' : 'text.secondary',
                    fontWeight: isLast ? 600 : 500,
                    whiteSpace: 'nowrap',
                    fontSize: { xs: 13, md: 14 },
                    '&:hover': isLast
                      ? undefined
                      : { color: 'primary.main', textDecoration: 'underline' },
                  }}
                >
                  {seg.label}
                </Box>
              );
            })}
          </Breadcrumbs>
        </Box>
        {!isAtRoot && (
          <IconButton
            size="small"
            onClick={handleRevealInExplorer}
            title="Reveal in File Explorer"
            aria-label="Reveal in File Explorer"
            sx={{ flexShrink: 0 }}
          >
            <Icon icon={revealIcon} height="1.25rem" />
          </IconButton>
        )}
      </Box>

      {/* Body */}
      <Box
        ref={bodyRef}
        onScroll={handleBodyScroll}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', mt: 1, px: { xs: 1, md: 2 } }}
      >
        {isLoading && <LinearProgress color="primary" sx={{ borderRadius: 1, mb: 2 }} />}
        {error && <Typography sx={{ p: 3, color: 'error.main' }}>Error loading folder.</Typography>}
        {!isLoading && !error && (
          <>
            {isAtRoot && subfolders.length === 0 && (
              <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                <Typography>
                  No music folders configured. Add a Music Folder in Settings to get started.
                </Typography>
              </Box>
            )}

            {subfolders.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography
                  variant="overline"
                  sx={{ color: 'text.secondary', pl: 1, letterSpacing: 1 }}
                >
                  {isAtRoot ? 'Music Folders' : `Folders (${subfolders.length})`}
                </Typography>
                {viewMode === 'grid' ? (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_MIN_PX[gridSize]}px, 1fr))`,
                      gap: GRID_GAP[gridSize],
                      mt: 1,
                    }}
                  >
                    {subfolders.map(sf => (
                      <SubFolderCard
                        key={sf.Path}
                        folder={sf}
                        iconSize={GRID_ICON_REM[gridSize]}
                        onClick={() => navigateTo(sf.Path)}
                        onHover={() => prefetchChildren(sf.Path)}
                      />
                    ))}
                  </Box>
                ) : (
                  <Box>
                    {subfolders.map(sf => (
                      <ListItemButton
                        key={sf.Path}
                        onDoubleClick={() => navigateTo(sf.Path)}
                        onClick={() => navigateTo(sf.Path)}
                        onMouseEnter={() => prefetchChildren(sf.Path)}
                        onFocus={() => prefetchChildren(sf.Path)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          borderRadius: 1,
                          mb: 0.5,
                          px: 1.5,
                          py: 1,
                          '&:hover': { background: 'rgba(255,255,255,0.06)' },
                        }}
                      >
                        <Icon
                          icon={folderIcon}
                          height="1.5rem"
                          style={{
                            color: sf.IsRoot ? '#7cc4ff' : '#facc6b',
                            flexShrink: 0,
                          }}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" noWrap fontWeight={500}>
                            {sf.Name}
                          </Typography>
                          {sf.IsRoot && (
                            <Typography
                              variant="caption"
                              noWrap
                              sx={{
                                color: 'text.secondary',
                                fontFamily: 'monospace',
                                fontSize: 11,
                              }}
                            >
                              {sf.Path}
                            </Typography>
                          )}
                        </Box>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {sf.SongCount} {sf.SongCount === 1 ? 'song' : 'songs'}
                        </Typography>
                      </ListItemButton>
                    ))}
                  </Box>
                )}
              </Box>
            )}

            {songs.length > 0 && (
              <Box>
                <Typography
                  variant="overline"
                  sx={{ color: 'text.secondary', pl: 1, letterSpacing: 1 }}
                >
                  Songs ({songs.length})
                </Typography>
                <Box>
                  {songs.map((song, idx) => (
                    <ListItemButton
                      key={String(song.Id ?? idx)}
                      data-track-id={song.Id ?? ''}
                      onClick={e => {
                        if ((e.target as HTMLElement).closest('[data-nav-cell]')) return;
                        handleSongClick(idx);
                      }}
                      selected={song.Id === state.track?.Id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        borderRadius: 1,
                        mb: 0.25,
                        px: 1.5,
                        py: 0.75,
                        '&:hover': { background: 'rgba(255,255,255,0.06)' },
                      }}
                    >
                      <Icon
                        icon={musicNoteIcon}
                        height="1.1rem"
                        style={{
                          color: song.Id === state.track?.Id ? 'var(--mui-primary)' : '#9aa0a6',
                          flexShrink: 0,
                        }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {(song.Title as string) || 'Unknown'}
                        </Typography>
                        {!isPhone && (
                          <Box sx={{ display: 'flex', alignItems: 'center', overflow: 'hidden', color: 'text.secondary' }}>
                            <Box sx={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
                              <ArtistCell artistNameRaw={song.ArtistName as string | undefined} variant="caption" />
                            </Box>
                            {song.AlbumTitle && (
                              <>
                                <Typography variant="caption" sx={{ flexShrink: 0, color: 'text.secondary' }}>
                                  &nbsp;·&nbsp;
                                </Typography>
                                <Typography
                                  variant="caption"
                                  noWrap
                                  data-nav-cell="true"
                                  onMouseDown={e => e.stopPropagation()}
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (song.AlbumId != null) navigate(`/main_window/albums/${song.AlbumId as string | number}`);
                                  }}
                                  sx={{
                                    flexShrink: 0,
                                    color: 'text.secondary',
                                    cursor: song.AlbumId != null ? 'pointer' : 'default',
                                    '&:hover': song.AlbumId != null ? { textDecoration: 'underline', color: 'primary.main' } : undefined,
                                  }}
                                >
                                  {song.AlbumTitle as string}
                                </Typography>
                              </>
                            )}
                          </Box>
                        )}
                      </Box>
                      <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
                        {formatDuration(song.Duration)}
                      </Typography>
                    </ListItemButton>
                  ))}
                </Box>
              </Box>
            )}

            {!isAtRoot && subfolders.length === 0 && songs.length === 0 && (
              <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                <Typography>This folder is empty.</Typography>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

export default FolderHierarchy;
