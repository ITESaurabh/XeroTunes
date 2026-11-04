import React from 'react';
import os from 'os';
import {
  Alert,
  alpha,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  ListItem,
  ListItemButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import revealIcon from '@iconify/icons-fluent/folder-arrow-right-24-regular';
import compareIcon from '@iconify/icons-fluent/scales-24-regular';
import AppDialog from './AppDialog';
import QualityCompareDialog from './QualityCompareDialog';
import Empty from './Empty';
import { useIpc } from '../state/ipc';
import { OS_WINDOWS } from '../../config/constants';

const BIN = os.type() === OS_WINDOWS ? 'Recycle Bin' : 'Trash';

interface DuplicateTrack {
  Id: number;
  Title: string;
  Uri: string;
  Duration: number | null;
  BitRate: number | null;
  Extension: string | null;
  ArtistName: string | null;
  AlbumTitle: string | null;
  DateAdded: number | null;
}

interface DuplicateGroup {
  key: string;
  tracks: DuplicateTrack[];
}

type Kind = 'identical' | 'similar';
type TabKind = Kind | 'kept';

interface KeptGroup extends DuplicateGroup {
  /** The tab it came from and goes back to on Restore. */
  kind: Kind;
}

interface Duplicates extends Record<Kind, DuplicateGroup[]> {
  /** Groups the user chose to keep whole, left out of the other two lists. */
  kept: KeptGroup[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  return `${mins}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function formatQuality(track: DuplicateTrack): string {
  return [
    track.BitRate ? `${Math.round(track.BitRate / 1000)} kbps` : null,
    track.Extension?.replace('.', '').toUpperCase(),
  ]
    .filter(Boolean)
    .join(' · ');
}

// Copies usually differ in only one of the two, so each gets its own line.
function splitPath(uri: string): { name: string; folder: string } {
  const cut = Math.max(uri.lastIndexOf('\\'), uri.lastIndexOf('/'));
  return { name: uri.slice(cut + 1), folder: uri.slice(0, cut) };
}

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

interface GroupCardProps {
  group: DuplicateGroup;
  /** Chip on the first copy, the one the group suggests keeping. */
  keepLabel: string;
  showQuality: boolean;
  selected: Set<number>;
  disabled: boolean;
  onToggle: (id: number) => void;
  actionLabel: string;
  onAction: () => void;
  /** Weighs a copy against the group's first; same-song groups only. */
  onCompare?: (track: DuplicateTrack) => void;
}

const GroupCard: React.FC<GroupCardProps> = ({
  group,
  keepLabel,
  showQuality,
  selected,
  disabled,
  onToggle,
  actionLabel,
  onAction,
  onCompare,
}) => {
  const { invokeEventToMainProcess } = useIpc();
  const first = group.tracks[0];
  return (
    <Box
      sx={{
        border: 1,
        borderColor: theme => theme.palette.surfaces.glassBorder,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: theme => theme.palette.surfaces.elevated,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ pl: 1.5, pr: 1, py: 0.75, bgcolor: theme => theme.palette.surfaces.listHeader }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, ...ellipsis }}>
            {first.Title}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={ellipsis}>
            {[
              first.ArtistName,
              first.AlbumTitle,
              `${group.tracks.length} copies`,
              formatDuration(first.Duration),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Box>
        <Button disabled={disabled} onClick={onAction} sx={{ flexShrink: 0 }}>
          {actionLabel}
        </Button>
      </Stack>

      {group.tracks.map((track, index) => {
        const removing = selected.has(track.Id);
        const { name, folder } = splitPath(track.Uri);
        const comparable = !!onCompare && index > 0;
        return (
          <ListItem
            key={track.Id}
            component="div"
            disablePadding
            sx={{ borderTop: 1, borderColor: theme => theme.palette.surfaces.glassBorder }}
            secondaryAction={
              <Stack direction="row">
                {comparable && (
                  <Tooltip title={`Compare with the ${keepLabel} copy`}>
                    <IconButton
                      aria-label={`Compare ${name} with the ${keepLabel} copy`}
                      onClick={() => onCompare(track)}
                    >
                      <Icon icon={compareIcon} width={24} />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Show in file explorer">
                  <IconButton
                    edge="end"
                    aria-label={`Show ${name} in file explorer`}
                    onClick={() =>
                      void invokeEventToMainProcess('reveal-file', { filePath: track.Uri })
                    }
                  >
                    <Icon icon={revealIcon} width={24} />
                  </IconButton>
                </Tooltip>
              </Stack>
            }
          >
            <ListItemButton
              onClick={() => onToggle(track.Id)}
              sx={{
                gap: 1,
                py: 0.5,
                pl: 1,
                // Room for the second button; ListItem only reserves one.
                ...(comparable && { pr: 12 }),
                ...(removing && {
                  bgcolor: theme => alpha(theme.palette.error.main, 0.16),
                  '&:hover': { bgcolor: theme => alpha(theme.palette.error.main, 0.22) },
                }),
              }}
            >
              <Checkbox
                color="error"
                checked={removing}
                tabIndex={-1}
                disableRipple
                inputProps={{ 'aria-label': `Remove ${track.Uri}` }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={ellipsis}>
                    {name}
                  </Typography>
                  {index === 0 && (
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={keepLabel}
                      sx={{ flexShrink: 0 }}
                    />
                  )}
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ ...ellipsis, direction: 'rtl', textAlign: 'left' }}
                >
                  {folder}
                </Typography>
              </Box>
              {showQuality && (
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {formatQuality(track)}
                </Typography>
              )}
            </ListItemButton>
          </ListItem>
        );
      })}
    </Box>
  );
};

const TAB_TEXT: Record<TabKind, { title: string; empty: string; help: string }> = {
  identical: {
    title: 'Identical',
    empty: 'No identical tracks',
    help: 'Every copy has the same audio; in MP3 files tags and cover art don’t count. Ticked copies are removed and the oldest is kept.',
  },
  similar: {
    title: 'Same song',
    empty: 'No same-song tracks',
    help: 'Same title, artist, album and length, but different audio: another rip or another bitrate. Tick the copies to remove. “best” is the highest bitrate, which a file re-encoded from a worse copy can fake.',
  },
  kept: {
    title: 'Kept',
    empty: 'No kept tracks',
    help: 'Groups where you chose to keep every copy. Restore puts a group back in the tab it came from. You can still tick copies here to remove them.',
  },
};

const SUGGESTED: Record<Kind, string> = { identical: 'oldest', similar: 'best' };

interface DuplicateTracksDialogProps {
  open: boolean;
  onClose: () => void;
}

const DuplicateTracksDialog: React.FC<DuplicateTracksDialogProps> = ({ open, onClose }) => {
  const { invokeEventToMainProcess } = useIpc();
  const [groups, setGroups] = React.useState<Duplicates | null>(null);
  const [tab, setTab] = React.useState<TabKind>('identical');
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [ignoredCount, setIgnoredCount] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [comparing, setComparing] = React.useState<{
    a: DuplicateTrack;
    b: DuplicateTrack;
  } | null>(null);

  const load = React.useCallback(() => {
    setGroups(null);
    setError(null);
    Promise.all([
      invokeEventToMainProcess('find-duplicate-tracks'),
      invokeEventToMainProcess('get-ignored-track-count'),
    ])
      .then(([found, ignored]) => {
        const list = found as Duplicates;
        setGroups(list);
        // Stay on the open tab after a removal unless it just emptied.
        setTab(t =>
          list[t].length
            ? t
            : ((['identical', 'similar', 'kept'] as const).find(k => list[k].length) ?? 'identical')
        );
        setIgnoredCount(Number(ignored) || 0);
        // Keep the oldest identical copy: main orders by DateAdded, and the
        // first-added is the one most likely to be referenced by a playlist.
        // Same-song groups are left unticked; picking the better file is a guess.
        setSelected(new Set(list.identical.flatMap(g => g.tracks.slice(1).map(t => t.Id))));
      })
      .catch((err: unknown) => {
        console.error('Error finding duplicate tracks:', err);
        setError(String(err));
        setGroups({ identical: [], similar: [], kept: [] });
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
    try {
      // Called directly rather than through useConfirm, which only reports the button.
      const choice = (await invokeEventToMainProcess('show-confirm', {
        title: 'Remove from library?',
        message: `${selected.size} track${selected.size === 1 ? '' : 's'} will be removed from your library.`,
        detail: `Files left on disk are remembered so later scans do not add them back; Restore undoes that. Deleted files go to the ${BIN}, along with any .lrc lyrics beside them.`,
        confirmLabel: 'Remove',
        destructive: true,
        checkboxLabel: 'Also delete the files',
      })) as { confirmed?: boolean; checkboxChecked?: boolean } | undefined;
      if (!choice?.confirmed) return;

      setBusy(true);
      const result = (await invokeEventToMainProcess('remove-tracks-from-library', {
        trackIds: [...selected],
        deleteFiles: !!choice.checkboxChecked,
      })) as { failed?: string[] } | undefined;
      load();
      // After load(), which clears the error.
      if (result?.failed?.length) {
        setError(
          `${result.failed.length} file${result.failed.length === 1 ? '' : 's'} could not be moved to the ${BIN} (in use, or already gone), so ${result.failed.length === 1 ? 'it was' : 'they were'} only removed from the library:\n${result.failed.join('\n')}`
        );
      }
    } catch (err) {
      console.error('Error removing duplicate tracks:', err);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Both move the group in place rather than reloading, which would reset the
  // ticks in every other group.
  const handleKeep = async (group: DuplicateGroup, kind: Kind) => {
    setBusy(true);
    try {
      await invokeEventToMainProcess('keep-duplicate-group', { key: group.key });
      setGroups(prev =>
        prev
          ? {
              ...prev,
              [kind]: prev[kind].filter(g => g.key !== group.key),
              kept: [...prev.kept, { ...group, kind }],
            }
          : prev
      );
      setSelected(prev => {
        const next = new Set(prev);
        for (const track of group.tracks) next.delete(track.Id);
        return next;
      });
    } catch (err) {
      console.error('Error keeping duplicate group:', err);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUnkeep = async ({ key, tracks, kind }: KeptGroup) => {
    setBusy(true);
    try {
      await invokeEventToMainProcess('unkeep-duplicate-group', { key });
      setGroups(prev =>
        prev
          ? {
              ...prev,
              kept: prev.kept.filter(g => g.key !== key),
              [kind]: [...prev[kind], { key, tracks }],
            }
          : prev
      );
    } catch (err) {
      console.error('Error moving kept duplicate group back:', err);
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

  const hasAny =
    !!groups &&
    (groups.identical.length > 0 || groups.similar.length > 0 || groups.kept.length > 0);

  return (
    <AppDialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Duplicate Tracks"
      maxWidth="md"
      contentSx={{ p: 0 }}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy || selected.size === 0}
            onClick={handleRemove}
          >
            {busy ? 'Working…' : `Remove ${selected.size} from library`}
          </Button>
        </>
      }
    >
      {hasAny && (
        <Tabs
          value={tab}
          variant="fullWidth"
          onChange={(_, v: TabKind) => setTab(v)}
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          {(['identical', 'similar', 'kept'] as const).map(kind => (
            <Tab
              key={kind}
              value={kind}
              label={`${TAB_TEXT[kind].title} (${groups[kind].length})`}
            />
          ))}
        </Tabs>
      )}

      <Stack spacing={2} sx={{ p: 2 }}>
        {error && (
          <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>
            {error}
          </Alert>
        )}

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
        ) : !hasAny ? (
          <Empty compact page="Duplicates" title="No duplicate tracks" sx={{ pb: 3 }} />
        ) : groups[tab].length === 0 ? (
          <Empty compact page={TAB_TEXT[tab].title} title={TAB_TEXT[tab].empty} sx={{ pb: 3 }} />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {TAB_TEXT[tab].help}
            </Typography>
            {tab === 'kept'
              ? groups.kept.map(group => (
                  <GroupCard
                    key={group.key}
                    group={group}
                    keepLabel={SUGGESTED[group.kind]}
                    showQuality={group.kind === 'similar'}
                    selected={selected}
                    disabled={busy}
                    onToggle={toggle}
                    actionLabel="Restore"
                    onAction={() => handleUnkeep(group)}
                    onCompare={
                      group.kind === 'similar'
                        ? track => setComparing({ a: group.tracks[0], b: track })
                        : undefined
                    }
                  />
                ))
              : groups[tab].map(group => (
                  <GroupCard
                    key={group.key}
                    group={group}
                    keepLabel={SUGGESTED[tab]}
                    showQuality={tab === 'similar'}
                    selected={selected}
                    disabled={busy}
                    onToggle={toggle}
                    actionLabel={group.tracks.length === 2 ? 'Keep both' : 'Keep all'}
                    onAction={() => handleKeep(group, tab)}
                    onCompare={
                      tab === 'similar'
                        ? track => setComparing({ a: group.tracks[0], b: track })
                        : undefined
                    }
                  />
                ))}
          </>
        )}
      </Stack>

      <QualityCompareDialog
        open={comparing !== null}
        onClose={() => setComparing(null)}
        a={
          comparing
            ? { uri: comparing.a.Uri, label: 'suggested copy', duration: comparing.a.Duration }
            : null
        }
        b={
          comparing
            ? { uri: comparing.b.Uri, label: 'other copy', duration: comparing.b.Duration }
            : null
        }
      />
    </AppDialog>
  );
};

export default DuplicateTracksDialog;
