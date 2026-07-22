import React, { useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Container,
  Box,
  Grid,
  LinearProgress,
  Theme,
  Typography,
  ListItemButton,
  useMediaQuery,
} from '@mui/material';
import { useNavigate } from 'react-router';
import { Icon } from '@iconify/react';
import folderIcon from '@iconify/icons-fluent/folder-24-filled';
import PageToolbar from '../components/PageToolbar';
import ViewModeToggle, { GRID_MIN_PX, GRID_GAP, GRID_ICON_REM } from '../components/ViewModeToggle';
import { useIpc } from '../state/ipc';
import { store } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'motion/react';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';
import { GridSize, ViewMode } from '../../config/app_settings';
import { getFolderViewSettings, setFolderViewSettings } from '../utils/LocStoreUtil';

interface FolderRow {
  Path: string;
  Name: string;
  SongCount: number;
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

const HeaderRow: React.FC<{ isPhone: boolean }> = ({ isPhone }) => (
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
        flex: isPhone ? 1 : 3,
        padding: '8px 16px',
        textAlign: 'left',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      Folder
    </div>
    {!isPhone && (
      <div
        style={{
          flex: 5,
          padding: '8px 16px',
          textAlign: 'left',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        Path
      </div>
    )}
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
      <Icon icon={folderIcon} height={iconSize} style={{ color: '#facc6b', flexShrink: 0 }} />
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
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
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

  const handleFolderClick = useCallback(
    (folder: FolderRow) => {
      navigate(`/main_window/folder-hierarchy?path=${encodeURIComponent(folder.Path)}`);
    },
    [navigate]
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const folder = folders[index];
      return (
        <ListItemButton
          style={style}
          onClick={() => handleFolderClick(folder)}
          onMouseEnter={() => prefetchFolderChildren(folder.Path)}
          onFocus={() => prefetchFolderChildren(folder.Path)}
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
              flex: isPhone ? 1 : 3,
              pl: 2,
              pr: 2,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              overflow: 'hidden',
            }}
          >
            <Icon icon={folderIcon} height="1.25rem" style={{ color: '#facc6b', flexShrink: 0 }} />
            <Typography variant="body2" noWrap fontWeight={500}>
              {folder.Name}
            </Typography>
          </Box>
          {!isPhone && (
            <Box
              sx={{
                flex: 5,
                pl: 2,
                pr: 2,
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              <Typography
                variant="body2"
                noWrap
                sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 12 }}
              >
                {folder.Path}
              </Typography>
            </Box>
          )}
          <Box
            sx={{
              flex: 1,
              pl: 2,
              pr: 3.5,
              minWidth: 0,
              textAlign: 'right',
              overflow: 'hidden',
            }}
          >
            <Typography variant="body2" noWrap>
              {folder.SongCount}
            </Typography>
          </Box>
        </ListItemButton>
      );
    },
    [folders, isPhone, handleFolderClick, prefetchFolderChildren]
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
          <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
            <Typography>No folders with songs yet. Add a Music Folder in Settings.</Typography>
          </Box>
        ) : viewMode === 'grid' ? (
          <Box onScroll={handleGridScroll} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 2 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_MIN_PX[gridSize]}px, 1fr))`,
                gap: GRID_GAP[gridSize],
              }}
            >
              {folders.map(folder => (
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
            <HeaderRow isPhone={isPhone} />
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', overflowX: 'hidden' }}>
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                  <FixedSizeList
                    height={height}
                    overscanCount={50}
                    itemCount={folders.length}
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

export default Folders;
