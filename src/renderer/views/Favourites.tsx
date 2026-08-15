import React, { useContext, useEffect } from 'react';
import {
  Alert,
  Button,
  Container,
  Box,
  Grid,
  IconButton,
  LinearProgress,
  Stack,
  Theme,
  Typography,
  ListItemButton,
  useMediaQuery,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router';
import { Icon } from '@iconify/react';
import heartOff24Regular from '@iconify/icons-fluent/heart-off-24-regular';
import arrowExport24Regular from '@iconify/icons-fluent/arrow-export-up-24-regular';
import arrowImport24Regular from '@iconify/icons-fluent/arrow-import-24-regular';
import AppDialog from '../components/AppDialog';
import PageToolbar from '../components/PageToolbar';
import ArtistCell from '../components/ArtistCell';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { motion } from 'motion/react';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';
import { useConfirm } from '../utils/useConfirm';
import type { FavouriteEntry } from '../../main/utils/mainProcess';
import { listHeaderSx, listRowSx } from '../styles/listSx';

interface Column {
  label: string;
  key: string;
  align: 'left' | 'center' | 'right';
  flex?: number;
  getNavPath?: (_song: Track) => string | null;
  format?: (_val: unknown) => string;
}

const formatDate = (val: unknown): string => {
  if (!val || typeof val !== 'number') return '';
  return new Date(val).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatDuration = (seconds: unknown): string => {
  const secs = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const columns: Column[] = [
  { label: 'Title', key: 'Title', align: 'left', flex: 3 },
  { label: 'Artist', key: 'ArtistName', align: 'left', flex: 2 },
  {
    label: 'Album',
    key: 'AlbumTitle',
    align: 'left',
    flex: 2,
    getNavPath: song => (song.AlbumId != null ? `/main_window/albums/${song.AlbumId}` : null),
  },
  { label: 'Favourited', key: 'FavouritedAt', align: 'center', flex: 1, format: formatDate },
  { label: 'Duration', key: 'Duration', align: 'right', flex: 1, format: formatDuration },
];

const getVisibleColumns = (isPhone: boolean): Column[] => (isPhone ? columns.slice(0, 2) : columns);

interface ExportResult {
  success?: boolean;
  canceled?: boolean;
  error?: string;
  filePath?: string;
  exported?: number;
}

interface ImportResult {
  success?: boolean;
  canceled?: boolean;
  error?: string;
  imported?: number;
  skipped?: number;
  failed?: FavouriteEntry[];
}

interface TransferReport {
  kind: 'export' | 'import';
  error?: string;
  exported?: number;
  filePath?: string;
  imported?: number;
  skipped?: number;
  failed?: FavouriteEntry[];
}

// Width of the trailing remove-button cell; the header reserves the same space.
const ACTION_WIDTH = 48;

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

const getFlex = (col: Column, isPhone: boolean): number => (isPhone ? 1 : (col.flex ?? 1));

const HeaderRow: React.FC<{ isPhone: boolean }> = ({ isPhone }) => {
  const visibleColumns = getVisibleColumns(isPhone);
  return (
    <Box sx={listHeaderSx}>
      {visibleColumns.map(col => (
        <div
          key={col.label}
          style={{
            flex: getFlex(col, isPhone),
            padding: '8px 16px',
            textAlign: col.align,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {col.label}
        </div>
      ))}
      <div style={{ width: ACTION_WIDTH, flexShrink: 0 }} />
    </Box>
  );
};

const Favourites: React.FC = () => {
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration('favourites');
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const listRef = React.useRef<FixedSizeList | null>(null);

  const handleScroll = React.useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const {
    data: songs = [] as Track[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.FAVOURITE_SONGS],
    queryFn: () => invokeEventToMainProcess('get-favourite-songs', undefined) as Promise<Track[]>,
  });

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

  const handleSongClick = React.useCallback(
    (clickedIndex: number): void => {
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

  // The main process broadcasts library-updated, which refreshes this list.
  const handleRemove = React.useCallback(
    async (song: Track): Promise<void> => {
      const ok = await confirm({
        title: 'Remove from Favourites',
        message: `Remove "${(song.Title as string) || 'this song'}" from your favourites?`,
        detail: 'The song stays in your library; only the favourite is removed.',
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!ok) return;
      await invokeEventToMainProcess('toggle-favourite', { trackId: song.Id });
    },
    [confirm, invokeEventToMainProcess]
  );

  // ── Export / import ───────────────────────────────────────────────────────
  const [report, setReport] = React.useState<TransferReport | null>(null);
  const [busy, setBusy] = React.useState(false);

  const handleExport = React.useCallback(async (): Promise<void> => {
    setBusy(true);
    const res = (await invokeEventToMainProcess('export-favourites', undefined)) as ExportResult;
    setBusy(false);
    if (res?.canceled) return;
    setReport(
      res?.success
        ? { kind: 'export', exported: res.exported, filePath: res.filePath }
        : { kind: 'export', error: res?.error || 'Export failed' }
    );
  }, [invokeEventToMainProcess]);

  const handleImport = React.useCallback(async (): Promise<void> => {
    setBusy(true);
    const res = (await invokeEventToMainProcess('import-favourites', undefined)) as ImportResult;
    setBusy(false);
    if (res?.canceled) return;
    setReport(
      res?.success
        ? { kind: 'import', imported: res.imported, skipped: res.skipped, failed: res.failed ?? [] }
        : { kind: 'import', error: res?.error || 'Import failed' }
    );
  }, [invokeEventToMainProcess]);

  const focusTrackId = (location.state as { focusTrackId?: string | number } | null)?.focusTrackId;
  const focusTs = (location.state as { _ts?: number } | null)?._ts;
  useEffect(() => {
    if (focusTrackId == null || !songs.length || !listRef.current) return;
    const idx = songs.findIndex(s => s.Id === focusTrackId);
    if (idx >= 0) listRef.current.scrollToItem(idx, 'center');
  }, [focusTrackId, focusTs, songs]);

  const Row = React.useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const song = songs[index];
      const visibleColumns = getVisibleColumns(isPhone);

      return (
        <ListItemButton
          style={style}
          selected={song.Id === state.track?.Id}
          sx={listRowSx(index)}
          onClick={e => {
            if ((e.target as HTMLElement).closest('[data-nav-cell]')) return;
            handleSongClick(index);
          }}
        >
          {visibleColumns.map(col => {
            const navPath = col.getNavPath?.(song) ?? null;
            const cellValue = col.format
              ? col.format(song[col.key])
              : (song[col.key] as string) || '';

            return (
              <Box
                key={col.label}
                sx={{
                  flex: getFlex(col, isPhone),
                  px: 2,
                  minWidth: 0,
                  textAlign: col.align,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {col.key === 'ArtistName' ? (
                  <ArtistCell artistNameRaw={song.ArtistName as string | undefined} />
                ) : navPath ? (
                  <Typography
                    variant="body2"
                    noWrap
                    data-nav-cell="true"
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      navigate(navPath);
                    }}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                    }}
                  >
                    {cellValue}
                  </Typography>
                ) : (
                  <Typography variant="body2" noWrap>
                    {cellValue}
                  </Typography>
                )}
              </Box>
            );
          })}
          <Box sx={{ width: ACTION_WIDTH, flexShrink: 0, textAlign: 'center' }}>
            <IconButton
              size="small"
              aria-label="remove from favourites"
              title="Remove from Favourites"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                void handleRemove(song);
              }}
              sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
            >
              <Icon icon={heartOff24Regular} width={18} />
            </IconButton>
          </Box>
        </ListItemButton>
      );
    },
    [songs, isPhone, state.track?.Id, handleSongClick, handleRemove, navigate]
  );

  if (isLoading)
    return (
      <div>
        <LinearProgress color="primary" sx={{ borderRadius: 1 }} />
      </div>
    );
  if (error) return <div>Error fetching favourites</div>;

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
      <PageToolbar
        title="Favourites"
        action={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              disabled={busy || songs.length === 0}
              startIcon={<Icon icon={arrowExport24Regular} />}
              onClick={() => void handleExport()}
            >
              Export
            </Button>
            <Button
              variant="contained"
              disabled={busy}
              startIcon={<Icon icon={arrowImport24Regular} />}
              onClick={() => void handleImport()}
            >
              Import
            </Button>
          </Stack>
        }
      />
      <Container
        maxWidth="xl"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {songs.length === 0 ? (
          <Typography sx={{ p: 4, opacity: 0.6 }}>
            No favourites yet — tap the heart on the album art while a song is playing.
          </Typography>
        ) : (
          <>
            <HeaderRow isPhone={isPhone} />
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', overflowX: 'hidden' }}>
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                  <FixedSizeList
                    ref={listRef}
                    height={height}
                    overscanCount={100}
                    itemCount={songs.length}
                    itemSize={43}
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

      <AppDialog
        open={report !== null}
        onClose={() => setReport(null)}
        title={report?.kind === 'export' ? 'Export favourites' : 'Import favourites'}
      >
        <Stack spacing={1.5}>
          {report?.error && <Alert severity="error">{report.error}</Alert>}

          {report?.exported !== undefined && (
            <>
              <Alert severity="success">
                Exported {report.exported} favourite{report.exported === 1 ? '' : 's'}.
              </Alert>
              <Typography variant="caption" color="text.secondary">
                {report.filePath}
              </Typography>
            </>
          )}

          {report?.imported !== undefined && (
            <Alert severity={report.failed?.length ? 'warning' : 'success'}>
              Added {report.imported}
              {report.skipped ? `, ${report.skipped} already favourited` : ''}
              {report.failed?.length ? `, ${report.failed.length} not found in your library` : ''}.
            </Alert>
          )}

          {/* Named one by one: matching is by file hash then filename, so a miss
              means the file is missing, renamed, or re-encoded. */}
          {!!report?.failed?.length && (
            <>
              <Typography variant="body2">Could not be matched:</Typography>
              <Box sx={{ maxHeight: 260, overflow: 'auto' }}>
                {report.failed.map((entry, i) => (
                  <Stack key={`${entry.file}-${i}`} sx={{ py: 0.5 }}>
                    <Typography variant="body2" noWrap>
                      {entry.title || entry.file}
                      {entry.artist ? ` — ${entry.artist}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {entry.file}
                    </Typography>
                  </Stack>
                ))}
              </Box>
            </>
          )}

          <Stack direction="row" justifyContent="flex-end">
            <Button onClick={() => setReport(null)}>Close</Button>
          </Stack>
        </Stack>
      </AppDialog>
    </Grid>
  );
};

export default Favourites;
