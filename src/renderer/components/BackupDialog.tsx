import React from 'react';
import { Button, Checkbox, Divider, FormControlLabel, Stack, Typography } from '@mui/material';
import AppDialog from './AppDialog';
import { BACKUP_PARTS, type BackupCounts, type BackupPart } from '../../config/backupParts';

interface BackupDialogProps {
  open: boolean;
  mode: 'backup' | 'restore';
  /** From the library when backing up, from the file when restoring. */
  counts: BackupCounts;
  createdAt?: number;
  /** Parts in the backup that only a newer version can restore. */
  unsupported?: number;
  onClose: () => void;
  onConfirm: (_parts: BackupPart[]) => void;
}

const BackupDialog: React.FC<BackupDialogProps> = ({
  open,
  mode,
  counts,
  createdAt,
  unsupported = 0,
  onClose,
  onConfirm,
}) => {
  const parts = React.useMemo(() => BACKUP_PARTS.filter(p => (counts[p.id] ?? 0) > 0), [counts]);
  const [selected, setSelected] = React.useState<Set<BackupPart>>(new Set());

  React.useEffect(() => {
    if (open) setSelected(new Set(parts.filter(p => p.defaultOn).map(p => p.id)));
  }, [open, parts]);

  const toggle = (id: BackupPart) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allSelected = parts.length > 0 && selected.size === parts.length;
  const restoring = mode === 'restore';

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={restoring ? 'Restore' : 'Back Up'}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            disableElevation
            disabled={selected.size === 0}
            onClick={() => onConfirm(parts.filter(p => selected.has(p.id)).map(p => p.id))}
          >
            {restoring ? 'Restore and Restart' : 'Back Up'}
          </Button>
        </>
      }
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {restoring
            ? `From the backup made ${createdAt ? new Date(createdAt).toLocaleString() : 'earlier'}. Ticked parts are merged into this library.`
            : 'Pick what goes in the backup file. Music files are never included; the library rebuilds from your folders and servers.'}
        </Typography>
        {restoring && unsupported > 0 && (
          <Typography variant="body2" color="warning.main">
            {unsupported === 1 ? '1 part' : `${unsupported} parts`} of this backup need a newer
            version of XeroTunes and will be skipped.
          </Typography>
        )}

        <FormControlLabel
          control={
            <Checkbox
              checked={allSelected}
              indeterminate={selected.size > 0 && !allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(parts.map(p => p.id)))}
            />
          }
          label={<Typography variant="body2">Select All</Typography>}
        />
        <Divider />

        {parts.map(part => (
          <FormControlLabel
            key={part.id}
            sx={{ alignItems: 'flex-start', mr: 0 }}
            control={
              <Checkbox
                checked={selected.has(part.id)}
                onChange={() => toggle(part.id)}
                sx={{ pt: 0.5 }}
              />
            }
            label={
              <Stack sx={{ py: 0.5 }}>
                <Typography variant="body2">
                  {part.label}
                  {part.id !== 'settings' && (
                    <Typography component="span" variant="body2" color="text.secondary">
                      {` · ${counts[part.id]}`}
                    </Typography>
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {part.detail}
                </Typography>
              </Stack>
            }
          />
        ))}
      </Stack>
    </AppDialog>
  );
};

export default BackupDialog;
