import React, { useContext, useEffect, useMemo, useCallback, useState } from 'react';
import {
  alpha,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Collapse,
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
import Empty from '../components/Empty';
import SelectionBar, { toEditableTracks, useTrackSelection } from '../components/SelectionBar';
import TagEditorDialog, { EditableTrack } from '../components/TagEditorDialog';
import ArtistCell from '../components/ArtistCell';
import ViewModeToggle, { GRID_MIN_PX, GRID_GAP, GRID_ICON_REM } from '../components/ViewModeToggle';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VariableSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'motion/react';
import { GridSize, ViewMode } from '../../config/app_settings';
import { getFolderViewSettings, setFolderViewSettings } from '../utils/LocStoreUtil';
import { detailBannerBg, gridCardSx } from '../styles/listSx';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { BodyRow, SubFolder, buildFolderRows, gridColumns } from './folderRows';

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
        ...gridCardSx,
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
        },
        textAlign: 'center',
        minWidth: 0,
        userSelect: 'none',
      }}
    >
      <Box
        component="span"
        sx={{
          color: folder.SourceType
            ? 'surfaces.server'
            : folder.IsRoot
              ? 'surfaces.year'
              : 'surfaces.folder',
          flexShrink: 0,
          display: 'flex',
        }}
      >
        <Icon icon={folderIcon} height={iconSize} />
      </Box>
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

/** Pinned row heights; keep in sync with the row styles below. */
const HEADER_H = 40;
const SECTION_GAP_H = 16;
const FOLDER_ROW_H = 40;
const FOLDER_ROOT_ROW_H = 60;
const SONG_ROW_H = 54;
const SONG_ROW_PHONE_H = 34;
const GRID_CARD_H: Record<GridSize, number> = { small: 122, medium: 138, large: 154 };

const FolderListRow: React.FC<{
  folder: SubFolder;
  onClick: () => void;
  onHover: () => void;
}> = React.memo(({ folder, onClick, onHover }) => (
  <ListItemButton
    onDoubleClick={onClick}
    onClick={onClick}
    onMouseEnter={onHover}
    onFocus={onHover}
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1.5,
      borderRadius: 1,
      px: 1.5,
      py: 1,
      height: (folder.IsRoot ? FOLDER_ROOT_ROW_H : FOLDER_ROW_H) - 4,
      '&:hover': { bgcolor: theme => alpha(theme.palette.text.primary, 0.06) },
    }}
  >
    <Box
      component="span"
      sx={{
        color: folder.IsRoot ? 'surfaces.year' : 'surfaces.folder',
        flexShrink: 0,
        display: 'flex',
      }}
    >
      <Icon icon={folderIcon} height="1.5rem" />
    </Box>
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography variant="body2" noWrap fontWeight={500}>
        {folder.Name}
      </Typography>
      {folder.IsRoot && (
        <Typography
          variant="caption"
          noWrap
          sx={{
            display: 'block',
            color: 'text.secondary',
            fontFamily: 'monospace',
            fontSize: 11,
          }}
        >
          {folder.Path}
        </Typography>
      )}
    </Box>
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
      {folder.SongCount} {folder.SongCount === 1 ? 'song' : 'songs'}
    </Typography>
  </ListItemButton>
));
FolderListRow.displayName = 'FolderListRow';

const SongRow: React.FC<{
  song: Track;
  index: number;
  height: number;
  isPhone: boolean;
  isSelected: boolean;
  isCurrent: boolean;
  anySelected: boolean;
  onPlay: (_index: number) => void;
  onToggle: (_index: number, _extend: boolean) => void;
  onOpenAlbum: (_albumId: string | number) => void;
}> = React.memo(
  ({
    song,
    index,
    height,
    isPhone,
    isSelected,
    isCurrent,
    anySelected,
    onPlay,
    onToggle,
    onOpenAlbum,
  }) => (
    <ListItemButton
      data-track-id={song.Id ?? ''}
      onClick={e => {
        if ((e.target as HTMLElement).closest('[data-nav-cell]')) return;
        onPlay(index);
      }}
      selected={isSelected || isCurrent}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        borderRadius: 1,
        px: 1.5,
        py: 0.75,
        height: height - 2,
        '&:hover': { bgcolor: theme => alpha(theme.palette.text.primary, 0.06) },
        '&:hover .rowCheck': { opacity: 1 },
      }}
    >
      <Box
        className="rowCheck"
        data-nav-cell="true"
        onClick={e => {
          e.stopPropagation();
          onToggle(index, e.shiftKey);
        }}
        sx={{
          display: 'flex',
          flexShrink: 0,
          opacity: anySelected ? 1 : 0,
          transition: 'opacity 120ms',
        }}
      >
        <Checkbox size="medium" checked={isSelected} tabIndex={-1} sx={{ p: 0.25 }} />
      </Box>
      <Box
        component="span"
        sx={{
          color: isCurrent ? 'primary.main' : 'text.secondary',
          flexShrink: 0,
          display: 'flex',
        }}
      >
        <Icon icon={musicNoteIcon} height="1.1rem" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {(song.Title as string) || 'Unknown'}
        </Typography>
        {!isPhone && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              color: 'text.secondary',
            }}
          >
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
                    if (song.AlbumId != null) onOpenAlbum(song.AlbumId as string | number);
                  }}
                  sx={{
                    flexShrink: 0,
                    color: 'text.secondary',
                    '&:hover':
                      song.AlbumId != null
                        ? { textDecoration: 'underline', color: 'primary.main' }
                        : undefined,
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
  )
);
SongRow.displayName = 'SongRow';

interface BodyData {
  rows: BodyRow[];
  cols: number;
  gridSize: GridSize;
  songRowH: number;
  isPhone: boolean;
  selectedIds: Set<string | number>;
  currentTrackId: string | number | undefined;
  onOpenFolder: (_path: string) => void;
  onPrefetch: (_path: string) => void;
  onPlaySong: (_index: number) => void;
  onToggleSong: (_index: number, _extend: boolean) => void;
  onOpenAlbum: (_albumId: string | number) => void;
}

const BodyRowRenderer: React.FC<ListChildComponentProps<BodyData>> = ({ index, style, data }) => {
  const row = data.rows[index];
  switch (row.kind) {
    case 'gap':
      return <div style={style} />;
    case 'header':
      return (
        <div style={style}>
          <Typography
            variant="overline"
            sx={{ display: 'block', color: 'text.secondary', pl: 1, letterSpacing: 1 }}
          >
            {row.label}
          </Typography>
        </div>
      );
    case 'grid':
      return (
        <div style={style}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${data.cols}, minmax(0, 1fr))`,
              gap: GRID_GAP[data.gridSize],
              height: GRID_CARD_H[data.gridSize],
            }}
          >
            {row.folders.map(sf => (
              <SubFolderCard
                key={sf.Path}
                folder={sf}
                iconSize={GRID_ICON_REM[data.gridSize]}
                onClick={() => data.onOpenFolder(sf.Path)}
                onHover={() => data.onPrefetch(sf.Path)}
              />
            ))}
          </Box>
        </div>
      );
    case 'folder':
      return (
        <div style={style}>
          <FolderListRow
            folder={row.folder}
            onClick={() => data.onOpenFolder(row.folder.Path)}
            onHover={() => data.onPrefetch(row.folder.Path)}
          />
        </div>
      );
    case 'song':
      return (
        <div style={style}>
          <SongRow
            song={row.song}
            index={row.index}
            height={data.songRowH}
            isPhone={data.isPhone}
            isSelected={row.song.Id != null && data.selectedIds.has(row.song.Id)}
            isCurrent={row.song.Id === data.currentTrackId}
            anySelected={data.selectedIds.size > 0}
            onPlay={data.onPlaySong}
            onToggle={data.onToggleSong}
            onOpenAlbum={data.onOpenAlbum}
          />
        </div>
      );
  }
};

const FolderHierarchy: React.FC = () => {
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const { invokeEventToMainProcess, sendEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentPath = searchParams.get('path');
  const listRef = React.useRef<VariableSizeList | null>(null);
  const [bodyWidth, setBodyWidth] = useState(0);

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => getFolderViewSettings('folderHierarchy').viewMode
  );
  const [gridSize, setGridSize] = useState<GridSize>(
    () => getFolderViewSettings('folderHierarchy').gridSize
  );

  const handleScroll = useScrollHidePlayerBar<{ scrollOffset: number }>();

  const handleResize = useCallback(({ width }: { width: number }) => setBodyWidth(width), []);

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

  const subfolders = useMemo(() => children?.subfolders ?? [], [children]);
  const songs = useMemo(() => (children?.songs ?? []) as Track[], [children]);

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

  const { selectedIds, selected, toggleAt, toggleAll, clear } = useTrackSelection(songs);
  const [editTracks, setEditTracks] = useState<EditableTrack[] | null>(null);

  // Walking into another folder ends the selection; the ids no longer belong to
  // anything on screen.
  useEffect(() => clear(), [currentPath, clear]);

  const handlePlaySelected = useCallback(() => {
    if (!selected.length) return;
    dispatch({
      type: 'SET_QUEUE',
      payload: { queue: selected, index: 0, source: location.pathname + location.search },
    });
    dispatch({ type: 'SET_CURR_TRACK', payload: selected[0] });
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  }, [selected, dispatch, location.pathname, location.search]);

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

  const isAtRootPath = !currentPath;

  const cols = useMemo(
    () => gridColumns(bodyWidth, GRID_MIN_PX[gridSize], GRID_GAP[gridSize] * 8),
    [bodyWidth, gridSize]
  );
  const songRowH = isPhone ? SONG_ROW_PHONE_H : SONG_ROW_H;

  const rows = useMemo(
    () =>
      buildFolderRows(subfolders, songs, {
        grid: viewMode === 'grid',
        cols,
        isAtRoot: isAtRootPath,
      }),
    [subfolders, songs, viewMode, cols, isAtRootPath]
  );

  const getItemSize = useCallback(
    (index: number) => {
      const row = rows[index];
      switch (row.kind) {
        case 'header':
          return HEADER_H;
        case 'gap':
          return SECTION_GAP_H;
        case 'grid':
          return GRID_CARD_H[gridSize] + GRID_GAP[gridSize] * 8;
        case 'folder':
          return row.folder.IsRoot ? FOLDER_ROOT_ROW_H : FOLDER_ROW_H;
        case 'song':
          return songRowH;
      }
    },
    [rows, gridSize, songRowH]
  );

  // VariableSizeList caches measurements; any change to the row model invalidates them.
  useEffect(() => listRef.current?.resetAfterIndex(0), [rows, gridSize, songRowH]);

  const focusTrackId = (location.state as { focusTrackId?: string | number } | null)?.focusTrackId;
  const focusTs = (location.state as { _ts?: number } | null)?._ts;
  useEffect(() => {
    if (focusTrackId == null || !listRef.current) return;
    const idx = rows.findIndex(r => r.kind === 'song' && r.song.Id === focusTrackId);
    if (idx >= 0) listRef.current.scrollToItem(idx, 'center');
  }, [focusTrackId, focusTs, rows]);

  const handleOpenAlbum = useCallback(
    (albumId: string | number) => navigate(`/main_window/albums/${albumId}`),
    [navigate]
  );

  const itemData = useMemo<BodyData>(
    () => ({
      rows,
      cols,
      gridSize,
      songRowH,
      isPhone,
      selectedIds,
      currentTrackId: state.track?.Id,
      onOpenFolder: navigateTo,
      onPrefetch: prefetchChildren,
      onPlaySong: handleSongClick,
      onToggleSong: toggleAt,
      onOpenAlbum: handleOpenAlbum,
    }),
    [
      rows,
      cols,
      gridSize,
      songRowH,
      isPhone,
      selectedIds,
      state.track?.Id,
      navigateTo,
      prefetchChildren,
      handleSongClick,
      toggleAt,
      handleOpenAlbum,
    ]
  );

  const handleRevealInExplorer = useCallback(() => {
    if (!currentPath) return;
    sendEventToMainProcess('reveal-folder', { folderPath: currentPath });
  }, [currentPath, sendEventToMainProcess]);

  const parentPath = currentPath ? getParentPath(currentPath, roots) : null;
  const isAtRoot = isAtRootPath;

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
          background: detailBannerBg,
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
              background: theme => alpha(theme.palette.text.primary, 0.15),
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

      {/* Outside the scroller: it was `position: sticky`, which absolutely
          positioned virtual rows can't honour. */}
      <Collapse in={selected.length > 0} sx={{ flexShrink: 0, px: { xs: 1, md: 2 }, mt: 1 }}>
        <SelectionBar
          selected={selected}
          total={songs.length}
          onToggleAll={toggleAll}
          onClear={clear}
          onPlay={handlePlaySelected}
          onEditTags={() => setEditTracks(toEditableTracks(selected))}
        />
      </Collapse>

      {/* Body */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          mt: 1,
          px: { xs: 1, md: 2 },
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {isLoading && <LinearProgress color="primary" sx={{ borderRadius: 1, mb: 2 }} />}
        {error && <Typography sx={{ p: 3, color: 'error.main' }}>Error loading folder.</Typography>}
        {!isLoading && !error && rows.length === 0 && (
          <Empty
            page={isAtRoot ? 'Folder Hierarchy' : 'folder'}
            hint={isAtRoot ? 'Add a Music Folder in Settings to get started.' : undefined}
          />
        )}
        {!isLoading && !error && rows.length > 0 && (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <AutoSizer onResize={handleResize}>
              {({ height, width }: { height: number; width: number }) => (
                <VariableSizeList
                  ref={listRef}
                  height={height}
                  width={width}
                  itemCount={rows.length}
                  itemSize={getItemSize}
                  itemData={itemData}
                  overscanCount={viewMode === 'grid' ? 10 : 100}
                  onScroll={handleScroll}
                >
                  {BodyRowRenderer}
                </VariableSizeList>
              )}
            </AutoSizer>
          </Box>
        )}
      </Box>

      {editTracks && (
        <TagEditorDialog
          open
          onClose={() => setEditTracks(null)}
          mode="track"
          tracks={editTracks}
        />
      )}
    </Box>
  );
};

export default FolderHierarchy;
