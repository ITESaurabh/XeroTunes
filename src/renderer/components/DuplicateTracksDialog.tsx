import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AppDialog from './AppDialog';
import { useIpc } from '../state/ipc';
import { useConfirm } from '../utils/useConfirm';

interface DuplicateTrack {
  Id: number;
  Title: string;
  Uri: string;
  Duration: number | null;
  ArtistName: string | null;
  AlbumTitle: string | null;
  DateAdded: number | null;
}

interface DuplicateGroup {
  fileHash: string;
  tracks: DuplicateTrack[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  return `${mins}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

interface DuplicateTracksDialogProps {
  open: boolean;
  onClose: () => void;
}

const DuplicateTracksDialog: React.FC<DuplicateTracksDialogProps> = ({ open, onClose }) => {
  const { invokeEventToMainProcess } = useIpc();
  const confirm = useConfirm();
  const [groups, setGroups] = React.useState<DuplicateGroup[] | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [ignoredCount, setIgnoredCount] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setGroups(null);
    setError(null);
    Promise.all([
      invokeEventToMainProcess('find-duplicate-tracks'),
      invokeEventToMainProcess('get-ignored-track-count'),
    ])
      .then(([found, ignored]) => {
        const list = found as DuplicateGroup[];
        setGroups(list);
        setIgnoredCount(Number(ignored) || 0);
        // Keep the oldest copy: main orders by DateAdded, and the first-added is
        // the one most likely to be referenced by a playlist.
        setSelected(new Set(list.flatMap(g => g.tracks.slice(1).map(t => t.Id))));
      })
      .catch((err: unknown) => {
        console.error('Error finding duplicate tracks:', err);
        setError(String(err));
        setGroups([]);
      });
  }, [invokeEventToMainProcess]);

  React.useEffect(() => {
    if (open) load();
  }, [open, load]);

  const toggle = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const handleRemove = async () => {
    const ok = await confirm({
      title: 'Remove from library?',
      message: `${selected.size} track${selected.size === 1 ? '' : 's'} will be removed from your library.`,
      detail:
        'The files stay on disk. XeroTunes remembers them so later scans do not add them back — use Restore to undo.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      await invokeEventToMainProcess('remove-tracks-from-library', { trackIds: [...selected] });
      load();
    } catch (err) {
      console.error('Error removing duplicate tracks:', err);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      await invokeEventToMainProcess('restore-ignored-tracks');
      setIgnoredCount(0);
    } catch (err) {
      console.error('Error restoring ignored tracks:', err);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const extraCopies = groups?.reduce((n, g) => n + g.tracks.length - 1, 0) ?? 0;

  return (
    <AppDialog open={open} onClose={busy ? () => undefined : onClose} title="Duplicate Tracks" maxWidth="md">
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          Files that are byte-for-byte identical, grouped together. The same song ripped twice at
          different bitrates is a different file and is not listed here.
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}

        {ignoredCount > 0 && (
          <Alert
            severity="info"
            action={
              <Button size="small" disabled={busy} onClick={handleRestore}>
                Restore
              </Button>
            }
          >
            {ignoredCount} file{ignoredCount === 1 ? '' : 's'} removed from the library but still on
            disk. Restoring lets the next scan pick them up again.
          </Alert>
        )}

        {groups === null ? (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Scanning the library…</Typography>
          </Stack>
        ) : groups.length === 0 ? (
          <Typography variant="body2" sx={{ py: 3 }}>
            No duplicates found.
          </Typography>
        ) : (
          <>
            <Typography variant="subtitle2">
              {groups.length} group{groups.length === 1 ? '' : 's'}, {extraCopies} extra cop
              {extraCopies === 1 ? 'y' : 'ies'}
            </Typography>

            {groups.map(group => (
              <Box key={group.fileHash}>
                <Divider sx={{ mb: 1 }} />
                <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {group.tracks[0].Title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {[group.tracks[0].ArtistName, group.tracks[0].AlbumTitle]
                      .filter(Boolean)
                      .join(' — ')}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${group.tracks.length} copies · ${formatDuration(group.tracks[0].Duration)}`}
                  />
                </Stack>

                {group.tracks.map((track, index) => (
                  <Stack key={track.Id} direction="row" alignItems="center" sx={{ pl: 0.5 }}>
                    <Checkbox
                      size="small"
                      checked={selected.has(track.Id)}
                      onChange={() => toggle(track.Id)}
                      inputProps={{ 'aria-label': `Remove ${track.Uri}` }}
                    />
                    <Tooltip title={track.Uri} placement="top-start">
                      <Typography
                        variant="caption"
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          direction: 'rtl',
                          textAlign: 'left',
                          color: selected.has(track.Id) ? 'text.disabled' : 'text.primary',
                          textDecoration: selected.has(track.Id) ? 'line-through' : 'none',
                        }}
                      >
                        {track.Uri}
                      </Typography>
                    </Tooltip>
                    {index === 0 && (
                      <Chip size="small" label="oldest" sx={{ ml: 1, flexShrink: 0 }} />
                    )}
                  </Stack>
                ))}
              </Box>
            ))}
          </>
        )}

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 1 }}>
          <Button onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy || selected.size === 0}
            onClick={handleRemove}
          >
            {busy ? 'Removing…' : `Remove ${selected.size} from library`}
          </Button>
        </Stack>
      </Stack>
    </AppDialog>
  );
};

export default DuplicateTracksDialog;
