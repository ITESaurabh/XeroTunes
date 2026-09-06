import React, { useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Container,
  Box,
  Grid,
  LinearProgress,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router';
import { Icon } from '@iconify/react';
import folderIcon from '@iconify/icons-fluent/folder-24-filled';
import PageToolbar from '../components/PageToolbar';
import Empty from '../components/Empty';
import LibraryTable, { TableColumn, useLibraryTable } from '../components/LibraryTable';
import ViewModeToggle, { GRID_MIN_PX, GRID_GAP, GRID_ICON_REM } from '../components/ViewModeToggle';
import { useIpc } from '../state/ipc';
import { store } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';
import { GridSize, ViewMode } from '../../config/app_settings';
import { getFolderViewSettings, setFolderViewSettings } from '../utils/LocStoreUtil';
import { gridCardSx } from '../styles/listSx';

interface FolderRow {
  Path: string;
  Name: string;
  SongCount: number;
}

const columns: TableColumn<FolderRow>[] = [
  {
    label: 'Folder',
    key: 'Name',
    align: 'left',
    flex: 3,
    gridWidth: 180,
    render: folder => (
      <>
        <Box
          component="span"
          sx={{
            color: 'surfaces.folder',
            flexShrink: 0,
            display: 'inline-flex',
            mr: 1.25,
            verticalAlign: 'middle',
          }}
        >
          <Icon icon={folderIcon} height="1.25rem" />
        </Box>
        <Typography variant="body2" noWrap fontWeight={500} component="span">
          {folder.Name}
        </Typography>
      </>
    ),
  },
  {
    label: 'Path',
    key: 'Path',
    align: 'left',
    flex: 5,
    gridWidth: 220,
    hideOnPhone: true,
    render: folder => (
      <Typography
        variant="body2"
        noWrap
        sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 12 }}
      >
        {folder.Path}
      </Typography>
    ),
  },
  { label: 'Songs', key: 'SongCount', align: 'right', flex: 1, gridWidth: 90, hideOnPhone: false },
];

interface FolderCardProps {
  folder: FolderRow;
  iconSize: string;
  onClick: () => void;
  onHover: () => void;
}

const FolderCard: React.FC<FolderCardProps> = React.memo(
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
      <Box component="span" sx={{ color: 'surfaces.folder', flexShrink: 0, display: 'flex' }}>
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
FolderCard.displayName = 'FolderCard';

const Folders: React.FC = () => {
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch } = useContext(store);
  const queryClient = useQueryClient();
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration('folders');
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => getFolderViewSettings('folders').viewMode
  );
  const [gridSize, setGridSize] = useState<GridSize>(
    () => getFolderViewSettings('folders').gridSize
  );

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setFolderViewSettings('folders', { viewMode: mode });
  }, []);

  const handleGridSize = useCallback((size: GridSize) => {
    setGridSize(size);
    setFolderViewSettings('folders', { gridSize: size });
  }, []);

  const handleScroll = useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const gridScrollHide = useScrollHidePlayerBar<{ scrollTop: number }>({ field: 'scrollTop' });
  const handleGridScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      gridScrollHide({ scrollTop: e.currentTarget.scrollTop });
    },
    [gridScrollHide]
  );

  const {
    data: folders = [] as FolderRow[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.FOLDERS_WITH_SONGS],
    queryFn: () =>
      invokeEventToMainProcess('get-folders-with-songs', undefined) as Promise<FolderRow[]>,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

  const prefetchFolderChildren = useCallback(
    (path: string) => {
      queryClient.prefetchQuery({
        queryKey: [QUERY_KEYS.FOLDER_CHILDREN, path],
        queryFn: () => invokeEventToMainProcess('get-folder-children', { folderPath: path }),
        staleTime: 30_000,
      });
    },
    [queryClient, invokeEventToMainProcess]
  );

  const { rows: sortedFolders, view } = useLibraryTable(folders, columns);

  const handleFolderClick = useCallback(
    (folder: FolderRow) => {
      navigate(`/main_window/folder-hierarchy?path=${encodeURIComponent(folder.Path)}`);
    },
    [navigate]
  );

  const viewToggle = useMemo(
    () => (
      <ViewModeToggle
        viewMode={viewMode}
        gridSize={gridSize}
        onChangeViewMode={handleViewMode}
        onChangeGridSize={handleGridSize}
      />
    ),
    [viewMode, gridSize, handleViewMode, handleGridSize]
  );

  if (isLoading)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Folders" />
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </Box>
    );
  if (error)
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <PageToolbar title="Folders" />
        <Typography sx={{ p: 3, color: 'error.main' }}>Error loading folders</Typography>
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
      <PageToolbar title={`Folders (${folders.length})`} action={viewToggle} />
      <Container
        maxWidth="xl"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {folders.length === 0 ? (
          <Empty page="Folders" hint="Add a Music Folder in Settings to get started." />
        ) : viewMode === 'grid' ? (
          <Box onScroll={handleGridScroll} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 2 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_MIN_PX[gridSize]}px, 1fr))`,
                gap: GRID_GAP[gridSize],
              }}
            >
              {sortedFolders.map(folder => (
                <FolderCard
                  key={folder.Path}
                  folder={folder}
                  iconSize={GRID_ICON_REM[gridSize]}
                  onClick={() => handleFolderClick(folder)}
                  onHover={() => prefetchFolderChildren(folder.Path)}
                />
              ))}
            </Box>
          </Box>
        ) : (
          <>
            <LibraryTable
              rows={sortedFolders}
              columns={columns}
              getRowId={folder => folder.Path}
              view={view}
              rowHeight={48}
              onRowClick={handleFolderClick}
              onRowHover={folder => prefetchFolderChildren(folder.Path)}
              initialScrollOffset={initialScrollOffset}
              onScroll={handleScroll}
            />
          </>
        )}
      </Container>
    </Grid>
  );
};

export default Folders;
