import React, { useContext, useEffect } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Container,
  Box,
  Grid,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router';
import { Icon } from '@iconify/react';
import heartOff24Regular from '@iconify/icons-fluent/heart-off-24-regular';
import arrowExport24Regular from '@iconify/icons-fluent/arrow-export-up-24-regular';
import arrowImport24Regular from '@iconify/icons-fluent/arrow-import-24-regular';
import AppDialog from '../components/AppDialog';
import Empty from '../components/Empty';
import PageToolbar from '../components/PageToolbar';
import ArtistCell from '../components/ArtistCell';
import LibraryTable, {
  TableColumn,
  useLibraryTable,
  type LibraryTableHandle,
} from '../components/LibraryTable';
import SelectionBar, { toEditableTracks, useTrackSelection } from '../components/SelectionBar';
import TagEditorDialog, { EditableTrack } from '../components/TagEditorDialog';
import { useIpc } from '../state/ipc';
import { store, Track } from '../utils/store';
import { QUERY_KEYS } from '../constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { useScrollRestoration } from '../utils/useScrollRestoration';
import { useConfirm } from '../utils/useConfirm';
import type { FavouriteEntry } from '../../main/utils/mainProcess';
import { formatDate, formatDuration } from '../utils/formatDuration';

const columns: TableColumn<Track>[] = [
  { label: 'Title', key: 'Title', align: 'left', flex: 3, gridWidth: 180 },
  {
    label: 'Artist',
    key: 'ArtistName',
    align: 'left',
    flex: 2,
    gridWidth: 140,
    render: song => <ArtistCell artistNameRaw={song.ArtistName as string | undefined} />,
  },
  {
    label: 'Album',
    key: 'AlbumTitle',
    align: 'left',
    flex: 2,
    gridWidth: 140,
    getNavPath: song => (song.AlbumId != null ? `/main_window/albums/${song.AlbumId}` : null),
  },
  {
    label: 'Favourited',
    key: 'FavouritedAt',
    align: 'center',
    flex: 1,
    gridWidth: 120,
    format: formatDate,
  },
  {
    label: 'Duration',
    key: 'Duration',
    align: 'right',
    flex: 1,
    gridWidth: 90,
    format: formatDuration,
  },
];

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

const Favourites: React.FC = () => {
  const { invokeEventToMainProcess } = useIpc();
  const { dispatch, state } = useContext(store);
  const scrollHide = useScrollHidePlayerBar();
  const { initialScrollOffset, saveScrollPosition } = useScrollRestoration('favourites');
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const listRef = React.useRef<LibraryTableHandle | null>(null);

  const handleScroll = React.useCallback(
    (args: { scrollOffset: number }) => {
      saveScrollPosition(args.scrollOffset);
      scrollHide(args);
    },
    [saveScrollPosition, scrollHide]
  );

  const {
    data: favourites = [] as Track[],
    isLoading,
    error,
  } = useQuery({
    queryKey: [QUERY_KEYS.FAVOURITE_SONGS],
    queryFn: () => invokeEventToMainProcess('get-favourite-songs', undefined) as Promise<Track[]>,
  });

  const { rows: songs, view } = useLibraryTable(favourites, columns);
  const { selectedIds, selected, toggleAll, clear, replace } = useTrackSelection(songs);
  const [editTracks, setEditTracks] = React.useState<EditableTrack[] | null>(null);

  useEffect(() => {
    dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    return () => {
      dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
    };
  }, [dispatch]);

  const handleSongClick = React.useCallback(
    (_song: Track, clickedIndex: number): void => {
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

  const handlePlaySelected = React.useCallback(() => {
    if (!selected.length) return;
    dispatch({
      type: 'SET_QUEUE',
      payload: { queue: selected, index: 0, source: location.pathname + location.search },
    });
    dispatch({ type: 'SET_CURR_TRACK', payload: selected[0] });
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  }, [selected, dispatch, location.pathname, location.search]);

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
    if (idx >= 0) listRef.current.scrollToItem(idx);
  }, [focusTrackId, focusTs, songs]);

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
          <Stack direction="row" spacing={0.5}>
            {/* A disabled button fires no events, so Tooltip needs the span to
                hang its listeners on — otherwise the hint vanishes exactly when
                you want to know why the button is dead. */}
            <Tooltip title="Export favourites">
              <span>
                <IconButton
                  aria-label="Export favourites"
                  disabled={busy || songs.length === 0}
                  onClick={() => void handleExport()}
                >
                  <Icon icon={arrowExport24Regular} width={24} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Import favourites">
              <span>
                <IconButton
                  aria-label="Import favourites"
                  disabled={busy}
                  onClick={() => void handleImport()}
                >
                  <Icon icon={arrowImport24Regular} width={24} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        }
      />
      <Container
        maxWidth="xl"
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {songs.length === 0 ? (
          <Empty page="Favourites" hint="Tap the heart on the album art while a song is playing." />
        ) : (
          <>
            <Collapse in={selected.length > 0} sx={{ flexShrink: 0 }}>
              <SelectionBar
                selected={selected}
                total={songs.length}
                onToggleAll={toggleAll}
                onClear={clear}
                onPlay={handlePlaySelected}
                onEditTags={() => setEditTracks(toEditableTracks(selected))}
              />
            </Collapse>
            <LibraryTable
              rows={songs}
              columns={columns}
              getRowId={song => song.Id as string | number}
              view={view}
              isRowActive={song => song.Id === state.track?.Id}
              onRowClick={handleSongClick}
              selection={{ selectedIds, onReplace: replace }}
              listRef={listRef}
              initialScrollOffset={initialScrollOffset}
              onScroll={handleScroll}
              onNavigate={navigate}
              renderRowAction={song => (
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
              )}
            />
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

      {editTracks && (
        <TagEditorDialog
          open
          onClose={() => setEditTracks(null)}
          mode="track"
          tracks={editTracks}
        />
      )}
    </Grid>
  );
};

export default Favourites;
